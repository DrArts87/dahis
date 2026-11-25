"""Onafhankelijke controle van tests/fixtures/vectoren.json in Python.

Rekent na wat de standaardbibliotheek kan: PBKDF2, HKDF, HMAC, SHA-256,
AAD-bytes, opvulling, herstelsleutel, registerdigests, hashketen en de
canonieke header. Is het pakket ``cryptography`` aanwezig, dan worden ook alle
AES-GCM-ciphertexts ontsleuteld (interoperabiliteit voor de latere
noodontsleutelaar, docs/formaat.md §15); anders wordt dat deel overgeslagen.

Gebruik:
    python3 -m unittest discover -s tests
"""
import base64
import hashlib
import hmac
import json
import math
import os
import re
import unicodedata
import unittest

VECTOREN = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "vectoren.json")
CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
AAD_TEXT = re.compile(r"^[A-Za-z0-9._:/-]*$")

try:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
except ImportError:  # pragma: no cover - afhankelijk van de omgeving
    AESGCM = None


def unhex(s):
    return bytes.fromhex(s)


def b64(data):
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def from_b64(text):
    if not isinstance(text, str) or len(text) % 4 == 1 or not re.fullmatch(r"[A-Za-z0-9_-]*", text):
        raise ValueError("ongeldige base64url")
    data = base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))
    if b64(data) != text:
        raise ValueError("niet-canonieke base64url")
    return data


def aad(parts):
    items = []
    for p in parts:
        if isinstance(p, bool):
            raise ValueError("ongeldig element")
        if isinstance(p, int):
            if p < 0:
                raise ValueError("negatief getal")
            items.append(str(p))
        elif isinstance(p, str) and AAD_TEXT.match(p):
            items.append(p)
        else:
            raise ValueError("ongeldig element")
    return json.dumps(items, separators=(",", ":")).encode("utf-8")


def hkdf(ikm, salt, info, length=32):
    prk = hmac.new(salt, ikm, hashlib.sha256).digest()
    out, block, counter = b"", b"", 1
    while len(out) < length:
        block = hmac.new(prk, block + info.encode("utf-8") + bytes([counter]), hashlib.sha256).digest()
        out += block
        counter += 1
    return out[:length]


def sha256(*parts):
    h = hashlib.sha256()
    for p in parts:
        h.update(p)
    return h.digest()


def dumps(value):
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False)


def padded_length(value, block):
    return max(1, math.ceil(len(dumps(value).encode("utf-8")) / block)) * block


def base32(data):
    out, acc, bits = "", 0, 0
    for b in data:
        acc, bits = (acc << 8) | b, bits + 8
        while bits >= 5:
            bits -= 5
            out += CROCKFORD[(acc >> bits) & 31]
            acc &= (1 << bits) - 1
    if bits:
        out += CROCKFORD[(acc << (5 - bits)) & 31]
    return out


def check_group(rk):
    h = sha256("dahis/1/herstelcontrole".encode("utf-8"), rk)
    twenty = (h[0] << 12) | (h[1] << 4) | (h[2] >> 4)
    return "".join(CROCKFORD[(twenty >> s) & 31] for s in (15, 10, 5, 0))


def format_recovery_key(rk):
    text = base32(rk) + check_group(rk)
    return "-".join(text[i:i + 4] for i in range(0, len(text), 4))


def parse_recovery_key(text):
    t = re.sub(r"[\s-]", "", text.upper()).replace("I", "1").replace("L", "1").replace("O", "0")
    if len(t) != 56 or any(c not in CROCKFORD for c in t):
        raise ValueError("tikfout")
    acc, bits, out = 0, 0, bytearray()
    for c in t[:52]:
        acc, bits = (acc << 5) | CROCKFORD.index(c), bits + 5
        if bits >= 8:
            bits -= 8
            out.append((acc >> bits) & 0xFF)
            acc &= (1 << bits) - 1
    if len(out) != 32 or bits != 4 or acc != 0 or check_group(bytes(out)) != t[52:]:
        raise ValueError("tikfout")
    return bytes(out)


HEADER_KEYS = ["magic", "format", "epoch", "salt", "kdf", "wrapped_password", "recovery"]


def parse_header(line):
    """Strikt en canoniek, onafhankelijk van crypto.js (docs/formaat.md §11.1)."""
    def no_duplicates(pairs):
        keys = [k for k, _ in pairs]
        if len(keys) != len(set(keys)):
            raise ValueError("dubbele sleutel")
        return dict(pairs)

    h = json.loads(line, object_pairs_hook=no_duplicates)
    if list(h) != HEADER_KEYS or h["magic"] != "dahis-backup" or h["format"] != 1:
        raise ValueError("header")
    if list(h["kdf"]) != ["alg", "iterations", "salt"] or h["kdf"]["alg"] != "PBKDF2-SHA256":
        raise ValueError("kdf")
    if not 600000 <= h["kdf"]["iterations"] <= 10000000:
        raise ValueError("iterations")
    if list(h["wrapped_password"]) != ["iv", "ct"] or list(h["recovery"]) != ["alg", "salt", "iv", "ct"]:
        raise ValueError("velden")
    lengths = [(h["salt"], 16), (h["kdf"]["salt"], 16), (h["wrapped_password"]["iv"], 12),
               (h["wrapped_password"]["ct"], 48), (h["recovery"]["salt"], 16), (h["recovery"]["iv"], 12),
               (h["recovery"]["ct"], 48)]
    for value, n in lengths:
        if len(from_b64(value)) != n:
            raise ValueError("lengte")
    if dumps(h) != line:
        raise ValueError("niet canoniek")
    return h


class VectorenStdlibTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(VECTOREN, encoding="utf-8") as f:
            cls.v = json.load(f)

    def test_pbkdf2(self):
        for c in self.v["pbkdf2"]:
            for pw in (c["password"], c["password_nfd"]):
                kek = hashlib.pbkdf2_hmac("sha256", unicodedata.normalize("NFC", pw).encode("utf-8"),
                                          unhex(c["salt"]), c["iterations"], 32)
                self.assertEqual(kek.hex(), c["kek"])

    def test_hkdf(self):
        for c in self.v["hkdf"]:
            self.assertEqual(hkdf(unhex(c["ikm"]), unhex(c["salt"]), c["info"]).hex(), c["okm"], c["info"])

    def test_aad(self):
        wp, wr = self.v["wrap_password"], self.v["wrap_recovery"]
        self.assertEqual(aad(["dahis/1/wrap", "password", "PBKDF2-SHA256", wp["iterations"], b64(unhex(wp["salt"])),
                              wp["epoch"]]).hex(), wp["aad"])
        self.assertEqual(aad(["dahis/1/wrap", "recovery", "HKDF-SHA256", b64(unhex(wr["salt"])), wr["epoch"]]).hex(),
                         wr["aad"])
        self.assertEqual(aad(self.v["record"]["aad_parts"]).hex(), self.v["record"]["aad"])
        a = self.v["audit"]
        self.assertEqual(aad(["dahis/1/audit", a["kid"], a["epoch"], a["seq"], b64(unhex(a["h_prev"]))]).hex(), a["aad"])
        cp = self.v["checkpoint"]
        self.assertEqual(aad(["dahis/1/checkpoint", cp["kid"], cp["epoch"]]).hex(), cp["aad"])
        kr = self.v["keyring"]
        self.assertEqual(aad(["dahis/1/keyring", kr["kid"], kr["old_epoch"], kr["epoch_of_kid"]]).hex(), kr["aad"])
        b = self.v["backup"]
        self.assertEqual(aad(["dahis/1/backup", 1, b64(sha256(b["line1"].encode("utf-8")))]).hex(), b["aad"])
        for parts in self.v["ongeldig"]["aad"]:
            with self.assertRaises(ValueError):
                aad(parts)

    def test_opvulling(self):
        r = self.v["record"]
        self.assertEqual(padded_length(r["content"], 512), r["plaintext_length"])

    def test_herstelsleutel(self):
        rk = self.v["recovery_key"]
        self.assertEqual(format_recovery_key(unhex(rk["bytes"])), rk["text"])
        for text in rk["geldige_invoer"]:
            self.assertEqual(parse_recovery_key(text).hex(), rk["bytes"])
        for text in rk["ongeldige_invoer"]:
            with self.assertRaises(ValueError):
                parse_recovery_key(text)

    def test_hashes(self):
        r = self.v["record"]
        self.assertEqual(sha256(unhex(r["aad"]), unhex(r["iv"]), unhex(r["ct"])).hex(), r["vh"])
        a = self.v["audit"]
        h = sha256(unhex(a["h_prev"]), a["seq"].to_bytes(8, "big"), a["kid"].to_bytes(4, "big"),
                   unhex(a["iv"]), unhex(a["ct"]))
        self.assertEqual(h.hex(), a["h"])
        sd = self.v["state_digest"]
        self.assertEqual(sha256(b"dahis/1/state", *[unhex(x) for x in sd["vhs"]]).hex(), sd["digest"])
        self.assertEqual(sha256(b"dahis/1/state").hex(), sd["leeg"])

    def test_registers(self):
        wk = sorted(self.v["write_keys_digest"]["list"], key=lambda w: w["kid"])
        parts = [w["kid"].to_bytes(4, "big") + w["epoch"].to_bytes(4, "big") + unhex(w["salt"]) for w in wk]
        self.assertEqual(sha256(b"dahis/1/write_keys", len(wk).to_bytes(4, "big"), *parts).hex(),
                         self.v["write_keys_digest"]["digest"])
        kr = sorted(self.v["keyring_digest"]["list"], key=lambda k: k["epoch"])
        parts = [k["epoch"].to_bytes(4, "big") + k["kid"].to_bytes(4, "big") + unhex(k["iv"]) + unhex(k["ct"]) for k in kr]
        self.assertEqual(sha256(b"dahis/1/keyring", len(kr).to_bytes(4, "big"), *parts).hex(),
                         self.v["keyring_digest"]["digest"])

    def test_reservering(self):
        rs = self.v["reservation"]
        data = aad(["dahis/1/reserve", rs["kid"], rs["until"]])
        self.assertEqual(data.hex(), rs["data"])
        self.assertEqual(hmac.new(unhex(rs["key"]), data, hashlib.sha256).hexdigest(), rs["mac"])

    def test_header(self):
        b = self.v["backup"]
        line1, line2, rest = b["file"].split("\n")
        self.assertEqual(rest, "")
        self.assertEqual(line1, b["line1"])
        self.assertEqual(sha256(line1.encode("utf-8")).hex(), b["line1_sha256"])
        parse_header(line1)
        from_b64(line2)
        for line in self.v["ongeldig"]["header"]:
            with self.assertRaises(ValueError):
                parse_header(line)

    def test_base64url(self):
        for s in self.v["ongeldig"]["base64url"]:
            with self.assertRaises(ValueError):
                from_b64(s)
        for s in self.v["ongeldig"]["base64url_geldig"]:
            self.assertEqual(b64(from_b64(s)), s)


@unittest.skipIf(AESGCM is None, "pakket cryptography niet aanwezig; AES-GCM niet getoetst")
class VectorenAesGcmTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(VECTOREN, encoding="utf-8") as f:
            cls.v = json.load(f)

    def decrypt(self, key_hex, iv_hex, ct_hex, aad_hex):
        return AESGCM(unhex(key_hex)).decrypt(unhex(iv_hex), unhex(ct_hex), unhex(aad_hex))

    def test_wraps(self):
        for w in (self.v["wrap_password"], self.v["wrap_recovery"]):
            self.assertEqual(self.decrypt(w["kek"], w["iv"], w["ct"], w["aad"]).hex(), w["dk"])
        kr = self.v["keyring"]
        self.assertEqual(self.decrypt(kr["key"], kr["iv"], kr["ct"], kr["aad"]).hex(), kr["dk"])

    def test_record_audit_checkpoint(self):
        r = self.v["record"]
        pt = self.decrypt(r["key"], r["iv"], r["ct"], r["aad"])
        self.assertEqual(json.loads(pt.decode("utf-8")), r["content"])
        self.assertEqual(len(pt), r["plaintext_length"])
        a = self.v["audit"]
        self.assertEqual(json.loads(self.decrypt(a["key"], a["iv"], a["ct"], a["aad"]).decode("utf-8")), a["content"])
        cp = self.v["checkpoint"]
        self.assertEqual(json.loads(self.decrypt(cp["key"], cp["iv"], cp["ct"], cp["aad"]).decode("utf-8")), cp["content"])

    def test_backup(self):
        b = self.v["backup"]
        line1, line2, _ = b["file"].split("\n")
        body = from_b64(line2)
        key = hkdf(unhex(b["dk"]), unhex(b["file_salt"]), "dahis/1/sub/backup")
        pt = AESGCM(key).decrypt(body[:12], body[12:], unhex(b["aad"]))
        self.assertEqual(len(pt) % 4096, 0)
        self.assertEqual(json.loads(pt.decode("utf-8")), b["payload"])


if __name__ == "__main__":
    unittest.main()

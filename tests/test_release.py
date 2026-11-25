"""Tests voor tools/release.py en tools/iconen.py (alleen standaardbibliotheek).

Gebruik:
    python3 -m unittest discover -s tests
"""
import hashlib
import io
import os
import shutil
import struct
import sys
import tempfile
import unittest
import zlib
from contextlib import redirect_stdout

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tools"))

import iconen   # noqa: E402
import release  # noqa: E402

SW_SJABLOON = """// kop
// BEGIN RELEASE
const VERSION = '0.1.0';
const CODE_HASH = '';
const FILES = {
};
// EINDE RELEASE
// staart
"""


class ReleaseTest(unittest.TestCase):
    def setUp(self):
        self.app = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.app)
        self.schrijf("index.html", b"<!doctype html>\n")
        self.schrijf("js/app.js", b"console.log(1);\n")
        self.schrijf(".nojekyll", b"")
        self.schrijf("sw.js", SW_SJABLOON.encode("utf-8"))

    def schrijf(self, rel, data):
        pad = os.path.join(self.app, rel)
        os.makedirs(os.path.dirname(pad), exist_ok=True)
        with open(pad, "wb") as f:
            f.write(data)

    def lees_sw(self):
        with open(os.path.join(self.app, "sw.js"), encoding="utf-8", newline="") as f:
            return f.read()

    def draai(self, *args):
        with redirect_stdout(io.StringIO()):
            return release.main(list(args) + ["--app", self.app])

    def test_bestanden_zonder_sw_en_verborgen(self):
        self.assertEqual(release.app_bestanden(self.app), ["index.html", "js/app.js"])

    def test_blok_bevat_hashes_en_rest_blijft(self):
        self.assertEqual(self.draai(), 0)
        sw = self.lees_sw()
        self.assertTrue(sw.startswith("// kop\n"))
        self.assertTrue(sw.endswith("// EINDE RELEASE\n// staart\n"))
        verwacht = hashlib.sha256(b"console.log(1);\n").hexdigest()
        self.assertIn("  'js/app.js': '%s'," % verwacht, sw)
        self.assertIn("const VERSION = '0.1.0';", sw)

    def test_codehash_volgens_documentatie(self):
        self.draai()
        h1 = hashlib.sha256(b"<!doctype html>\n").hexdigest()
        h2 = hashlib.sha256(b"console.log(1);\n").hexdigest()
        tekst = "dahis 0.1.0\n%s  index.html\n%s  js/app.js\n" % (h1, h2)
        verwacht = hashlib.sha256(tekst.encode("utf-8")).hexdigest()
        self.assertIn("const CODE_HASH = '%s';" % verwacht, self.lees_sw())

    def test_check_na_bijwerken_slaagt(self):
        self.draai()
        self.assertEqual(self.draai("--check"), 0)

    def test_check_faalt_na_wijziging(self):
        self.draai()
        self.schrijf("js/app.js", b"console.log(2);\n")
        self.assertEqual(self.draai("--check"), 1)

    def test_check_wijzigt_niets(self):
        voor = self.lees_sw()
        self.assertEqual(self.draai("--check"), 1)
        self.assertEqual(self.lees_sw(), voor)

    def test_nieuwe_versie(self):
        self.assertEqual(self.draai("--versie", "0.2.0"), 0)
        self.assertIn("const VERSION = '0.2.0';", self.lees_sw())
        self.assertEqual(self.draai("--check"), 0)
        self.assertEqual(self.draai("--check", "--versie", "0.3.0"), 1)

    def test_ongeldige_versie(self):
        self.assertEqual(self.draai("--versie", "1.0"), 2)

    def test_zonder_blok_fout(self):
        self.schrijf("sw.js", b"// geen blok\n")
        self.assertEqual(self.draai(), 2)
        with self.assertRaises(ValueError):
            release.vervang_blok("// geen blok\n", "x")

    def test_schrijft_lf(self):
        self.draai()
        with open(os.path.join(self.app, "sw.js"), "rb") as f:
            self.assertNotIn(b"\r\n", f.read())


class IconenTest(unittest.TestCase):
    def lees_png(self, data):
        self.assertEqual(data[:8], b"\x89PNG\r\n\x1a\n")
        pos, blokken = 8, {}
        while pos < len(data):
            (lengte,) = struct.unpack(">I", data[pos:pos + 4])
            soort = data[pos + 4:pos + 8]
            inhoud = data[pos + 8:pos + 8 + lengte]
            (crc,) = struct.unpack(">I", data[pos + 8 + lengte:pos + 12 + lengte])
            self.assertEqual(crc, zlib.crc32(soort + inhoud) & 0xFFFFFFFF)
            blokken[soort] = inhoud
            pos += 12 + lengte
        return blokken

    def test_geldige_png(self):
        for maskable in (False, True):
            data = iconen.png(16, iconen.teken(16, maskable))
            blokken = self.lees_png(data)
            breedte, hoogte = struct.unpack(">II", blokken[b"IHDR"][:8])
            self.assertEqual((breedte, hoogte), (16, 16))
            ruw = zlib.decompress(blokken[b"IDAT"])
            self.assertEqual(len(ruw), 16 * (1 + 16 * 4))

    def test_hoeken_transparant_behalve_maskable(self):
        rond = iconen.teken(32, False)
        vol = iconen.teken(32, True)
        self.assertEqual(rond[0][3], 0)      # alfa van pixel (0, 0)
        self.assertEqual(vol[0][3], 255)

    def test_logopad_compleet(self):
        polygonen = iconen.lees_pad("".join(iconen.LOGO_PAD))
        self.assertEqual(len(polygonen), "".join(iconen.LOGO_PAD).count("M"))
        x0, y0, x1, y1 = iconen.grenzen(polygonen)
        self.assertEqual([round(v) for v in (x0, y0, x1, y1)], [246, 73, 644, 834])

    def test_logo_wit_op_groen(self):
        rijen = iconen.teken(64, True)
        pixels = [rij[i:i + 4] for rij in rijen for i in range(0, len(rij), 4)]
        wit = sum(1 for p in pixels if p[:3] == b"\xff\xff\xff")
        groen = sum(1 for p in pixels if p[:3] == bytes(iconen.ACHTERGROND))
        self.assertTrue(0.03 * len(pixels) < wit < 0.4 * len(pixels))
        self.assertGreater(groen, 0.5 * len(pixels))

    def test_oog_is_gat(self):
        # Even-odd: het oog van de slang (rond 573, 350) is niet gevuld.
        grootte = 256
        polygonen = iconen.lees_pad("".join(iconen.LOGO_PAD))
        x0, y0, x1, y1 = iconen.grenzen(polygonen)
        schaal = iconen.HOOGTE[True] * grootte / (y1 - y0)
        px = int(grootte / 2 + (573 - (x0 + x1) / 2) * schaal)
        py = int(grootte / 2 + (350 - (y0 + y1) / 2) * schaal)
        dekking = iconen.logo_dekking(grootte, iconen.HOOGTE[True])
        self.assertLess(dekking[py][px], iconen.SUBPIXELS ** 2 // 2)
        self.assertEqual(dekking[py][px - 6], iconen.SUBPIXELS ** 2)   # kop van de slang

    def test_deterministisch(self):
        a = iconen.png(24, iconen.teken(24, False))
        b = iconen.png(24, iconen.teken(24, False))
        self.assertEqual(a, b)


if __name__ == "__main__":
    unittest.main()

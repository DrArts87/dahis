"""Zet de versie en de bestandshashes van de app in app/sw.js.

De service worker installeert een nieuwe versie alleen als elk bestand de
SHA-256 heeft die in sw.js staat. Elke wijziging aan de app verandert zo ook
sw.js, zodat de browser de update altijd ziet.

Het blok tussen ``// BEGIN RELEASE`` en ``// EINDE RELEASE`` in sw.js wordt
door dit script geschreven en niet met de hand.

Codehash: SHA-256 (hex) over de UTF-8-tekst

    dahis <versie>\\n
    <sha256>  <pad>\\n       (een regel per bestand, gesorteerd op pad)

Dezelfde waarde staat in de app (instellingen) en komt in de release-notes,
zodat je kunt vergelijken welke code er draait.

Gebruik:
    python3 tools/release.py                  hashes bijwerken, versie gelijk
    python3 tools/release.py --versie 0.2.0   nieuwe versie
    python3 tools/release.py --check          faalt als sw.js niet klopt
"""
import argparse
import hashlib
import os
import re
import sys

BEGIN = "// BEGIN RELEASE"
EINDE = "// EINDE RELEASE"
SW = "sw.js"
VERSIE_RE = re.compile(r"^\d+\.\d+\.\d+$")
BLOK_RE = re.compile(re.escape(BEGIN) + r".*?" + re.escape(EINDE), re.S)
HUIDIGE_VERSIE_RE = re.compile(r"const VERSION = '([^']*)';")


def app_bestanden(app_dir):
    """Alle bestanden onder app_dir behalve sw.js en verborgen bestanden, als
    gesorteerde lijst van paden met '/'."""
    paden = []
    for map_pad, mappen, bestanden in os.walk(app_dir):
        mappen[:] = sorted(m for m in mappen if not m.startswith("."))
        for naam in bestanden:
            if naam.startswith("."):
                continue
            rel = os.path.relpath(os.path.join(map_pad, naam), app_dir).replace(os.sep, "/")
            if rel != SW:
                paden.append(rel)
    return sorted(paden)


def sha256_bestand(pad):
    h = hashlib.sha256()
    with open(pad, "rb") as f:
        for stuk in iter(lambda: f.read(65536), b""):
            h.update(stuk)
    return h.hexdigest()


def code_hash(versie, hashes):
    """Codehash over versie en (pad, hash)-paren, zie de moduledocumentatie."""
    tekst = "dahis %s\n" % versie + "".join("%s  %s\n" % (h, p) for p, h in hashes)
    return hashlib.sha256(tekst.encode("utf-8")).hexdigest()


def maak_blok(app_dir, versie):
    hashes = [(p, sha256_bestand(os.path.join(app_dir, p))) for p in app_bestanden(app_dir)]
    regels = [
        BEGIN + " (geschreven door tools/release.py, niet met de hand wijzigen)",
        "const VERSION = '%s';" % versie,
        "const CODE_HASH = '%s';" % code_hash(versie, hashes),
        "const FILES = {",
    ]
    regels += ["  '%s': '%s'," % (p, h) for p, h in hashes]
    regels += ["};", EINDE]
    return "\n".join(regels)


def huidige_versie(sw_tekst):
    m = HUIDIGE_VERSIE_RE.search(sw_tekst)
    return m.group(1) if m else None


def vervang_blok(sw_tekst, blok):
    if len(BLOK_RE.findall(sw_tekst)) != 1:
        raise ValueError("sw.js moet precies één blok '%s' ... '%s' bevatten" % (BEGIN, EINDE))
    return BLOK_RE.sub(lambda _: blok, sw_tekst)


def main(argv=None):
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    parser = argparse.ArgumentParser(description="Versie en hashes in app/sw.js zetten.")
    parser.add_argument("--versie", help="nieuwe versie, bijv. 0.2.0")
    parser.add_argument("--check", action="store_true", help="alleen controleren")
    parser.add_argument("--app", default=os.path.join(root, "app"), help=argparse.SUPPRESS)
    args = parser.parse_args(argv)

    sw_pad = os.path.join(args.app, SW)
    with open(sw_pad, encoding="utf-8", newline="") as f:
        sw_tekst = f.read()

    if len(BLOK_RE.findall(sw_tekst)) != 1:
        print("app/sw.js moet precies één blok '%s' ... '%s' bevatten" % (BEGIN, EINDE))
        return 2

    versie = args.versie or huidige_versie(sw_tekst)
    if not versie or not VERSIE_RE.match(versie):
        print("Ongeldige of ontbrekende versie: %r (verwacht bijv. 0.2.0)" % versie)
        return 2

    nieuw = vervang_blok(sw_tekst, maak_blok(args.app, versie))

    if args.check:
        if args.versie and args.versie != huidige_versie(sw_tekst):
            print("sw.js heeft versie %s, verwacht %s" % (huidige_versie(sw_tekst), args.versie))
            return 1
        if nieuw != sw_tekst:
            print("app/sw.js past niet bij de bestanden. Draai: python3 tools/release.py")
            return 1
        print("app/sw.js klopt (versie %s)." % versie)
        return 0

    if nieuw != sw_tekst:
        with open(sw_pad, "w", encoding="utf-8", newline="\n") as f:
            f.write(nieuw)
    m = re.search(r"const CODE_HASH = '([0-9a-f]+)';", nieuw)
    print("versie %s, codehash %s" % (versie, m.group(1)))
    return 0


if __name__ == "__main__":
    sys.exit(main())

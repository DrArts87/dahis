"""Controleert dat er geen persoons- of patiëntgegevens in de repository staan.

Faalt als een door git gevolgd bestand:
- een database, back-up, export of .env is, of in data/ staat;
- een BSN bevat dat de 11-proef haalt (dus een mogelijk echt BSN).
  Verzonnen BSN's moeten de 11-proef níet halen, bijv. 123456780.

Een regel met de tekst ``privacy-check: ok`` wordt overgeslagen, voor het
zeldzame geval dat een getal van negen cijfers geen BSN is (een hash of
tijdstempel). Gebruik dit spaarzaam.

Namen, geboortedata en diagnoses zijn niet automatisch te herkennen; die
blijf je zelf nalopen. Het gevonden nummer wordt niet getoond, alleen de plek.

Gebruik:
    python3 tools/privacy_check.py
"""
import os
import re
import subprocess
import sys

FORBIDDEN_SUFFIXES = (
    ".db", ".db-journal", ".db-wal", ".db-shm", ".sqlite", ".sqlite3",
    ".bak", ".backup", ".dump", ".sql", ".csv", ".xlsx", ".pdf", ".dahis",
)
FORBIDDEN_NAMES = (".env",)
ALLOWED_IN_DATA = ("data/.gitkeep",)
IGNORE_MARKER = "privacy-check: ok"

# Precies negen cijfers, niet onderdeel van een langer getal of woord
BSN_RE = re.compile(r"(?<![A-Za-z0-9])\d{9}(?![A-Za-z0-9])")


def valid_bsn(s):
    """True als het nummer de 11-proef haalt, dus mogelijk een echt BSN."""
    if len(s) != 9 or s == "000000000":
        return False
    total = sum(int(c) * w for c, w in zip(s[:8], range(9, 1, -1))) - int(s[8])
    return total % 11 == 0


def tracked_files(root):
    out = subprocess.run(["git", "ls-files", "-z"], cwd=root, check=True,
                         stdout=subprocess.PIPE).stdout
    return [f for f in out.decode("utf-8").split("\0") if f]


def check(root):
    problems = []
    for name in tracked_files(root):
        base = os.path.basename(name)
        if name.startswith("data/") and name not in ALLOWED_IN_DATA:
            problems.append("%s: bestanden in data/ horen niet in de repository" % name)
            continue
        if base.lower().endswith(FORBIDDEN_SUFFIXES) or base in FORBIDDEN_NAMES:
            problems.append("%s: databases, back-ups, exports en .env horen niet in de repository" % name)
            continue
        try:
            with open(os.path.join(root, name), encoding="utf-8") as f:
                lines = f.read().splitlines()
        except (UnicodeDecodeError, OSError):
            continue    # binair of verdwenen bestand
        for n, line in enumerate(lines, 1):
            if IGNORE_MARKER in line:
                continue
            for m in BSN_RE.finditer(line):
                if valid_bsn(m.group(0)):
                    problems.append("%s:%d: mogelijk echt BSN; gebruik een nummer dat de 11-proef niet haalt"
                                    % (name, n))
    return problems


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    problems = check(root)
    for p in problems:
        print(p)
    if problems:
        print("\n%d probleem/problemen gevonden. Zie 'Nooit' in CLAUDE.md." % len(problems))
        return 1
    print("Geen persoons- of patiëntgegevens gevonden in de gevolgde bestanden.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

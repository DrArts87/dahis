"""Bepaalt in CI of de zware tests moeten draaien (issue #26).

Alleen bij een pull request die uitsluitend documentatie wijzigt, mogen de
Node-tests en de browsertests worden overgeslagen. In elk ander geval draait
alles: een ander bestand, een onbekend pad, een lege of mislukte diff, een
push naar main of een handmatige start. De verplichte controles starten
altijd; de selectie zit binnen de workflow (controle.yml).

Gebruik in CI:
    python3 tools/ci_selectie.py <event> < bestanden.txt
Uitvoer: een regel "volledig=1" of "volledig=0" (voor $GITHUB_OUTPUT) en een
uitleg op stderr.
"""
import re
import sys

# Alleen deze paden gelden als documentatie: alles onder docs/ en Markdown in
# de hoofdmap (CLAUDE.md, SECURITY.md). Bewust kort; uitbreiden alleen met
# een expliciete keuze.
DOCS = re.compile(r"^(docs/.+|[^/]+\.md)$")


def volledig(event, bestanden):
    """True als alles moet draaien."""
    if event != "pull_request":
        return True
    paden = [p.strip() for p in bestanden if p.strip()]
    if not paden:
        return True
    return not all(DOCS.match(p) for p in paden)


def main(argv):
    event = argv[1] if len(argv) > 1 else ""
    bestanden = sys.stdin.read().splitlines()
    alles = volledig(event, bestanden)
    if alles:
        sys.stderr.write("Volledige set: niet alleen documentatie gewijzigd (of geen pull request).\n")
    else:
        sys.stderr.write("Alleen documentatie gewijzigd: Node- en browsertests worden overgeslagen.\n")
    print("volledig=" + ("1" if alles else "0"))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

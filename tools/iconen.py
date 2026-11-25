"""Tekent de app-iconen van Dahis als PNG, alleen met de standaardbibliotheek.

Ontwerp: een wit kruis op een donkergroene, afgeronde achtergrond. De
maskable variant vult het hele vlak en houdt het kruis binnen de veilige zone
(de middelste cirkel van 80%), zodat Android er elke vorm van kan maken.

De uitvoer is deterministisch: dezelfde code geeft byte voor byte dezelfde
bestanden.

Gebruik:
    python3 tools/iconen.py
"""
import os
import struct
import sys
import zlib

ACHTERGROND = (0x1F, 0x5C, 0x4A)
KRUIS = (0xFF, 0xFF, 0xFF)
SUBPIXELS = 4   # 4 x 4 monsters per pixel voor gladde randen

ICONEN = (
    # bestandsnaam, grootte, maskable
    ("icon-192.png", 192, False),
    ("icon-512.png", 512, False),
    ("maskable-512.png", 512, True),
)


def in_afgerond_vierkant(x, y, straal):
    """True als (x, y) in het eenheidsvierkant met afgeronde hoeken ligt."""
    cx = min(max(x, straal), 1 - straal)
    cy = min(max(y, straal), 1 - straal)
    return (x - cx) ** 2 + (y - cy) ** 2 <= straal ** 2


def in_kruis(x, y, lengte, breedte):
    """True als (x, y) in een kruis rond het midden van het eenheidsvierkant ligt."""
    dx, dy = abs(x - 0.5), abs(y - 0.5)
    half_l, half_b = lengte / 2, breedte / 2
    return (dx <= half_b and dy <= half_l) or (dy <= half_b and dx <= half_l)


def teken(grootte, maskable):
    """Geeft de pixels als lijst van rijen met RGBA-bytes."""
    schaal = 0.8 if maskable else 1.0
    lengte, breedte = 0.56 * schaal, 0.18 * schaal
    straal = 0.22
    n = SUBPIXELS
    rijen = []
    for py in range(grootte):
        rij = bytearray()
        for px in range(grootte):
            vlak = kruis = 0
            for sy in range(n):
                y = (py + (sy + 0.5) / n) / grootte
                for sx in range(n):
                    x = (px + (sx + 0.5) / n) / grootte
                    if maskable or in_afgerond_vierkant(x, y, straal):
                        vlak += 1
                        if in_kruis(x, y, lengte, breedte):
                            kruis += 1
            totaal = n * n
            if vlak == 0:
                rij += b"\x00\x00\x00\x00"
                continue
            # Kleur binnen het vlak mengen; dekking is de vlakdekking
            k = kruis / vlak
            kleur = [round(a + (b - a) * k) for a, b in zip(ACHTERGROND, KRUIS)]
            rij += bytes(kleur + [round(255 * vlak / totaal)])
        rijen.append(bytes(rij))
    return rijen


def png(grootte, rijen):
    """Codeert RGBA-rijen als PNG-bestand (bytes)."""
    def blok(soort, data):
        inhoud = soort + data
        return struct.pack(">I", len(data)) + inhoud + struct.pack(">I", zlib.crc32(inhoud) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", grootte, grootte, 8, 6, 0, 0, 0)  # 8 bits, RGBA
    ruw = b"".join(b"\x00" + rij for rij in rijen)                    # filter 0 per rij
    return (b"\x89PNG\r\n\x1a\n" + blok(b"IHDR", ihdr)
            + blok(b"IDAT", zlib.compress(ruw, 9)) + blok(b"IEND", b""))


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    map_iconen = os.path.join(root, "app", "icons")
    os.makedirs(map_iconen, exist_ok=True)
    for naam, grootte, maskable in ICONEN:
        pad = os.path.join(map_iconen, naam)
        with open(pad, "wb") as f:
            f.write(png(grootte, teken(grootte, maskable)))
        print("geschreven: app/icons/%s" % naam)
    return 0


if __name__ == "__main__":
    sys.exit(main())

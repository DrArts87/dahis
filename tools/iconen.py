"""Tekent de app-iconen van Dahis als PNG, alleen met de standaardbibliotheek.

Ontwerp: het logo van Dahis (esculaap met bladeren en appel, ontwerp van de
gebruiker) wit op donkergroen #123F32, op een afgeronde achtergrond. Het
logopad is ongewijzigd overgenomen uit het SVG-bestand "wit op groen"
(viewBox 0 0 887 887, even-odd vulling); dezelfde paden staan als symbool
in app/index.html. De maskable variant vult het hele vlak en houdt het logo
binnen de veilige zone (de middelste cirkel van 80%), zodat Android er elke
vorm van kan maken.

De uitvoer is deterministisch: dezelfde code geeft byte voor byte dezelfde
bestanden.

Gebruik:
    python3 tools/iconen.py
"""
import os
import re
import struct
import sys
import zlib

ACHTERGROND = (0x12, 0x3F, 0x32)
LOGO = (0xFF, 0xFF, 0xFF)
SUBPIXELS = 4      # 4 x 4 monsters per pixel voor gladde randen
BEZIER_STAPPEN = 16

ICONEN = (
    # bestandsnaam, grootte, maskable
    ("icon-192.png", 192, False),
    ("icon-512.png", 512, False),
    ("maskable-512.png", 512, True),
)

# Hoogte van het logo als deel van het icoon. Maskable: de hele vorm past
# binnen de cirkel van 80% (logo is ongeveer 400 x 761 eenheden).
HOOGTE = {False: 0.78, True: 0.66}

LOGO_PAD = (
    "M438 831 C436 824 434 804 434 794 C433 789 433 783 432 780 L432 776 443 771 C450 768 455 "
    "765 456 765 C457 765 452 798 448 811 C445 821 440 834 439 834 C439 834 438 833 438 831Z "
    "M400 800 C393 788 393 776 399 763 C406 749 419 738 445 725 C455 721 465 715 467 713 C476 "
    "707 477 699 471 693 L468 691 468 676 C468 669 468 662 469 662 C470 661 483 667 490 672 "
    "C503 680 509 691 509 704 C509 712 508 717 503 724 C495 735 486 741 452 755 C435 762 425 "
    "768 418 775 C411 782 406 791 405 799 C405 802 404 805 404 805 C404 806 402 803 400 800Z "
    "M430 712 C430 704 431 624 432 613 L432 606 445 601 C452 598 459 596 460 596 C461 596 461 "
    "597 460 600 C459 609 458 644 457 675 L457 708 444 714 C437 717 432 720 431 720 C431 720 "
    "431 717 430 712Z "
    "M411 680 C382 671 363 657 354 639 C351 633 351 630 350 623 C349 608 355 595 367 583 C380 "
    "571 394 564 436 549 C467 538 479 532 485 525 C489 520 490 517 490 513 C489 509 484 503 "
    "481 501 C479 500 479 499 480 484 L480 468 483 468 C488 469 506 478 512 483 C527 494 534 "
    "508 533 524 C532 539 523 552 508 562 C499 568 478 578 459 585 C426 597 419 600 409 607 "
    "C390 619 392 636 415 646 L419 648 419 665 C419 674 419 682 419 682 C419 682 415 681 411 "
    "680Z "
    "M437 532 C437 529 438 513 438 497 C440 460 441 456 451 442 C456 436 467 426 468 427 C469 "
    "428 469 494 468 511 L467 526 463 528 C461 528 454 531 448 533 L437 538 437 532Z "
    "M422 504 C416 499 409 490 405 484 C395 465 395 441 406 421 C413 407 426 392 442 381 C452 "
    "373 473 361 485 356 C490 354 502 348 510 344 C529 334 539 331 555 330 C573 329 588 334 "
    "601 343 C604 346 606 348 607 350 C608 354 609 354 613 354 C619 354 628 352 638 348 C641 "
    "346 644 346 644 346 C644 348 635 355 631 357 C628 358 626 360 626 360 C626 360 628 361 "
    "630 362 C635 365 646 374 642 374 C641 373 637 372 633 370 C626 368 613 365 609 365 C607 "
    "365 604 367 602 369 C599 372 594 375 590 377 C579 383 570 385 548 386 C534 387 526 387 "
    "520 389 C498 395 472 408 456 423 C435 441 428 457 428 488 C428 492 428 499 427 502 L426 "
    "507 422 504Z "
    "M577 352 C579 350 579 349 578 348 C575 344 572 343 569 345 C566 347 565 350 568 353 C570 "
    "356 574 356 577 352Z "
    "M303 426 C293 423 283 414 275 402 C267 388 263 368 266 355 C271 331 294 319 317 326 L324 "
    "329 324 322 C328 292 351 270 381 270 L387 270 382 265 C378 260 377 260 372 260 C370 261 "
    "362 262 356 264 C346 266 342 266 330 266 C317 266 316 266 307 263 C286 256 271 244 251 "
    "219 C248 214 245 210 246 210 C246 209 260 202 269 199 C303 187 333 190 356 206 C369 215 "
    "378 226 385 241 L390 251 412 272 434 292 435 282 C436 267 436 239 435 233 C435 230 433 "
    "226 428 220 C408 191 403 176 403 156 C403 140 406 129 416 112 C420 104 433 86 441 78 "
    "L445 73 454 85 C475 114 484 134 484 155 C484 176 478 191 458 219 L451 230 451 261 C451 "
    "278 451 291 452 291 C453 291 462 282 474 271 C495 252 496 250 499 243 C505 231 511 222 "
    "520 214 C544 190 575 185 613 198 C624 202 639 209 639 210 C639 211 629 224 620 234 C610 "
    "245 596 256 586 261 C566 271 548 272 517 265 L506 263 500 267 C487 278 474 293 468 307 "
    "C463 318 461 327 461 342 L461 356 458 358 C456 359 450 362 445 366 C440 369 435 372 435 "
    "372 C434 372 434 370 434 367 C435 365 434 356 434 347 C433 325 429 313 416 298 C406 286 "
    "383 280 367 285 C350 291 340 305 338 322 L338 329 343 327 C347 325 351 325 358 325 C368 "
    "324 369 325 375 328 C387 334 394 344 396 359 C400 386 378 423 356 426 C351 427 341 425 "
    "335 421 L331 419 324 422 C315 426 309 427 303 426Z "
)


def lees_pad(tekst):
    """SVG-pad met M, L, C en Z (absoluut, met herhaalde coördinaten) naar
    een lijst van gesloten polygonen."""
    tokens = re.findall(r"[MLCZ]|-?\d+(?:\.\d+)?", tekst)
    polygonen, huidig, opdracht, i = [], [], None, 0
    punt = (0.0, 0.0)

    def getal():
        nonlocal i
        waarde = float(tokens[i])
        i += 1
        return waarde

    while i < len(tokens):
        tok = tokens[i]
        if tok in "MLCZ":
            opdracht = tok
            i += 1
            if tok == "Z":
                if huidig:
                    polygonen.append(huidig)
                huidig = []
                continue
        if opdracht == "M":
            if huidig:
                polygonen.append(huidig)
            punt = (getal(), getal())
            huidig = [punt]
            opdracht = "L"   # volgende coördinaten zijn lijnstukken
        elif opdracht == "L":
            punt = (getal(), getal())
            huidig.append(punt)
        elif opdracht == "C":
            c1, c2, eind = (getal(), getal()), (getal(), getal()), (getal(), getal())
            x0, y0 = punt
            for s in range(1, BEZIER_STAPPEN + 1):
                t = s / BEZIER_STAPPEN
                u = 1 - t
                x = u * u * u * x0 + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * eind[0]
                y = u * u * u * y0 + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * eind[1]
                huidig.append((x, y))
            punt = eind
        else:
            raise ValueError("Onverwacht in pad: " + tok)
    if huidig:
        polygonen.append(huidig)
    return polygonen


def randen(polygonen):
    out = []
    for poly in polygonen:
        for a, b in zip(poly, poly[1:] + poly[:1]):
            if a[1] != b[1]:
                out.append((a, b))
    return out


def grenzen(polygonen):
    xs = [p[0] for poly in polygonen for p in poly]
    ys = [p[1] for poly in polygonen for p in poly]
    return min(xs), min(ys), max(xs), max(ys)


def logo_dekking(grootte, hoogte):
    """Dekking (0..SUBPIXELS^2) van het logo per pixel, als lijst van rijen.
    Even-odd vulling met horizontale scanlijnen per subrij."""
    polygonen = lees_pad("".join(LOGO_PAD))
    x0, y0, x1, y1 = grenzen(polygonen)
    schaal = hoogte * grootte / (y1 - y0)
    dx = grootte / 2 - (x0 + x1) / 2 * schaal
    dy = grootte / 2 - (y0 + y1) / 2 * schaal
    lijnen = [((a[0] * schaal + dx, a[1] * schaal + dy), (b[0] * schaal + dx, b[1] * schaal + dy))
              for a, b in randen(polygonen)]
    n = SUBPIXELS
    dekking = [[0] * grootte for _ in range(grootte)]
    for sy in range(grootte * n):
        y = (sy + 0.5) / n
        kruisingen = []
        for (ax, ay), (bx, by) in lijnen:
            if (ay <= y < by) or (by <= y < ay):
                kruisingen.append(ax + (y - ay) * (bx - ax) / (by - ay))
        kruisingen.sort()
        rij = dekking[sy // n]
        for k in range(0, len(kruisingen) - 1, 2):
            # subkolommen met middelpunt binnen [links, rechts)
            begin = max(0, int(kruisingen[k] * n - 0.5 + 1 - 1e-9))
            eind = min(grootte * n, int(kruisingen[k + 1] * n - 0.5 + 1 - 1e-9))
            for sx in range(begin, eind):
                rij[sx // n] += 1
    return dekking


def in_afgerond_vierkant(x, y, straal):
    """True als (x, y) in het eenheidsvierkant met afgeronde hoeken ligt."""
    cx = min(max(x, straal), 1 - straal)
    cy = min(max(y, straal), 1 - straal)
    return (x - cx) ** 2 + (y - cy) ** 2 <= straal ** 2


def teken(grootte, maskable):
    """Geeft de pixels als lijst van rijen met RGBA-bytes."""
    logo = logo_dekking(grootte, HOOGTE[maskable])
    straal = 0.22
    n = SUBPIXELS
    totaal = n * n
    rijen = []
    for py in range(grootte):
        rij = bytearray()
        for px in range(grootte):
            if maskable:
                vlak = totaal
            else:
                vlak = 0
                for sy in range(n):
                    y = (py + (sy + 0.5) / n) / grootte
                    for sx in range(n):
                        if in_afgerond_vierkant((px + (sx + 0.5) / n) / grootte, y, straal):
                            vlak += 1
            if vlak == 0:
                rij += b"\x00\x00\x00\x00"
                continue
            # Het logo ligt ruim binnen het vlak: mengen naar logodekking.
            k = min(logo[py][px], vlak) / vlak
            kleur = [round(a + (b - a) * k) for a, b in zip(ACHTERGROND, LOGO)]
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

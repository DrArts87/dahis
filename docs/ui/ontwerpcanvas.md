# Ontwerpcanvas: schermen samen ontwerpen

Grotere UI-wijzigingen en nieuwe schermen ontwerpen we eerst op een
ontwerpcanvas (een Design-artifact op claude.ai). Daar kan de gebruiker zelf
teksten aanpassen, blokken verschuiven en opmerkingen plaatsen, zonder alles
in woorden te beschrijven. Het canvas is een **referentie, geen code**: de app
blijft platte HTML/CSS/JS en wordt pas na een issue, een plan en een pull
request aangepast.

Eerste keer gebruikt bij #29 (instellingen met vaste keuzes) en #32 (vaste
kop en lint).

## Het canvas

- Naam: **Dahis – Schermen**. Er is één canvas voor het hele project.
- Het staat buiten de repository, op het account van de gebruiker, en is
  **privé**. De link staat bewust niet in deze (openbare) repository; Claude
  vindt het canvas op naam in de lijst met artifacts van de gebruiker.
- Pagina's:
  - **Productie**: alle schermen zoals ze op `main` staan, gegroepeerd per
    onderdeel (lint-tabbladen, subschermen van Meer, groene schermen). Elk
    scherm heeft in de titel de versie waarin het voor het laatst veranderde,
    bijvoorbeeld *Instellingen – 0.4.4*; schermen die niet veranderen,
    houden hun versie. Zo is per release te zien wat er anders is.
  - **Voorstellen**: ontwerpen in uitvoering, met het issuenummer in de
    titel, bijvoorbeeld *#29 Instellingen – voorstel*.
  - **Archief**: de opmerkingsdraden van afgeronde of afgewezen voorstellen,
    met een korte notitie. Oude versies van schermen worden niet bewaard (het
    canvas houdt zelf een versiegeschiedenis bij).
- Maat: telefoon 390 × 844; een klein toestel 360 × 640 waar lengte of
  scrollen ertoe doet.
- Stijl: kleuren uit `app/css/app.css`, teksten uit `app/js/i18n/nl.js`,
  iconen uit `app/index.html`, varen en randen uit `app/img/`.

## Regels

- **Alleen verzonnen gegevens**, net als in tests en issues (`CLAUDE.md` §1
  *Nooit*). Geen namen, BSN's, diagnoses of recepten, ook niet als
  voorbeeld. Ook schermafbeeldingen van het canvas in issues volgen die regel.
- Het canvas verandert niets aan de app. Wat er in de app komt, gaat via
  issue, plan, PR en review, zoals altijd.
- In de app komen geen fonts, scripts of andere verbindingen van buiten, ook
  als een ontwerp daar om lijkt te vragen; het ontwerp past zich aan de app
  aan.
- Kleine punten (een tekst, een knop) gaan gewoon als issue met label `ui`;
  daarvoor is geen canvas nodig.

## De ronde

1. **Voorstel**: Claude kopieert het huidige scherm van Productie naar
   Voorstellen en ontwerpt daar, met het issuenummer in de titel. Een nieuw
   scherm begint direct op Voorstellen.
2. **Opmerkingen**: de gebruiker past zelf aan of plaatst een opmerking op
   een onderdeel en stuurt die naar Claude. Claude verwerkt de opmerking op
   het canvas en antwoordt in de draad; de gebruiker sluit de draad.
3. **Vastleggen**: is het ontwerp klaar, dan beschrijft Claude het in een
   issue (label `ui`, met plan, risico's en acceptatiecriteria) of in het
   bestaande issue. Afwijkingen van het ontwerp die bij het bouwen nodig
   blijken, vraagt Claude eerst aan de gebruiker.
4. **Bouwen en bijhouden**: op een topic-branch, volgens `CLAUDE.md` §2–§4.
   In een PR die de UI raakt, houdt Claude het voorstel op het canvas gelijk
   aan de code: wijkt de bouw af van het ontwerp (een tekst, een melding),
   dan past Claude het voorstel aan. De PR-beschrijving noemt de geraakte
   schermen op het canvas.
5. **Na de merge**: eerst geeft Claude in een eigen bericht de releasetekst
   en de teststappen (`CLAUDE.md` §3), zodat de gebruiker meteen kan
   uitbrengen en testen. Daarna, in een tweede bericht, het canvas: het
   voorstel vervangt het scherm op Productie (zelfde plek, nieuwe versie in
   de titel); het oude scherm wordt weggehaald. Alleen de geraakte schermen
   veranderen. De opmerkingsdraden van het voorstel gaan met een korte
   notitie naar Archief (#48).

**Uitzondering**: raakt een PR iets wat op alle schermen staat (kop, lint,
kleuren, zoals #32), dan werkt Claude alle schermen op Productie in één keer
bij. Dat gebeurt met een hulpscript dat de schermen uit de echte app haalt
(wegwerpprofiel, verzonnen gegevens; buiten de repository, zoals de andere
Playwright-scripts); de PR noemt dat.

Het canvas is een kopie van de app en kan dus achterlopen. Twijfel je,
vergelijk dan de versie in de titel met *Meer → Over deze app*.

## Beginnen in een nieuwe chat

Voorbeeld van een eerste bericht:

> Lees `CLAUDE.md` en `docs/ui/ontwerpcanvas.md`. Open het canvas
> *Dahis – Schermen* en maak op Voorstellen een voorstel voor #nn.

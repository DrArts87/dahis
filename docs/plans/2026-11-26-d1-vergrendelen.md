# Plan stap D1: wachttijd na wisselen van app, PBKDF2 2.000.000, werkstand

Status: akkoord gebruiker 2026-11-26 (met de vier beslispunten hieronder)
Datum: 2026-11-26
Hoort bij: [vervolgplan](2026-11-26-vervolgplan.md) stap D1
Soort: `feat`, versie 0.4.0, één PR

## Open issues nagelopen
- [#19](https://github.com/DrArts87/dahis/issues/19) (herinnering om oude
  back-ups op te ruimen): raakt het back-upscherm, dat voor delen toch
  wordt aangepast. **Gaat mee** (`Closes #19`).
- [#18](https://github.com/DrArts87/dahis/issues/18) (biometrie via een
  passkey): raakt ontgrendelen en sessies, wordt niet opgelost (`Zie #18`).

## In het kort
Nu vergrendelt de app zodra je naar een andere app gaat; daardoor werkte
delen via het deelmenu niet. De app krijgt een wachttijd: binnen 5 minuten
terug, dan staat alles er nog; later, dan is hij vergrendeld. Het wachtwoord
wordt beter beschermd met 2.000.000 rondes PBKDF2. De code krijgt een
*werkstand* (scherm en formulier) met een opslagkoppeling die nu niets
bewaart, voor "verder waar je was" in fase 2 en 3.

## Besluiten van de gebruiker (2026-11-26)
| # | Onderwerp | Besluit |
|---|---|---|
| 1 | KDF-upgrade | Bij ontgrendelen met het wachtwoord en `kdf.iterations` lager dan de standaard opnieuw wrappen met `password_change` / `kdf_upgrade`, zoals formaat §12.2 stap 6 al voorschrijft. Het formaat verandert niet |
| 2 | #19 | Meenemen in D1 |
| 3 | Waar de wachttijd geldt | Alleen in de weergave *ontgrendeld* (`ready`) zonder lopende handeling. Bij een lopende handeling, de herstelsleutel in de onboarding, het nieuwe wachtwoord na herstel en het stopscherm na een afwijking blijft direct vergrendelen |
| 4 | Inactiviteit | Terugkomen binnen de wachttijd telt als activiteit; de tijd weg telt niet mee voor de inactiviteitsgrens |

## Taken
1. **Instelling** `lock.awayMinutes` in `settings.js`: 0–15, standaard 5
   (0 = direct). `lock.idleMinutes` blijft 1–15, standaard 3. Een kluis of
   back-up zonder de sleutel krijgt de standaard; record `settings` en
   formaat ongewijzigd. Keuzelijst *Vergrendelen na wisselen van app* onder
   Instellingen → Beveiliging.
2. **Vergrendelen in de controller** (`hidden`, `visible`, `pageClosed`,
   `idleTick`), met een nagebootste klok te testen:
   - verbergen in `ready` zonder handeling en wachttijd > 0: tijdstip
     onthouden en een timer zetten (vergrendelt als JavaScript op de
     achtergrond nog loopt);
   - terugkomen: langer weg dan de wachttijd, of de klok liep terug, dan
     vergrendelen; anders telt het als activiteit;
   - elke andere geheime toestand, wachttijd 0 en `pagehide`: direct
     vergrendelen, zoals nu;
   - inactiviteit: zoals nu, met de klok en activiteit in de controller.
3. **PBKDF2**: `DEFAULT_ITERATIONS` 2.000.000 voor nieuwe wraps (onboarding,
   wachtwoord wijzigen, herstel, terugzetten met nieuw wachtwoord) en de
   KDF-upgrade bij ontgrendelen (besluit 1, nieuwe `kdfUpgradeTx`).
   `MIN_ITERATIONS` blijft 600.000; testvectoren blijven 600.000. Meer →
   Snelheid meten: 600.000, 2.000.000 en 10.000.000. `formaat.md`: alleen de
   beschreven standaard (§2.4, §3.4).
4. **Werkstand** in de controller: `work = {tab, sub, form}` en een koppeling
   `workStore` (`load`, `save`, `clear`), nu alleen `NullWorkStore`. `app.js`
   leest tab en subscherm uit de werkstand. Bij vergrendelen `save` (nu
   niets) en weg uit het geheugen; na ontgrendelen `load` (nu `null`), dan
   Patiënten. Velden voor wachtwoord of herstelsleutel komen nooit in de
   werkstand (regel en test).
5. **Delen** terug op het back-upscherm, naast Downloaden, alleen als
   `navigator.canShare({files})` het bestand accepteert en de wachttijd > 0.
   Proef op de OnePlus; lukt het niet, dan gaat de knop eruit en stelt
   Claude een issue voor. `formaat.md` §11.3 stap 5 bijgewerkt (gedrag van de
   app, geen formaat).
6. **#19**: na downloaden of delen een melding om alleen de laatste vier
   back-ups te bewaren, met de datum van de vorige back-up.
   `onboarding.done.lockText` noemt de wachttijd.
7. **Documenten**: `nen7510.md` (Sessies, Cryptografie, restrisico's
   sessies, Incidenten, Apparaten), `SECURITY.md`, `dpia.md` (besluit
   ondertekend, open punten buiten de repository ingevuld),
   `voor-echte-dossiers.md` (afvinken), vervolgplan, overdracht.

## Tests
- `settings.test`: nieuwe sleutel met grenzen en standaard.
- `controller.test`: wachttijd 0, 5 en 15; terug net vóór en net na de
  wachttijd; klok terug; verbergen tijdens een handeling en bij de
  herstelsleutel; `pagehide`; inactiviteit na terugkomen; werkstand (`save`
  bij vergrendelen, geen geheimen, `load` geeft `null`); KDF-upgrade bij
  600.000 (en niet bij de herstelsleutel of bij 2.000.000).
- `vault.test`: `kdf.iterations` 2.000.000 bij een nieuwe installatie en na
  wachtwoord wijzigen; `kdfUpgradeTx`.
- Playwright in de cloudsessie (wegwerpprofiel): verbergen en terugkomen.

## Risico's
| Risico | Maatregel |
|---|---|
| Sleutels in het geheugen tijdens de wachttijd | Geaccepteerd (DPIA §6); wachttijd 0 mogelijk; alleen in `ready` |
| Android bevriest de app, de timer loopt niet | De controle bij terugkomen is de echte grens; de timer is extra |
| Voorbeeld in *Recente apps* toont het laatste scherm | Proefstap op de OnePlus; restrisico in `nen7510.md` |
| Tests trager door 2.000.000 rondes | Gemeten; zo nodig een parameter in de tests |
| Delen werkt nog steeds niet op de OnePlus | Proefstap; anders knop eruit en issue voorstellen |

## Proef op de OnePlus (na de release van 0.4.0, alleen testgegevens)
1. Versie en codehash kloppen (Meer → Over).
2. Ontgrendelen met het bestaande wachtwoord: werkt; in het logboek
   "Wachtwoordbeveiliging verzwaard"; volgende ontgrendeling ongeveer 0,3 s.
3. Wachttijd 5: naar een andere app en binnen 5 minuten terug, alles staat
   er nog; na meer dan 5 minuten vergrendeld.
4. Wachttijd 0: direct vergrendeld bij wisselen.
5. Back-up maken en **Delen** naar mail of cloud: het deelmenu opent, het
   bestand komt aan, de app is daarna niet vergrendeld (binnen de wachttijd).
6. Melding over de laatste vier back-ups met de datum van de vorige.
7. *Recente apps* na wisselen: wat toont het voorbeeld?

## Acceptatiecriteria
- Binnen de wachttijd terug: hetzelfde scherm zonder ontgrendelen; erna het
  vergrendelscherm; bij 0 als voorheen. Inactiviteit werkt als voorheen.
- Nieuwe wraps en de KDF-upgrade gebruiken 2.000.000; kluizen en back-ups
  met 600.000 blijven werken; formaat en vectoren ongewijzigd.
- Delen getest op de OnePlus, of de knop is eruit en er is een issue
  voorgesteld.
- Documenten bijgewerkt; alle verplichte controles groen.
- Na de merge de releasetekst met codehash (`CLAUDE.md` §3).

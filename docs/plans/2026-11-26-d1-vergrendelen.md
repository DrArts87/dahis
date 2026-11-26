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
   KDF-upgrade bij ontgrendelen (besluit 1; na de review in dezelfde transactie als `unlock`).
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
  wachtwoord wijzigen; KDF-upgrade via `unlockTx`.
- Playwright in de cloudsessie (wegwerpprofiel): verbergen en terugkomen.

## Risico's
| Risico | Maatregel |
|---|---|
| Sleutels in het geheugen tijdens de wachttijd | Geaccepteerd (DPIA §6); wachttijd 0 mogelijk; alleen in `ready` |
| Android bevriest de app, de timer loopt niet | De controle bij terugkomen is de echte grens; de timer is extra |
| Voorbeeld in *Recente apps* toont het laatste scherm | Proefstap op de OnePlus; restrisico in `nen7510.md` |
| Tests trager door 2.000.000 rondes | Gemeten; zo nodig een parameter in de tests |
| Delen werkt nog steeds niet op de OnePlus | Proefstap; anders knop eruit en issue voorstellen |

## Review PR #23 (auditor, 2026-11-26)
Verwerkt na akkoord van de gebruiker op alle punten:

| Punt | Verwerking |
|---|---|
| P1-1 geheime invoer bij wisselen | Geen wachttijd op *Wachtwoord wijzigen* (`SECRET_SUBS`); bij elk verbergen worden wachtwoord- en herstelsleutelvelden gewist (`data-secret`, ook op het vergrendelscherm); opnieuw tekenen zet een waarde alleen terug in een veld van hetzelfde type en dezelfde markering. Daarmee ook een oudere fout opgelost: na wisselen naar de herstelsleutel stond een ingetypt wachtwoord leesbaar in het tekstveld. Tests: `tests/dom.test.mjs`, controller |
| P1-2 back-upstatus | Eén waarschuwing bij het verlaten van het back-upscherm zonder downloaden of delen; opruimtekst vraagt eerst de nieuwe kopie te controleren, noemt de prullenbak, en "in de app gemaakt op". Een bevestigde externe kopie als aparte status: [#24](https://github.com/DrArts87/dahis/issues/24) (formaatbesluit) |
| P1-3 mislukte KDF-upgrade | `unlock` en `password_change`/`kdf_upgrade` in één transactie (`unlockTx` met `password`); getest: mislukte commit, opnieuw proberen, verbergen tijdens de upgrade, precies één `kdf_upgrade` |
| P2 Delen | Uitslag gekoppeld aan de bestandsnaam; knop alleen als `canShare` het concrete bestand accepteert (één keer per back-up bepaald) |
| P2 werkstand | Opslaan en laden wachten hooguit 1 s; geladen werkstand pas na `alive(gen)` |
| P2 formaat | §12.2 stap 6 en §3.7 beschrijven de upgrade zoals gebouwd; back-upbestanden houden hun rondes |
| Praktijktoets | Sessies in `nen7510.md` terug op ◐ tot de proef; proef uitgebreid (hieronder) |
| Nieuwe instelling zichtbaar | Melding na ontgrendelen zolang de instelling niet bewaard is; *Begrepen* bewaart de waarde |
| Cloud en AVG | Teksten: afgesproken cloudmap, niet per mail; `avg.md` (bestemming, prullenbak); open punt in *vóór echte dossiers*; [#25](https://github.com/DrArts87/dahis/issues/25) |

Tweede ronde (auditor, 2026-11-26), verwerkt na akkoord:

| Punt | Verwerking |
|---|---|
| Delen aan een unieke export | Elke export krijgt een volgnummer (`state.backup.id`); de deeluitkomst, de foutmelding en het onthouden deelbare bestand gaan daarvan uit, niet van de bestandsnaam (twee back-ups in dezelfde minuut). Test met twee exports met dezelfde naam en een late uitkomst |
| Invoer alleen binnen hetzelfde formulier | `render()` bepaalt een formuliersleutel (weergave, stap, scherm, vergrendelmodus, invoermodus); bij een ander formulier gaat er niets terug, ook niet bij hetzelfde veld-id (Ontgrendelen en Back-up controleren). Test in `tests/dom.test.mjs` |
| #24 vóór echte dossiers | Als punt op de checklist *vóór echte dossiers*, naast #25 en de proef |

## Proef op de OnePlus (na de release van 0.4.0, alleen testgegevens)
1. Versie en codehash kloppen (Meer → Over).
2. Ontgrendelen met het bestaande wachtwoord: werkt; in het logboek
   "Wachtwoordbeveiliging verzwaard" (één keer); volgende ontgrendeling
   ongeveer 0,3 s. De melding over de nieuwe wachttijd verschijnt; na
   *Begrepen* niet meer.
3. Wachttijd 5: naar een andere app en terug na ongeveer 4,5 minuten: alles
   staat er nog. Terug na ruim 5 minuten: vergrendeld.
4. Scherm uit en weer aan (binnen en na de wachttijd): zelfde uitkomst als 3.
5. Wachttijd 0: direct vergrendeld bij wisselen.
6. Op *Wachtwoord wijzigen* iets intypen en naar een andere app: direct
   vergrendeld. Op het vergrendelscherm een wachtwoord intypen, wisselen en
   terug: het veld is leeg. Wachtwoord intypen en op *Herstelsleutel
   gebruiken* tikken: het veld is leeg.
7. Handmatig vergrendelen (knop Vergrendel) en met de terugknop van Android
   terug: vergrendelscherm, geen gegevens.
8. Back-up maken en **Delen** naar de cloudmap: het deelmenu opent, het
   bestand komt aan, de app is daarna niet vergrendeld. Opnieuw, en het
   delen **annuleren**: geen foutmelding; bij het verlaten van het scherm de
   waarschuwing.
9. De opruimmelding na delen of downloaden, met de datum van de vorige.
10. *Recente apps* na wisselen, bij wachttijd 0 en bij 5: wat toont het
    voorbeeld? Uitkomst in `nen7510.md` (restrisico's sessies).

## Uitkomst proef (2026-11-26, versie 0.4.0)
Uitgevoerd door de gebruiker met de checklist in een privé Claude-document;
alleen testgegevens.

| Stap | Uitkomst | Gevolg |
|---|---|---|
| 1, 3–7, 9 | In orde | *Sessies* in `nen7510.md` naar ☑ |
| 2 | Melding over de nieuwe wachttijd niet gezien; waarschijnlijk gemist of terecht weg (instelling al bewaard) | Geen actie (besluit gebruiker) |
| 8 | Delen mislukt ("Delen is niet gelukt"); annuleren niet te testen | Knop verwijderd in 0.4.2; [#30](https://github.com/DrArts87/dahis/issues/30) |
| 10 | Voorbeeld in Recente apps toont gegevens, bij wachttijd 0 en 5 | 0.4.2 dekt de inhoud af bij verbergen; de proef van 0.4.2 toonde nog steeds gegevens: restrisico geaccepteerd (#37, [#33](https://github.com/DrArts87/dahis/issues/33)) |

**Proef 0.4.2**: versie en codehash; Recente apps bij wachttijd 0 en 5 (voorbeeld zonder gegevens?); terug binnen de wachttijd: inhoud weer zichtbaar; back-up maken en downloaden met de opruimmelding.

## Acceptatiecriteria
- Binnen de wachttijd terug: hetzelfde scherm zonder ontgrendelen; erna het
  vergrendelscherm; bij 0 als voorheen. Inactiviteit werkt als voorheen.
- Nieuwe wraps en de KDF-upgrade gebruiken 2.000.000; kluizen en back-ups
  met 600.000 blijven werken; formaat en vectoren ongewijzigd.
- Delen getest op de OnePlus, of de knop is eruit en er is een issue
  voorgesteld. *Sessies* in `nen7510.md` pas ☑ na de proef.
- Documenten bijgewerkt; alle verplichte controles groen.
- Na de merge de releasetekst met codehash (`CLAUDE.md` §3).

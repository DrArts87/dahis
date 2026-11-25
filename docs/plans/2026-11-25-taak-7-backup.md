# Plan taak 7: back-up maken, controleren en terugzetten

Datum: 2026-11-25. Uitwerking van taak 7 uit het
[plan fase 1](2026-11-25-fase-1-fundament.md) §5. Akkoord gebruiker:
2026-11-25.

## In het kort
De bouwstenen voor de back-up bestaan sinds taak 3 (`vault.js`: export,
bestand bouwen, inlezen, terugzetten). Deze taak zet ze in de app: een
back-up maken en direct controleren, delen of downloaden, een ouder bestand
controleren, terugzetten op een lege opslag met wachtwoord of herstelsleutel,
en een herinnering na 7 dagen. Daarnaast het testbestand van formaat 1, een
lezer per formaatnummer en een meting van grote back-ups op de OnePlus.

## Doel
- Audit A3 afronden: de regel `export` is een poging; een bruikbaar bestand
  blijkt uit een direct volgende `verify_backup` met detail `equal`.
- Acceptatiecriteria plan fase 1 §7: export en import in het auditlog; een
  back-up van profiel A terug te zetten op B; het testbestand van formaat 1
  terug te zetten; geen testwaarde leesbaar in het bestand.
- Voorbereiding op de voorwaarde voor echte dossiers (taak 10): terugzetten
  via beide routes op een lege opslag, een mislukte poging laat de opslag
  leeg.

## Besluiten van de gebruiker (2026-11-25)
1. **`last_backup_at`** wordt vastgelegd in dezelfde transactie als
   `verify_backup` (`equal`), dus vóór het delen. Reden: het deelmenu verbergt
   de app en die vergrendelt dan (herladen). Nadeel, geaccepteerd: wie het
   delen afbreekt, krijgt toch geen herinnering. Formaat §11.3 aangepast.
2. **Een ouder bestand controleren** (interne integriteit) gebeurt vanaf het
   vergrendelscherm, met het wachtwoord of de herstelsleutel van dat bestand.
   Er is dan geen sessie, dus er komt geen regel in het logboek. Formaat
   §11.4 aangepast; de detail `integrity` blijft in formaat 1 bestaan, maar
   de app schrijft hem nu niet.
3. **Delen is de standaard**, downloaden de tweede knop.

## Omvang
- Gewijzigd: `app/js/vault.js` (controle "gelijk aan de export" met de
  datasleutel van de sessie, `verifyBackupTx`, lezer per formaat),
  `app/js/controller.js`, `app/js/app.js`, `app/css/app.css`,
  `app/js/i18n/nl.js`, `app/js/benchmark.js` (meting grote back-up),
  `app/sw.js` (release), tests, `docs/formaat.md` §11.3 en §11.4,
  `docs/reviews/2026-11-25-reviews.md`, `docs/overdracht.md`, het plan
  fase 1.
- Nieuw: `tests/fixtures/testbestand-formaat-1.json`, `tests/maak_testbestand.mjs`,
  `tests/testbestand.test.mjs`.
- Niet: schemawijziging, nieuw formaatnummer, andere regels voor
  vergrendelen, forensisch bestand, bewaarbeleid binnen de app (de app kan
  bestanden buiten zichzelf niet wissen).

## Taken
1. **Back-up maken** (Meer → Back-up): volledige controle op een vers
   ingelezen opslag en de regel `export`; het bestand bouwen in het geheugen;
   dat bestand controleren met de datasleutel van de sessie (de header bevat
   byte voor byte de wraps uit `meta`, de inhoud ontsleutelt, samenhang en
   volledige controle slagen, en `checkpoint` is gelijk aan `seq`, `h` en
   `state` van de `export`-regel); dan `verify_backup` met `equal` en
   `last_backup_at` in één transactie. Pas daarna verschijnen de knoppen
   Delen en Downloaden (een nieuwe tik: Chrome eist een recente tik voor
   delen). Mislukt de controle, dan geen `verify_backup` en de melding
   "Back-up mislukt".
2. **Terugzetten** vanaf het eerste scherm van een lege opslag (ook na
   *Alles wissen*): bestand kiezen (grootte eerst, dan pas inlezen),
   wachtwoord of herstelsleutel; bij de herstelsleutel een nieuw wachtwoord.
   Daarna vergrendelt de app en ontgrendel je met het (nieuwe) wachtwoord.
3. **Ouder bestand controleren** vanaf het vergrendelscherm: bestand kiezen,
   geheim invoeren, uitslag tonen (datum van de back-up, app-versie, aantal
   recordversies en logregels). Er wordt niets geschreven.
4. **Herinnering** op het hoofdscherm als er nog geen back-up is, of de
   laatste 7 dagen of langer geleden (of in de toekomst) is. Het laatste
   onboardingscherm wijst op de eerste back-up.
5. **Lezer per formaatnummer** (nu alleen 1); een onbekend formaat geeft een
   eigen melding ("werk de app bij").
6. **Testbestand** `tests/fixtures/testbestand-formaat-1.json` (het bestand
   als tekst in JSON, want `privacy_check.py` weigert `.dahis`) met verzonnen
   inhoud en een bekend testwachtwoord en testherstelsleutel, gemaakt met
   `tests/maak_testbestand.mjs` (alleen bij een bewuste formaatwijziging).
   Elke versie moet het kunnen terugzetten.
7. **Tests** (Node en `tests/browser.html`): terugzetten met wachtwoord en
   herstelsleutel; een ongeldig of te groot bestand laat de opslag leeg; twee
   keer terugzetten geeft twee verschillende schrijfsleutels; na herstel met
   de herstelsleutel opent alleen het nieuwe wachtwoord; `equal` faalt bij een
   ander bestand of een gewijzigde export; volgorde `export`, `verify_backup`;
   geen testwaarde leesbaar; profiel A naar B in Chromium.
8. **Meting** (Meer → Snelheid meten): een nep-back-up van 64, 128 en 256 MiB
   bouwen en weer openen in het geheugen, met duur en of het lukt.
   Piekgeheugen is vanuit de pagina niet betrouwbaar te meten in Chrome op
   Android; dat wordt vastgelegd.
9. **Documenten**: formaat §11.3/§11.4, reviews (A3 verwerkt), overdracht,
   plan fase 1.

## Uitvoering: afwijkingen en bevindingen
- **Geheugen bij grote back-ups**: de eerste meting liet zien dat `b64()` in
  `crypto.js` de tekst teken voor teken opbouwde: 2,5 GB bij 64 MiB, vastlopen
  bij 250 MiB. Herschreven via een bytebuffer, met dezelfde uitvoer (test
  tegen base64url van Node voor elke restlengte). Nu in Node: 253 MiB maken
  2,6 s, openen 6,2 s, ongeveer 1,4 GB. Het formaat verandert niet.
- **Delen op Android**: Chrome deelt alleen bekende bestandstypen. Lukt `.dahis`
  niet, dan deelt de app dezelfde inhoud als `text/plain` met `.txt` achter de
  naam; lukt ook dat niet, dan de melding om Downloaden te gebruiken. Formaat
  §11.2 vermeldt dit. Akkoord gebruiker 2026-11-25; nog te testen op de
  OnePlus.
- **Teksten**: de regel `export` heet in het logboek nu "Back-up begonnen",
  `verify_backup` met `equal` "Back-up gecontroleerd en klaar".
- **Versie** 0.3.0, zodat de gebruiker de back-up op de OnePlus kan testen na
  een versietag.

## Risico's
| Risico | Maatregel |
|---|---|
| Delen werkt niet als de app achter het deelmenu herlaadt | Alles is vóór het delen vastgelegd; Downloaden als terugval; testen op de OnePlus |
| Geheugen bij 256 MiB (base64 en ontsleutelde kopie) | Meting; een lagere grens is een apart besluit (formaatwijziging) |
| Bestandskiezer verbergt de app | Kiezen gebeurt alleen zonder sessie (terugzetten, controleren vanaf het vergrendelscherm) |

## Acceptatiecriteria
- Alle controles uit `CLAUDE.md` §2 slagen, ook de browsertests in Chromium.
- In de app: back-up maken geeft `export` en direct daarna `verify_backup`
  (`equal`) in het logboek; terugzetten via beide routes werkt op een lege
  opslag; een ongeldig bestand laat de opslag leeg.
- Op de OnePlus (taak 10): delen of downloaden lukt, terugzetten via beide
  routes, meting grote back-up.

## Proef op de OnePlus (versie 0.3.0) en herstelronde (0.3.1)
Uitgevoerd door de gebruiker op 2026-11-25.

| Stap | Uitkomst |
|---|---|
| A. Bijwerken, versie en codehash | In orde |
| B. Grote back-up | 64 MiB 0,6 / 2,7 s; 128 MiB 1,4 / 2,7 s; 253,3 MiB 2,6 / 6,2 s (maken / openen). Grens van 256 MiB vastgesteld (akkoord gebruiker; formaat §2.4) |
| C. Back-up maken en delen | Maken, herinnering en logboek in orde; **delen werkte niet** (geen deelmenu). Downloaden werkt |
| D. Bestand controleren | In orde, ook fout wachtwoord en ander bestand; **niet te zien dat een bestand gekozen was** |
| E. Terugzetten met wachtwoord | In orde |
| F. Terugzetten met herstelsleutel | Niet getest; open voor taak 10 |
| G. Onderbreken tijdens terugzetten | Op de telefoon niet te onderbreken (te snel). Gedekt door de tests: een afgebroken IndexedDB-transactie laat de opslag leeg en een nieuwe poging slaagt (`tests/browser.mjs`, `tests/controller.test.mjs`) |

Herstelronde (besluiten gebruiker 2026-11-25):
- **Alleen downloaden** (optie b). Vermoedelijke oorzaak bij delen: het
  deelmenu verbergt de app, die vergrendelt door te herladen, en dat breekt
  het delen af. Delen gaat nu vanuit Bestanden → Downloads; de
  `.txt`-terugval vervalt. Formaat §11.2 en §11.3 aangepast. Besluit 3
  (delen als standaard) is hiermee vervangen.
- **Bestand kiezen**: eigen knop "Bestand kiezen" en een duidelijke regel
  "Gekozen: naam (grootte)" of "Nog geen bestand gekozen"; het knopje van
  Chrome is verborgen.
- Versie 0.3.1.


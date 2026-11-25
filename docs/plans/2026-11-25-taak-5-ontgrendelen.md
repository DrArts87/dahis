# Plan taak 5: onboarding, ontgrendelen, vergrendelen

Datum: 2026-11-25. Uitwerking van taak 5 uit het
[plan fase 1](2026-11-25-fase-1-fundament.md) §5, met de afspraken uit de
[UI-opbouw](2026-11-25-ui-opbouw.md). Akkoord gebruiker: 2026-11-25.

## In het kort
De app krijgt zijn eerste echte schermen: een kluis inrichten met wachtwoord
en herstelsleutel, ontgrendelen, automatisch vergrendelen, wachtwoord
wijzigen, herstel met de herstelsleutel, alles wissen en stoppen bij een
afwijking. Daarmee is de opslag uit taak 4 aangesloten op de app. De
back-up volgt in taak 7.

## Doel
`vault.js` en `store.js` aansluiten op de app volgens `docs/formaat.md`
§10 en §12.1–§12.4, met de schermen, het logo en de teksten uit de
UI-opbouw. Rest van audit A1: sleutels verdwijnen bij vergrendelen.

## Omvang
- Nieuw: `app/js/controller.js` (toestand van de app zonder DOM),
  `app/js/settings.js` (vaste lijst instellingen), `app/js/i18n.js` en
  `app/js/i18n/nl.js` (teksten), `app/img/` (randen, varen).
- Gewijzigd: `app/index.html` (logo als inline SVG-symbool),
  `app/js/app.js` (schermen), `app/css/app.css`, `app/manifest.webmanifest`
  (kleuren), `app/sw.js` (content-type SVG, release), `tools/iconen.py`
  (logo als app-icoon), `docs/formaat.md` §6.3 (kind `settings`),
  `docs/compliance/nen7510.md`, `docs/overdracht.md`.
- Tests: `tests/controller.test.mjs`, `tests/i18n.test.mjs`,
  `tests/settings.test.mjs`, `tests/test_release.py` (iconen); browser met
  Playwright buiten de repository.
- Niet: back-up en terugzetten (taak 7), scherm Sleutels vernieuwen (na de
  alpha), schemawijziging, patiënten- en receptenmodule.

## Taken
1. **Controller** (`controller.js`), te testen met `MemoryBackend`:
   - opstarten: Web Lock, opslag openen; bezet → "al geopend"; leeg →
     onboarding; anders vergrendeld;
   - onboarding: wachtwoord (min. 14 tekens) → `createInstallation`
     (duur van PBKDF2 gemeten) → herstelsleutel → twee groepen controleren
     → pas dan vastleggen; daarna `requestPersist()`;
   - ontgrendelen met wachtwoord of herstelsleutel: onjuist →
     `failedUnlockTx`; tikfout in de herstelsleutel → melding, niets
     geschreven; afwijking → gestopt; gelukt → `unlockTx` via de wachtrij
     (die doet zo nodig de volledige controle);
   - na de herstelsleutel eerst een nieuw wachtwoord (`changePasswordTx`,
     detail `recovery`); tot dan niets anders;
   - wachtwoord wijzigen (huidig wachtwoord of herstelsleutel);
   - instellingen lezen en opslaan als één record `settings`;
   - volledige controle op verzoek (`integrityCheckTx`);
   - vergrendelen: sessie loslaten, opslag en slot sluiten, pagina
     herladen; geen auditregel;
   - alles wissen: opslag sluiten, database verwijderen, herladen;
   - elke `IntegrityError` of `ConflictError` → gestopt (§10).
2. **Instellingen** (`settings.js`): vaste lijst met type, standaard en
   grenzen; nu alleen `lock.idleMinutes` (1–15, standaard 3). Onbekend of
   ongeldig → standaard.
3. **Teksten**: alle gebruikersteksten in `i18n/nl.js` met vaste sleutels
   en plaatshouders; `t()` zet alleen tekst in de pagina.
4. **Schermen** (`app.js`, `app.css`): de 14 schermen uit
   `docs/ui/voorbeelden.html`; kopregel met varen, randen boven en onder,
   lint onderaan, hoofdscherm geheel groen. Vergrendelen bij verbergen van
   de app, na inactiviteit en met de knop. Onder Meer ook snelheid meten
   (PBKDF2 bij 600.000 en 10.000.000 rondes) en Over deze app.
5. **Logo en iconen**: de SVG-paden van de gebruiker exact; `iconen.py`
   tekent het logo (Bézier, even-odd) wit op `#123F32`.
6. **Documentatie**: kind `settings` in formaat §6.3; restrisico geheugen
   en vergrendelen in `nen7510.md`; overdracht bijwerken.

## Risico's
| Risico | Maatregel |
|---|---|
| Vergrendelen tijdens een schrijfactie | IndexedDB-transactie is atomair; na herladen geldt de laatste vastgelegde toestand |
| Android verbergt de app ook bij het delen (export, taak 7) | Uitzondering in taak 7 met eigen plan |
| Onboarding afgebroken (app verborgen) | Nog niets vastgelegd; onboarding begint opnieuw met nieuwe sleutels |
| Beide geheimen kwijt | Alleen "Gegevens wissen" via Chrome; geen achterdeur (formaat §1) |
| Teksten los van de code raken uit de pas | Test: alle gebruikte sleutels bestaan, geen ongebruikte |
| Iconen tekenen in pure Python is traag | Eenmalig bij een ontwerpwijziging; deterministische uitvoer |

## Acceptatiecriteria
- In Chromium (wegwerpprofiel): inrichten, ontgrendelen, wachtwoord
  wijzigen, herstel met de herstelsleutel en alles wissen werken.
- De app vergrendelt bij verbergen en na de ingestelde tijd; daarna staat
  er geen sleutel meer in het geheugen (pagina herladen).
- Een afwijking stopt de app zonder te schrijven.
- In IndexedDB staat geen testtekst leesbaar.
- `py_compile`, unittests, `node --check`, `node --test`,
  `release.py --check` en `privacy_check.py` slagen.

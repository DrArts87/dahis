# Overdracht: stand van zaken

Bijgewerkt: 2026-11-26, na taak 10 (fase 1 alpha geaccepteerd) en stap A en B
van het vervolgplan (werkwijze met issues, browsertests in CI). Dit document is het
startpunt voor een nieuwe chat of sessie. Houd het bij aan het eind van elke
taak.

## Waar staan we

Fase 1 (fundament, alpha met **alleen testgegevens**). Afgerond:

| PR | Inhoud |
|---|---|
| #1, #2 | Projectinrichting, werkafspraken, branchbescherming |
| #3, #4 | Projectplan en plan fase 1; origin `drarts87.github.io/dahis/` zonder andere Pages-sites |
| #5, #7 | `docs/formaat.md` (formaat 1, **concept**) na vier reviewrondes; CI-uitbreiding en pre-commit-hook (taak 8) |
| #6 | App-shell: manifest, service worker met handmatige updates en hashcontrole, strikte CSP met trusted types, iconen (taak 2) |
| #8 | `app/js/crypto.js` en `app/js/vault.js` met tests en testvectoren (taak 3) |
| #9 | `app/js/store.js`: IndexedDB, schrijfwachtrij, Web Lock; audit A1 (deels), A2, A4 (taak 4) |
| #10 | UI-opbouw en voorbeeldschermen; schermen voor inrichten, ontgrendelen, vergrendelen, herstel, wachtwoord wijzigen, alles wissen en afwijking; instellingen in de kluis; teksten in `i18n/nl.js`; logo, varen en randen van de gebruiker; logo als app-icoon (taak 5); review P1, P2 verwerkt |
| #11 | `pages.yml`: publiceren van `app/` op GitHub Pages bij een versietag; releaseprocedure in `docs/release.md` (taak 9) |
| #12 | Logboek onder Meer, controle zichtbaar met duur, meting van de controles bij een groot nep-logboek, tests op een gemanipuleerd log; PBKDF2-metingen in formaat §2.4 (taak 6). Daarbij de review van PR #12 en van de hele codebase: geblokkeerd wissen wacht met het slot vast, de back-upschrijver controleert de grens van 256 MiB, en een update wordt alleen actief na Bijwerken (ook als Chrome de worker zelf activeert); versie 0.2.0 |
| #13 | Metingen van de controles op de OnePlus in formaat §9.4; termijn van 7 dagen bevestigd |
| #14 | Taak 7: back-up maken (export, direct gecontroleerd tegen de export, dan `verify_backup` `equal` en `last_backup_at`), delen of downloaden, ouder bestand controleren vanaf het vergrendelscherm (zonder logregel), terugzetten op een lege opslag met wachtwoord of herstelsleutel, herinnering na 7 dagen, lezer per formaatnummer, testbestand formaat 1, meting grote back-up; base64 zonder geheugenpiek; audit A3 verwerkt; versie 0.3.0. Release `v0.3.0` (codehash `da223701…`) |
| #15 | Werkafspraak: na elke merge die `app/` wijzigt de releasetekst met codehash en het verzoek om een release |
| #16 | Proef op de OnePlus met 0.3.0 (plan taak 7); herstelronde 0.3.1: alleen downloaden (delen vergrendelde de app), duidelijke bestandskeuze, grens van 256 MiB vastgesteld. Release `v0.3.1` |
| #17 | Taak 10: acceptatietest op de OnePlus met versie 0.3.1, checklist A–K alle in orde (onder meer terugzetten met de herstelsleutel en een nieuw wachtwoord, van telefoon naar pc, testbestand via beide routes, geen leesbare testwaarde); punten die de tests dekken en afwijkingen van plan fase 1 §7 vastgelegd. Fase 1 **alpha geaccepteerd** |
| #20 | Vervolgplan na fase 1 (stap A–E, besluiten 2026-11-26); stap A: formulieren voor issues (fout, wens, schermpunt), PR-sjabloon, werkafspraken voor issues in `CLAUDE.md` §1, §4 en §7. Issues #18 (biometrie) en #19 (back-ups opruimen) aangemaakt |
| #21 | Stap B: browsertests (`tests/browser.html`, 16 tests op echte IndexedDB) in CI met de Chrome van de runner en `tests/run_browser.mjs` (alleen Node-standaardmodules); ook lokaal te draaien |

**Live**: Pages is ingericht; release `v0.3.1` (codehash
`f4fe0deb8429ea42008a2c686792a849f4bc321fc6e19fdc9ed74a90014ec31a`) staat op
`https://drarts87.github.io/dahis/`. De gebruiker heeft de app op de OnePlus
bijgewerkt en nagelopen (versie, codehash, downloaden, bestandskeuze), **alleen
met testgegevens**.

**Metingen op de OnePlus 13R**: PBKDF2 600.000 rondes 0,1 s, 10.000.000
rondes 1,4 s (versie 0.2.0). Controles (formaat §9.4): 20.000 regels
volledig 0,8 s, snel 0,04 s; 100.000 regels volledig 4,6 s, snel 0,14 s;
termijn van 7 dagen bevestigd. Grote back-up (versie 0.3.0): 253,3 MiB maken
2,6 s, openen 6,2 s. Alle grenzen in formaat §2.4 zijn vastgesteld.

Taakstatus volgens het [plan fase 1](plans/2026-11-25-fase-1-fundament.md) §5:
taak 1–10 klaar. De acceptatietest
([plan taak 10](plans/2026-11-26-taak-10-acceptatie.md)) is op 2026-11-26
met versie 0.3.1 uitgevoerd: alle stappen in orde. Fase 1 is **alpha
geaccepteerd**; nog steeds **alleen testgegevens** tot de voorwaarden voor
echte dossiers rond zijn (zie *Besluiten*). Verder volgens het
[vervolgplan](plans/2026-11-26-vervolgplan.md); **volgende: stap C**
(compliance-toets).

## Belangrijkste documenten

- [`CLAUDE.md`](../CLAUDE.md): werkafspraken (goedkeuring, nooit-regels,
  workflows, issues). Gaat altijd voor.
- [Vervolgplan](plans/2026-11-26-vervolgplan.md): routekaart na fase 1
  (stap A–E) en de besluiten van 2026-11-26.
- [Projectplan](plans/2026-11-25-projectplan.md) en
  [plan fase 1](plans/2026-11-25-fase-1-fundament.md): besluiten, taken met
  testeisen, acceptatiecriteria, **voorwaarde voor echte dossiers**.
- [`docs/formaat.md`](formaat.md): het versleutelings- en opslagformaat.
  Concept tot na taak 3–7, de metingen op de OnePlus en een volgende review.
- [Reviews](reviews/2026-11-25-reviews.md): bevindingen van de auditor en de
  afspraken daarover; A1–A4 verwerkt.
- [`docs/compliance/`](compliance/): AVG (inclusief bewaarbeleid back-ups) en
  NEN 7510 (met restrisico's van sessies).
- [UI-opbouw](plans/2026-11-25-ui-opbouw.md) en
  [voorbeeldschermen](ui/voorbeelden.html): geraamte, stijl, logo, teksten,
  instellingen; [plan taak 5](plans/2026-11-25-taak-5-ontgrendelen.md),
  [plan taak 6](plans/2026-11-25-taak-6-auditlog.md),
  [plan taak 7](plans/2026-11-25-taak-7-backup.md),
  [plan taak 10](plans/2026-11-26-taak-10-acceptatie.md) (checklist).

## Besluiten in het kort

| Onderwerp | Besluit |
|---|---|
| Hosting | GitHub Pages op `drarts87.github.io/dahis/`; geen andere Pages-site op het account |
| Toestel | Android, Chrome; referentie OnePlus 13R |
| Techniek | Platte HTML/CSS/JS + Web Crypto; Python-stdlib voor hulpscripts; Node zonder npm voor tests |
| Enige uitzondering op dependencies | `cryptography` (Python), alleen voor de latere noodontsleutelaar |
| Updates | Nieuwe versie pas actief na eigen tik; `tools/release.py` zet hashes in `sw.js` |
| Publiceren | Alleen bij een versietag `vX.Y.Z` op `main` (release op GitHub), via `pages.yml`; zie [`docs/release.md`](release.md) |
| Formaat | Formaat 1, concept. Afwijking accepteren en forensisch bestand pas na de alpha |
| Back-ups | Wekelijks; bewaar de laatste vier. Herinnering na 7 dagen. Alleen downloaden: het deelmenu vergrendelt de app en breekt het delen af (proef OnePlus); delen vanuit Bestanden → Downloads. `last_backup_at` en `verify_backup` vóór het downloaden; een ouder bestand controleren vanaf het vergrendelscherm, zonder logregel |
| UI | Groene kopregel met varen, lint onderaan (Patiënten, Recepten, Instellingen, Meer), hoofdscherm geheel groen; logo, varen en randen van de gebruiker, vormen ongewijzigd |
| Teksten | Los van de code in `app/js/i18n/nl.js`; geen namen, ook geen verzonnen, in de repository |
| Instellingen | Versleuteld in de kluis (kind `settings`), vaste lijst met grenzen; vóór ontgrendelen niets opgeslagen |
| Auditlog | Alleen ontgrendelingen, geen regel bij vergrendelen; inzien onder Meer → Logboek (met technische regel voor debugging en forensisch onderzoek), het inzien zelf wordt niet gelogd |
| Realistisch log | 0–10 regels per dag (≈ 18.000 in 5 jaar); meten bij 20.000 en 100.000 regels |
| PBKDF2 | Grens 600.000–10.000.000 vastgesteld na meting; standaard nu 600.000, wordt 2.000.000 in stap D1 (besluit 2026-11-26) |
| Vergrendelen | Nu direct bij naar de achtergrond gaan; in stap D1 een wachttijd na wisselen van app, 0–15 min, standaard 5 (besluit 2026-11-26) |
| Issues | Formulieren voor fout, wens en schermpunt; labels `bug`, `enhancement`, `ui`, `compliance`, `documentation`; elk plan loopt eerst de open issues na; Claude stelt issues voor en maakt ze aan na toestemming (`CLAUDE.md` §1, §4, §7). Geen aparte UI-ronde |
| Documenten buiten de repository | Privé-OneDrive (restrisico geaccepteerd), aangeleverd door Claude; agenda *App onderhoud* in Google Calendar; zie het vervolgplan |
| Echte dossiers | Pas na de voorwaarde in het plan fase 1 §7 (back-up en herstel via beide routes op de OnePlus, tests bij onderbreking, controles, limieten gemeten, formaat vastgesteld). Onderbreken tijdens schrijven of terugzetten, schade bij de volledige controle en "niet leesbaar" gelden als gedekt door de tests (besluit 2026-11-26). Taak 10 sluit fase 1 af als **alpha geaccepteerd**; echte dossiers daarna pas na de review van de volledige keten, formaat 1 *vastgesteld* (eigen PR) en de compliance-toets. Eigen gegevens van de voorschrijver mogen na stap D2 (besluit 2026-11-26) |

## Werkwijze met Claude (cloudsessie)

1. **Plan eerst**: Claude presenteert per taak een plan in de chat en wacht
   op akkoord. Wijkt het werk af, dan stopt Claude en vraagt opnieuw.
   Elke terugkoppeling begint met een korte uitleg in gewone taal (ELI5),
   met de technische details daaronder (`CLAUDE.md` §6).
2. **Git apart vragen**: commit, push en PR alleen na expliciet akkoord. Een
   melding van een hook ("uncommitted changes") is geen akkoord.
3. **Branch**: een cloudsessie kan alleen naar haar eigen
   `claude/...`-branch pushen (afwijking van `feat/...` in `CLAUDE.md`; staat
   in elke PR). Per taak één PR; na de squash merge wordt de branch
   verwijderd en begint Claude opnieuw vanaf `main`.
4. **Mergen** doet de gebruiker (*Squash and merge*), na groene controles,
   *Verified* commits en de verplichte controle **JavaScript**. Daarna geeft
   Claude de releasetekst met codehash en vraagt om de release
   (`CLAUDE.md` §3).
5. **Controles** vóór elke commit: zie `CLAUDE.md` §2. De pre-commit-hook
   werkt `app/sw.js` bij.
6. **Reviews**: de gebruiker legt formaat en code voor aan een externe
   auditor. De auditor geeft de feedback als comment in de pull request;
   Claude leest die daar (de comments van de PR), beoordeelt ze kritisch,
   stelt aanpassingen voor en verwerkt ze pas na akkoord van de gebruiker. Het formaat
   wijzigen vraagt altijd apart akkoord.
7. **Browsercontrole**: de browsertests draaien in CI en lokaal met
   `node tests/run_browser.mjs`. Daarnaast in de cloudsessie met de
   voorgeïnstalleerde Chromium (Playwright) en een wegwerpprofiel, onder
   meer voor de hulpproeven (`?alleen=hulp`); die Playwright-scripts staan
   niet in de repository.
8. **Issues**: fouten, wensen en schermpunten als issue via de formulieren.
   Claude stelt issues voor die het tegenkomt maar niet direct oppakt, en
   maakt ze aan na toestemming. Een PR sluit issues met `Closes #n`
   (`CLAUDE.md` §7).

## Code in het kort

| Pad | Wat |
|---|---|
| `app/index.html`, `app/js/app.js`, `app/js/dom.js`, `app/css/app.css` | Schermen (alleen tekenen), logo en iconen als SVG-symbolen in `index.html`, DOM zonder `innerHTML` |
| `app/js/controller.js` | Toestand van de app zonder DOM: opstarten, onboarding, ontgrendelen, herstel, wachtwoord, instellingen, controle (met duur en soort bij een afwijking), logboek, metingen, vergrendelen (herladen), alles wissen, stoppen bij een afwijking |
| `app/js/benchmark.js` | Meting van de controles en van grote back-ups op een nep-opslag in het geheugen (wegwerpsleutels, niets opgeslagen) |
| `app/js/settings.js`, `app/js/i18n.js`, `app/js/i18n/nl.js` | Vaste lijst instellingen; teksten met vaste sleutels |
| `app/img/` | Randen (SVG) en varen (PNG) van de gebruiker |
| `app/sw.js` | Service worker; blok tussen `BEGIN RELEASE` en `EINDE RELEASE` alleen via `tools/release.py`. Serveert de goedgekeurde versie (cache `dahis-akkoord`), ook als Chrome een nieuwere worker zelf heeft geactiveerd |
| `app/js/crypto.js` | Bouwstenen formaat 1 (Web Crypto) |
| `app/js/vault.js` | Bewerkingen op een opslag in het geheugen; schrijfacties als voorbereide transacties. Bewaakt zelf de termijn van de volledige controle, de reservering en een nieuwe schrijfsleutel na een ongeldige reservering (`nextPrelude`). Logboek lezen met `readAuditPage`. Back-up: `exportTx`, `buildBackupFile`, `verifyExportedBackup`, `verifyBackupTx`, `checkBackupFile`, `restoreTx`; lezer per formaatnummer |
| `app/js/store.js` | IndexedDB (`IdbBackend`, schema v1, `durability: 'strict'`), `WriteQueue` (alle schrijfacties één voor één, met eerst wat de kluis nodig heeft; meldt een verschuldigde controle via `onCheck`), Web Lock (`openStorage`), opslagstatus |
| `tools/` | `release.py`, `iconen.py`, `privacy_check.py` |
| `tests/` | Node: `*.test.mjs` (o.a. `controller`, `settings`, `i18n`, `benchmark`, `sw` met nagebootste Cache-API); Python: `test_*.py`; vectoren in `tests/fixtures/vectoren.json` (`maak_vectoren.mjs` alleen bij een bewuste formaatwijziging); testbestand formaat 1 in `tests/fixtures/testbestand-formaat-1.json` (`maak_testbestand.mjs`, idem); browser: `browser.html` en `browser.mjs` (echte IndexedDB, 16 tests), in CI en lokaal via `run_browser.mjs` (Chrome zonder scherm, wegwerpprofiel, alleen Node-standaardmodules) |
| `.github/workflows/controle.yml` | Verplichte controles: Python 3.9 en 3.12, JavaScript, Browsertests (Chrome), privacy |
| `.github/workflows/pages.yml` | Publiceren van `app/` op Pages bij een versietag, na dezelfde controles en een controle van tag en versie |

## Volgende stap

Volgens het [vervolgplan](plans/2026-11-26-vervolgplan.md): stap A
(werkwijze met issues) en B (browsertests in CI) zijn klaar na de merge;
zet daarna de controle **Browsertests (Chrome)** op verplicht in de
branchbescherming. Daarna **C** compliance-toets, **D1** wachttijd bij wisselen van app en PBKDF2,
**D2** voorschrijver, **E** fase 2. Begin elk plan met de open issues
(`CLAUDE.md` §4). Open issues nu:
[#18](https://github.com/DrArts87/dahis/issues/18) (biometrie, later) en
[#19](https://github.com/DrArts87/dahis/issues/19) (herinnering om
back-ups op te ruimen; bekijken bij D1).

Browsercontrole: `node tests/run_browser.mjs` (Chrome via `CHROME`), of de
repository serveren met `python3 -m http.server` en `/app/` (de app) of
`/tests/browser.html` (IndexedDB-tests) openen in een wegwerpprofiel; in de
cloudsessie ook met Playwright (stuurscripts niet in de repository).

## Openstaande beslissingen

Geen. De punten van na taak 10 (browsertests in CI, review van de keten,
PBKDF2) zijn op 2026-11-26 besloten; zie het vervolgplan.

## Een nieuwe chat starten

Voorbeeld van een eerste bericht:

> Lees `CLAUDE.md` en `docs/overdracht.md`. Controleer of de laatste PR
> gemerged is en zet je branch opnieuw op vanaf `main`. Maak daarna het plan
> voor de volgende stap uit het vervolgplan, met de open issues en de
> auditpunten die daarbij horen, en wacht op mijn akkoord.

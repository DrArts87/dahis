# Overdracht: stand van zaken

Bijgewerkt: 2026-11-25, na taak 5 (onboarding, ontgrendelen, vergrendelen). Dit document is het
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
| (nieuw) | UI-opbouw en voorbeeldschermen; schermen voor inrichten, ontgrendelen, vergrendelen, herstel, wachtwoord wijzigen, alles wissen en afwijking; instellingen in de kluis; teksten in `i18n/nl.js`; logo, varen en randen van de gebruiker; logo als app-icoon (taak 5). **Let op**: bij het schrijven stond deze PR nog open; controleer dat hij gemerged is |

Taakstatus volgens het [plan fase 1](plans/2026-11-25-fase-1-fundament.md) §5:
taak 1, 2, 3, 4, 5 en 8 klaar (5 nog zonder metingen op de OnePlus);
**volgende: taak 6** (auditlog en controles in de app), daarna 7, 9 en 10.

## Belangrijkste documenten

- [`CLAUDE.md`](../CLAUDE.md): werkafspraken (goedkeuring, nooit-regels,
  workflows). Gaat altijd voor.
- [Projectplan](plans/2026-11-25-projectplan.md) en
  [plan fase 1](plans/2026-11-25-fase-1-fundament.md): besluiten, taken met
  testeisen, acceptatiecriteria, **voorwaarde voor echte dossiers**.
- [`docs/formaat.md`](formaat.md): het versleutelings- en opslagformaat.
  Concept tot na taak 3–7, de metingen op de OnePlus en een volgende review.
- [Reviews](reviews/2026-11-25-reviews.md): bevindingen van de auditor en de
  afspraken daarover; A2 en A4 verwerkt, A1 deels, A3 in taak 7.
- [`docs/compliance/`](compliance/): AVG (inclusief bewaarbeleid back-ups) en
  NEN 7510 (met restrisico's van sessies).
- [UI-opbouw](plans/2026-11-25-ui-opbouw.md) en
  [voorbeeldschermen](ui/voorbeelden.html): geraamte, stijl, logo, teksten,
  instellingen; [plan taak 5](plans/2026-11-25-taak-5-ontgrendelen.md).

## Besluiten in het kort

| Onderwerp | Besluit |
|---|---|
| Hosting | GitHub Pages op `drarts87.github.io/dahis/`; geen andere Pages-site op het account |
| Toestel | Android, Chrome; referentie OnePlus 13R |
| Techniek | Platte HTML/CSS/JS + Web Crypto; Python-stdlib voor hulpscripts; Node zonder npm voor tests |
| Enige uitzondering op dependencies | `cryptography` (Python), alleen voor de latere noodontsleutelaar |
| Updates | Nieuwe versie pas actief na eigen tik; `tools/release.py` zet hashes in `sw.js` |
| Formaat | Formaat 1, concept. Afwijking accepteren en forensisch bestand pas na de alpha |
| Back-ups | Wekelijks; bewaar de laatste vier |
| UI | Groene kopregel met varen, lint onderaan (Patiënten, Recepten, Instellingen, Meer), hoofdscherm geheel groen; logo, varen en randen van de gebruiker, vormen ongewijzigd |
| Teksten | Los van de code in `app/js/i18n/nl.js`; geen namen, ook geen verzonnen, in de repository |
| Instellingen | Versleuteld in de kluis (kind `settings`), vaste lijst met grenzen; vóór ontgrendelen niets opgeslagen |
| Auditlog | Alleen ontgrendelingen, geen regel bij vergrendelen |
| Echte dossiers | Pas na de voorwaarde in het plan fase 1 §7 (back-up en herstel via beide routes op de OnePlus, tests bij onderbreking, controles, limieten gemeten, formaat vastgesteld) |

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
   *Verified* commits en de verplichte controle **JavaScript**.
5. **Controles** vóór elke commit: zie `CLAUDE.md` §2. De pre-commit-hook
   werkt `app/sw.js` bij.
6. **Reviews**: de gebruiker legt formaat en code voor aan een externe
   auditor. De auditor geeft de feedback als comment in de pull request;
   Claude leest die daar (de comments van de PR), beoordeelt ze kritisch,
   stelt aanpassingen voor en verwerkt ze pas na akkoord van de gebruiker. Het formaat
   wijzigen vraagt altijd apart akkoord.
7. **Browsercontrole** in de cloudsessie met de voorgeïnstalleerde Chromium
   (Playwright), wegwerpprofiel, testscripts niet in de repository.

## Code in het kort

| Pad | Wat |
|---|---|
| `app/index.html`, `app/js/app.js`, `app/js/dom.js`, `app/css/app.css` | Schermen (alleen tekenen), logo en iconen als SVG-symbolen in `index.html`, DOM zonder `innerHTML` |
| `app/js/controller.js` | Toestand van de app zonder DOM: opstarten, onboarding, ontgrendelen, herstel, wachtwoord, instellingen, controle, meting, vergrendelen (herladen), alles wissen, stoppen bij een afwijking |
| `app/js/settings.js`, `app/js/i18n.js`, `app/js/i18n/nl.js` | Vaste lijst instellingen; teksten met vaste sleutels |
| `app/img/` | Randen (SVG) en varen (PNG) van de gebruiker |
| `app/sw.js` | Service worker; blok tussen `BEGIN RELEASE` en `EINDE RELEASE` alleen via `tools/release.py` |
| `app/js/crypto.js` | Bouwstenen formaat 1 (Web Crypto) |
| `app/js/vault.js` | Bewerkingen op een opslag in het geheugen; schrijfacties als voorbereide transacties. Bewaakt zelf de termijn van de volledige controle, de reservering en een nieuwe schrijfsleutel na een ongeldige reservering (`nextPrelude`) |
| `app/js/store.js` | IndexedDB (`IdbBackend`, schema v1, `durability: 'strict'`), `WriteQueue` (alle schrijfacties één voor één, met eerst wat de kluis nodig heeft), Web Lock (`openStorage`), opslagstatus |
| `tools/` | `release.py`, `iconen.py`, `privacy_check.py` |
| `tests/` | Node: `*.test.mjs` (o.a. `controller`, `settings`, `i18n`); Python: `test_*.py`; vectoren in `tests/fixtures/vectoren.json` (`maak_vectoren.mjs` alleen bij een bewuste formaatwijziging); browser: `browser.html` en `browser.mjs` (echte IndexedDB, niet in CI) |
| `.github/workflows/controle.yml` | Verplichte controles: Python 3.9 en 3.12, JavaScript, privacy |

## Volgende stap

Taak 5 is gebouwd; na de review en de merge volgt taak 6 (auditlog en
controles in de app). Open uit taak 5: de metingen op de OnePlus (Meer →
Snelheid meten, bij 600.000 en 10.000.000 rondes).

Browsercontrole: repository serveren met `python3 -m http.server` en
`/app/` (de app) of `/tests/browser.html` (IndexedDB-tests) openen in een
wegwerpprofiel; in de cloudsessie met Playwright, stuurscripts niet in de
repository.

Daarna taak 7 (back-up in de app, audit A3; let op: het Android-deelmenu
verbergt de app en vergrendelt die nu), 9 (Pages-workflow en
releaseprocedure) en 10 (acceptatietest op de OnePlus).

## Openstaande beslissingen

- Browsertests in CI (job met de Chrome van de runner, zonder npm):
  wijziging van de workflow, dus apart te vragen.
- Een nieuwe review na taak 7 (volledige keten in de app).

## Een nieuwe chat starten

Voorbeeld van een eerste bericht:

> Lees `CLAUDE.md` en `docs/overdracht.md`. Controleer of de laatste PR
> gemerged is en zet je branch opnieuw op vanaf `main`. Maak daarna het plan
> voor de volgende taak, inclusief de auditpunten die daarbij horen, en wacht
> op mijn akkoord.

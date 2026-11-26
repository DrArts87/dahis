# Vóór echte dossiers

Wat af moet zijn voordat er echte **patiëntgegevens** in Dahis komen. Hoort
bij plan fase 1 §7 (*Voorwaarde voor echte dossiers*) en het
[vervolgplan](../plans/2026-11-26-vervolgplan.md). Bijgewerkt in de
compliance-toets van 2026-11-26. Vink af in de PR waarin het gebeurt, met
bewijs.

**Eigen gegevens van de voorschrijver** (de gebruiker zelf) mogen na stap D2,
ook voordat deze lijst af is (besluit gebruiker 2026-11-26). Stap D2 zit in
versie 0.5.0: vanaf die release mogen de eigen gegevens in de app.

## Techniek
| | Punt | Wie | Bewijs of stap |
|---|---|---|---|
| ☑ | Back-up gemaakt en op een lege opslag teruggezet, met wachtwoord én herstelsleutel, op de OnePlus | Gebruiker | Taak 10 stap F, G |
| ☑ | Na herstel met een nieuw wachtwoord opent de app normaal | Gebruiker | Taak 10 stap F |
| ☑ | Tests bij onderbreking (onboarding, schrijfactie, terugzetten) | Claude, CI | Taak 10 stap K; `tests/browser.mjs` in CI (Browsertests (Chrome)) |
| ☑ | Verschuldigde volledige controle met schade laat de opslag ongewijzigd | CI | `tests/browser.mjs` |
| ☑ | Limieten in `formaat.md` §2.4 gemeten en vastgesteld | Gebruiker | Taak 5–7 |
| ☑ | PBKDF2 standaard 2.000.000 en wachttijd na wisselen van app | Claude | Stap D1, versie 0.4.0 ([plan D1](../plans/2026-11-26-d1-vergrendelen.md)); `tests/controller.test.mjs`, `tests/vault.test.mjs` |
| ☐ | Patiëntenbestand met logging van inzage en wijziging (NEN 7513) | Claude | Stap E (fase 2) |
| ☐ | Volledige review van de keten door de auditor | Gebruiker, auditor | Na fase 2 |
| ☐ | Formaat 1 *vastgesteld* (eigen PR, na de review) | Claude, gebruiker | Na de review |
| ☐ | Back-upstatus met een bevestigde externe kopie: de herinnering mag niet wegvallen als het bestand de telefoon niet heeft verlaten (direct vergrendelen, app sluiten, mislukte upload) | Claude, gebruiker | [#24](https://github.com/DrArts87/dahis/issues/24); bij het vaststellen van formaat 1; review PR #23 |
| ☐ | Eisen aan een recept nagelopen (Geneesmiddelenwet) | Claude, gebruiker | Fase 3, vóór recepten |

## Organisatie
| | Punt | Wie | Bewijs of stap |
|---|---|---|---|
| ☑ | Private vulnerability reporting en secret scanning aan | Gebruiker | 2026-11-26 |
| ☑ | Branchbescherming met vier verplichte controles | Gebruiker | 2026-11-26 |
| ☑ | Onderhoud in de agenda (hersteltest, updates, jaarlijkse herziening) | Claude | Agenda *App onderhoud*: updates elke maand vanaf 5 december 2026, hersteltest elk kwartaal vanaf 9 januari 2027, herziening elk jaar vanaf 27 november 2027 |
| ☑ | Tweestapsverificatie op het GitHub-account (een release is code die de telefoon na akkoord draait) | Gebruiker | Bevestigd 2026-11-26; [DPIA](dpia.md) §6 |
| ☑ | DPIA aangevuld (punten **Open**) en het besluit ondertekend | Gebruiker | 2026-11-26; open punten ingevuld in het besluit op OneDrive, [`dpia.md`](dpia.md) |
| ☑ | Incidentenregister aangelegd op OneDrive (alleen patiëntnummers) | Gebruiker | 2026-11-26, op OneDrive |
| ☑ | Checklist apparaten ingevuld (telefoon en laptop: biometrische vergrendeling, versleuteling, updates, wissen op afstand) | Gebruiker | 2026-11-26, op OneDrive |
| ☑ | Herstelsleutel op papier op een veilige plek, niet bij de telefoon | Gebruiker | 2026-11-26, besluitenlog op OneDrive (alleen "gedaan", niet de plek) |
| ☐ | Eerste hersteltest volgens de [herstelprocedure](herstelprocedure.md) §6 | Gebruiker | Januari 2027, of eerder |
| ☐ | Cloudopslag van back-ups beoordeeld: toegestane bestemmingen, rol van de aanbieder, art. 28 AVG, doorgifte buiten de EER, verwijderen inclusief prullenbak en versiegeschiedenis | Gebruiker | [#25](https://github.com/DrArts87/dahis/issues/25); review PR #23 |
| ☑ | Praktijkproef sessies op de OnePlus (stap D1) | Gebruiker | 2026-11-26, versie 0.4.0, [plan D1](../plans/2026-11-26-d1-vergrendelen.md); delen mislukt (knop verwijderd in 0.4.2, [#30](https://github.com/DrArts87/dahis/issues/30)) |
| ☑ | Voorbeeld in Recente apps zonder gegevens, of restrisico vastgelegd | Gebruiker | Proef 0.4.2: voorbeeld toont gegevens; restrisico geaccepteerd 2026-11-26 (`nen7510.md`, [DPIA](dpia.md) §6); [#33](https://github.com/DrArts87/dahis/issues/33) |
| ☐ | Betrokkenen informeren dat er een dossier wordt bijgehouden (`avg.md`) | Gebruiker | Bij elk nieuw dossier, vastgelegd in het dossier |

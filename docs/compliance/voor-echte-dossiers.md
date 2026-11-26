# Vóór echte dossiers

Wat af moet zijn voordat er echte **patiëntgegevens** in Dahis komen. Hoort
bij plan fase 1 §7 (*Voorwaarde voor echte dossiers*) en het
[vervolgplan](../plans/2026-11-26-vervolgplan.md). Bijgewerkt in de
compliance-toets van 2026-11-26. Vink af in de PR waarin het gebeurt, met
bewijs.

**Eigen gegevens van de voorschrijver** (de gebruiker zelf) mogen na stap D2,
ook voordat deze lijst af is (besluit gebruiker 2026-11-26).

## Techniek
| | Punt | Wie | Bewijs of stap |
|---|---|---|---|
| ☑ | Back-up gemaakt en op een lege opslag teruggezet, met wachtwoord én herstelsleutel, op de OnePlus | Gebruiker | Taak 10 stap F, G |
| ☑ | Na herstel met een nieuw wachtwoord opent de app normaal | Gebruiker | Taak 10 stap F |
| ☑ | Tests bij onderbreking (onboarding, schrijfactie, terugzetten) | Claude, CI | Taak 10 stap K; `tests/browser.mjs` in CI (Browsertests (Chrome)) |
| ☑ | Verschuldigde volledige controle met schade laat de opslag ongewijzigd | CI | `tests/browser.mjs` |
| ☑ | Limieten in `formaat.md` §2.4 gemeten en vastgesteld | Gebruiker | Taak 5–7 |
| ☐ | PBKDF2 standaard 2.000.000 en wachttijd na wisselen van app | Claude | Stap D1 |
| ☐ | Patiëntenbestand met logging van inzage en wijziging (NEN 7513) | Claude | Stap E (fase 2) |
| ☐ | Volledige review van de keten door de auditor | Gebruiker, auditor | Na fase 2 |
| ☐ | Formaat 1 *vastgesteld* (eigen PR, na de review) | Claude, gebruiker | Na de review |
| ☐ | Eisen aan een recept nagelopen (Geneesmiddelenwet) | Claude, gebruiker | Fase 3, vóór recepten |

## Organisatie
| | Punt | Wie | Bewijs of stap |
|---|---|---|---|
| ☑ | Private vulnerability reporting en secret scanning aan | Gebruiker | 2026-11-26 |
| ☑ | Branchbescherming met vier verplichte controles | Gebruiker | 2026-11-26 |
| ☐ | Onderhoud in de agenda (hersteltest, updates, jaarlijkse herziening) | Claude | Agenda *App onderhoud*, na de merge van stap C; afvinken in de PR van D1 |
| ☐ | Tweestapsverificatie op het GitHub-account (een release is code die de telefoon na akkoord draait) | Gebruiker | [DPIA](dpia.md) §6 |
| ☐ | DPIA aangevuld (punten **Open**) en het besluit ondertekend | Gebruiker | [`dpia.md`](dpia.md); besluit op OneDrive |
| ☐ | Incidentenregister aangelegd op OneDrive (alleen patiëntnummers) | Gebruiker | Sjabloon aangeleverd |
| ☐ | Checklist apparaten ingevuld (telefoon en laptop: biometrische vergrendeling, versleuteling, updates, wissen op afstand) | Gebruiker | Sjabloon aangeleverd |
| ☐ | Herstelsleutel op papier op een veilige plek, niet bij de telefoon | Gebruiker | Besluitenlog op OneDrive (alleen "gedaan", niet de plek) |
| ☐ | Eerste hersteltest volgens de [herstelprocedure](herstelprocedure.md) §6 | Gebruiker | Januari 2027, of eerder |
| ☐ | Betrokkenen informeren dat er een dossier wordt bijgehouden (`avg.md`) | Gebruiker | Bij elk nieuw dossier, vastgelegd in het dossier |

# Vervolgplan na fase 1

Status: akkoord gebruiker 2026-11-26
Datum: 2026-11-26
Hoort bij: [projectplan](2026-11-25-projectplan.md) §6,
[plan fase 1](2026-11-25-fase-1-fundament.md)

## In het kort
Fase 1 is als alpha geaccepteerd (taak 10). Voordat we verder bouwen, richten
we eerst de werkwijze met issues in, laten we de browsertests in CI draaien
en doen we een compliance-toets. Daarna komt het vergrendelen prettiger te
werken, wordt de voorschrijver vastgelegd, en volgt fase 2. Dit plan is de
routekaart; issues komen daar bovenop (`CLAUDE.md` §4 en §7).

## Routekaart

| Stap | Wat | Soort | Release |
|---|---|---|---|
| A | Werkwijze met issues: formulieren, PR-sjabloon, `CLAUDE.md` §1, §4 en §7, dit plan | `chore` | Nee |
| B | Browsertests (`tests/browser.html`) in CI, met de Chrome van de runner en zonder npm | `ci` | Nee |
| C | Compliance-toets: `nen7510.md` met bewijs, `avg.md`, concept-DPIA, lijst *vóór echte dossiers*, sjablonen voor documenten buiten de repository, afspraken in de agenda | `docs` | Nee |
| D1 | Wachttijd bij wisselen van app, PBKDF2 naar 2.000.000 rondes, werkstand voorbereid | `feat` | Ja |
| D2 | Voorschrijver registreren | `feat` | Ja |
| E | Fase 2: patiëntenbestand (projectplan §6), daarna de volledige review van de keten | per taak | Ja |
| | Fase 3: medicatie en recepten (projectplan §6) | per taak | Ja |

Elke stap krijgt een eigen plan, begint met de open issues (`CLAUDE.md` §4)
en wordt één PR (fase 2 en 3: één PR per taak).

## Besluiten van de gebruiker (2026-11-26)

| Onderwerp | Besluit |
|---|---|
| Issues | Werkwijze naar het voorbeeld van FinApp, aangepast aan Dahis. Starten nu; het plan heeft voorrang, issues die een plan raken gaan mee. Claude stelt issues voor, aanmaken na toestemming |
| UI-schaafsessie | Vervalt; schermpunten worden issues met label `ui` |
| Labels | `bug`, `enhancement`, `ui`, `compliance`, `documentation` (door de gebruiker aangemaakt) |
| Vergrendelen | Nieuwe instelling *Vergrendelen na wisselen van app*: 0–15 minuten, standaard 5. Binnen die tijd terug: alles staat er nog. De vergrendeling na inactiviteit (1–15 min, standaard 3) blijft. Restrisico: sleutels in het geheugen tijdens de wachttijd; maatregel is de biometrische schermvergrendeling en versleuteling van de telefoon (`nen7510.md`) |
| PBKDF2 | Standaard naar 2.000.000 rondes (OnePlus: ongeveer 0,3 s), op voorwaarde van minder vaak ontgrendelen. Geldt voor nieuwe wraps; het formaat verandert niet |
| Verder waar je was | Na vergrendelen terug op hetzelfde scherm met het half ingevulde formulier: later (fase 2/3, versleuteld concept, formaatbesluit). In D1 wordt de code er al op ingericht (één *werkstand* in de controller, met een koppeling voor opslag die nu niets bewaart), zodat het later zonder grote wijzigingen kan |
| Biometrie | Later, als [DrArts87/dahis#18](https://github.com/DrArts87/dahis/issues/18) (passkey met WebAuthn-PRF; formaatwijziging, eigen plan en review) |
| Back-ups opruimen | Herinnering in de app, niet in de agenda: [DrArts87/dahis#19](https://github.com/DrArts87/dahis/issues/19) |
| Review | Per stap (zoals bij elke PR); na het patiëntenbestand een volledige review van de keten, nodig om formaat 1 vast te stellen |
| Echte gegevens | Van de voorschrijver (de gebruiker zelf) na D2, ook vóór het vaststellen van formaat 1: eigen gegevens, laag risico, opnieuw in te voeren. Patiëntgegevens pas na de volledige review, formaat 1 vastgesteld en de lijst *vóór echte dossiers* uit stap C |
| Documenten buiten de repository | In de privé-OneDrive van de gebruiker; Claude levert de bestanden aan. Geen verwerkersovereenkomst met Microsoft; restrisico geaccepteerd door de gebruiker (vast te leggen in DPIA en `avg.md`) |
| Incidentenregister | Op OneDrive alleen met patiëntnummers en zonder andere details die naar een persoon leiden; de koppeling nummer–persoon staat niet op OneDrive (vanaf fase 2 in de app zelf) |
| Herstelsleutel | Alleen op papier; de plek staat niet op OneDrive of in de repository |
| Agenda | Google Calendar, agenda *App onderhoud* (door de gebruiker aangemaakt), titels beginnend met "Dahis:", melding op de dag zelf. Elk kwartaal een hersteltest (vanaf januari 2027), elke maand de updates van Android en Chrome (vanaf december 2026), elk jaar een herziening van NEN 7510 en de DPIA (vanaf november 2027). Aan te maken in stap C. Geen wekelijkse back-upafspraak: die herinnering zit in de app |

## Stap A: werkwijze met issues

**Open issues nagelopen**: #18 en #19 raken stap A niet; #19 komt terug bij
het plan van D1.

### Taken
1. `.github/ISSUE_TEMPLATE/`: `config.yml` (lege issues uit; links naar het
   privé meldformulier voor een beveiligingslek en naar de werkafspraken),
   `fout.yml` (`bug`), `wens.yml` (`enhancement`), `ui.yml` (`ui`). Elk
   formulier met een privacywaarschuwing, een keuzelijst *Onderdeel* en een
   verplicht vinkje dat er geen persoons- of medische gegevens in staan.
2. `.github/pull_request_template.md`: `Closes #`, *In het kort*, wat, waarom,
   hoe getest, en de controles uit `CLAUDE.md` §2.
3. `CLAUDE.md`: §1 (issues aanmaken, sluiten of labelen apart vragen;
   voorstellen mag), §4 (open issues nalopen, routekaart heeft voorrang),
   §7 (nieuw: issues).
4. Dit vervolgplan en `docs/overdracht.md`.

### Risico's
| Risico | Maatregel |
|---|---|
| Fout in een formulier (YAML) | Structuur lokaal gecontroleerd; GitHub valt anders terug op een gewoon formulier; na de merge controleert de gebruiker *New issue* |
| Persoonsgegevens in een openbaar issue | Waarschuwing en verplicht vinkje in elk formulier; regel in `CLAUDE.md` §1 en §7. `privacy_check.py` controleert geen issues |

### Acceptatiecriteria
- De formulieren, `config.yml` en het PR-sjabloon staan op `main`; onder
  *New issue* staan drie formulieren en de link voor een beveiligingslek,
  geen leeg issue.
- `CLAUDE.md`, dit plan en de overdracht zijn bijgewerkt; de controles uit
  `CLAUDE.md` §2 slagen.

<!--
Koppel elk issue dat deze pull request oplost met een Engels sleutelwoord,
dan sluit het issue vanzelf bij het mergen: Closes #12, closes #13.
GitHub herkent alleen closes, fixes en resolves; "Sluit #12" koppelt niets.
Raakt de PR een issue alleen: Zie #12. Geen issue? Haal de regel weg.
Geen persoons- of medische gegevens in deze beschrijving.
Schrijft een AI-agent deze beschrijving, dan begint die met de naam van de
agent, bijvoorbeeld: > 🤖 **Geschreven door Claude Code** (AI-agent van
Anthropic). Zie CLAUDE.md §6 en AGENTS.md.
-->
Closes #

## In het kort


## Wat verandert er


## Waarom


## Hoe getest


## Voor de review
<!--
Voor de auditor (AGENTS.md). Houd dit bij na elke reviewronde.
Basis: de commit op main en eventueel de vorige gereviewde PR.
Besloten: keuzes van de gebruiker met reden, die de review niet opnieuw opent.
-->
- **Focus**:
- **Buiten de review**: proef op de OnePlus, ontwerpcanvas (privé)
- **Besloten**: geen
- **Basis**:


## Controle
- [ ] Na een wijziging in `app/`: `python3 tools/release.py`, en de versie klopt.
- [ ] `py_compile`, unittests, `node --check`, `node --test` en `privacy_check.py` slagen (`CLAUDE.md` §2).
- [ ] `git status`: niets uit `data/`, geen database, export, back-up of PDF.
- [ ] Geen namen, BSN's, diagnoses of andere echte gegevens in code, tests, voorbeelden of deze beschrijving.
- [ ] Bij een formaat- of schemawijziging: versienummer, migratie, en oude back-ups blijven terug te zetten.

# Plan: tests sneller en gerichter

Status: akkoord gebruiker 2026-11-26 (beslispunten 1–3: ja)
Datum: 2026-11-26
Hoort bij: [#26](https://github.com/DrArts87/dahis/issues/26), met de reactie van de auditor daarin
Soort: `test`/`ci`, versie 0.4.1 (alleen een testoptie in `app/`)

## Open issues nagelopen
- [#26](https://github.com/DrArts87/dahis/issues/26) (tests sneller): dit plan, `Closes #26`.
- [#27](https://github.com/DrArts87/dahis/issues/27) (browsertest via de echte schermen): nieuw, op voorstel van de auditor; apart, na dit plan (`Zie #27`).
- [#24](https://github.com/DrArts87/dahis/issues/24), [#25](https://github.com/DrArts87/dahis/issues/25), [#18](https://github.com/DrArts87/dahis/issues/18): niet geraakt.

## In het kort
Sinds D1 rekent elke test die een kluis aanmaakt of ontgrendelt met
2.000.000 PBKDF2-rondes. De Node-tests gingen daardoor van ongeveer 12 naar
ongeveer 58 s. Nu maken de meeste tests hun wraps met het minimum van het
formaat (600.000), krijgen tests een voorbereide testkluis, en worden
dubbele tests samengevoegd. De routes over de sleutelafleiding zelf blijven
met de echte standaard. In CI slaat een PR die alleen documentatie wijzigt
de zware tests over; bij twijfel draait alles.

## Meting (lokaal, 4 kernen, Node 22)
| Bestand | Vóór | Na |
|---|---|---|
| `controller.test.mjs` | 54 s | ongeveer 13 s |
| `vault.test.mjs` | 30 s | ongeveer 11 s |
| `store.test.mjs` | 19 s | ongeveer 6 s |
| Hele set (parallel) | ongeveer 57 s | ongeveer 15 s |

## Taken
1. **Optie `iterations`** (beslispunt 1): `vault.js` (`createInstallation`,
   `changePasswordTx`, `rotateKeysTx`, `restoreTx`, `unlockTx`,
   `needsKdfUpgrade`) en de controller (`deps.kdfIterations`). Standaard
   `DEFAULT_ITERATIONS`; de app geeft het nooit mee; buiten de grenzen van het
   formaat (§2.4) geweigerd. Ook `deps.workStoreMs` (standaard 1 s) zodat de
   test van de werkstand niet echt hoeft te wachten.
2. **Testhulp** `tests/helpers/kluis.mjs`: `TEST_ITERATIONS` (600.000) en
   `REAL_ITERATIONS` (de standaard).
3. **Voorbereide testkluis** (voorstel auditor): in de controllertests loopt
   de eerste onboarding per aantal rondes de hele route; daarna krijgt elk
   toestel een verse kopie van die opslag. `onboardFull()` voor tests over de
   onboarding zelf.
4. **Echte standaard** in: nieuwe installatie en wachtwoord wijzigen
   (`vault.test.mjs`), de KDF-upgrade in de unlock-transactie (vault), de
   mislukte en geslaagde upgrade en verbergen tijdens de upgrade
   (controller), herstel met de herstelsleutel naar 2.000.000 (controller).
   Een test controleert dat de app zonder optie de standaard gebruikt en dat
   de controller de optie doorgeeft.
5. **Dubbele tests samengevoegd**: de controllertests "nieuwe installatie met
   2.000.000" en "KDF-upgrade bij ontgrendelen" deden hetzelfde als de
   vault-test van de standaard en de controllertest van de mislukte upgrade;
   hun controles (nieuwe salt, geen tweede upgrade, volledige controle)
   staan nu in die tests. Geen test uit een review verwijderd.
6. **Selectie in CI** (beslispunt 2): job *Selectie* met
   `tools/ci_selectie.py` (met unittests). Alleen bij een pull request die
   uitsluitend `docs/**` of `*.md` in de hoofdmap wijzigt, slaan *JavaScript*
   en *Browsertests (Chrome)* hun tests over, met een melding; de jobs
   starten en rapporteren altijd (`if: always()`). Bij een ander bestand, een
   lege of mislukte diff, een push naar `main` of een handmatige start draait
   alles. `pages.yml` (publiceren) draait altijd zijn eigen controles.
7. **`CLAUDE.md` §2**: tabel "wat je raakt → wat je tussendoor draait";
   vóór elke commit de hele set.

## Risico's
| Risico | Maatregel |
|---|---|
| Minder rondes in tests verbergen een fout bij 2.000.000 | Tests over de standaard en de upgrade gebruiken de echte waarde; test dat de app zonder optie de standaard gebruikt |
| Een testoptie in productiecode verlaagt de beveiliging | Alleen een parameter met de standaard; geen globale instelling; ondergrens van het formaat afgedwongen; de app geeft hem nooit mee |
| Gedeelde testkluis verbergt een fout bij een verse installatie | Elke test krijgt een kopie; de onboardingtests lopen de hele route |
| De selectie in CI slaat ten onrechte iets over | Alleen `docs/**` en `*.md` in de hoofdmap; bij twijfel alles; tests van `ci_selectie.py`; op `main` altijd alles |
| Een overgeslagen verplichte controle blijft op *Pending* | De selectie zit binnen de workflow; de jobs lopen altijd |

## Acceptatiecriteria
- Node-tests lokaal ongeveer 15 s (was ongeveer 57 s); in CI te zien in de PR.
- De routes onboarding, wachtwoord, upgrade en herstel lopen met echte rondes.
- In de PR: de code-commits draaien alles. Een documentatie-PR slaat de zware stappen over; dat controleert de gebruiker bij de eerste documentatie-PR na de merge (job *Selectie*, melding "overgeslagen").
- `CLAUDE.md` §2 bijgewerkt; alle controles groen.

# Plan taak 6: auditlog en controles in de app

Datum: 2026-11-25. Uitwerking van taak 6 uit het
[plan fase 1](2026-11-25-fase-1-fundament.md) §5. Akkoord gebruiker:
2026-11-25.

## In het kort
De hashketen, het controlepunt en beide controles bestaan al sinds taak 3–5
(`vault.js`, `store.js`). Deze taak maakt ze zichtbaar en meetbaar in de
app: een scherm Logboek, een melding terwijl de opslag wordt gecontroleerd,
de duur van de controle, en een meting van de controles bij een groot
nep-logboek. Daarnaast tests die laten zien dat een gemanipuleerd log wordt
gevonden en dat de opslag dan ongewijzigd blijft.

## Doel
- Acceptatiecriterium plan fase 1 §7: "een gemanipuleerd log wordt
  gedetecteerd"; ontgrendelen, mislukte pogingen, wachtwoord wijzigen en
  herstel staan in het log (export en import: taak 7).
- Voorwaarde voor echte dossiers: "een verschuldigde volledige controle die
  schade vindt, laat de bestaande opslag ongewijzigd", nu ook via de app.
- Formaat §9.4: termijn en duur van de volledige controle bijstellen op
  basis van een meting bij een realistisch groot log.
- Rest van audit A1: de meting op het referentietoestel.

## Besluiten van de gebruiker (2026-11-25)
- **Omvang van het log**: 0–10 regels per dag, dus ongeveer 18.000 regels in
  5 jaar. Meetgroottes: 20.000 regels met 2.000 recordversies, en als marge
  100.000 regels met 10.000 recordversies.
- **Logboek bekijken wordt niet gelogd**: er komt geen nieuwe actie in §8.2.
  Het logboek is vooral voor debugging en forensisch onderzoek en moet dus
  goed benaderbaar zijn: het scherm toont per regel ook een technische regel
  (volgnummer, schrijfsleutel, soort en versie, begin van het record-id,
  detailcode).
- **PBKDF2**: gemeten op de OnePlus 13R: 600.000 rondes in 0,1 s,
  10.000.000 rondes in 1,5 s. De grens van `kdf.iterations` is daarmee niet
  meer voorlopig (formaat §2.4).

## Omvang
- Nieuw: `app/js/benchmark.js` (nep-opslag in het geheugen en meting),
  `tests/benchmark.test.mjs`.
- Gewijzigd: `app/js/vault.js` (`readAuditPage`; fouten bij het inlezen
  altijd als afwijking), `app/js/store.js` (melding van de wachtrij bij een
  verschuldigde controle), `app/js/controller.js`, `app/js/app.js`,
  `app/css/app.css`, `app/js/i18n/nl.js`, `app/sw.js` (release),
  `tests/vault.test.mjs`, `tests/controller.test.mjs`, `tests/browser.mjs`,
  `docs/formaat.md` §2.4 en §9.4, `docs/reviews/2026-11-25-reviews.md`,
  `docs/compliance/nen7510.md`, `docs/overdracht.md`, het plan fase 1.
- Niet: formaatwijziging, schemawijziging, nieuwe auditacties, export van
  het log (gaat mee in de back-up, taak 7), forensisch bestand (na de alpha).

## Taken
1. **`readAuditPage(store, session, {before, limit})`** in `vault.js`: pure
   leesfunctie, nieuwste eerst, standaard 50 regels per bladzijde. Elke regel
   ontsleutelt met de `h` van de regel ervoor in de AAD; een onleesbare regel
   of een gat is een afwijking `chain` (§10). De hashketen zelf blijft het
   werk van `fullCheck()`.
2. **Scherm Logboek** (Meer → Logboek): datum en tijd, handeling in gewone
   taal, resultaat als het niet `ok` is, en de technische regel; knop
   "Oudere regels".
3. **Controle zichtbaar**: de wachtrij meldt een verschuldigde controle
   (`onCheck`); de app toont "De opslag wordt gecontroleerd…" en daarna de
   duur bij Meer → Controle opslag. Het stopscherm noemt bij welke controle
   (snel of volledig) de afwijking werd gevonden.
4. **Meting** (Meer → Snelheid meten → Controle van de opslag): bouwt met
   een wegwerpwachtwoord een opslag in het geheugen met de gevraagde omvang
   en meet `fullCheck()` en `quickCheck()`. Niets in IndexedDB.
5. **Inlezen als afwijking**: een regel of versie die wel ontsleutelt maar
   niet aan het formaat voldoet, gaf in `fullCheck()` een `FormatError` en
   daarmee een algemene foutmelding; nu een afwijking `chain` of `record`.
6. **Tests**: zie hieronder.
7. **Documentatie**: formaat §2.4 (meting PBKDF2, "voorlopig" weg bij de
   rondes) en §9.4 (meting van de controle), reviews, NEN 7510,
   overdracht.

## Tests
- Node: logboek lezen (volgorde, bladeren, niets geschreven, onleesbare
  regel en gat → `chain`); nep-opslag doorstaat beide controles; een
  gewijzigde oudere regel valt alleen bij de volledige controle op;
  controller: logboek, verschuldigde controle bij ontgrendelen (zichtbaar,
  duur, `integrity_check` na `unlock`), klok teruggezet, schade bij een
  verschuldigde controle (gestopt, `haltCheck` = `full`, opslag
  ongewijzigd), meting slaat niets op.
- Browser (`tests/browser.html`): logboek op IndexedDB, meting raakt
  IndexedDB niet.
- Browsercontrole van de schermen met Playwright (buiten de repository).

## Risico's
| Risico | Maatregel |
|---|---|
| Meting in het geheugen wijkt af van IndexedDB (inlezen telt niet mee) | Controle opslag toont ook de duur op de eigen opslag, inclusief inlezen |
| Lange controle bij een groot log | Elke stap wacht op Web Crypto, de UI blijft reageren; vergrendelen tijdens de controle werkt via het generatienummer |
| Meetcode wordt meegepubliceerd | `benchmark.js` raakt de opslag niet; test in Node en in de browser |

## Acceptatiecriteria
- Logboek leesbaar onder Meer; lezen schrijft niets.
- De volledige controle is zichtbaar en toont haar duur.
- Meting van de controles beschikbaar; uitslag op de OnePlus in formaat §9.4.
- Alle controles uit `CLAUDE.md` §2 slagen; browsertests slagen.

## Open na deze taak
- Meting op de OnePlus: Meer → Snelheid meten → Controle van de opslag, bij
  beide groottes. De uitslag gaat naar formaat §9.4; daarna termijn (nu 7
  dagen) bevestigen of bijstellen.

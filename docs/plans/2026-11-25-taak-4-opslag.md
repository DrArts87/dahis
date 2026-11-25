# Plan taak 4: opslag in IndexedDB

Datum: 2026-11-25. Uitwerking van taak 4 uit het
[plan fase 1](2026-11-25-fase-1-fundament.md) §5, met de punten A1, A2 en A4
uit de [code-audit](../reviews/2026-11-25-reviews.md).

## In het kort
De kluis (`vault.js`) werkt tot nu toe alleen in het geheugen. Deze taak geeft
haar een vaste plek in de browser (IndexedDB) en regels die ervoor zorgen dat
er nooit half wordt opgeslagen, dat er maar één schrijver tegelijk is, en dat
de kluis zelf bepaalt welke controles en sleutels nodig zijn. De schermen van
de app sluiten pas in taak 5 aan.

## Doel
De transacties uit `vault.js` atomair en duurzaam vastleggen in IndexedDB
(formaat §5 en §9.1), en de afspraken uit de code-audit afdwingen in de code,
niet bij de aanroeper.

## Omvang
- `app/js/store.js` (nieuw): IndexedDB, Web Lock, opslagstatus,
  schrijfwachtrij.
- `app/js/vault.js`: verschuldigde volledige controle, ongeldige reservering,
  sleutelrotatie.
- `app/sw.js` via `tools/release.py`.
- Tests: Node (`tests/*.test.mjs`) en de browser (`tests/browser.html`).
- `docs/formaat.md` §3.8, §9.1, §9.4 (tekst; geen nieuwe velden, de
  testvectoren blijven gelijk). Akkoord van de gebruiker: 2026-11-25.
- Niet in deze taak: schermen (taak 5), metingen op de OnePlus, CI-job voor
  browsertests.

## Taken

### 1. `store.js`
- `IdbBackend.open()`: database `dahis`, versie 1, met `meta` (sleutel =
  naam), `records` (keyPath `[id, version]`, index `kind`) en `audit`
  (keyPath `seq`). Een database van een nieuwere versie wordt geweigerd.
- `load()`: de hele database als `{meta, records, audit}`, dezelfde vorm als
  in `vault.js`.
- `commit(tx)`: één `readwrite`-transactie over de drie stores met
  `durability: 'strict'`:
  - controlepunt synchroon en byte voor byte vergelijken, of bij
    `requireEmpty` alle drie de stores tellen;
  - records en auditregels met `add`, zodat een bestaande sleutel de
    transactie afbreekt (append-only);
  - vernietigen verwijdert alle versies van een `id` via een sleutelbereik;
  - pas na `complete` wordt de kopie in het geheugen bijgewerkt.
- `acquireLock()`: exclusief Web Lock `dahis` voor de hele sessie, met
  `ifAvailable`; bezet geeft "Dahis is al geopend".
- `storageStatus()` en `requestPersist()`: `navigator.storage.persist()`,
  `persisted()` en `estimate()`.
- `WriteQueue`: alle schrijfacties van een tabblad achter elkaar (A1). Per
  schrijfactie eerst, zo nodig: de verschuldigde volledige controle op een
  vers ingelezen opslag, een nieuwe schrijfsleutel, een nieuwe reservering;
  dan de schrijfactie zelf.
- `IdbBackend.deleteDatabase()` voor "alles wissen" en voor de tests.

### 2. `vault.js`
- **A1, verschuldigde volledige controle.** `unlock()` zoekt van achter naar
  voren de laatste regel `integrity_check`, `export`, `import` of `create`
  (detail `install`). Is die er niet, of is ze 7 dagen of ouder (of ligt ze in
  de toekomst), dan is de controle verschuldigd. Elke schrijfactie weigert
  (`FullCheckDueError`) zolang de verschuldigde controle niet is uitgevoerd;
  na een geslaagde controle voegt de kluis zelf de regel `integrity_check` toe
  aan de eerstvolgende schrijfactie. De vlag `integrityChecked` van
  `unlockTx()` verdwijnt.
- **A1, reservering vóór gebruik.** Versleutelen zonder vastgelegde
  reservering kan niet (`ReservationNeededError`, bestond al); de wachtrij
  legt de reservering eerst in een eigen transactie vast. `nextPrelude()` geeft
  de voorafgaande transactie die nodig is.
- **A2, ongeldige reservering.** Ontbreekt de reservering, hoort ze bij een
  oudere schrijfsleutel, of faalt de structuur of de HMAC, dan is de eerste
  schrijfactie een nieuwe schrijfsleutel (§3.8 geval 1). Een reservering met
  een onbekende `kid` blijft een afwijking (`keys`).
- **Mislukte ontgrendelpogingen**: de regel `unlock_failed` komt voortaan in
  de eerste schrijvende transactie, welke dat ook is (§9.1), en niet alleen in
  `unlockTx()`.
- **A4.** `rotateKeysTx()` weigert een nieuw wachtwoord dat de huidige
  `wrapped_password` opent (`PasswordReuseError`); dat kost één extra
  PBKDF2-afleiding.

### 3. Tests
- Node, met `MemoryBackend` en de `WriteQueue`: termijn wel en niet
  verschuldigd, ook als een sessie over de grens loopt; een verschuldigde
  controle die schade vindt, laat de opslag ongewijzigd en stopt de wachtrij;
  de drie A2-varianten geven elk een nieuwe `kid` met nieuwe salt; A4;
  volgorde in de wachtrij; `unlock_failed` in de eerste schrijvende
  transactie.
- Browser (`tests/browser.html`, echte IndexedDB): end-to-end onboarding,
  ontgrendelen, schrijven, vergrendelen en opnieuw openen, back-up, alles
  wissen, terugzetten met wachtwoord en met herstelsleutel; Web Lock;
  append-only; afgebroken transactie bij onboarding, schrijven en terugzetten
  laat de opslag ongewijzigd en de volgende poging slaagt met een nieuwe salt;
  een verschuldigde controle met schade in IndexedDB laat de opslag
  ongewijzigd.
- Herladen midden in een schrijfactie ("geheel of niets") en twee tabbladen:
  met Playwright in de cloudsessie; het stuurscript staat niet in de
  repository.

### 4. Documentatie
`docs/formaat.md`, `docs/overdracht.md`, plan fase 1 (taak 4 afvinken),
reviews (A1 deels, A2, A4 verwerkt).

## Afwijking van het plan in de chat
In de chat stond: bij een conflict opnieuw inlezen en nog één poging. Dat is
niet veilig: een conflict betekent dat een andere schrijver met dezelfde
schrijfsleutel kan hebben versleuteld, en de teller van deze sessie weet daar
niets van. Daarom: bij een conflict leest de wachtrij de opslag opnieuw in,
stopt, en vraagt om opnieuw te ontgrendelen (§9.1 stap 3: "opnieuw beginnen
vanaf de nieuwe toestand"). Met het Web Lock hoort een conflict niet voor te
komen.

## Risico's

| Risico | Maatregel |
|---|---|
| CI heeft geen browser; de IndexedDB-tests draaien niet automatisch | Lokaal en in de cloudsessie; later eventueel een CI-job met de Chrome van de runner, zonder npm (apart te vragen) |
| Het hele log in het geheugen houden wordt traag bij een groot log | Meten in taak 6 |
| Terugzoeken van de laatste volledige controle ontsleutelt veel regels bij een lang log | Stopt bij de eerste passende regel; lukt het niet, dan is de controle verschuldigd |
| Herladen midden in een transactie is niet deterministisch te testen | Daarnaast een afbreekhaak voor tests |
| Chrome op Android gedraagt zich anders (persist, durability) | Taak 5 en 10 op de OnePlus |

## Acceptatiecriteria
- Elke schrijfactie gaat via de wachtrij in één `readwrite`-transactie met
  controlepuntvergelijking en `strict` durability.
- `unlockTx()` kent geen `integrityChecked` meer; een verschuldigde volledige
  controle wordt altijd uitgevoerd en gelogd vóór de eerste schrijfactie, en
  een controle die schade vindt, laat de opslag ongewijzigd.
- Een ongeldige reservering leidt tot een nieuwe schrijfsleutel vóór er
  opnieuw wordt versleuteld.
- `rotateKeysTx()` weigert het huidige wachtwoord.
- De onderbrekings- en end-to-end tests slagen in Chromium; een tweede
  tabblad krijgt "Dahis is al geopend".
- `release.py`, `py_compile`, unittests, `node --check`, `node --test` en
  `privacy_check.py` slagen.

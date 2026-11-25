# Formaat: versleuteling, opslag en back-up

Formaat: **1**
Status: concept voor de alpha, herzien na vier reviewrondes (2026-11-25).
Wordt *vastgesteld* na taak 3 (implementatie en testvectoren), de metingen op
het referentietoestel en een volgende review. Tot dan kan formaat 1 nog zonder
migratie wijzigen, omdat er geen echte gegevens in bestaan.
Hoort bij: [plan fase 1](plans/2026-11-25-fase-1-fundament.md)

Na vaststelling is dit document een **contract** met alle gegevens en
back-ups die met Dahis zijn gemaakt. Een implementatie houdt zich er byte voor
byte aan. Wijzigen kan dan alleen met een nieuw formaatnummer en een migratie
(§14).

Testvectoren, ook negatieve, staan in `tests/fixtures/vectoren.json` (gemaakt
met `tests/maak_vectoren.mjs`). Ze worden gecontroleerd tegen de
implementatie (`app/js/crypto.js`, in Node en in de browser) en onafhankelijk
in Python (`tests/test_vectoren.py`). Wat bewust na de alpha komt, staat in
§17.

## 1. Dreigingsmodel en garanties

Aanvaller: iemand die de opslag van de telefoon of een back-upbestand kan
lezen en wijzigen, maar het wachtwoord en de herstelsleutel niet kent.

**Gegarandeerd**
- **Vertrouwelijkheid**: geen inhoud van records of auditregels leesbaar.
- **Integriteit**: elke wijziging aan een versleuteld stuk of aan de
  metadata in de AAD wordt gedetecteerd zodra dat stuk wordt gelezen.
- **Bij elke ontgrendeling** (§9.2): een ontbrekende, toegevoegde, vervangen
  of teruggezette recordversie, een gewijzigde laatste auditregel, een
  teruggezet of ingekort auditlog, en een gewijzigde lijst van schrijfsleutels
  of sleutelring worden gedetecteerd, zolang het controlepunt niet mee wordt
  teruggezet.
- **Bij de volledige controle** (§9.3, §9.4): ook een wijziging aan of het
  ontbreken van een **oudere** auditregel, en een recordversie die niet meer
  te ontsleutelen is.
- **Na sleutelvernieuwing** (§12.5): gegevens die daarna zijn geschreven, zijn
  niet te lezen met oude wachtwoorden, oude herstelsleutels of een gelekte
  oude datasleutel.

**Niet gegarandeerd**
- **Volledige rollback**: worden records, auditlog, `meta` en controlepunt
  samen teruggezet naar een eerdere, consistente toestand, dan is dat lokaal
  niet te detecteren; dat vraagt een vertrouwd extern referentiepunt (later de
  synchronisatieserver). Het is gelijkwaardig aan het terugzetten van een
  oudere back-up.
- **Oudere auditregels tussen twee volledige controles**: een wijziging
  daaraan valt pas bij de volgende volledige controle op (§9.4).
- **Herstel ter plekke na een afwijking**: de app stopt met normaal gebruik;
  herstel gaat via een back-up, en wijzigingen sinds die back-up gaan
  verloren (§10).
- **Oude kopieën**: een back-up of opslagkopie die al bestond, blijft leesbaar
  met de geheimen van toen, ook na wachtwoordwijziging of sleutelvernieuwing.
- **Vernietiging in bestaande back-ups** (§13).
- **Raden van het wachtwoord**: met een buitgemaakte wrap kan offline worden
  geraden; PBKDF2 maakt dat duur, niet onmogelijk. Wie IndexedDB kan lezen,
  kan de wraps al kopiëren. `failed_unlocks` telt alleen pogingen in de app
  zelf en is door de aanvaller te wijzigen.
- **Exacte telling van het IV-budget onder aanval** (§3.8).
- Iemand die de ontgrendelde app bedient of gewijzigde app-code laat draaien
  (zie service worker en CSP in het plan voor fase 1).

**Zichtbaar zonder sleutel**
- IndexedDB: `format`, `created_at`, `device_id`, `epoch`, KDF-parameters,
  de salts van de schrijfsleutels, de reservering, `last_backup_at`,
  `failed_unlocks`; per recordversie `id`, `version`, `kid`, `kind`,
  `updated_at` en de grootte in blokken van 512 bytes; per auditregel `seq`,
  `kid` en de grootte in blokken van 128 bytes. Daaruit volgen aantallen en
  het tijdpatroon van wijzigingen.
- Back-upbestand: de header (`magic`, `format`, `epoch`, bestandssalt,
  KDF-parameters, gewrapte sleutels), de grootte in blokken van 4096 bytes,
  de bestandsnaam (lokale datum en tijd) en de tijdstempels van het
  bestandssysteem.

## 2. Bouwstenen en notatie

| Bouwsteen | Gebruik |
|---|---|
| AES-GCM-256 | Alle versleuteling; IV van 12 bytes, tag van 16 bytes |
| PBKDF2-HMAC-SHA256 | Sleutel uit het wachtwoord |
| HKDF-SHA256 | Sleutel uit de herstelsleutel; subsleutels; bestandssleutels |
| HMAC-SHA256 | Reservering van het IV-budget (§3.8) |
| SHA-256 | Hashketen, versiehashes, toestandsdigest, registerdigests, controlegroep |
| Willekeur | `crypto.getRandomValues` / `crypto.randomUUID` |

Notatie:
- `‖` is aaneenschakelen van bytes; `UTF8(s)` de UTF-8-codering van `s`.
- `B64(x)` is base64url **zonder** opvulling, RFC 4648 §5 (§2.3).
- `be32(n)`, `be64(n)`: het getal `n` als 4 of 8 bytes big-endian.
- Tijdstippen: UTC, `JJJJ-MM-DDTUU:MM:SS.sssZ`, precies zoals
  `Date.prototype.toISOString()` (24 tekens).
- In IndexedDB worden bytes opgeslagen als `Uint8Array`; in JSON als `B64`.
- Elke IV is 12 willekeurige bytes, per versleuteling opnieuw gegenereerd.

### 2.1 AAD
Alle AAD is `UTF8` van een JSON-array zonder spaties. Het eerste element
noemt domein en formaat (`dahis/1/…`). Elementen zijn uitsluitend:
- tekst uit de tekens `A–Z a–z 0–9 - _ . : /`;
- gehele getallen 0 … 2⁵³ − 1 als **tekst** in decimale notatie zonder
  voorloopnullen (`"2"`, niet `2`).

Dan geven `JSON.stringify(arr)` en
`json.dumps(arr, separators=(",", ":"))` exact dezelfde bytes. Een
implementatie weigert een element dat niet aan deze regels voldoet.

### 2.2 Opvulling
`opgevuld(json, n)`: `UTF8(json)`, aangevuld met spaties (`0x20`) tot de
lengte een veelvoud van `n` is (geen spaties als dat al zo is). JSON-parsers
negeren spaties aan het eind. Blokgroottes: records 512, auditregels 128,
inhoud van een back-up 4096.

### 2.3 Strikt inlezen
Gegevens van buiten (bestanden) en onversleutelde velden uit IndexedDB worden
gecontroleerd vóór ze worden gebruikt; welke velden wanneer, staat in §12.2
en §11.5.
- **UTF-8**: eerst de ruwe bytes controleren: beginnen ze met `EF BB BF`
  (BOM), dan is dat een fout. Daarna streng decoderen (`TextDecoder` met
  `fatal: true` en `ignoreBOM: true`); ongeldige bytes of een `\r` zijn een
  fout.
- **base64url**: alleen `A–Z a–z 0–9 - _`, lengte mod 4 ≠ 1, en decoderen en
  opnieuw coderen geeft exact dezelfde tekst (geen niet-nul restbits).
- **Getallen**: gehele getallen binnen de grenzen van §2.4.
- **Objecten**: precies de velden die dit document noemt, met de juiste
  types; onbekende of ontbrekende velden zijn een fout.
- **Canoniek** (de header van een back-up, §11.1): na inlezen opnieuw
  serialiseren in de volgorde van dit document moet exact dezelfde bytes
  geven. Dat sluit dubbele sleutels, extra witruimte en een andere volgorde
  uit, ook in JavaScript waar `JSON.parse` dubbele sleutels stilzwijgend
  accepteert.

### 2.4 Grenzen

| Veld | Grens |
|---|---|
| `kdf.alg` | exact `PBKDF2-SHA256` |
| `recovery.alg` | exact `HKDF-SHA256` |
| `kdf.iterations` | 600.000 t/m 10.000.000 (voorlopig) |
| salt (alle soorten) | 16 bytes |
| IV | 12 bytes |
| gewrapte sleutel (`ct`) | 48 bytes |
| `epoch` | 1 t/m 65.535 |
| `kid` | 1 t/m 65.535, uniek, oplopend in `write_keys` |
| `seq` | 1 t/m 2⁵³ − 1 |
| `version` | 1 t/m 2³¹ − 1 |
| record | opgevulde inhoud 512·k bytes, 1 ≤ k ≤ 2048 (≤ 1 MiB); `ct` = inhoud + 16 |
| auditregel | opgevulde inhoud 128·k bytes, 1 ≤ k ≤ 32; `ct` = inhoud + 16 |
| header van een back-up (regel 1) | ≤ 4096 bytes |
| back-upbestand | ≤ 256 MiB voor het hele tekstbestand, gecontroleerd vóór inlezen (voorlopig) |

De grenzen die als voorlopig zijn gemarkeerd, worden vóór gebruik met echte
dossiers gemeten op het referentietoestel: de rekentijd van PBKDF2 bij het
maximum, en of de app bij de maximale bestandsgrootte een back-up nog kan
maken én openen (piekgeheugen). Zo nodig gaan ze omlaag.

## 3. Sleutels

```
hoofdwachtwoord ──PBKDF2──► KEK_w ──┐
                                    ├─ wrap ─► datasleutel DK_e ─┬─ HKDF(salt_k) ─► K_k,record / audit / checkpoint / keyring / reserve
herstelsleutel ───HKDF────► KEK_h ──┘                            └─ HKDF(salt_bestand) ─► sleutel voor één back-up
                                                        K_k,keyring ─ wrap ─► DK_1 … DK_e−1
```

### 3.1 Datasleutel en epoch
- Elke datasleutel `DK_e` is 32 willekeurige bytes en hoort bij een
  `epoch` `e`. Onboarding maakt `DK_1`; sleutelvernieuwing (§12.5) maakt de
  volgende.
- `DK_e` wordt nooit direct gebruikt om te versleutelen, alleen als bron voor
  subsleutels (§3.2, §3.3).

### 3.2 Schrijfsleutels en subsleutels
Een **schrijfsleutel** is een item `{kid, epoch, salt}` in `meta.write_keys`.
```
K_k,d = HKDF-SHA256(ikm = DK_epoch(k), salt = salt_k, info = UTF8("dahis/1/sub/" + d), 32 bytes)
d ∈ { record, audit, checkpoint, keyring, reserve }
```
`reserve` is een HMAC-sleutel (§3.8); de andere zijn AES-GCM-sleutels.

**Samenhang** (gecontroleerd bij elke ontgrendeling en bij terugzetten):
- `kid`'s in `write_keys` zijn uniek en strikt oplopend; elk item voldoet aan
  §2.4.
- De **actuele** schrijfsleutel is de `kid` van het controlepunt
  (`meta.checkpoint.kid`). Die staat in `write_keys` en hoort bij
  `meta.epoch`; `meta.epoch` is ook de epoch in de AAD van beide wraps.
- Elke `kid` waarnaar een record, auditregel, sleutelringitem of de
  reservering verwijst, staat in `write_keys`.
- De registerdigests in het controlepunt (§9) kloppen:
  ```
  write_keys_digest = SHA-256( UTF8("dahis/1/write_keys") ‖ be32(n) ‖ (be32(kid) ‖ be32(epoch) ‖ salt)… )   gesorteerd op kid
  keyring_digest    = SHA-256( UTF8("dahis/1/keyring") ‖ be32(n) ‖ (be32(epoch) ‖ be32(kid) ‖ iv ‖ ct)… ) gesorteerd op epoch
  ```
  Alle velden hebben na de controle van §2.4 een vaste lengte, dus deze
  aaneenschakeling is eenduidig.

**Nieuwe schrijfsleutel** (nieuwe salt, hoogste `kid` + 1, actuele epoch): bij
onboarding, bij elk herstel uit een back-up, bij sleutelvernieuwing, en zodra
het budget van de actuele op is (§3.8). Twee installaties die uit dezelfde
back-up voortkomen, versleutelen zo nooit met dezelfde subsleutel. De volgorde
van vastleggen staat in §3.8.

### 3.3 Bestandssleutels
Elke back-up krijgt een eigen sleutel:
```
K_bestand = HKDF-SHA256(ikm = DK_e, salt = salt_bestand, info = UTF8("dahis/1/sub/backup"), 32 bytes)
salt_bestand: 16 willekeurige bytes, in de header
```
Met die sleutel wordt precies één keer versleuteld.

### 3.4 Wachtwoordsleutel
- Wachtwoord: Unicode-normaliseren naar **NFC**, dan `UTF8`. Geen andere
  bewerking.
- Minimaal 14 Unicode-codepunten na NFC. De app geeft daarnaast advies (een
  wachtzin van minstens 5 willekeurige woorden) en weigert evident zwakke
  wachtwoorden; die controle hoort bij de app, niet bij het formaat.
- `KEK_w = PBKDF2-HMAC-SHA256(wachtwoord, salt_w, iterations, 32 bytes)`.
- `salt_w`: 16 willekeurige bytes. Standaard `iterations`: 600.000. De duur
  wordt bij onboarding gemeten en getoond.

### 3.5 Herstelsleutel-KEK
`KEK_h = HKDF-SHA256(ikm = herstelsleutel (32 bytes), salt = salt_h,
info = UTF8("dahis/1/kek/herstel"), 32 bytes)`, met `salt_h` 16 willekeurige
bytes.

### 3.6 Wrappen
De actuele datasleutel wordt gewrapt met beide KEK's:
```
iv = 12 willekeurige bytes
ct = AES-GCM(KEK, iv, DK_e (32 bytes), aad)        → 48 bytes
```

| | AAD |
|---|---|
| Wachtwoord | `["dahis/1/wrap","password","PBKDF2-SHA256","<iterations>","<B64(salt_w)>","<e>"]` |
| Herstelsleutel | `["dahis/1/wrap","recovery","HKDF-SHA256","<B64(salt_h)>","<e>"]` |

**Sleutelring.** Oudere datasleutels staan in `meta.keyring`:
```
aad = ["dahis/1/keyring", "<kid>", "<oude epoch>", "<epoch van kid>"]
ct  = AES-GCM(K_kid,keyring, iv, DK_oud, aad)     → 48 bytes
```
De sleutelring wordt alleen bij sleutelvernieuwing (§12.5) opgebouwd, onder
de eerste schrijfsleutel van de nieuwe epoch. Een latere nieuwe schrijfsleutel
binnen dezelfde epoch wrapt de sleutelring **niet** opnieuw; lezen gebeurt met
de `kid` die bij elk item staat, en die hoort bij de actuele epoch. De
sleutelring bevat precies één item per epoch 1 … actuele − 1.

Mislukt het unwrappen van een wrap, dan is de melding: "Wachtwoord (of
herstelsleutel) onjuist, of de gegevens zijn beschadigd of gewijzigd."

### 3.7 Omgaan met ruwe sleutelbytes
- **Unwrappen** is AES-GCM-ontsleutelen naar een tijdelijke `Uint8Array`. Die
  wordt direct geïmporteerd als **niet-exporteerbare** HKDF-`CryptoKey` en
  daarna met nullen overschreven.
- Een niet-exporteerbare sleutel levert zijn bytes niet terug. Waar de ruwe
  `DK` opnieuw nodig is (wachtwoord wijzigen, herstel, KDF-upgrade,
  sleutelvernieuwing, terugzetten), wordt hij **binnen die handeling opnieuw
  ontsleuteld**:
  - de actuele `DK` uit `wrapped_password` of `recovery`, met een KEK die in
    dezelfde handeling is afgeleid uit het wachtwoord of de herstelsleutel die
    de gebruiker net heeft ingevoerd;
  - een oude `DK` uit `keyring`, met `K_kid,keyring`.
- Bij de **KDF-upgrade** tijdens het ontgrendelen (§12.2) is dat de `KEK_w`
  uit die ontgrendeling.
- KEK's en ruwe bytes bestaan alleen binnen de handeling; buffers worden na
  gebruik met nullen overschreven. JavaScript garandeert niet dat er geen
  kopieën in het geheugen achterblijven (§16).

### 3.8 IV-budget en reservering
Met willekeurige IV's geldt per sleutel een maximum van 2³² versleutelingen.
Dahis telt per schrijfsleutel **één gezamenlijke teller** voor alle
AES-GCM-subsleutels en stopt bij 2³¹; elke afzonderlijke subsleutel blijft dan
ruim onder de grens.

Een **reservering** legt vast tot welke tellerstand versleutelen mag:
```
meta.reservation = {kid, until, mac}
mac = HMAC-SHA256(K_kid,reserve, AAD-bytes van ["dahis/1/reserve", "<kid>", "<until>"])
```
Elke handeling bepaalt vóór de eerste versleuteling hoeveel versleutelingen ze
nodig heeft: recordversies, auditregels (inclusief een uitgestelde
`unlock_failed`), sleutelringitems en het controlepunt. Het controlepunt slaat
in `counter` de stand na de handeling op.

**Twee gevallen, één regel**: een schrijfsleutel wordt pas gebruikt als hij,
met een reservering die het gebruik dekt, duurzaam is vastgelegd, óf in
dezelfde transactie wordt vastgelegd als alles wat ermee is versleuteld.

1. **Nieuwe schrijfsleutel** (onboarding, terugzetten, sleutelvernieuwing,
   budget op): verse salt; het nieuwe item in `write_keys`, de reservering
   (`until` = stand na de handeling + 2¹⁶) en alles wat met de sleutel is
   versleuteld, gaan in **één** transactie. Wordt die afgebroken of crasht de
   app, dan is niets vastgelegd: de salt en alle ciphertext worden weggegooid
   en de volgende poging begint met een nieuwe salt. Een salt die nooit is
   vastgelegd, wordt nooit opnieuw gebruikt; een crash laat geen half
   ingerichte installatie achter.
2. **Bestaande schrijfsleutel** (na ontgrendelen): de teller begint bij
   `max(checkpoint.counter, reservation.until)`, waarbij alleen een
   reservering met geldige `mac` voor de actuele `kid` telt. Alles daaronder
   geldt als verbruikt. Vóór de eerste versleuteling schrijft de app in een
   eigen transactie een nieuwe reservering `until = teller + 2¹⁶`. Past een
   handeling niet meer in de reservering, dan eerst een nieuwe reservering;
   past ze niet meer onder 2³¹, dan geval 1.

Een gewone crash verliest zo hooguit de rest van één reservering; die geldt
als verbruikt. Een geldige `mac` bewijst dat een reservering echt is, maar
niet dat ze de nieuwste is: zet een aanvaller herhaald een oudere reservering
terug en crasht de app telkens, dan is er geen cumulatieve bovengrens op het
aantal ongetelde versleutelingen. Bij het verwachte volume en willekeurige
IV's is dat aanvaardbaar (§16).

Bestandssleutels (§3.3) worden één keer gebruikt en vallen hierbuiten. Bij
`kid` of `epoch` 65.535 weigert de app nieuwe schrijfsleutels of epochs; dat
vraagt een nieuw formaat.

## 4. Herstelsleutel op papier
- Alfabet (Crockford base32): `0123456789ABCDEFGHJKMNPQRSTVWXYZ`.
- De 32 bytes worden van links naar rechts in groepen van 5 bits omgezet; het
  laatste teken bevat 1 databit en 4 nulbits: 52 tekens.
- Controle: de eerste 20 bits van
  `SHA-256(UTF8("dahis/1/herstelcontrole") ‖ herstelsleutel)`, als 4 tekens.
- Weergave: 14 groepen van 4 tekens met `-`; de laatste groep is de controle.

Invoer: hoofd- en kleine letters gelijk; spaties en `-` genegeerd; `I` en
`L` gelden als `1`, `O` als `0`; `U` en andere tekens zijn ongeldig. Precies
56 tekens, nulbits nul, controle klopt; anders "tikfout in de herstelsleutel"
zonder ontsleutelpoging.

## 5. Opslag in IndexedDB

Database `dahis`, IndexedDB-versie 1.

### 5.1 `meta` (sleutel = naam)

| Sleutel | Waarde | Beschermd |
|---|---|---|
| `format` | `1` | nee |
| `created_at` | tijdstip onboarding | nee |
| `device_id` | UUIDv4 van deze installatie | nee |
| `epoch` | actuele epoch | via AAD van wraps en controlepunt |
| `kdf` | `{alg, iterations, salt}` | via AAD van de wrap |
| `wrapped_password` | `{iv, ct}` (§3.6) | ja |
| `recovery` | `{alg, salt, iv, ct}` (§3.6) | ja |
| `write_keys` | `[{kid, epoch, salt}]` (§3.2) | via `write_keys_digest` |
| `keyring` | `[{epoch, kid, iv, ct}]` (§3.6) | ja, en via `keyring_digest` |
| `checkpoint` | `{kid, iv, ct}` (§9) | ja |
| `reservation` | `{kid, until, mac}` (§3.8) | HMAC |
| `last_backup_at` | tijdstip of `null` | nee |
| `failed_unlocks` | `{count, last_at}` | nee |

### 5.2 `records`
keyPath `["id", "version"]`, index `kind`. Zie §6.

### 5.3 `audit`
keyPath `seq`. Zie §8.

## 6. Records

| Veld | Type | Regel |
|---|---|---|
| `id` | tekst | UUIDv4 in kleine letters |
| `version` | geheel getal | 1, 2, 3, …; elke wijziging is een nieuwe versie |
| `kid` | geheel getal | schrijfsleutel |
| `kind` | tekst | `^[a-z][a-z_]{0,31}$` |
| `updated_at` | tekst | tijdstip van deze versie |
| `iv`, `ct` | bytes | §2.4 |

```
aad = ["dahis/1/record", "<kid>", "<epoch van kid>", id, "<version>", kind, updated_at]
ct  = AES-GCM(K_kid,record, iv, opgevuld(inhoud, 512), aad)
vh  = SHA-256(aad ‖ iv ‖ ct)                   (versiehash)
```

### 6.1 Inhoud
- `{"schema": n, "data": {...}}` voor een gewone versie;
  `{"schema": n, "deleted": true}` voor een verwijderde versie.
- `schema` is de versie van de inhoud per kind, los van het formaat.

### 6.2 Versies, verwijderen, vernietigen
- Een versie wordt nooit overschreven; de actuele versie is de hoogste.
- **Verwijderen**: nieuwe versie met `deleted: true`.
- **Vernietigen**: alle versies van het `id` worden gewist; zie §13 voor de
  reikwijdte.

### 6.3 Kinds

| kind | schema | Sinds | Omschrijving |
|---|---|---|---|
| — | — | — | — |

Formaat 1 begint zonder kinds; tests gebruiken `test_*`.

## 7. Toestandsdigest
De digest vat **alle** recordversies samen, zonder ontsleutelen:
```
state = SHA-256( UTF8("dahis/1/state") ‖ vh_1 ‖ vh_2 ‖ … ‖ vh_n )
```
met de versies gesorteerd op `id` (tekst, oplopend) en dan `version`
(oplopend). Bij een lege opslag: `SHA-256(UTF8("dahis/1/state"))`. Een rij
die niet aan §6 en §2.4 voldoet, of waarvan de `kid` niet bestaat, is een
afwijking (§10).

## 8. Auditlog

### 8.1 Regel
Opgeslagen object `{seq, kid, iv, ct, h}`; `seq` is 1, 2, 3, … zonder gaten.
```
h_0   = 32 nulbytes
aad   = ["dahis/1/audit", "<kid>", "<epoch van kid>", "<seq>", B64(h_vorige)]
ct    = AES-GCM(K_kid,audit, iv, opgevuld(inhoud, 128), aad)
h_seq = SHA-256(h_vorige ‖ be64(seq) ‖ be32(kid) ‖ iv ‖ ct)
```

### 8.2 Inhoud

| Veld | Waarde |
|---|---|
| `ts` | tijdstip |
| `action` | tabel hieronder |
| `kind`, `record_id`, `version` | van het betrokken record, of `null` |
| `vh` | bij `create`, `update` en `delete` van een record de `vh`; anders `null` (ook bij `create` met detail `install`) |
| `state` | `B64(state)` bij `export`; anders `null` |
| `result` | `ok`, `error` of `denied` |
| `device_id` | uit `meta` |
| `detail` | vaste code of getal, of `null`; **nooit** vrije tekst, namen of medische gegevens |

| action | Wanneer | detail |
|---|---|---|
| `create` | record of installatie aangemaakt | `install` bij onboarding |
| `view` | record geopend | |
| `update` | nieuwe versie | |
| `delete` | versie met `deleted: true` | |
| `destroy` | alle versies gewist | |
| `unlock` | ontgrendeld | `password` of `recovery` |
| `unlock_failed` | mislukte pogingen sinds de vorige ontgrendeling | aantal |
| `lock` | vergrendeld | `timeout`, `hidden` of `manual` |
| `password_change` | actuele datasleutel opnieuw gewrapt | `user`, `recovery` of `kdf_upgrade` |
| `recovery_used` | ontgrendeld met herstelsleutel | |
| `key_rotation` | nieuwe epoch (§12.5) | nieuwe epoch |
| `write_key` | nieuwe schrijfsleutel (§3.2) | nieuwe `kid` |
| `export` | back-up gemaakt | |
| `import` | back-up teruggezet | |
| `verify_backup` | back-up gecontroleerd | `integrity` of `equal` |
| `integrity_check` | periodieke of gevraagde volledige controle geslaagd | |
| `print` | afdruk of PDF gemaakt | |
| `app_update` | nieuwe app-versie geactiveerd | versienummer |

Nieuwe acties komen er alleen bij in dit document. De vh in auditregels legt
vast welke versie bij welke handeling hoort; of het geheel aan NEN 7513
voldoet, wordt apart getoetst.

## 9. Controlepunt
`meta.checkpoint = {kid, iv, ct}`:
```
aad = ["dahis/1/checkpoint", "<kid>", "<epoch van kid>"]
ct  = AES-GCM(K_kid,checkpoint, iv, UTF8(inhoud), aad)
```
Inhoud:
```json
{"seq": 0, "h": "…", "state": "…", "records": 0, "counter": 0,
 "write_keys_digest": "…", "keyring_digest": "…"}
```
- `seq`, `h`: van de laatste auditregel.
- `state`: toestandsdigest (§7); `records`: aantal recordversies.
- `counter`: versleutelingen onder schrijfsleutel `kid` (§3.8).
- `write_keys_digest`, `keyring_digest`: §3.2.

### 9.1 Atomair schrijven
Elke handeling die schrijft, gaat zo:
1. **Buiten** de transactie: reservering controleren (§3.8) en alles
   versleutelen en hashen (recordversie, auditregels, nieuw controlepunt).
   (Een IndexedDB-transactie sluit vanzelf zodra er op iets anders dan
   IndexedDB wordt gewacht, zoals Web Crypto.)
2. Eén `readwrite`-transactie: lees `meta.checkpoint` en vergelijk `kid`,
   `iv` en `ct` **synchroon, byte voor byte** met het controlepunt waarop
   stap 1 voortbouwde. Gelijk: schrijven. Anders: afbreken.
3. Na afbreken is niets geschreven; opnieuw beginnen vanaf de nieuwe
   toestand. De gebruikte tellerplaatsen blijven verbruikt (§3.8).

Staan er mislukte ontgrendelpogingen open (`failed_unlocks`), dan komt de
regel `unlock_failed` in de eerste schrijvende transactie, vóór de
eigenlijke regel, en gaat de teller op nul.

Er is maar één schrijvende instantie: de app neemt bij het starten een
exclusief Web Lock `dahis` voor de hele sessie. Een tweede tabblad of venster
krijgt de melding "Dahis is al geopend".

### 9.2 Snelle controle (bij elke ontgrendeling)
Een pure controle; ze schrijft niets.
1. Samenhang van de sleutelverwijzingen (§3.2, §3.6), inclusief beide
   registerdigests.
2. Controlepunt ontsleutelen.
3. De laatste auditregel heeft dezelfde `seq` en `h`, en haar `h` klopt
   opnieuw berekend uit de `h` van de regel ervoor, `seq`, `kid`, `iv` en
   `ct`.
4. Toestandsdigest en aantal versies, berekend over de opslag, zijn gelijk
   aan `state` en `records`.

Oudere auditregels worden hier niet gecontroleerd (§1, §9.4).

### 9.3 Volledige controle
Een pure controle op de opslag of op de inhoud van een back-up; ze schrijft
niets.
1. **Keten**: alle auditregels oplopend: geldige rijen, `seq` begint bij 1
   zonder gaten, `h` klopt, elke regel ontsleutelt.
2. **Records**: elke recordversie is geldig en ontsleutelt met de subsleutel
   van haar `kid`.
3. De snelle controle (§9.2) slaagt.

### 9.4 Wanneer welke controle, en wat er wordt geschreven

| Aanleiding | Controle | Bij succes geschreven | Bij afwijking |
|---|---|---|---|
| Ontgrendelen | snel | `unlock` | §10, niets geschreven |
| Termijn verstreken | volledig, op de opslag | `integrity_check` | §10, niets geschreven |
| Op verzoek | volledig, op de opslag | `integrity_check` | §10, niets geschreven |
| Export | volledig, op de opslag | `export` (§11.3) | §10, niets geschreven |
| Back-up controleren | volledig, op het bestand | `verify_backup` | melding; opslag ongewijzigd |
| Terugzetten | volledig, op het bestand | §11.5 | weigeren; opslag blijft leeg |

**Termijn.** De app controleert bij ontgrendelen en vóór elke schrijvende
handeling of de laatste geslaagde volledige controle (`integrity_check`,
`export` of `import`) 7 dagen of langer geleden is. Zo ja, dan voert hij eerst
de volledige controle uit en laat in die tijd geen handelingen toe. De
controle loopt onder het Web Lock en er wordt intussen niets geschreven. De
termijn en de duur worden tijdens de alpha bijgesteld op basis van metingen
bij een realistisch groot log.

## 10. Gedrag bij een afwijking
De app **stopt met normaal gebruik**: geen records openen, geen
schrijfacties, niets naar de opslag. Hij toont welke controle mislukte.

Mogelijk zijn alleen:
- **vergrendelen**;
- **alles wissen** (met expliciete bevestiging) en daarna een back-up
  terugzetten (§11.5). Wijzigingen sinds die back-up gaan verloren.

Elk geval is een incident volgens `docs/compliance/avg.md`. Een forensisch
bestand en het accepteren van een afwijking komen na de alpha (§17).

Codes: `checkpoint` (ontbreekt of niet te ontsleutelen), `chain` (hash,
`seq`, structuur of ontsleutelen van een auditregel), `head` (laatste regel
≠ controlepunt), `state` (digest of aantal), `record` (ongeldige of niet te
ontsleutelen versie), `keys` (samenhang van de sleutelverwijzingen, §3.2).

## 11. Back-upbestand (`.dahis`)

Tekstbestand in UTF-8 met precies twee regels, elk afgesloten met `\n`.

### 11.1 Regel 1: header
Canonieke JSON (§2.3), velden in deze volgorde, zonder witruimte, alle velden
verplicht:
```json
{"magic":"dahis-backup","format":1,"epoch":1,"salt":"…",
 "kdf":{"alg":"PBKDF2-SHA256","iterations":600000,"salt":"…"},
 "wrapped_password":{"iv":"…","ct":"…"},
 "recovery":{"alg":"HKDF-SHA256","salt":"…","iv":"…","ct":"…"}}
```
(hier over meerdere regels voor de leesbaarheid). `salt` is de bestandssalt
(§3.3). De header bevat alleen wat nodig is om te ontgrendelen. De `magic`
`dahis-forensic` is gereserveerd voor het forensische bestand (§17).

### 11.2 Regel 2: inhoud
`B64(iv ‖ ct)` met
```
aad = ["dahis/1/backup", "<epoch>", B64(SHA-256(regel 1))]
ct  = AES-GCM(K_bestand, iv, opgevuld(inhoud, 4096), aad)
```
"Regel 1" is zonder de afsluitende `\n`; de testvectoren leggen dat vast.
Elke wijziging aan de header maakt het bestand ongeldig.

Inhoud: JSON-object (strikt ingelezen, §2.3):

| Veld | Waarde |
|---|---|
| `format` | `1` |
| `created_at`, `app_version` | moment en app-versie van de export |
| `source_device_id` | `device_id` van het exporterende toestel |
| `write_keys` | als in `meta` (§3.2) |
| `keyring` | als in `meta` (§3.6) |
| `records` | alle versies als `{id, version, kid, kind, updated_at, iv, ct}` |
| `audit` | alle regels als `{seq, kid, iv, ct, h}` |
| `checkpoint` | `kid` en de onversleutelde inhoud van het controlepunt (§9) |

Records en auditregels behouden hun eigen versleuteling; terugzetten is
kopiëren.

Bestandsnaam `dahis-backup-JJJJMMDD-UUMM.dahis` (lokale tijd); MIME-type bij
delen `application/octet-stream`.

### 11.3 Exporteren
1. Volledige controle (§9.3) op de opslag; bij een afwijking §10.
2. Atomair (§9.1) een regel `export` schrijven met `state` van de huidige
   opslag, plus het nieuwe controlepunt.
3. De back-up opbouwen uit precies die toestand, met een nieuwe bestandssalt;
   het `checkpoint` in de back-up verwijst naar de `export`-regel.
4. Delen of downloaden; daarna `last_backup_at` bijwerken.

### 11.4 Controleren
- **Interne integriteit** (elke back-up): §11.5 stap 1–5 zonder te schrijven.
  Werkt ook voor een oudere back-up.
- **Gelijk aan een export** (direct na exporteren): de back-up is intern
  integer, en `checkpoint.seq`, `checkpoint.h` en `checkpoint.state` zijn
  gelijk aan `seq`, `h` en `state` van de `export`-regel met die `seq` in de
  eigen opslag. De vergelijking gaat met de momentopname van de export, niet
  met de huidige opslag.
- Daarna een regel `verify_backup` met detail `integrity` of `equal`.

### 11.5 Terugzetten (formaat 1: alleen op een lege opslag)
Stap 1–6 gebeuren in het geheugen; er wordt niets geschreven.
1. Bestandsgrootte ≤ 256 MiB, dan pas inlezen. Precies twee regels; regel 1
   ≤ 4096 bytes; strikt UTF-8.
2. Header strikt en canoniek inlezen; `magic` moet `dahis-backup` zijn;
   `format` en alle grenzen (§2.4) controleren.
3. Ontgrendelen met wachtwoord of herstelsleutel via de header (§3.6).
4. Bestandssleutel afleiden, inhoud ontsleutelen en strikt inlezen.
   Samenhang controleren (§3.2): `checkpoint.kid` hoort bij de epoch uit de
   header, beide registerdigests kloppen met de lijsten in de inhoud, alle
   `kid`-verwijzingen bestaan. Daarna de sleutelring unwrappen.
5. Volledige controle (§9.3) op de inhoud van de back-up, met het
   `checkpoint` uit de back-up.
6. Bij ontgrendelen met de herstelsleutel: een nieuw wachtwoord laten kiezen
   en de datasleutel opnieuw wrappen (§3.7).
7. **Nieuwe schrijfsleutel** (§3.8 geval 1), nieuwe `device_id`, regels
   `write_key`, `recovery_used` en `password_change` (indien van toepassing)
   en `import`, en een nieuw controlepunt, allemaal in het geheugen.
8. In één transactie, na controle dat de opslag nog leeg is: `meta`
   (inclusief nieuwe schrijfsleutel en reservering), records, auditregels en
   controlepunt schrijven. Mislukt dit, dan blijft de opslag leeg en begint
   een nieuwe poging bij stap 7 met een nieuwe salt.

## 12. Procedures

### 12.1 Onboarding
1. `DK_1`, `salt_w`, `salt_h`, herstelsleutel, `device_id` en schrijfsleutel
   `kid` 1 maken; `epoch` = 1, lege `keyring`.
2. Wachtwoord controleren (§3.4); `DK_1` wrappen met `KEK_w` en `KEK_h`.
3. Herstelsleutel tonen (§4) en twee groepen laten overtypen.
4. Regel `create` met detail `install` en het eerste controlepunt
   versleutelen; alles inclusief reservering in één transactie schrijven
   (§3.8 geval 1). Mislukt dit, dan blijft de opslag leeg en begint de
   onboarding opnieuw.

### 12.2 Ontgrendelen
1. Alleen de velden voor de gekozen route strikt controleren (§2.3, §2.4):
   bij het wachtwoord `kdf`, `wrapped_password` en `epoch`; bij de
   herstelsleutel `recovery` en `epoch`. Ongeldig: deze route kan niet; geen
   sleutelafleiding.
2. Met wachtwoord: `KEK_w` afleiden en `wrapped_password` unwrappen. Met
   herstelsleutel: invoer controleren (§4), `KEK_h` afleiden en `recovery`
   unwrappen.
3. Mislukt: `failed_unlocks` ophogen, verder niets.
4. Gelukt: de rest van `meta` strikt controleren, subsleutels afleiden,
   sleutelring unwrappen, snelle controle (§9.2), en als de termijn
   verstreken is ook de volledige controle (§9.4). Elke afwijking leidt naar
   §10. **Tot en met deze stap wordt niets geschreven**, behalve bij een
   mislukte ontgrendeling de teller van stap 3.
5. Reservering schrijven (§3.8 geval 2), dan regel `unlock` (§9.1), plus
   `integrity_check` als in stap 4 de volledige controle is uitgevoerd.
6. Is `iterations` lager dan de huidige standaard, dan opnieuw wrappen met de
   `KEK_w` van stap 2 (§3.7) en `password_change` met detail `kdf_upgrade`
   loggen.

### 12.3 Herstel met de herstelsleutel (zelfde toestel)
Na ontgrendelen met de herstelsleutel direct een nieuw wachtwoord laten
kiezen, opnieuw wrappen met de `KEK_h` van die ontgrendeling (§3.7), en
`recovery_used` en `password_change` (detail `recovery`) loggen, in één
transactie.

### 12.4 Wachtwoord wijzigen
Vraagt het huidige wachtwoord of de herstelsleutel; daarmee wordt de ruwe
`DK` opnieuw ontsleuteld (§3.7). Nieuwe `salt_w`, nieuwe `KEK_w`, opnieuw
wrappen; `password_change` met detail `user`.

Dit **trekt geen toegang in**: wie een oude back-up en het oude wachtwoord
heeft, kan de datasleutel nog steeds verkrijgen, en daarmee ook latere
gegevens in dezelfde epoch lezen. Daarvoor is §12.5 nodig.

### 12.5 Sleutels vernieuwen na een mogelijk lek
Formaat 1 ondersteunt dit; het scherm komt later.
1. Ontgrendelen met het huidige wachtwoord of de herstelsleutel.
2. Nieuwe `DK_{e+1}` en een nieuwe schrijfsleutel voor epoch `e+1` (§3.8
   geval 1).
3. Alle oude datasleutels (`DK_e` en die uit `keyring`, ontsleuteld volgens
   §3.7) wrappen onder `K_nieuw,keyring`; dat is de nieuwe `keyring`.
4. Een nieuw wachtwoord en een **nieuwe herstelsleutel**; beide wraps maken.
5. Regels `key_rotation` en `write_key` en het controlepunt onder de nieuwe
   schrijfsleutel; de teller telt alles wat in deze handeling onder die
   sleutel is versleuteld. Alles, inclusief reservering, in één transactie.
6. Direct een nieuwe back-up maken en oudere back-ups verwijderen.

Garantie: wat na stap 5 wordt geschreven, is niet te lezen met de oude
geheimen. Bestaande kopieën (oude back-ups) blijven leesbaar met de geheimen
van toen.

## 13. Vernietigen en back-ups
- `destroy` wist alle versies uit de actieve opslag. Kopieën in **bestaande
  back-ups blijven bestaan**; de app kan bestanden buiten zichzelf niet
  wissen.
- Na een vernietiging vraagt de app om direct een nieuwe back-up te maken en
  wijst hij op het bewaarbeleid.
- **Bewaarbeleid** (zie `docs/compliance/avg.md`): bewaar de laatste vier
  wekelijkse back-ups en verwijder oudere. Vernietigde gegevens bestaan dan
  hooguit ongeveer vier weken in back-ups.
- Het auditlog bewaart de `destroy`-regel (alleen het record-id), zodat een
  latere back-up de vernietiging bevat.
- Terugzetten van een back-up van vóór een vernietiging brengt de vernietigde
  gegevens terug. Wie zo'n back-up terugzet, moet de vernietiging opnieuw
  uitvoeren.

## 14. Versies en migratie
- Eén formaatnummer: in `meta.format`, in elke AAD (`dahis/<formaat>/…`) en
  in de back-upheader.
- De app **leest** elk ouder formaat en **schrijft** alleen het huidige; een
  lezer wordt nooit verwijderd.
- Migratie van de opslag in `onupgradeneeded`, stap voor stap, na een
  verplichte back-up.
- Per formaat een testbestand in `tests/fixtures/` (verzonnen inhoud, bekend
  testwachtwoord); elke versie moet ze allemaal kunnen terugzetten.
- Het `schema` per kind migreert los van het formaat, bij het lezen.
- Formaat 1 verwijdert geen auditregels; inkorten na de bewaartermijn vraagt
  een nieuw formaat.

## 15. Leesbaar zonder de app
Het formaat gebruikt alleen openbare standaarden. De noodontsleutelaar
(`tools/noodontsleutelaar.py`, na fase 1) leest back-ups. Hij gebruikt de
standaardbibliotheek voor PBKDF2, HKDF, HMAC, SHA-256, JSON en base64url, en
voor AES-GCM `AESGCM` uit het pakket `cryptography`. Dat is de enige
toegestane externe dependency, en alleen voor dit hulpmiddel, niet voor de
app. Interoperabiliteit wordt getoetst met de testvectoren.

## 16. Restrisico's

| Restrisico | Toelichting |
|---|---|
| Volledige rollback | Lokaal niet te detecteren (§1) |
| Wijziging aan oudere auditregels | Pas zichtbaar bij de volgende volledige controle (§9.4) |
| Afwijking | App stopt; herstel alleen via een back-up, wijzigingen sinds die back-up gaan verloren (§10) |
| Teruggezette reservering plus herhaalde crashes | Geen cumulatieve bovengrens op ongetelde versleutelingen; bij het verwachte volume aanvaardbaar (§3.8) |
| Metadata zichtbaar | Zie §1 |
| Oude kopieën | Blijven leesbaar met oude geheimen (§12.4, §12.5) |
| Vernietigde gegevens in back-ups | Tot vier weken (§13) |
| Offline raden van het wachtwoord | PBKDF2, wachtzinadvies; geen harde grens |
| Geheugen niet te wissen in JavaScript | Buffers overschreven, app herlaadt bij vergrendelen; kopieën door de engine niet uit te sluiten |

## 17. Na de alpha
Bewust uitgesteld; elk punt krijgt een eigen ontwerp en review.
- **Forensisch bestand** (`magic` `dahis-forensic`): de aangetroffen toestand
  bij een afwijking onveranderd bewaren voor onderzoek, met een canonieke
  codering die ook ongeldige waarden eenduidig vastlegt. Zelf geen
  herstelpad.
- **Een afwijking accepteren** en daarna verder werken, met vastlegging van
  het geaccepteerde deel. Tot die tijd gaat herstel via een back-up.
- **Scherm "Sleutels vernieuwen"** (§12.5).
- **Noodontsleutelaar** (§15).

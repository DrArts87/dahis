# Formaat: versleuteling, opslag en back-up

Formaat: **1**
Status: concept, ter goedkeuring via pull request
Hoort bij: [plan fase 1](plans/2026-11-25-fase-1-fundament.md)

Dit document is een **contract** met alle gegevens en back-ups die ooit met
Dahis zijn gemaakt. Een implementatie moet zich er byte voor byte aan houden.
Wijzigen kan alleen met een nieuw formaatnummer en een migratie (§11); een
eenmaal vastgesteld formaat wordt nooit achteraf aangepast.

Testvectoren volgen bij taak 3 in `tests/fixtures/vectoren.json`.

## 1. Dreigingsmodel

Het formaat beschermt tegen iemand die de opslag van de telefoon of een
back-upbestand in handen krijgt, maar het wachtwoord en de herstelsleutel
niet kent:

- **Vertrouwelijkheid**: geen inhoud leesbaar, ook geen namen, BSN's,
  geboortedata of medicatie; exacte lengtes worden verhuld door opvulling.
- **Integriteit**: elke wijziging aan een versleuteld stuk, aan de
  bijbehorende metadata of aan de KDF-parameters wordt gedetecteerd.
- **Auditlog**: omwisselen, invoegen, wijzigen of verwijderen van regels, en
  het afkappen van het einde, wordt gedetecteerd.

Buiten het formaat:
- Iemand die de ontgrendelde app bedient of gewijzigde app-code laat draaien
  (zie de service worker en CSP in het plan voor fase 1).
- Het terugzetten van de *hele* opslag naar een oudere kopie (rollback) wordt
  niet gedetecteerd.
- Onversleuteld zichtbaar zijn: aantallen records en versies, `kind`,
  `updated_at`, de grootte in blokken van 512 bytes en het aantal auditregels.
  In een back-upbestand alleen de totale grootte in blokken van 4096 bytes.

## 2. Bouwstenen en notatie

| Bouwsteen | Gebruik |
|---|---|
| AES-GCM-256 | Alle versleuteling; IV van 12 bytes, tag van 16 bytes |
| PBKDF2-HMAC-SHA256 | Sleutel uit het wachtwoord |
| HKDF-SHA256 | Sleutel uit de herstelsleutel |
| SHA-256 | Hashketen auditlog, controlegroep herstelsleutel |
| Willekeur | `crypto.getRandomValues` / `crypto.randomUUID` |

Notatie:
- `‖` is aaneenschakelen van bytes.
- `B64(x)` is base64url **zonder** opvulling (`=`), RFC 4648 §5.
- `be64(n)` is het getal `n` als 8 bytes big-endian.
- `UTF8(s)` is de UTF-8-codering van tekst `s`.
- Tijdstippen zijn UTC in de vorm `JJJJ-MM-DDTUU:MM:SS.sssZ`, precies zoals
  `Date.prototype.toISOString()` die geeft (24 tekens).
- In IndexedDB worden bytes opgeslagen als `Uint8Array`; in JSON
  (back-upbestand) als `B64`-tekst.
- Elke IV is 12 willekeurige bytes, voor elke versleuteling opnieuw
  gegenereerd. Bij willekeurige IV's geldt een maximum van 2³² versleutelingen
  per sleutel; bij het verwachte gebruik (orde van 10⁶ in 20 jaar) is dat
  ruim voldoende.

### 2.1 AAD

Alle AAD (*additional authenticated data*) is `UTF8` van een JSON-array
zonder spaties, met een vast eerste element dat het soort gegeven en het
formaatnummer aangeeft, bijvoorbeeld:

```
["dahis/1/record","3f2b8c1e-...","2","settings","2026-11-25T14:03:00.000Z"]
```

Om de serialisatie in elke taal gelijk te maken, mogen elementen alleen zijn:
- tekst uit de tekens `A–Z a–z 0–9 - _ . : /`;
- gehele getallen van 0 tot en met 2⁵³ − 1, als **tekst** in decimale
  notatie zonder voorloopnullen (dus `"2"`, niet `2`).

Daardoor geven `JSON.stringify(arr)` in JavaScript en
`json.dumps(arr, separators=(",", ":"))` in Python exact dezelfde bytes.

## 3. Sleutels

```
hoofdwachtwoord ──PBKDF2──► wachtwoordsleutel ──┐
                                                ├─ ontsleutelt ─► datasleutel ─► records, auditlog, back-up
herstelsleutel ───HKDF────► herstelsleutel-KEK ─┘
```

### 3.1 Datasleutel
- 32 willekeurige bytes, eenmalig bij onboarding gemaakt, gebruikt als
  AES-GCM-256-sleutel voor alles wat in §5–§9 versleuteld wordt.
- Na unwrappen wordt de sleutel geïmporteerd als niet-exporteerbare
  `CryptoKey`.
- De onderdelen worden gescheiden door het eerste element van de AAD
  (`dahis/1/record`, `dahis/1/audit`, `dahis/1/audithead`, `dahis/1/backup`).
- Formaat 1 kent geen vervanging (rotatie) van de datasleutel.

### 3.2 Wachtwoordsleutel
- Wachtwoord: eerst Unicode-normaliseren naar **NFC**, dan `UTF8`. Geen
  andere bewerking (niet trimmen, geen hoofdletters).
- Minimaal 14 tekens (na NFC, geteld in Unicode-codepunten).
- `KEK_w = PBKDF2-HMAC-SHA256(wachtwoord, salt_w, iteraties, 32 bytes)`.
- `salt_w`: 16 willekeurige bytes. Standaard `iteraties`: 600.000.

### 3.3 Herstelsleutel-KEK
- `KEK_h = HKDF-SHA256(ikm = herstelsleutel (32 bytes), salt = salt_h,
  info = UTF8("dahis/1/kek/herstel"), 32 bytes)`.
- `salt_h`: 16 willekeurige bytes.

### 3.4 Wrappen
De datasleutel wordt per KEK afzonderlijk versleuteld:

```
iv  = 12 willekeurige bytes
ct  = AES-GCM(KEK, iv, datasleutel (32 bytes), aad)   → 48 bytes
```

| | AAD |
|---|---|
| Wachtwoord | `["dahis/1/wrap","password","PBKDF2-SHA256", "<iteraties>", "<B64(salt_w)>"]` |
| Herstelsleutel | `["dahis/1/wrap","recovery","HKDF-SHA256", "<B64(salt_h)>"]` |

Omdat de parameters in de AAD staan, levert het wijzigen ervan in de opslag
alleen een mislukte ontgrendeling op. Een mislukte AES-GCM-ontsleuteling bij
het unwrappen betekent: verkeerd wachtwoord of verkeerde herstelsleutel.

## 4. Herstelsleutel op papier

- Alfabet (Crockford base32): `0123456789ABCDEFGHJKMNPQRSTVWXYZ`.
- De 32 bytes (256 bits) worden van links naar rechts in groepen van 5 bits
  omgezet; het laatste teken bevat 1 databit en 4 nulbits. Dat geeft 52
  tekens.
- Controle: de eerste 20 bits van `SHA-256(UTF8("dahis/1/herstelcontrole") ‖
  herstelsleutel)`, als 4 tekens.
- Weergave: 14 groepen van 4 tekens, gescheiden door `-`; de laatste groep is
  de controle.

```
XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-CCCC
```

Invoer:
- Hoofd- en kleine letters zijn gelijk; spaties en `-` worden genegeerd.
- `I` en `L` gelden als `1`, `O` als `0`. `U` en andere tekens zijn ongeldig.
- Precies 56 tekens; de 4 nulbits in teken 52 moeten nul zijn; de controle
  moet kloppen. Anders: melding "tikfout in de herstelsleutel", zonder
  ontsleutelpoging.

## 5. Opslag in IndexedDB

Database `dahis`, IndexedDB-versie 1, met drie object stores.

### 5.1 `meta`
Sleutel-waardeparen (store zonder keyPath, sleutel is de naam):

| Sleutel | Waarde | Versleuteld |
|---|---|---|
| `format` | `1` | nee |
| `created_at` | tijdstip onboarding | nee |
| `device_id` | UUIDv4 van deze installatie | nee |
| `kdf` | `{alg: "PBKDF2-SHA256", iterations, salt}` | nee (in AAD van de wrap) |
| `wrapped_password` | `{iv, ct}` (§3.4) | ja |
| `recovery` | `{alg: "HKDF-SHA256", salt, iv, ct}` (§3.4) | ja |
| `audit_head` | `{iv, ct}` (§8.3) | ja |
| `last_backup_at` | tijdstip of `null` | nee |
| `failed_unlocks` | `{count, last_at}` sinds de laatste geslaagde ontgrendeling | nee |

### 5.2 `records`
keyPath `["id", "version"]`, index `kind`. Zie §6.

### 5.3 `audit`
keyPath `seq`. Zie §8.

## 6. Records

Opgeslagen object:

| Veld | Type | Regel |
|---|---|---|
| `id` | tekst | UUIDv4 in kleine letters (`crypto.randomUUID()`) |
| `version` | geheel getal | 1, 2, 3, …; elke wijziging is een nieuwe versie |
| `kind` | tekst | `^[a-z][a-z_]{0,31}$` |
| `updated_at` | tekst | tijdstip van deze versie |
| `iv` | bytes | 12 bytes |
| `ct` | bytes | AES-GCM-uitvoer inclusief tag |

```
aad = ["dahis/1/record", id, "<version>", kind, updated_at]
ct  = AES-GCM(datasleutel, iv, opgevuld(inhoud), aad)
```

### 6.1 Inhoud
- `UTF8` van een JSON-object:
  - `{"schema": n, "data": {...}}` voor een gewone versie;
  - `{"schema": n, "deleted": true}` voor een verwijderde versie.
- `schema` is de versie van de inhoud *per kind*, los van het formaatnummer.
- **Opvulling**: na de JSON spaties (`0x20`) toevoegen tot de lengte in bytes
  een veelvoud van 512 is. `JSON.parse` en `json.loads` negeren spaties aan
  het eind, dus lezen werkt zonder de opvulling te verwijderen.

### 6.2 Versies, verwijderen en vernietigen
- Een bestaande versie wordt nooit overschreven. De actuele versie is die met
  het hoogste `version`.
- **Verwijderen**: een nieuwe versie met `deleted: true`. Oude versies blijven
  bestaan (dossierplicht).
- **Vernietigen** (WGBO art. 7:455): alle versies van het `id` worden gewist;
  dat staat als `destroy` in het auditlog.

### 6.3 Kinds
Elke `kind` wordt hier geregistreerd met zijn `schema`-versies, zodra een
fase hem invoert. Formaat 1 begint zonder kinds; tests gebruiken `test_*`.

| kind | schema | Sinds | Omschrijving |
|---|---|---|---|
| — | — | — | — |

## 7. Ontgrendelen en sleutelbeheer

**Onboarding**
1. Datasleutel, `salt_w`, `salt_h`, herstelsleutel en `device_id` maken.
2. Datasleutel wrappen met `KEK_w` en `KEK_h`; `meta` schrijven.
3. Herstelsleutel tonen (§4) en twee groepen laten overtypen.
4. Eerste auditregel: `create` van de installatie.

**Ontgrendelen met wachtwoord**
1. `KEK_w` afleiden met `kdf` uit `meta`; `wrapped_password` unwrappen.
2. Mislukt: `failed_unlocks` ophogen, niets anders.
3. Gelukt: `audit_head` ontsleutelen en de keten controleren (§8.4); als
   `failed_unlocks.count > 0` eerst een regel `unlock_failed` schrijven en de
   teller op nul zetten; daarna `unlock`.
4. Is `iterations` lager dan de huidige standaard, dan opnieuw wrappen met
   nieuwe `salt_w` en de standaard, en `password_change` loggen met detail
   `kdf_upgrade`.

**Ontgrendelen met herstelsleutel**
1. Invoer controleren (§4); `KEK_h` afleiden; `recovery` unwrappen.
2. Direct een nieuw wachtwoord laten kiezen en opnieuw wrappen (§3.4).
3. `recovery_used` en `password_change` loggen.

**Wachtwoord wijzigen**
Nieuwe `salt_w`, nieuwe `KEK_w`, datasleutel opnieuw wrappen. Records,
auditlog en herstelsleutel blijven ongewijzigd.

## 8. Auditlog

### 8.1 Regel
Opgeslagen object `{seq, iv, ct, h}`:
- `seq`: 1, 2, 3, … zonder gaten.
- `h`: 32 bytes, de hash van deze regel.

```
h_0   = 32 nulbytes
aad   = ["dahis/1/audit", "<seq>", B64(h_vorige)]
ct    = AES-GCM(datasleutel, iv, opgevuld(inhoud), aad)
h_seq = SHA-256(h_vorige ‖ be64(seq) ‖ iv ‖ ct)
```

### 8.2 Inhoud
`UTF8` van een JSON-object, opgevuld met spaties tot een veelvoud van **128**
bytes:

| Veld | Waarde |
|---|---|
| `ts` | tijdstip |
| `action` | zie de tabel hieronder |
| `kind` | kind van het record, of `null` |
| `record_id` | id van het record, of `null` |
| `version` | versie van het record, of `null` |
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
| `unlock` | geslaagd ontgrendeld | `password` of `recovery` |
| `unlock_failed` | mislukte pogingen sinds de vorige ontgrendeling | aantal |
| `lock` | vergrendeld | `timeout`, `hidden` of `manual` |
| `password_change` | datasleutel opnieuw gewrapt | `user`, `recovery` of `kdf_upgrade` |
| `recovery_used` | ontgrendeld met herstelsleutel | |
| `export` | back-up gemaakt | |
| `import` | back-up teruggezet | |
| `verify_backup` | back-up gecontroleerd | |
| `print` | afdruk of PDF gemaakt | |
| `app_update` | nieuwe app-versie geactiveerd | versienummer |

Nieuwe acties komen er alleen bij in dit document.

### 8.3 Kop van de keten
`meta.audit_head` bevat de versleutelde inhoud
`{"seq": <laatste seq>, "h": "<B64(h_seq)>"}` met
`aad = ["dahis/1/audithead"]`. Bij elke nieuwe regel worden de regel en de
kop in één IndexedDB-transactie geschreven.

### 8.4 Controle
Na elke ontgrendeling en bij het maken en terugzetten van een back-up:
1. Regels oplopend op `seq` lezen; `seq` begint bij 1 en heeft geen gaten.
2. Per regel `h` opnieuw berekenen en vergelijken; inhoud ontsleutelen met
   de AAD (die bevat de vorige hash).
3. `seq` en `h` van de laatste regel moeten gelijk zijn aan `audit_head`.

Mislukt de controle, dan toont de app een waarschuwing en blijft hij
bruikbaar; het incident volgt de procedure in `docs/compliance/avg.md`.

### 8.5 Bewaren
Formaat 1 verwijdert geen auditregels (dat zou de keten breken). Inkorten na
de bewaartermijn (minstens 5 jaar) vraagt een nieuw formaat met een
controlepunt.

## 9. Back-upbestand (`.dahis`)

Een tekstbestand in UTF-8 met precies twee regels, elk afgesloten met `\n`.

**Regel 1: header**, een JSON-object zonder regeleinden:

```json
{"magic":"dahis-backup","format":1,"created_at":"…","app_version":"…",
 "kdf":{"alg":"PBKDF2-SHA256","iterations":600000,"salt":"…"},
 "wrapped_password":{"iv":"…","ct":"…"},
 "recovery":{"alg":"HKDF-SHA256","salt":"…","iv":"…","ct":"…"}}
```

(hier over meerdere regels voor de leesbaarheid; in het bestand op één regel)

**Regel 2: inhoud**, `B64(iv ‖ ct)` met

```
aad = header-bytes (regel 1 exact zoals in het bestand, zonder \n)
ct  = AES-GCM(datasleutel, iv, opgevuld(inhoud), aad)
```

De AAD bevat de exacte bytes van de header: er hoeft niets canoniek gemaakt
te worden en elke wijziging aan de header maakt het bestand ongeldig.

**Inhoud**: `UTF8` van een JSON-object, opgevuld met spaties tot een
veelvoud van **4096** bytes:

| Veld | Waarde |
|---|---|
| `format` | `1` |
| `source_device_id` | `device_id` van het toestel dat de back-up maakte |
| `created_at` | gelijk aan de header |
| `records` | alle records als `{id, version, kind, updated_at, iv, ct}`, bytes als `B64` |
| `audit` | alle auditregels als `{seq, iv, ct, h}`, bytes als `B64` |
| `audit_head` | `{seq, h}` onversleuteld (de inhoud is zelf al versleuteld) |

Records en auditregels staan erin zoals in de opslag, dus met hun eigen
versleuteling. Terugzetten is kopiëren; de buitenste versleuteling verbergt
aantallen, soorten en tijdstippen.

Bestandsnaam: `dahis-backup-JJJJMMDD-UUMM.dahis` (lokale tijd), zonder namen.
MIME-type bij delen: `application/octet-stream`.

### 9.1 Wachtwoord en herstelsleutel van een back-up
Een back-up gebruikt het wachtwoord dat gold **op het moment van exporteren**.
Na een wachtwoordwijziging blijven oudere back-ups dus het oude wachtwoord
vragen, of de herstelsleutel. Formaat 1 kent geen nieuwe herstelsleutel: die
blijft voor alle back-ups dezelfde.

### 9.2 Maken
1. Auditketen controleren (§8.4); regel `export` schrijven.
2. Header opbouwen uit `meta`; inhoud opbouwen; versleutelen.
3. Delen via de Web Share API of downloaden; `last_backup_at` bijwerken.

### 9.3 Controleren
Bestand inlezen, ontsleutelen met de datasleutel in het geheugen, de
auditketen in het bestand controleren en aantallen en hashes vergelijken met
de opslag. Regel `verify_backup` schrijven.

### 9.4 Terugzetten (formaat 1: alleen op een leeg toestel)
1. `magic` en `format` controleren; onbekend formaat: weigeren met melding.
2. Ontgrendelen met wachtwoord of herstelsleutel via de header (§7).
3. Inhoud ontsleutelen; elke record en de auditketen controleren.
4. `meta` vullen uit de header, met een **nieuwe** `device_id`; records en
   auditregels kopiëren; regel `import` schrijven.

## 10. Leesbaar zonder de app

Het formaat gebruikt alleen PBKDF2, HKDF, AES-GCM, SHA-256, JSON en
base64url, allemaal openbare standaarden. Een noodontsleutelaar in Python kan
alles behalve AES-GCM uit de standaardbibliotheek halen
(`hashlib.pbkdf2_hmac`, `hmac`, `json`, `base64`); voor AES-GCM is een eigen
implementatie nodig, getest tegen de testvectoren. Gepland na fase 1.

## 11. Versies en migratie

- Er is één formaatnummer, terug te vinden in `meta.format`, in het eerste
  element van elke AAD (`dahis/<formaat>/…`) en in de back-upheader.
- De app **leest** elk ouder formaat en **schrijft** alleen het huidige.
- Een lezer voor een oud formaat wordt nooit verwijderd.
- Migratie van de opslag gebeurt in `onupgradeneeded` van IndexedDB, stap
  voor stap (1 → 2 → 3 …), na een verplichte back-up.
- Per formaat staat een testbestand in `tests/fixtures/` (verzonnen inhoud,
  bekend testwachtwoord). Elke versie van de app moet alle testbestanden
  kunnen terugzetten.
- Het `schema` per kind (§6.1) migreert los van het formaat, bij het lezen.

## 12. Restrisico's

| Restrisico | Toelichting |
|---|---|
| Rollback van de hele opslag | Niet te detecteren zonder externe referentie; komt in beeld bij synchronisatie |
| Metadata zichtbaar | Aantallen, `kind`, `updated_at` en grootte in blokken (§1) |
| Geen rotatie van de datasleutel | Lekt de datasleutel, dan moet alles opnieuw versleuteld worden in een nieuw formaat |
| Oude back-ups met oud wachtwoord | Herstelsleutel blijft geldig (§9.1) |
| Geheugen niet te wissen in JavaScript | App herlaadt bij vergrendelen; zie het plan voor fase 1 |

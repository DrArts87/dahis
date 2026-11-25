# Plan fase 1: fundament

Status: concept, ter goedkeuring via pull request
Datum: 2026-11-25
Hoort bij: [projectplan](2026-11-25-projectplan.md), §6 fase 1

## 1. Doel

Een geïnstalleerde PWA die volledig offline werkt, met versleutelde opslag,
ontgrendelen en automatisch vergrendelen, een auditlog en back-up met herstel.
Nog geen patiëntenmodule; tot de acceptatie van fase 1 alleen verzonnen
gegevens.

## 2. Besluiten

| Onderwerp | Besluit |
|---|---|
| Origin | `https://<gebruikersnaam>.github.io/dahis/`; op dit GitHub-account komt geen andere Pages-site (§3) |
| Doeltoestel | Android, nieuwste versie, Chrome; referentietoestel OnePlus 13R |
| Updates | Geen netwerkverkeer behalve het controleren op en ophalen van app-code; een nieuwe versie wordt pas actief na eigen akkoord (herformulering van het criterium in projectplan §11) |
| Testtool | Node (`node --test`, `node --check`), zonder npm-pakketten; later ook in CI |
| Publiceren | Officiële Pages-actions van GitHub (`actions/upload-pages-artifact`, `actions/deploy-pages`), vastgepind op een commit-SHA, alleen bij een versietag `vX.Y.Z` |
| Databaseschema | Schema v1 zoals in §4; vastgelegd met dit plan |

## 3. Origin: één Pages-site per account

IndexedDB, de Cache-API en service workers zijn per *origin* gescheiden, niet
per pad. Elke Pages-site op `<gebruikersnaam>.github.io` deelt die origin: een
andere site op hetzelfde account zou de versleutelde database kunnen lezen en
de cache van Dahis kunnen overschrijven met gewijzigde code die het wachtwoord
afvangt.

Besluit: Dahis blijft op `https://<gebruikersnaam>.github.io/dahis/` en er
komt op dit account **geen andere Pages-site**, ook geen gebruikerssite
(repository `<gebruikersnaam>.github.io`).

Maatregelen:
- Vastleggen in `docs/compliance/nen7510.md` (bij taak 9) als regel voor het
  account.
- Releasechecklist (taak 9): controleren dat geen andere repository op het
  account Pages aan heeft.

Als er later toch een tweede site nodig is:
- Voorkeur: geef díe site een eigen (sub)domein. GitHub stuurt
  `<gebruikersnaam>.github.io/<repo>/` dan door naar dat domein, zodat de
  site niet op de origin van Dahis draait. Dahis zelf blijft ongewijzigd.
  Restrisico: valt dat custom domain weg, dan draait de site weer op de
  gedeelde origin.
- Of Dahis naar een eigen subdomein verhuizen. Gegevens en installatie zijn
  aan de origin gebonden, dus dat kan alleen via een back-up en opnieuw
  installeren.

## 4. Ontwerp

### Bestanden
- `app/`: wordt gepubliceerd. `index.html`, `manifest.webmanifest`, `sw.js`,
  `js/*.js` (ES-modules), `css/`, iconen.
- `tests/`: niet gepubliceerd.
- [`docs/formaat.md`](../formaat.md): specificatie van versleuteling, opslag
  en back-up (formaat 1).

### Crypto (`app/js/crypto.js`), alleen Web Crypto
- **Datasleutel**: AES-GCM-256, willekeurig; na unwrappen niet-exporteerbaar
  geïmporteerd.
- **Wachtwoordsleutel**: PBKDF2-SHA256, 600.000 rondes, salt van 16 bytes.
  Parameters staan in `meta` zodat ze later omhoog kunnen.
- **Herstelsleutel**: 256 bits willekeurig, getoond als 13 groepen van 4
  tekens (Crockford base32) plus een controlegroep; sleutelafleiding met HKDF.
- **Records**: per record een willekeurige IV van 96 bits; formaatversie, id,
  kind en versie in de AAD.
- Wachtwoord wijzigen = datasleutel opnieuw wrappen. Herstel = ontgrendelen
  met de herstelsleutel en direct een nieuw wachtwoord instellen.
- Geen eigen crypto-primitieven.

### Opslag (`app/js/store.js`): IndexedDB, schema v1
- `meta`: formaatversie, KDF-parameters, gewrapte datasleutels, apparaat-id,
  tijdstip laatste back-up, kop van de auditketen (versleuteld), teller
  mislukte ontgrendelpogingen.
- `records`: `{id, version, kind, updated_at, iv, ciphertext}` met sleutel
  `[id, version]`. Append-only: een wijziging maakt een nieuwe versie
  (versiegeschiedenis voor WGBO/AVG, geschikt voor latere synchronisatie).
  Vernietigen op verzoek wist alle versies.
- `audit`: versleutelde regels met hashketen (§4 auditlog).
- `navigator.storage.persist()` aanvragen en de status tonen.

### Ontgrendelen en vergrendelen
- Onboarding: uitleg → wachtwoord kiezen (minimaal 14 tekens) → herstelsleutel
  tonen → twee groepen overtypen ter controle → eerste back-up.
- Vergrendelen bij `visibilitychange` naar verborgen en na inactiviteit
  (standaard 3 minuten, instelbaar).
- Bij vergrendelen herlaadt de pagina: de enige betrouwbare manier om sleutel
  en ontsleutelde gegevens uit het geheugen te halen. JavaScript kan geheugen
  niet gegarandeerd wissen; restrisico in `docs/compliance/nen7510.md`.
- Bij onboarding de duur van PBKDF2 meten en tonen.
- "Alles wissen" met bevestiging.

### Auditlog (NEN 7513)
- Per regel: tijdstip, actie, kind, record-id, resultaat, apparaat-id;
  versleuteld; geen namen of medische gegevens.
- Elke regel bevat de hash van de vorige; de laatste hash staat versleuteld in
  `meta` en in de back-up.
- Mislukte ontgrendelpogingen worden onversleuteld geteld en bij de volgende
  geslaagde ontgrendeling gelogd.

### Back-up (`.dahis`)
- Onversleutelde header: magic, formaatversie, KDF-parameters, gewrapte
  sleutels. De hele inhoud als één AES-GCM-blok, met de header als AAD; lekt
  dus ook geen aantallen of tijdstippen.
- Terug te zetten met wachtwoord of herstelsleutel, op elk toestel.
- Export via het deelmenu (Web Share API), downloaden als terugval.
- "Back-up controleren": bestand teruglezen en vergelijken met de huidige
  gegevens.
- Import in fase 1 alleen op een leeg toestel; samenvoegen later.
- Herinnering als de laatste back-up meer dan 7 dagen oud is.
- Migratieketen per formaatversie, met een vast testbestand (formaat 1,
  verzonnen inhoud, bekend testwachtwoord, extensie niet `.dahis` zodat
  `privacy_check.py` en `.gitignore` gelden zoals nu).

### Service worker en CSP
- Alle bestanden uit een cache per versie; geen `skipWaiting` zonder akkoord.
  Banner "Bijwerken naar vX" met versienummer.
- De browser controleert zelf periodiek op een nieuwe `sw.js`; dat is niet uit
  te zetten. Restrisico: een gewijzigde, nog wachtende `sw.js` kan de
  versleutelde database lezen, maar niet ontsleutelen.
- Pages zet geen eigen headers: CSP in een `<meta>`-tag, en de service worker
  zet de headers (inclusief `frame-ancestors 'none'`) op antwoorden uit de
  cache:
  `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self';
  manifest-src 'self'; worker-src 'self'; connect-src 'none'; base-uri 'none';
  form-action 'none'; require-trusted-types-for 'script';
  trusted-types dahis-sw` (in de header ook `frame-ancestors 'none'`).
  Trusted types blokkeren `innerHTML` en vergelijkbare constructies; de enige
  toegestane policy, `dahis-sw`, laat alleen `sw.js` door voor het registreren
  van de service worker.
- Instellingen tonen versienummer en SHA-256 van de app-bestanden, te
  vergelijken met de release op GitHub.

### Android/Chrome
- Installeren via Chrome (*App installeren*); de app draait dan als WebAPK.
- Chrome-gegevens gaan niet mee in de Android-back-up; de-installeren of
  *Gegevens wissen* wist alles. De eigen back-up is dus de enige back-up.
- Afdrukken (fase 3) via het printmenu van Chrome / Opslaan als PDF.
- Passkeys met PRF (fase later) worden op Android/Chrome ondersteund; nog te
  testen op het referentietoestel.

### Tests (geen npm-pakketten)
- `node --test tests/`: crypto, formaat, hashketen, back-up en herstel,
  migratie. Opslag in het geheugen nagebootst. PBKDF2-rondes instelbaar zodat
  tests snel zijn, plus één test op de standaardwaarde.
- `tests/browser.html` voor echte IndexedDB, lokaal met een wegwerpprofiel.

## 5. Taken (elk een aparte pull request)

1. Dit plan; daarna `docs/formaat.md`.
2. App-shell, manifest, service worker met handmatige update, CSP, iconen.
3. `crypto.js` met tests.
4. `store.js` (IndexedDB, append-only, `persist()`).
5. Onboarding, ontgrendelen, vergrendelen, wachtwoord wijzigen, herstel,
   alles wissen.
6. Auditlog met hashketen.
7. Back-up: export, controle, import, herinnering, migratieketen, testbestand.
8. ✅ CI: unittests, `release.py --check` en een job JavaScript in
   `controle.yml`, plus een pre-commit-hook in `.githooks/`. De job
   JavaScript wordt een verplichte controle in de branchbescherming
   (gebruiker). Bij taak 3 komt `node --test` erbij.
9. Pages-workflow op versietag en releaseprocedure, inclusief controle op
   andere Pages-sites op het account (apart te vragen).
10. Acceptatietest op de OnePlus 13R door de gebruiker, met checklist.

## 6. Risico's

| Risico | Maatregel |
|---|---|
| Gedrag van Chrome op Android wijkt af (updates, persist, delen) | Vroeg testen op het referentietoestel |
| PBKDF2 traag op het toestel | Meten bij onboarding; parameters in `meta` |
| Formaat is een contract met bestaande back-ups | `docs/formaat.md` eerst, versienummer en testbestand vanaf dag één |
| Back-up alleen leesbaar met de app | Na fase 1 een noodontsleutelaar in pure Python overwegen (stdlib heeft geen AES-GCM), getest tegen Web Crypto |
| Andere Pages-site op hetzelfde account | Regel in `nen7510.md`, controle in releasechecklist; tweede site alleen op eigen domein |
| Origin wijzigt na ingebruikname | Alleen via back-up en opnieuw installeren |
| Geheugen niet te wissen in JavaScript | Herladen bij vergrendelen; restrisico documenteren |

## 7. Acceptatiecriteria

- In IndexedDB en in het `.dahis`-bestand is geen enkele testwaarde leesbaar
  te vinden (test zoekt op bekende tekst).
- De app vergrendelt bij naar de achtergrond gaan en na de ingestelde tijd.
- Na het "vergeten" van het wachtwoord: ontgrendelen met de herstelsleutel en
  een nieuw wachtwoord instellen werkt.
- Een back-up van toestel of profiel A is volledig terug te zetten op B, met
  kloppende hashketen; het testbestand van formaat 1 is terug te zetten.
- In vliegtuigmodus werkt alles; geen netwerkverkeer behalve het controleren
  op en ophalen van app-code; een nieuwe versie wordt pas actief na eigen
  akkoord.
- Ontgrendelen, wachtwoord wijzigen, export, import en herstel staan in het
  auditlog; een gemanipuleerd log wordt gedetecteerd.
- `py_compile`, `node --check`, de Node-tests en `privacy_check.py` slagen.

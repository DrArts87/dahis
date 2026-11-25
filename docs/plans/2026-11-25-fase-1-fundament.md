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

### Crypto, opslag, auditlog en back-up
De details staan in [`docs/formaat.md`](../formaat.md) (formaat 1, concept
voor de alpha). In het kort:
- **Sleutels**: een datasleutel per epoch, gewrapt met een sleutel uit het
  hoofdwachtwoord (PBKDF2-SHA256, 600.000 rondes) en een uit de herstelsleutel
  (HKDF). Versleuteld wordt met subsleutels van een *schrijfsleutel*; na elk
  herstel komt er een nieuwe. Een reservering in de opslag bewaakt het
  IV-budget, ook na een crash. Elke back-up heeft een eigen sleutel.
- **Opslag** (`app/js/store.js`, IndexedDB, schema v1): `meta`, `records`
  (append-only, sleutel `[id, version]`) en `audit`. Atomair schrijven met
  een vergelijking van het controlepunt; één venster tegelijk via een Web
  Lock. `navigator.storage.persist()` aanvragen en de status tonen.
- **Auditlog** (NEN 7513): versleutelde regels met hashketen, zonder namen of
  medische gegevens. Een versleuteld **controlepunt** bindt de kop van de
  keten aan een digest van alle recordversies en aan de sleutelregisters.
  Snelle controle bij elke ontgrendeling, volledige controle minstens
  wekelijks en bij export.
- **Bij een afwijking** stopt de app met normaal gebruik; herstel via "alles
  wissen" en een back-up terugzetten. Forensisch bestand en afwijking
  accepteren komen na de alpha.
- **Back-up** (`.dahis`): canonieke header plus één versleuteld blok; terug
  te zetten met wachtwoord of herstelsleutel op een lege opslag. Export via
  het deelmenu, downloaden als terugval. Twee controles: interne integriteit,
  en gelijk aan de export. Herinnering na 7 dagen. Bewaarbeleid: de laatste
  vier wekelijkse back-ups.
- Geen eigen crypto-primitieven; alleen Web Crypto.

### Ontgrendelen en vergrendelen
- Onboarding: uitleg → wachtwoord kiezen (minimaal 14 tekens, advies voor een
  wachtzin van 5 woorden) → herstelsleutel tonen → twee groepen overtypen ter
  controle → eerste back-up.
- Vergrendelen bij `visibilitychange` naar verborgen en na inactiviteit
  (standaard 3 minuten, instelbaar).
- Bij vergrendelen herlaadt de pagina: de enige betrouwbare manier om sleutel
  en ontsleutelde gegevens uit het geheugen te halen. JavaScript kan geheugen
  niet gegarandeerd wissen; restrisico in `docs/compliance/nen7510.md`.
- Bij onboarding de duur van PBKDF2 meten en tonen.
- "Alles wissen" met bevestiging.

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
- `node --test tests/*.test.mjs`: crypto, formaat, hashketen, back-up en herstel,
  migratie. Opslag in het geheugen nagebootst. PBKDF2-rondes instelbaar zodat
  tests snel zijn, plus één test op de standaardwaarde.
- `tests/browser.html` (met `tests/browser.mjs`) voor echte IndexedDB, lokaal
  met een wegwerpprofiel; nog niet in CI.

## 5. Taken (elk een aparte pull request)

1. Dit plan; daarna `docs/formaat.md`.
2. App-shell, manifest, service worker met handmatige update, CSP, iconen.
3. ✅ `crypto.js` (bouwstenen) en `vault.js` (bewerkingen in het geheugen) met tests: sleutels en wraps, herstelsleutel,
   schrijfsleutels en reservering (beide gevallen van formaat §3.8),
   registerdigests, records, auditketen, controlepunt, back-upformaat met
   strikt inlezen. Testvectoren in `tests/fixtures/vectoren.json`, ook
   negatief, onder meer:
   - een gewijzigde oudere auditregel met ongewijzigde opgeslagen `h`;
   - een mislukte transactie, herstart en nieuwe versleuteling;
   - een back-up met een gewijzigde `write_keys` of een controlepunt uit een
     eerdere epoch;
   - herhaald herstel van dezelfde back-up (telkens een nieuwe
     schrijfsleutel).
4. ✅ `store.js` (IndexedDB, append-only, atomair schrijven, Web Lock,
   `persist()`); uitgewerkt in [plan taak 4](2026-11-25-taak-4-opslag.md). Tests bij onderbreking: een transactie die wordt afgebroken
   (onboarding, gewone schrijfactie, terugzetten) laat de opslag ongewijzigd,
   en een nieuwe poging slaagt met een nieuwe salt waar dat hoort.
   Uit de code-audit ([reviews](../reviews/2026-11-25-reviews.md), A1, A2,
   A4):
   - de kluis bepaalt zelf of de volledige controle verschuldigd is en voert
     die uit vóór de eerste schrijfactie (geen vlag van de aanroeper);
   - een reservering is duurzaam vastgelegd vóór gebruik; schrijfacties
     binnen één tabblad lopen via één wachtrij;
   - een ongeldige reservering leidt tot een nieuwe schrijfsleutel vóór er
     opnieuw wordt versleuteld (formaat §3.8 daarop aanpassen);
   - `rotateKeysTx()` weigert een nieuw wachtwoord dat de huidige wrap opent;
   - end-to-end tests op echte IndexedDB in Chromium: onboarding,
     ontgrendelen, schrijven, vergrendelen, back-up en terugzetten.
5. Onboarding, ontgrendelen, vergrendelen, wachtwoord wijzigen, herstel,
   alles wissen, stoppen bij een afwijking. Meting op de OnePlus: PBKDF2 bij
   600.000 en bij het maximum van 10.000.000 rondes.
6. Auditlog met hashketen, controlepunt, snelle en volledige controle. Meting
   op de OnePlus: duur van de volledige controle bij een realistisch groot
   log.
7. Back-up: export, beide controles, terugzetten, herinnering,
   migratieketen, testbestand. Tests: terugzetten op een lege opslag met
   wachtwoord én met herstelsleutel; een ongeldig bestand laat de opslag
   leeg; twee keer dezelfde back-up terugzetten geeft twee verschillende
   schrijfsleutels; bij export wordt de grens van 256 MiB aan de schrijvende
   kant gecontroleerd, en een bruikbaar bestand blijkt uit een direct
   volgende `verify_backup` met detail `equal` (audit A3); na terugzetten met
   de herstelsleutel en een nieuw
   wachtwoord opent de app daarna normaal met dat nieuwe wachtwoord (en niet
   meer met het oude), en de controles slagen. Meting op de OnePlus: piekgeheugen, en of bij de maximale
   bestandsgrootte een back-up nog te maken én te openen is.
8. ✅ CI: unittests, `release.py --check` en een job JavaScript in
   `controle.yml`, plus een pre-commit-hook in `.githooks/`. De job
   JavaScript wordt een verplichte controle in de branchbescherming
   (gebruiker). `node --test` sinds taak 3.
9. ✅ Pages-workflow op versietag en releaseprocedure, inclusief controle op
   andere Pages-sites op het account (akkoord gebruiker 2026-11-25; naar
   voren gehaald om de app op de telefoon te kunnen proberen). Zie
   [`docs/release.md`](../release.md).
10. Acceptatietest op de OnePlus 13R door de gebruiker, met checklist.

**Na de alpha** (eigen ontwerp en review): forensisch bestand, een afwijking
accepteren, scherm "Sleutels vernieuwen", noodontsleutelaar in Python met
`cryptography` (de enige toegestane uitzondering op de dependency-regel,
alleen voor dit hulpmiddel).

## 6. Risico's

| Risico | Maatregel |
|---|---|
| Gedrag van Chrome op Android wijkt af (updates, persist, delen) | Vroeg testen op het referentietoestel |
| PBKDF2 traag op het toestel | Meten bij onboarding; parameters in `meta` |
| Formaat is een contract met bestaande back-ups | `docs/formaat.md` eerst, versienummer en testbestand vanaf dag één |
| Back-up alleen leesbaar met de app | Na de alpha een noodontsleutelaar in Python met `cryptography`, getest met de testvectoren |
| Afwijking in de opslag | App stopt; herstel via een back-up, wijzigingen sinds die back-up gaan verloren; daarom wekelijkse back-ups |
| Limieten (PBKDF2, bestandsgrootte) te hoog voor het toestel | Meten op de OnePlus vóór echte dossiers; zo nodig verlagen |
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

**Voorwaarde voor echte dossiers**, allemaal op de OnePlus:
- een back-up gemaakt en op een lege opslag teruggezet, zowel met het
  wachtwoord als met de herstelsleutel;
- na herstel met een nieuw wachtwoord opent de app weer normaal;
- de tests bij onderbreking slagen: de app afsluiten tijdens onboarding,
  tijdens een schrijfactie en tijdens terugzetten laat geen half ingerichte
  opslag achter, en een nieuwe poging slaagt; een onderbroken restore laat de
  doelopslag leeg;
- een verschuldigde volledige controle die schade vindt, laat de bestaande
  opslag ongewijzigd;
- de voorlopige limieten in `docs/formaat.md` §2.4 zijn gemeten en
  vastgesteld, en het formaat is vastgesteld.

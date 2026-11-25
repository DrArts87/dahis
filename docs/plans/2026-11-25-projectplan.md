# Projectplan DrArtsHIS (Dahis)

Status: concept, wacht op goedkeuring
Datum: 2026-11-25 (herzien: alleen lokaal op telefoon; public repository met GitHub Pages)

## 1. Doel

Een klein, persoonlijk huisartsinformatiesysteem voor een BIG-geregistreerd
arts, voor de zorg die hij of zij binnen de eigen kring mag verlenen
(zichzelf, gezinsleden, vrienden). Eerste twee modules:

1. **Patiëntenbestand** met persoons- en medische gegevens, volledig
   versleuteld.
2. **Voorschrijfmodule**: actuele medicatie per persoon bijhouden en een
   papieren recept (afdrukken of PDF) maken.

Uitbreidbaar met meer modules (journaal/SOEP, metingen, vaccinaties,
verwijsbrieven, documenten). Waar mogelijk conform AVG en NEN 7510.

## 2. Uitgangspunten

| Keuze | Besluit | Waarom |
|---|---|---|
| Vorm | PWA, geïnstalleerd op het beginscherm van de telefoon | Werkt offline, geen app store nodig, later ook in de browser op de laptop |
| Opslag | **Alleen lokaal op de telefoon** (IndexedDB), versleuteld | Geen server = geen server die gehackt kan worden |
| Techniek | Platte HTML/CSS/JS + Web Crypto; Python-standaardbibliotheek alleen voor hulpscripts | Geen dependencies, klein aanvalsoppervlak |
| Gebruikers | Alleen de arts zelf, één account | Geen rollen of autorisatie nodig in v1 |
| Repository | **Public**, `dahis`, zonder licentie (alle rechten voorbehouden) | Gratis GitHub Pages en branchbescherming; code en data strikt gescheiden |
| Hosting app-code | GitHub Pages | Gratis bij een public repository; alleen app-code, nooit data |
| Medicatiedata | Open data (CBG) + links naar NHG/Kompas | Prescriptor en G-Standaard vragen een licentie |
| Toekomst | Browser op laptop, synchronisatie via server op Home Assistant | Zie §7; het ontwerp houdt hier nu al rekening mee |

## 3. Architectuur v1

```
Telefoon (PWA, geïnstalleerd)
┌─────────────────────────────────────────────┐
│ UI (HTML/JS)                                │
│ Web Crypto: AES-GCM-256, sleutel in geheugen│
│ IndexedDB: alleen versleutelde records      │
│ Service worker: hele app offline            │
│ Export: versleuteld back-upbestand (.dahis) │
└─────────────────────────────────────────────┘
        ▲ eenmalig installeren en updates
        │ (alleen app-code, nooit data)
   statische hosting via HTTPS
```

### Waarom toch hosting?
Een PWA moet één keer vanaf een HTTPS-adres worden geladen om te kunnen
installeren; daarna werkt hij volledig offline. Op dat adres staat alleen de
app-code (HTML/JS/CSS en de geneesmiddelenlijst), nooit patiëntgegevens.

Besluit: **GitHub Pages** (`https://<gebruikersnaam>.github.io/dahis/`).
- Alleen de map met de app (in fase 1 `app/`) wordt gepubliceerd, niet de
  hele repository. Hoe precies (een workflow met de officiële
  Pages-actions van GitHub, of een aparte branch) wordt in fase 1 besloten;
  zie §12.
- Later eventueel Home Assistant, alleen bereikbaar via VPN.

Code en site zijn openbaar; de beveiliging mag dus nooit afhangen van
geheimhouding van de code.

### Bescherming tegen gewijzigde code
De hostingdienst kan in theorie andere code serveren. Daarom:
- De service worker houdt de geïnstalleerde versie vast; een update wordt
  alleen geïnstalleerd als je daar zelf op drukt, met het versienummer in
  beeld.
- Strikte Content-Security-Policy, geen externe scripts, CDN's, fonts of
  analytics.
- De app maakt geen enkele netwerkverbinding behalve het ophalen van
  updates van de eigen code.

### Sleutelbeheer
- Een willekeurige **datasleutel** (AES-GCM-256) versleutelt alle records.
- Die datasleutel wordt versleuteld met een sleutel afgeleid van het
  hoofdwachtwoord (PBKDF2-SHA256, minstens 600.000 rondes).
- Een **herstelsleutel** kan de datasleutel ook ontsleutelen; eenmalig
  getoond om op papier in een kluis te bewaren. Zonder wachtwoord én
  herstelsleutel zijn de gegevens definitief weg.
- Per record een eigen IV; record-id, type en versie in de AAD.
- Automatisch vergrendelen na inactiviteit en zodra de app naar de
  achtergrond gaat; dan wordt de sleutel uit het geheugen gewist.

### Inloggen
- **Hoofdwachtwoord** (lang, uniek) ontgrendelt de app.
- **Authenticator-app (TOTP)**: zonder server voegt dit geen beveiliging
  toe. Het TOTP-geheim zou naast de data op de telefoon staan, dus iemand
  die de opslag kan lezen, slaat de code gewoon over. TOTP komt daarom pas
  bij de server (§7), waar het wél werkt.
- Optioneel later: **ontgrendelen met Face ID / vingerafdruk** via passkeys
  met de PRF-uitbreiding (WebAuthn). Hierbij levert de passkey zelf een
  sleutel. *Nog te verifiëren* op welke iOS/Android-versies dit in een
  geïnstalleerde PWA werkt.
- De telefoon zelf is de tweede laag: schermvergrendeling verplicht en
  apparaatversleuteling aan (standaard op recente iPhones en Android).

### Gegevensmodel (IndexedDB)
- `records`: `{id, kind, version, updated_at, iv, ciphertext}`, met `kind`
  bijv. `patient`, `medication`, `prescription`. Alle inhoud, ook naam en
  geboortedatum, zit in de ciphertext.
- `audit`: versleuteld auditlog (wie, wanneer, actie, record-id), met
  hashketen (NEN 7513).
- `meta`: gewrapte datasleutels, KDF-parameters, schemaversie.
- Dit formaat is meteen geschikt om later naar een server te synchroniseren.

### Back-up (cruciaal)
De gegevens staan op één apparaat en moeten 20 jaar bewaard blijven (WGBO).
- `navigator.storage.persist()` aanvragen, zodat de browser de data niet
  zelf opruimt. Op iOS geldt de opruimregel van 7 dagen niet voor een
  geïnstalleerde PWA, maar de-installeren wist alles.
- **Versleutelde export** (`.dahis`-bestand) via het deelmenu naar
  Bestanden, iCloud Drive, een USB-stick of de laptop. Alleen ciphertext.
- De app herinnert aan een back-up als de laatste langer dan 7 dagen
  geleden is.
- Herstellen uit een back-up op een nieuw toestel is een vast onderdeel van
  de acceptatietest.
- Een back-up in iCloud of Google Drive is versleuteld en daarom
  acceptabel; zet bij iCloud bij voorkeur *Geavanceerde gegevensbescherming*
  aan.

## 4. Dekt een PWA alles?

| Behoefte | PWA | Opmerking |
|---|---|---|
| Op telefoon, installeerbaar, offline | ✅ | Manifest + service worker |
| Versleuteling | ✅ | Web Crypto: AES-GCM, PBKDF2, HKDF |
| Recept afdrukken / PDF | ✅ | Print-CSS; vanaf telefoon via AirPrint of "Opslaan als PDF" |
| Foto's/scans | ✅ | Camera via `<input capture>` (later) |
| Back-up als bestand | ✅ | Downloaden / Web Share API |
| Biometrisch ontgrendelen | ⚠️ | Passkeys met PRF, afhankelijk van OS-versie |
| Later in de browser op laptop | ✅ | Zelfde code; data overzetten via back-up of later via server |
| eRecept naar apotheek (LSP) | ❌ | Vraagt UZI-pas en gecertificeerde software; ook niet met een native app |
| BSN controleren (SBV-Z) | ❌ | Vraagt UZI-certificaat; BSN wordt alleen opgeslagen |

## 5. Voorschrijfmodule

- **Bron geneesmiddelen**: open data van het CBG (registratienummer, naam,
  werkzame stof, sterkte, toedieningsvorm, ATC). *Nog te verifiëren*:
  actuele vorm, licentie en updatefrequentie. Een Python-script zet de data
  om naar een JSON-bestand dat met de app meekomt en lokaal doorzocht wordt.
- **Kennis**: per middel links naar het Farmacotherapeutisch Kompas en de
  NHG-Standaarden. Geen eigen doseeradvies of interactiecontrole (MDR, §8).
- **NHG-Prescriptor / G-Standaard**: alleen met licentie; niet in v1.
- **Recept**: afdrukbaar met de wettelijk vereiste gegevens
  (Geneesmiddelenwet art. 67 en onderliggende regeling). *De precieze eisen
  nog nalopen* voordat de module in gebruik gaat. Met de hand ondertekenen.
- **Opiumwetmiddelen** (lijst I en II): niet in v1.
- Elk recept wordt een record bij de patiënt en een regel in het
  medicatieoverzicht.

## 6. Fasering

### Fase 0: inrichting
- [x] Projectplan, werkafspraken (`CLAUDE.md`), `SECURITY.md`
- [x] Compliance-documenten AVG en NEN 7510 (beginversie)
- [x] `tools/privacy_check.py` + GitHub-workflow
- [x] Repository `dahis` op GitHub (public), eerste commit
- [ ] Branchbescherming `main`: pull request, ondertekende commits, lineaire geschiedenis
- [ ] Private vulnerability reporting en secret scanning aan

### Fase 1: fundament
- [ ] App-shell, manifest, service worker met handmatige updates
- [ ] Crypto-module: datasleutel, wachtwoord, herstelsleutel
- [ ] Onboarding, ontgrendelen, automatisch vergrendelen
- [ ] Versleutelde opslag in IndexedDB, `storage.persist()`
- [ ] Versleutelde export en import (back-up), herinnering
- [ ] Auditlog met hashketen
- [ ] GitHub Pages inrichten (alleen `app/` publiceren)
- [ ] Tests: crypto-ronde, back-up en herstel, migratie van het formaat

### Fase 2: patiëntenbestand
- [ ] Persoon: naam, geboortedatum, BSN (optioneel), adres, contact,
      huisarts, apotheek, verzekering, allergieën, voorgeschiedenis
- [ ] Zoeken en lijst (na ontsleutelen)
- [ ] Afdrukbaar overzicht per patiënt (inzage/afschrift)
- [ ] Bewaartermijn per dossier zichtbaar

### Fase 3: medicatie en recepten
- [ ] Importscript CBG-data
- [ ] Medicatieoverzicht per patiënt (start, stop, reden)
- [ ] Recept maken en afdrukken; herhaalrecept

## 7. Toekomst (niet in v1)

- **Browser op laptop**: dezelfde PWA; data in eerste instantie overzetten
  met een back-upbestand.
- **Synchronisatie via Home Assistant**: kleine server (Python-
  standaardbibliotheek) als add-on, alleen bereikbaar via Tailscale. De
  server bewaart alleen de al versleutelde records (end-to-end). Dan komt er
  ook een serveraccount met wachtwoord + authenticator-app (TOTP).
- Journaal (SOEP, ICPC of SNOMED via Nictiz), metingen, vaccinaties, scans,
  verwijsbrieven, licentie Prescriptor/G-Standaard.

## 8. Juridisch kader (geen juridisch advies; zelf toetsen)

- **AVG**: gezondheidsgegevens zijn bijzondere persoonsgegevens (art. 9);
  als arts verwerk je ze professioneel, de huishoudelijke uitzondering
  geldt niet. Zie `docs/compliance/avg.md`.
- **WGBO**: dossierplicht, bewaartermijn 20 jaar na de laatste wijziging,
  inzage- en afschriftrecht.
- **NEN 7510 / 7513**: als kader; zie `docs/compliance/nen7510.md`.
- **MDR**: geen beslisondersteuning in v1, alleen eigen gebruik. Bij
  uitbreiding opnieuw toetsen.
- **KNMG**: terughoudendheid bij het behandelen van naasten blijft een
  professionele afweging.

## 9. Code en data gescheiden

- Nooit echte persoons- of medische gegevens in de repository, ook niet in
  tests, voorbeelden of issues; alleen verzonnen gegevens met een BSN dat
  de 11-proef niet haalt. De repository is **public**: alles wat erin komt,
  is voor iedereen leesbaar en blijft vindbaar in de geschiedenis.
- Mocht er toch iets in terechtkomen: niet alleen verwijderen, maar de
  geschiedenis opschonen, GitHub Support vragen caches te wissen en het
  behandelen als datalek (zie `docs/compliance/avg.md`).
- `.gitignore` en `tools/privacy_check.py` (lokaal en in CI).
- Geen wachtwoorden of persoonlijke instellingen in de repository.

## 10. Risico's

| Risico | Gevolg | Maatregel |
|---|---|---|
| Telefoon kwijt, kapot of app verwijderd | Dossiers weg | Versleutelde back-up op tweede locatie, herinnering, hersteltest |
| Wachtwoord én herstelsleutel kwijt | Alles onherstelbaar | Herstelsleutel op papier in kluis |
| Telefoon in verkeerde handen | Onbevoegde inzage | Schermvergrendeling, app vergrendelt direct, sterk wachtwoord |
| Hosting serveert gewijzigde code | Wachtwoord afgevangen | Handmatige updates, CSP, geen netwerkverkeer; restrisico documenteren |
| Verkeerd recept door fout in app | Patiëntveiligheid | Geen automatische dosering; recept altijd zelf controleren |
| Browser wist opslag | Dossiers weg | `storage.persist()`, geïnstalleerde PWA, back-ups |

## 11. Acceptatiecriteria v1

- De IndexedDB-opslag en het back-upbestand bevatten geen leesbare naam,
  BSN, geboortedatum of medicatie.
- De app vergrendelt na inactiviteit en bij naar de achtergrond gaan.
- Herstellen met de herstelsleutel werkt na het vergeten van het wachtwoord.
- Een back-up van toestel A is te herstellen op toestel B.
- De app werkt volledig in vliegtuigmodus en maakt geen netwerkverbinding
  behalve bij een zelf gestarte update.
- Een recept bevat alle wettelijk vereiste gegevens en is af te drukken.
- Elke inzage, wijziging en export staat in het auditlog.

## 12. Open vragen

1. iPhone of Android (en welke versie)? Bepaalt o.a. biometrisch
   ontgrendelen en afdrukken.
2. Publiceren naar Pages: met de officiële Pages-actions van GitHub
   (`actions/upload-pages-artifact`, `actions/deploy-pages`) of zonder
   actions vanaf een aparte branch? Besluit in fase 1.

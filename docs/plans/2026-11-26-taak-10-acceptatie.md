# Plan taak 10: acceptatietest op de OnePlus

Status: uitgevoerd 2026-11-26; alle stappen in orde (stap K deel 2 niet te doen)
Datum: 2026-11-26
Hoort bij: [plan fase 1](2026-11-25-fase-1-fundament.md), §5 taak 10 en §7

## In het kort
De gebruiker loopt met versie 0.3.1 op de OnePlus 13R een vaste lijst stappen
na en noteert per stap de uitkomst. Samen met de tests in de repository laat
dat zien of fase 1 aan de acceptatiecriteria (§7) voldoet. Er staan alleen
testgegevens op de telefoon. Echte dossiers volgen pas na een apart besluit
(zie *Afwijkingen*).

## Doel
- Aantonen dat de acceptatiecriteria van plan fase 1 §7 op het
  referentietoestel gehaald worden.
- De voorwaarde voor echte dossiers zo ver mogelijk afvinken, en vastleggen
  wat daarvoor nog openstaat.

## Omvang
- Alleen documentatie: dit plan met checklist, `docs/overdracht.md` en een
  verwijzing in plan fase 1 §5. Geen codewijziging, geen nieuwe release.
- Buiten de omvang: de compliance-toets, het registreren van de eigenaar en
  de UI-schaafsessie (eigen stappen na taak 10, zie *Daarna*).

## Voorbereiding
- Versie **0.3.1** (codehash `f4fe0deb8429ea42008a2c686792a849f4bc321fc6e19fdc9ed74a90014ec31a`)
  geïnstalleerd vanaf het startscherm.
- De **herstelsleutel** van de huidige testinrichting bij de hand (nodig
  bij stap F). Kwijt? Doe dan eerst stap K: een nieuwe inrichting geeft een
  nieuwe herstelsleutel.
- Voor stap H een **tweede omgeving**: een wegwerpprofiel in Chrome op de pc
  (besluit gebruiker 2026-11-26), geopend op `https://drarts87.github.io/dahis/`.
- Voor stap I het **testbestand** als `.dahis`-bestand. In PowerShell, vanuit
  de checkout:

  ```
  py -c "import json; d = json.load(open('tests/fixtures/testbestand-formaat-1.json', encoding='utf-8')); open('testbestand-formaat-1.dahis', 'w', encoding='utf-8', newline='').write(d['bestand'])"
  ```

  Zet het bestand daarna in Downloads op de telefoon. Wachtwoord en
  herstelsleutel staan in hetzelfde JSON-bestand; ze zijn verzonnen en
  openbaar. Het `.dahis`-bestand hoort niet in de repository.
- Stap F, G, I en K wissen de opslag op de telefoon. Daar staan alleen
  testgegevens, en stap E maakt eerst een back-up.

## Checklist (versie 0.3.1, alleen testgegevens)

Uitgevoerd door de gebruiker op 2026-11-26 met versie 0.3.1; ingevuld in een
bewerkbaar document en hier overgenomen.

| Stap | Wat te doen | Wat je hoort te zien | Criterium | Uitkomst |
|---|---|---|---|---|
| A | App openen; Meer → Over deze app | Versie 0.3.1 en de codehash hierboven; de app staat als eigen app op het startscherm | §7 updates | In orde |
| B | Vliegtuigmodus aan. App helemaal sluiten en opnieuw openen, ontgrendelen, back-up maken en downloaden, logboek openen. Daarna vliegtuigmodus uit | Alles werkt zonder netwerk; geen foutmelding over verbinding; geen update-melding | §7 offline | In orde |
| C | Instellingen: vergrendelen na 1 minuut. (1) Naar een andere app gaan en terugkomen. (2) De app open laten liggen zonder aanraken | (1) Direct vergrendeld. (2) Vergrendeld na ongeveer 1 minuut (uiterlijk 10 s later). Instelling daarna terugzetten | §7 vergrendelen | In orde: (1) en (2) lukken |
| D | Instellingen → Wachtwoord wijzigen. Vergrendelen; ontgrendelen met het oude, dan met het nieuwe wachtwoord | Oud wachtwoord geweigerd, nieuw opent | §7 auditlog | In orde |
| E | Meer → Back-up → maken en Downloaden. Vergrendelen; op het vergrendelscherm *Back-up controleren* met dat bestand en het wachtwoord | Bestand in Downloads; controle geslaagd met de regel "Gekozen: …"; in het logboek "Back-up begonnen" en "Back-up gecontroleerd en klaar" | §7, voorwaarde | In orde |
| F | **Herstelsleutel.** Meer → Alles wissen. Op het welkomstscherm *Back-up terugzetten* met het bestand uit E en de **herstelsleutel**, en een **nieuw wachtwoord** instellen. Vergrendelen; ontgrendelen met het wachtwoord uit E, dan met het nieuwe | Terugzetten lukt; het oude wachtwoord wordt geweigerd, alleen het nieuwe opent; de controles slagen (geen afwijking); het logboek loopt door met de regel "Back-up teruggezet" | §7 herstel, voorwaarde | In orde |
| G | Alles wissen; *Back-up terugzetten* met hetzelfde bestand uit E en het **wachtwoord** uit E | Terugzetten lukt; dat wachtwoord opent; controles slagen | voorwaarde | In orde |
| H | Een nieuwe back-up van de telefoon naar de pc overzetten. In het wegwerpprofiel op de pc terugzetten; ontgrendelen; logboek openen. Profiel daarna verwijderen | Terugzetten lukt; controles slagen (kloppende hashketen); logboek gelijk aan dat op de telefoon | §7 A naar B | In orde |
| I | Alles wissen. Het testbestand terugzetten (met het testwachtwoord; zo mogelijk ook een keer met de testherstelsleutel). Daarna een back-up maken en downloaden. Het gedownloade bestand openen in een teksteditor of Bestanden-app en zoeken op `Verzonnen testwaarde` | Terugzetten lukt, controles slagen; de tekst `Verzonnen testwaarde` komt **niet** voor in de back-up | §7 testbestand, §7 niet leesbaar | In orde: met het testwachtwoord én met de testherstelsleutel |
| J | Logboek openen | Ontgrendelen, wachtwoord wijzigen (D), back-up begonnen en gecontroleerd (E) en "Back-up teruggezet" (F, G, I) staan erin | §7 auditlog | In orde |
| K | Alles wissen. *Beginnen*, wachtwoord kiezen en *Verder*. (1) Op het scherm *Herstelsleutel* of *Controle* de app wegvegen en opnieuw openen. (2) Zo mogelijk ook direct na *Controleren* wegvegen | (1) Weer het welkomstscherm: niets ingericht; een nieuwe inrichting slaagt, met een nieuwe herstelsleutel. (2) Óf welkomstscherm, óf een volledig ingerichte app die met het wachtwoord opent; nooit iets daartussen. Lukt (2) niet op tijd: *niet te doen* | voorwaarde | In orde voor (1): op alle schermen weggeveegd, verwacht resultaat. (2) niet te doen |

Na de proef: zet zo nodig de eigen back-up uit E of G weer terug.

## Uitkomst
Alle stappen A–K zijn in orde; er zijn geen fouten gevonden. Daarmee zijn op
de OnePlus aangetoond: offline werken, vergrendelen (achtergrond en
inactiviteit), wachtwoord wijzigen, back-up maken, downloaden en controleren,
terugzetten op een lege opslag met het wachtwoord én met de herstelsleutel
(daarna opent alleen het nieuwe wachtwoord), van toestel naar pc, het
testbestand van formaat 1 via beide routes, geen leesbare testwaarde in de
back-up, het logboek, en onderbreken tijdens het inrichten. Alleen stap K
deel 2 (wegvegen direct na *Controleren*) was niet te doen; dat valt onder de
tests bij onderbreking (`tests/browser.mjs`). Fase 1 is hiermee **alpha
geaccepteerd** (zie *Afwijkingen*).

## Wat de tests dekken (besluit gebruiker 2026-11-26)

Deze punten uit de voorwaarde voor echte dossiers zijn op de telefoon niet of
niet zinvol te doen. Ze gelden als gedekt door de tests:

| Punt | Waarom niet op de telefoon | Gedekt door |
|---|---|---|
| Onderbreken tijdens een schrijfactie, tijdens terugzetten en direct na *Controleren* bij het inrichten | Te snel om te onderbreken (taak 7 stap G, stap K deel 2) | Afgebroken transacties in echte IndexedDB (`tests/browser.mjs`) en in de controller (`tests/controller.test.mjs`): opslag ongewijzigd of leeg, nieuwe poging slaagt |
| Verschuldigde volledige controle die schade vindt | Schade maken vraagt ontwikkelaarstools | `tests/browser.mjs` ("verschuldigde volledige controle met schade in IndexedDB: opslag ongewijzigd") en `tests/controller.test.mjs` (app stopt, niets geschreven); bij dit plan opnieuw gedraaid in Chromium |
| Geen testwaarde leesbaar in IndexedDB en back-up | Op de telefoon is IndexedDB niet te doorzoeken | Tests op bekende tekst (`tests/vault.test.mjs`, `tests/testbestand.test.mjs`, `tests/browser.mjs`), plus de handcontrole in stap I |

## Afwijkingen van plan fase 1 §7 (besluit gebruiker 2026-11-26)
- "Allemaal op de OnePlus" geldt niet voor de punten in de tabel hierboven;
  die zijn gedekt door de tests.
- **Formaat vastgesteld**: dat kan pas na een nieuwe review van de volledige
  keten. Taak 10 sluit fase 1 af als **alpha geaccepteerd**. Echte dossiers
  vragen daarnaast een apart besluit: review, daarna formaat 1 op
  *vastgesteld* in een eigen PR, en de compliance-toets. Tot dan alleen
  testgegevens.

## Daarna (volgorde besluit gebruiker 2026-11-26)
1. **Compliance-toets fase 1**: `docs/compliance/nen7510.md` per maatregel
   bijwerken met bewijs, `avg.md` aanpassen (back-up alleen downloaden,
   back-uplocatie), DPIA als concept, lijst "vóór echte dossiers" met per
   punt wie het doet.
2. **Registreren van de eigenaar** (de arts) en de gegevens die later nodig
   zijn (bijvoorbeeld voor recepten). Alleen in de versleutelde kluis, nooit
   in de repository.
3. **UI-schaafsessie**.
4. Fase 2 (patiëntenbestand).

Nog open, apart te vragen: browsertests in CI, de review van de volledige
keten, een hogere standaard voor PBKDF2 (bij voorkeur vóór echte dossiers,
want het geldt alleen voor nieuwe wraps).

## Risico's
| Risico | Maatregel |
|---|---|
| Testback-up raakt kwijt bij wissen | Stap E maakt en controleert eerst een back-up |
| Herstelsleutel van de testinrichting niet bij de hand | Eerst stap K; die geeft een nieuwe herstelsleutel |
| Wegwerpprofiel op de pc blijft bestaan | Profiel na stap H verwijderen; alleen testgegevens |
| Testbestand of back-up belandt in de repository | `git status` voor elke commit; `.dahis` hoort niet in de checkout |

## Acceptatiecriteria
- Elke stap is ingevuld met *in orde*, of met een afwijking of *niet te doen*
  die de gebruiker heeft goedgekeurd.
- De controles uit `CLAUDE.md` §2 slagen, en de browsertests in Chromium.
- `docs/overdracht.md` en plan fase 1 §5 zijn bijgewerkt (✅ na de proef).

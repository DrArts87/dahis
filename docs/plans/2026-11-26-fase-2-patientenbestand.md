# Plan fase 2: patiëntenbestand (stap E)

Status: akkoord gebruiker 2026-11-26 (besluiten hieronder); herzien
2026-11-28: referentiemodel-ready (raakpunten R1–R7 worden per taak besproken)
Datum: 2026-11-26
Hoort bij: [vervolgplan](2026-11-26-vervolgplan.md) stap E,
[projectplan](2026-11-25-projectplan.md) §6 fase 2
Soort: per taak een eigen plan en een eigen PR

## Open issues nagelopen
| Issue | Verwerking |
|---|---|
| [#41](https://github.com/DrArts87/dahis/issues/41) banner nieuwe versie onleesbaar | Mee in E0 (`Closes #41`) |
| [#42](https://github.com/DrArts87/dahis/issues/42) icoon Snelheid meten | Mee in E0 (`Closes #42`) |
| [#46](https://github.com/DrArts87/dahis/issues/46) galago op lege schermen | Mee in E2: de lege lijst met patiënten is die toestand; eerst op het canvas |
| [#27](https://github.com/DrArts87/dahis/issues/27) browsertest via de echte schermen | Mee in E2b, vóór de schermen van E3 |
| [#44](https://github.com/DrArts87/dahis/issues/44) Meer opsplitsen, [#43](https://github.com/DrArts87/dahis/issues/43) back-up controleren vanuit Meer | Eerst als voorstel op het canvas, parallel aan E1; bouwen in E5 |
| [#24](https://github.com/DrArts87/dahis/issues/24) bevestigde externe kopie | Geraakt; bij het vaststellen van formaat 1 (E6) |
| [#25](https://github.com/DrArts87/dahis/issues/25) cloudopslag en art. 28 AVG | Geraakt; vóór echte dossiers, beoordeling door de gebruiker |
| [#52](https://github.com/DrArts87/dahis/issues/52) voorschrijvermodule afmeten aan het referentiemodel | Geraakt; vóór fase 3 en uiterlijk bij E6 (`Zie #52`) |
| [#53](https://github.com/DrArts87/dahis/issues/53) logboek afmeten aan toegangslog en wijzigingslog | Geraakt: overzicht per dossier in E4, raakpunt R7 in E3; toets uiterlijk bij E6 (`Zie #53`) |
| [#54](https://github.com/DrArts87/dahis/issues/54) fase 3 op Medicatieproces 9 | Niet in fase 2; raakt R5 (overgevoeligheden) |
| [#55](https://github.com/DrArts87/dahis/issues/55) projectplan §3 gegevensmodel | Na de besluiten over R1, R5 en R6 (`Zie #55`) |
| [#18](https://github.com/DrArts87/dahis/issues/18), [#30](https://github.com/DrArts87/dahis/issues/30), [#33](https://github.com/DrArts87/dahis/issues/33) | Niet geraakt |

## In het kort
Fase 2 brengt de eerste patiënten in de app: personen toevoegen, opzoeken,
hun gegevens bijhouden en een overzicht afdrukken. Elke taak is een eigen
PR met een eigen plan en, waar de app verandert, een release en een proef op
de OnePlus. Na fase 2 volgt de volledige review van de keten (E6). Tot die
review, formaat 1 *vastgesteld* en de lijst
[vóór echte dossiers](../compliance/voor-echte-dossiers.md) rond zijn, staan
er **alleen testgegevens** in de app.

## Besluiten van de gebruiker (2026-11-26)
| # | Onderwerp | Besluit |
|---|---|---|
| 1 | Velden | Verplicht: achternaam (met tussenvoegsel), voornamen of voorletters, geboortedatum, relatie tot de voorschrijver. Optioneel: roepnaam, geslacht, BSN, adres, telefoon, e-mail, huisarts, apotheek, zorgverzekeraar met polisnummer |
| 2 | Relatie tot de voorschrijver | Vaste keuze: zelf, gezin, familie, kennis, zakelijk, anders. Bij *anders* geen toelichting |
| 3 | BSN | Een BSN dat de 11-proef niet haalt, geeft een **waarschuwing** met "Toch opslaan", geen weigering. Zo kunnen de tests verzonnen BSN's gebruiken die de 11-proef niet halen (`CLAUDE.md` §5) |
| 4 | Patiëntnummer | Vast, oplopend nummer per dossier: `DH000001`, `DH000002`, … Nooit hergebruikt, ook niet na vernietigen. Het incidentenregister gebruikt dit nummer; de koppeling met de persoon staat alleen in de app |
| 5 | Inzage loggen | Eén logregel `view` (zonder naam) per keer dat de gebruiker een dossier opent. Zoeken in de lijst geeft geen regel. Opnieuw ontgrendelen of terugkomen in de app terwijl een dossier openstaat, geeft **geen** nieuwe regel |
| 6 | Verwijderen | In fase 2 alleen **vernietigen op verzoek van de patiënt**: stevige bevestiging, daarna een nieuwe back-up, met de melding dat oude back-ups het dossier nog tot ongeveer vier weken bevatten (formaat §13). Archiveren komt later |
| 7 | Allergieën en voorgeschiedenis | Een lijst met regels: vrije tekst en een **verplichte** begindatum. Geen codering (ICPC of SNOMED later, bij het journaal) |
| 8 | Volgorde | Eerst E0 (fix 0.5.3); de browsertest (E2b, #27) vóór E3 |

## NHG HIS-Referentiemodel (besluiten gebruiker 2026-11-27 en 2026-11-28)
**Referentiemodel-ready.** Dahis wordt geen volledig HIS en implementeert
het [HIS-Referentiemodel](https://referentiemodel.nhg.org/inhoud/themas/publieksversie/published)
van het NHG niet volledig. Wel bouwen we zo dat de app *klaar* is voor het
model: begrippen, indeling van gegevens en regels voor wijzigen, vernietigen
en loggen sluiten erop aan waar we dat per raakpunt besluiten, zodat
gegevens later over te zetten of uit te wisselen zijn. Wat dat precies
betekent, bespreken we **per besluit of raakpunt**, in het plan van de taak
die het raakt (`CLAUDE.md` §4, *Referentiemodel nagelopen*). Dit plan legt
geen raakpunten vast; het noemt ze alleen.

**Fair use voor eigen gebruik (eis).** De gebruiker is huisarts, lid van en
betalend abonnee bij het NHG, lid van de gebruikersraad die de G-Standaard
mee ontwikkelt, en ontwikkelt Dahis voor eigen gebruik. Bevindingen uit het
bouwen komen ten goede aan het referentiemodel en de G-Standaard. Daarom
gebruiken we de publieksversie van het referentiemodel, de openbare
NHG-Tabellen (bijvoorbeeld ICPC, geslacht, naamgebruik, ernst
overgevoeligheidsreactie) en de G-Standaard van Z-Index zonder verdere
beperking, als fair use voor eigen gebruik. Wordt de app commercieel
aangeboden of door anderen gebruikt, dan handelt de gebruiker in een andere
rol en zijn eerst licenties bij NHG en Z-Index nodig. Dit is de eigen
beoordeling van de gebruiker, geen juridisch advies.

**MDR en andere regels.** Fair use en de relatie van de gebruiker met deze
organisaties veranderen niets aan de MDR en andere wetgeving en normen
(AVG, WGBO, NEN 7510). Medicatiebewaking,
interactiecontrole en doseeradvies (bijvoorbeeld met contra-indicaties uit
de G-Standaard) alleen na een apart besluit (`CLAUDE.md` §1 *Nooit*).

### Raakpunten van fase 2
Gevonden in de publieksversie (2026-11-27). Per raakpunt een eerste
voorstel; het besluit valt in het plan van de genoemde taak.

| Dahis (fase 2) | Referentiemodel | Raakpunt |
|---|---|---|
| Patiënt (E1) | Dossierdeel [Persoonsgegevens](https://referentiemodel.nhg.org/node/1676), medisch gegeven [Patiënt](https://referentiemodel.nhg.org/node/1677) | R1, R2 |
| Lijst en zoeken (E2) | Praktijkdossierdeel [Patiëntenadministratie](https://referentiemodel.nhg.org/node/1846) | R3, R4 |
| Allergieën (E3) | Dossierdelen [Contra-indicaties en overgevoeligheden](https://referentiemodel.nhg.org/node/987) en [Overige overgevoeligheden](https://referentiemodel.nhg.org/node/1159) | R5 |
| Voorgeschiedenis (E3) | Dossierdeel [Episodes](https://referentiemodel.nhg.org/node/1464), medisch gegeven [Episode](https://referentiemodel.nhg.org/node/93) | R6 |
| Wijzigen en vernietigen (E3) | [Dossier-item](https://referentiemodel.nhg.org/node/4), [Wijzigingslog](https://referentiemodel.nhg.org/node/1151) | R1, R7 |
| Inzage loggen (E3) | Praktijkdossierdeel [Toegangslog](https://referentiemodel.nhg.org/node/1149) | Past bij besluit 5 (een regel bij elke toegang, ook bij export); overzicht per dossier in E4 |
| Afdrukbaar overzicht (E4) | [Medische samenvatting](https://referentiemodel.nhg.org/node/1466), module [Printen](https://referentiemodel.nhg.org/node/1862) | Indeling van het overzicht, in het plan van E4 |
| Voorschrijver (D2, al gebouwd) | [Medewerker](https://referentiemodel.nhg.org/node/1913) | #52 |

| # | Raakpunt | Eerste voorstel | Taak |
|---|---|---|---|
| R1 | Dossier-items | **Besloten 2026-11-28 (optie B, [plan E1](2026-11-28-e1-patient.md)):** elk gegeven een eigen record met `patient_id` in de versleutelde inhoud | E1 |
| R2 | Persoonsgegevens | **Besloten 2026-11-28: niet afwijken van het NHG.** Alle codes van NHG-Tabel 42 (naamgebruik, ook pseudoniem) en NHG-Tabel 4 (geslacht); geslachtsnaam en voorvoegsels apart, met de naam van de echtgenoot | E1 |
| R3 | Meerling | Melding bij een nieuwe patiënt met dezelfde achternaam en geboortedatum | E2 |
| R4 | In- en uitschrijven | Het model kent actieve en inactieve patiënten (overleden, vertrokken) en samenvoegen. Voorstel: niet in fase 2; besluit 6 (archiveren later) heet dan *uitschrijven later* | E2 |
| R5 | Overgevoeligheden | Splitsen in medicatie-overgevoeligheid (middel, reactie, ernst volgens NHG-Tabel 55, bron) en overige overgevoeligheid; niet meer actueel wordt afgesloten, niet verwijderd. Contra-indicaties (G-Standaard) en medicatiebewaking niet in fase 2 (MDR) | E3 |
| R6 | Episodes | Voorgeschiedenis als episode: naam en ICPC (NHG-Tabel 24), open of afgesloten, attentievlag. Het model kent een *startdatum* (standaard vandaag) en een optionele *begindatum van de aandoening*; hoe dat zich verhoudt tot besluit 7 (begindatum verplicht) beslissen we in E3 | E3 |
| R7 | Corrigeren | Het model onderscheidt corrigeren (een fout herstellen) van aanvullen of afsluiten. Voorstel: detailcode `correction` bij `update` in het logboek (formaat §8.2) | E3 |

Raakpunten die het gegevensmodel raken (R1, R2, R5, R6, R7), moeten vaststaan
vóór de review van de keten en het vaststellen van formaat 1 (E6).

## Taken
| Stap | Wat | Versie |
|---|---|---|
| E0 | Fix: banner nieuwe versie leesbaar op alle schermen (#41), icoon Snelheid meten in het midden van zijn vlak (#42) | 0.5.3 |
| E1 | Gegevensmodel (raakpunten R1, R2): record `patient` (schema 1, formaat §6.3; geen structuurwijziging), `app/js/patient.js` met regels per veld, 11-proef als waarschuwing, patiëntnummer (§ hieronder), strikt inlezen; de kinds voor episode en overgevoeligheid worden in E1 ontworpen en in E3 gebouwd; tests met verzonnen gegevens | 0.6.0 |
| E2 | Tabblad Patiënten: lijst en zoeken (naam, geboortedatum, nummer) en **nieuwe patiënt** (persoonsgegevens, met de controle op BSN en meerling; verschoven van E3, besluit 2026-11-28, zodat er UI te testen is), raakpunten R3 en R4. De lijst wordt na ontgrendelen in het geheugen ontsleuteld en bij vergrendelen gewist. Lege toestand met galago (#46). Meting bij 100 en 1.000 patiënten onder Snelheid meten | 0.6.x |
| E2b | UI-browsertest in CI (#27), inclusief de schermen van E2 | geen release |
| E3 | Dossier: bekijken, persoonsgegevens wijzigen, corrigeren, vernietigen; allergieën en voorgeschiedenis (raakpunten R5, R6); logregels `create`, `update` (raakpunt R7), `view`, `destroy` zonder inhoud | 0.7.0 |
| E4 | Afdrukbaar overzicht per patiënt (indeling: de medische samenvatting uit het model als uitgangspunt) (inzage of afschrift; print-CSS, logregel `print`); overzicht van de inzage in een dossier uit het logboek; bewaartermijn per dossier zichtbaar (WGBO) | 0.8.0 |
| E5 | Meer opsplitsen (#44) en back-up controleren vanuit Meer (#43), na het canvas | 0.8.x |
| E6 | Volledige review van de keten; daarna formaat 1 *vastgesteld* (eigen PR, met #24) | geen release |

Projectplan §6 fase 2: persoon (E1, E3), zoeken en lijst (E2), afdrukbaar
overzicht (E4), bewaartermijn zichtbaar (E4). Huisarts, apotheek en
verzekering (besluit 1) staan bij de persoonsgegevens; contactpersonen en
sociale gegevens (in het model *Additioneel*) komen later.

### Patiëntnummer
Het nummer moet uniek blijven, ook na vernietigen en na terugzetten van een
back-up. Voorstel voor het plan van E1: het hoogste ooit uitgegeven nummer
staat in een eigen record (kind `patient_counter`, één per installatie),
geschreven in dezelfde transactie als het nieuwe dossier. Het gaat mee in de
back-up, zodat een teruggezette opslag verder telt. Het nummer staat in de
versleutelde inhoud, niet in de metadata. Uitwerking en besluit in het plan
van E1.

### Werkwijze per taak
- Elke taak krijgt een eigen plan in `docs/plans/` (begint met de open
  issues en het referentiemodel) en wacht op akkoord.
- Schermen eerst op het canvas *Dahis – Schermen* (Voorstellen), met
  verzonnen gegevens; in de PR gelijk gehouden aan de code.
- Na de merge: eerst releasetekst en teststappen, daarna het canvas
  (`CLAUDE.md` §3).

## Risico's
| Risico | Maatregel |
|---|---|
| Echte patiëntgegevens te vroeg in de app | Pas na E6, formaat 1 vastgesteld en de lijst *vóór echte dossiers*; herhaald in elke releasetekst en proef |
| Gegevens in het logboek | Logregels alleen met record-id, versie en `vh` (formaat §8.2); tests per taak dat er geen naam, geboortedatum of BSN in het logboek staat |
| Gegevens in het geheugen na vergrendelen | Lijst en dossier na `alive(gen)` in de toestand, gewist bij vergrendelen (zoals voorschrijver en handtekening); getest |
| Inzage niet volledig vastgelegd | `view` bij elk geopend dossier (besluit 5); de uitzondering voor opnieuw ontgrendelen of terugkomen staat in `nen7510.md` |
| Bewaarplicht tegenover vernietigen | Alleen vernietigen op verzoek, met bevestiging en een nieuwe back-up (besluit 6); bewaartermijn zichtbaar (E4) |
| Medische software (MDR) | Allergieën en voorgeschiedenis alleen bewaren en tonen; geen controle of waarschuwing bij voorschrijven zonder apart besluit |
| Snelheid bij veel dossiers | Meting bij 100 en 1.000 patiënten (E2) op de OnePlus |
| Afwijken van het referentiemodel zonder het te merken | Paragraaf *Referentiemodel nagelopen* in elk plan; per raakpunt een besluit |
| Licentie | NHG-materiaal en G-Standaard alleen als fair use voor eigen gebruik; bij commercieel aanbieden of gebruik door anderen eerst licenties bij NHG en Z-Index |
| Testgegevens lijken echt | Alleen verzonnen gegevens; geen namen in de repository (overdracht, *Teksten*); BSN's halen de 11-proef niet |

## Acceptatiecriteria (fase 2)
- Een patiënt toevoegen, zoeken, wijzigen, vernietigen en afdrukken werkt op
  de OnePlus, met verzonnen gegevens.
- In de opslag, de back-up en het logboek staat geen leesbare naam,
  geboortedatum of BSN (tests).
- Na vergrendelen staat er geen patiëntgegeven meer in de toestand van de
  app (tests).
- Elk geopend dossier geeft één regel `view`; zoeken, opnieuw ontgrendelen
  en terugkomen geven er geen (tests).
- Patiëntnummers zijn uniek en oplopend, ook na vernietigen en terugzetten
  (tests).
- Oude back-ups (formaat 1, zonder patiënten) zijn terug te zetten; het
  testbestand van formaat 1 blijft slagen.
- De controles uit `CLAUDE.md` §2 slagen per taak; de UI-browsertest (E2b)
  draait in CI.
- Elk plan van een taak heeft *Referentiemodel nagelopen* met een besluit
  per raakpunt; de tabel *Raakpunten van fase 2* is bij de afronding
  bijgewerkt.

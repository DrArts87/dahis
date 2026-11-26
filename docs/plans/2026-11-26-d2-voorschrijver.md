# Plan stap D2: voorschrijver registreren

Status: akkoord gebruiker 2026-11-26 (beslispunten hieronder)
Datum: 2026-11-26
Hoort bij: [vervolgplan](2026-11-26-vervolgplan.md) stap D2
Soort: `feat`, versie 0.5.0, één PR

## Open issues nagelopen
- [#27](https://github.com/DrArts87/dahis/issues/27) (browsertest via de echte schermen): niet meegenomen; na D2 (`Zie #27`). De vaste stap hoort dan bij de scenario's.
- [#18](https://github.com/DrArts87/dahis/issues/18), [#24](https://github.com/DrArts87/dahis/issues/24), [#25](https://github.com/DrArts87/dahis/issues/25), [#30](https://github.com/DrArts87/dahis/issues/30), [#33](https://github.com/DrArts87/dahis/issues/33): niet geraakt.
- Nagelopen na de UI-PR's #34 en #35 (#29, #32 gesloten): de waarschuwing bij "Direct" noemde nog het deelmenu, dat sinds 0.4.2 weg is; tekst aangepast.

## In het kort
De gegevens van de voorschrijver (de gebruiker zelf) staan versleuteld in de
app, gaan mee in de back-up en zijn klaar voor het recept in fase 3. Invullen
is een **vaste stap**: na de eerste ontgrendeling, en bij elke ontgrendeling
zolang de gegevens niet compleet zijn, opent de app eerst het formulier.
Wijzigen kan daarna onder Instellingen. Na de release van 0.5.0 mogen de
eigen echte gegevens in de app.

## Besluiten van de gebruiker (2026-11-26)
| # | Onderwerp | Besluit |
|---|---|---|
| 1 | Opslag | Nieuw record van kind `prescriber`, schema 1, in de kluis; regel in formaat §6.3 (geen structuurwijziging) |
| 2 | Velden | Naam (zoals op het recept), beroep, BIG-nummer, AGB-code, praktijknaam, adres, postcode, plaats, telefoon, e-mail; **alle verplicht**; praktijknaam vooraf ingevuld met "vrij gevestigd" |
| 3 | BIG-nummer | Alleen 11 cijfers; geen openbare rekenregel |
| 4 | Restrisico wisselscherm | Losse documentatie-PR (#37) |
| 5 | Onboarding | Invullen wordt een vaste stap. Omdat het record versleuteld wordt met de sleutel van de kluis, kan dat pas na de eerste ontgrendeling: direct daarna opent het formulier; ook bij een bestaande installatie of een teruggezette back-up zonder voorschrijver |

## Taken
1. `app/js/prescriber.js`: vaste lijst velden met regels (lengte, geen
   stuurtekens; BIG 11 cijfers; AGB 8 cijfers; postcode als `1234 AB`, niet
   SA/SD/SS; telefoon minstens 10 cijfers met `+`, spaties en `-`; e-mail),
   `validatePrescriber`, strikt inlezen (`readPrescriber`: een ongeldig veld
   geldt als ontbrekend), `isComplete`, beginwaarden van het formulier.
2. Controller: weergave `prescriber` (vaste stap) zolang niet compleet, na
   ontgrendelen en na een nieuw wachtwoord bij herstel; `loadPrescriber`,
   `savePrescriber` (via `putRecordTx`, log `create`/`update` zonder
   waarden), melding per veld en niets geschreven bij een fout; de wachttijd
   na wisselen van app geldt ook in de vaste stap (geen geheimen, opzoeken
   moet kunnen); vergrendelen en stoppen wissen de gegevens uit het geheugen.
3. Schermen: vaste stap zonder lint; Instellingen → *Voorschrijver* →
   formulier; velden als werkvelden (`data-work`); bij een fout blijft de
   invoer staan.
4. Teksten in `i18n/nl.js`; onboarding (klaar) noemt de vaste stap;
   waarschuwing bij "Direct" zonder deelmenu.
5. Tests: `tests/prescriber.test.mjs`; controller (vaste stap, ongeldige
   invoer schrijft niets, wachttijd in de vaste stap, wijzigen en terug na
   ontgrendelen, geen waarden in het logboek, back-up en terugzetten,
   herstel, ongeldig opgeslagen veld). De testkluis doorloopt de vaste stap
   met een verzonnen voorschrijver (`tests/helpers/kluis.mjs`).
6. Documenten: formaat §6.3, `avg.md`, *vóór echte dossiers*, vervolgplan,
   overdracht.

## Ontwerpcanvas (werkwijze #36, #38)
Op het canvas *Dahis – Schermen*, pagina Voorstellen, staan de geraakte
schermen als voorstel met `#39` in de titel (verzonnen gegevens):

| Scherm | Soort |
|---|---|
| Jouw gegevens (vaste stap) | Nieuw; met een fout bij het BIG-nummer als voorbeeld |
| Instellingen → Voorschrijver | Nieuw |
| Instellingen | Gewijzigd: kaart Voorschrijver, tekst bij "Direct" |
| Inrichten 5 – Klaar | Gewijzigd: laatste zin noemt de vaste stap |

Een fout bij een veld krijgt een rode rand en rode tekst (voorstel op het
canvas, ook in de code). Opmerkingen van de gebruiker op het canvas worden
in de PR verwerkt; na de merge vervangen de voorstellen de schermen op
Productie (nieuw: erbij, met versie 0.5.0 in de titel).

## Risico's
| Risico | Maatregel |
|---|---|
| Echte eigen gegevens in de repository | Alleen verzonnen waarden (nullen, `example.invalid`); `privacy_check.py`; nagelopen |
| Velden blijken in fase 3 niet genoeg voor een recept | Schema 1 kan met een versie groeien; de eisen aan een recept staan voor fase 3 op de checklist |
| Vaste stap blokkeert bij een fout in de regels | Melding per veld; de invoer blijft staan; tests per regel |
| Fout bij opslaan raakt de kluis | Zelfde route als instellingen (`putRecordTx`, schrijfwachtrij) |

## Proef op de OnePlus (na de release van 0.5.0)
1. Na het bijwerken en ontgrendelen opent het formulier *Jouw gegevens*; praktijknaam staat op "vrij gevestigd".
2. Een fout (bijvoorbeeld een BIG-nummer van 10 cijfers): melding bij het veld, de rest blijft ingevuld.
3. Opslaan: daarna het hoofdscherm; Instellingen → Voorschrijver toont de naam; wijzigen werkt.
4. Logboek: "aangemaakt" en "gewijzigd" voor `prescriber`, zonder gegevens.
5. Back-up maken en downloaden.

## Acceptatiecriteria
- Na de eerste ontgrendeling eerst de vaste stap; daarna het hoofdscherm. Een teruggezette back-up met voorschrijver slaat de stap over.
- Ongeldige invoer: melding per veld, niets geschreven.
- Wijzigen onder Instellingen; na opnieuw ontgrendelen terug; in het logboek alleen `create` en `update`.
- Alle controles groen; na de merge de releasetekst.

## Uitkomst proef (2026-11-26, versie 0.5.0)
Alle vijf stappen in orde: vaste stap geopend en ingevuld, fout bij een
BIG-nummer van 10 cijfers, opslaan en wijzigen, logboek zonder gegevens,
back-up gemaakt en gecontroleerd.

## Fix 0.5.1 (review van #39 door de auditor)
| Punt | Verwerking |
|---|---|
| P1: een te lang BIG-nummer of AGB-code werd door `maxlength` stil ingekort en dan goedgekeurd | Geen `maxlength` meer op de velden (`PRESCRIBER_INPUT` in `prescriber.js`, getest); de controle ziet de volledige invoer en weigert wat te lang is |
| P2: vergrendelen tijdens het ontsleutelen zette de gegevens daarna terug in het geheugen | `readPrescriber`/`readSettings` geven hun uitkomst terug; de controller past die pas toe na `alive(gen)`, zoals bij de werkstand; getest |
| Overdracht: live-versie en Recente apps verouderd | Bijgewerkt (live 0.5.0, restrisico #33, canvas tot 0.5.0) |

Daarna volgt **0.5.2**: handtekening van de voorschrijver (besluiten
2026-11-26: tekenen of afbeelding, verplicht in de vaste stap, kind
`signature`, witte achtergrond van een foto transparant), samen met #40
(stapnummers onboarding); eerst op het canvas.

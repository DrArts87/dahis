# DPIA: persoonlijk patiëntendossier Dahis

Status: **besluit ondertekend**, 2026-11-26 (op OneDrive). Opgesteld in de
compliance-toets (stap C van het
[vervolgplan](../plans/2026-11-26-vervolgplan.md)); bijgewerkt in stap D1.
Eigen beoordeling, geen juridisch advies. De punten die in het concept als
*Open* stonden (aantal betrokkenen, afweging van de alternatieven,
acceptatie van de restrisico's, conclusie), zijn door de
verwerkingsverantwoordelijke **buiten de repository ingevuld**, in het
ondertekende besluit (§8) op OneDrive. De inhoud daarvan staat bewust niet
in deze openbare repository. Jaarlijks herzien (agenda *App
onderhoud*) en bij elke wezenlijke wijziging van de verwerking.

## 1. Waarom een DPIA
Een DPIA is verplicht bij grootschalige verwerking van gezondheidsgegevens
(AVG art. 35; lijst van de Autoriteit Persoonsgegevens). Dat is hier niet het
geval: één arts, een kleine kring van betrokkenen. Omdat het om bijzondere
persoonsgegevens gaat, voeren we hem toch uit (zie [`avg.md`](avg.md)).

## 2. Beschrijving van de verwerking
| Onderdeel | Invulling |
|---|---|
| Verwerkingsverantwoordelijke | De arts die de app gebruikt (BIG-geregistreerd); naam en BIG-nummer alleen in de app en in het besluit op OneDrive |
| Doel | Verlenen en vastleggen van zorg aan zichzelf, gezinsleden en vrienden; voorschrijven van geneesmiddelen |
| Betrokkenen | De arts zelf, gezinsleden, vrienden. Aantal: ingevuld in het besluit op OneDrive |
| Gegevens | Zie [`avg.md`](avg.md): identificatie, contact, BSN (optioneel), huisarts, apotheek, verzekering, allergieën, voorgeschiedenis, medicatie, recepten; auditlog zonder namen of medische gegevens |
| Systeem | Progressive web app in Chrome op één Android-telefoon (referentie OnePlus 13R), code via GitHub Pages; alle gegevens versleuteld in de browser van het toestel |
| Opslag | IndexedDB op de telefoon, versleuteld (AES-GCM-256); versleutelde back-ups (`.dahis`) op OneDrive (privé) |
| Ontvangers | Geen. Recepten op papier via de patiënt naar de apotheek |
| Bewaartermijn | 20 jaar na de laatste wijziging (WGBO art. 7:454); back-ups: de laatste vier wekelijkse |
| Levenscyclus | Invoeren in de app → versleuteld bewaren → back-up (versleuteld) → inzage of afschrift op verzoek → vernietigen na de termijn of op verzoek |

## 3. Grondslag, noodzaak en evenredigheid
- **Grondslag**: AVG art. 6 lid 1 sub b en c (behandelovereenkomst,
  dossierplicht WGBO); verwerkingsverbod gezondheidsgegevens opgeheven via
  art. 9 lid 2 sub h, met beroepsgeheim (art. 9 lid 3).
- **Noodzaak**: de WGBO verplicht een dossier bij elke behandeling, ook bij
  naasten. Zonder dossier geen verantwoorde zorg en geen recepten.
- **Dataminimalisatie**: alleen gegevens die voor de zorg of het recept
  nodig zijn; BSN optioneel (verificatie via SBV-Z is niet mogelijk).
- **Alternatieven**: een papieren dossier (moeilijker te beveiligen en te
  back-uppen) of een HIS (niet bedoeld voor behandeling van naasten buiten
  de praktijk). Afweging bevestigd in het besluit op OneDrive.
- **Rechten van betrokkenen**: inzage, afschrift, correctie en vernietiging
  volgens [`avg.md`](avg.md); de functies komen in fase 2.
- **Informeren**: elke betrokkene weet dat er een dossier is en waarom;
  vastleggen in het dossier.

## 4. Risico's voor betrokkenen
| Risico | Oorzaak | Kans zonder maatregelen | Impact |
|---|---|---|---|
| Onbevoegde inzage | Telefoon of back-up in verkeerde handen | Middel | Hoog (gezondheidsgegevens van naasten) |
| Onbevoegde inzage via gewijzigde code | Hosting of account gecompromitteerd; andere Pages-site op hetzelfde account | Laag | Hoog |
| Verlies van gegevens | Telefoon kwijt of kapot, browser wist opslag, wachtwoord én herstelsleutel kwijt | Middel | Middel tot hoog (dossierplicht) |
| Onjuiste of gewijzigde gegevens | Fout in de app, manipulatie van de opslag | Laag | Hoog (patiëntveiligheid) |
| Gegevens langer bewaard dan nodig | Back-ups na vernietiging; ontbrekende vernietiging na 20 jaar | Middel | Laag tot middel |
| Herleidbare gegevens buiten de app | Incidentenregister of notities op OneDrive | Laag | Middel |

## 5. Maatregelen
Uitgewerkt in [`nen7510.md`](nen7510.md). In het kort:
- versleuteling op het toestel en in de back-up; sleutel afgeleid van het
  wachtwoord (PBKDF2, standaard 2.000.000 rondes vanaf versie 0.4.0, met
  upgrade van oudere wraps bij ontgrendelen);
  herstelsleutel alleen op papier;
- automatisch vergrendelen (inactiviteit, wisselen van app met wachttijd;
  op schermen met de herstelsleutel en tijdens een handeling direct),
  biometrische schermvergrendeling en versleuteling van de telefoon;
- geen netwerkverkeer behalve app-code; updates pas na eigen akkoord, met
  codehash; strikte CSP; geen dependencies; één Pages-site op het account;
- auditlog met hashketen, controles bij ontgrendelen en wekelijks; de app
  stopt bij een afwijking;
- wekelijkse back-up met herinnering, hersteltest elk kwartaal,
  [herstelprocedure](herstelprocedure.md);
- bewaarbeleid back-ups (laatste vier), herinnering in de app om op te
  ruimen (vanaf 0.4.0, [#19](https://github.com/DrArts87/dahis/issues/19));
- incidentenregister alleen met patiëntnummers; de koppeling nummer–persoon
  staat niet op OneDrive;
- wijzigingsbeheer via pull requests met verplichte controles en review.

## 6. Restrisico's
| Restrisico | Toelichting | Besluit |
|---|---|---|
| OneDrive privé zonder verwerkersovereenkomst | Microsoft bewaart de versleutelde back-ups en de compliance-documenten; de back-ups zijn zonder wachtwoord of herstelsleutel niet te lezen, maar een offline aanval op een back-up is onbeperkt in de tijd mogelijk. Maatregel: sterk wachtwoord, PBKDF2 2.000.000 | Geaccepteerd door de gebruiker, 2026-11-26 |
| Sleutels in het geheugen tijdens de wachttijd | Binnen de wachttijd na wisselen van app (standaard 5 minuten) blijft de app open; het voorbeeld in *Recente apps* kan het laatste scherm tonen (`nen7510.md`) | Geaccepteerd door de gebruiker, 2026-11-26; wachttijd 0 is mogelijk |
| Geheugen niet te wissen in JavaScript | Resten van sleutels kunnen tot herladen in het geheugen van Chrome staan | Restrisico, zie `nen7510.md` |
| Gewijzigde code via de hosting | De app ziet een nieuwe versie pas na eigen akkoord en toont de codehash; een aanvaller met toegang tot het GitHub-account kan een release maken | Besloten in het besluit op OneDrive; maatregel tweestapsverificatie op GitHub, bevestigd 2026-11-26 |
| Verlies van beide geheimen | Geen achterdeur: dossiers onherstelbaar | Restrisico, zie herstelprocedure §3 |
| Back-up alleen leesbaar met de app | Tot de noodontsleutelaar (na de alpha) | Restrisico tot de noodontsleutelaar |
| Verificatie BSN niet mogelijk | SBV-Z vraagt een UZI-certificaat | Restrisico, BSN optioneel |

## 7. Conclusie
Met de maatregelen in §5 is het risico voor betrokkenen naar verwachting
aanvaardbaar, mits de punten in [vóór echte dossiers](voor-echte-dossiers.md)
af zijn. Het oordeel van de verwerkingsverantwoordelijke staat in het
ondertekende besluit op OneDrive.

## 8. Besluit
Vastgelegd en ondertekend buiten de repository, op OneDrive (sjabloon
*DPIA-besluit*), op **2026-11-26**: datum, conclusie, geaccepteerde
restrisico's, datum volgende herziening (agenda *App onderhoud*, jaarlijks
vanaf november 2027).

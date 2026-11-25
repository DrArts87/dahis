# AVG: verwerkingsregister en uitgangspunten

Beginversie, bij te houden naarmate de app groeit. Geen juridisch advies.

## Verwerkingsverantwoordelijke
De arts die de app gebruikt, in de rol van BIG-geregistreerd
zorgverlener. Naam en BIG-nummer staan in de eigen instellingen van de app,
niet in deze repository.

## Verwerking: persoonlijk patiëntendossier

| Onderdeel | Invulling |
|---|---|
| Doel | Verlenen en vastleggen van zorg aan zichzelf, gezinsleden en vrienden; voorschrijven van geneesmiddelen |
| Grondslag | Art. 6 lid 1 sub b/c (behandelovereenkomst, WGBO-dossierplicht); uitzondering verwerkingsverbod art. 9 lid 2 sub h, met beroepsgeheim (art. 9 lid 3) |
| Betrokkenen | De arts zelf, gezinsleden, vrienden |
| Gegevens | Naam, geboortedatum, geslacht, adres, contactgegevens, BSN (optioneel), huisarts, apotheek, verzekering, allergieën, voorgeschiedenis, medicatie, recepten |
| Ontvangers | Geen. Recepten gaan op papier naar de apotheek via de patiënt |
| Verwerkers | Geen: gegevens staan alleen op de eigen telefoon. Back-ups in iCloud/Google Drive zijn versleuteld met een sleutel die de dienst niet heeft; GitHub (code en Pages) ziet nooit gegevens |
| Doorgifte buiten EER | Geen |
| Bewaartermijn | 20 jaar na de laatste wijziging van het dossier (WGBO art. 7:454), of langer als goed hulpverlenerschap dat vraagt; daarna vernietigen |
| Beveiliging | Versleuteld op het toestel (AES-GCM-256), hoofdwachtwoord + schermvergrendeling, automatisch vergrendelen, auditlog; zie `nen7510.md` |

## Rechten van betrokkenen
- **Inzage en afschrift** (AVG art. 15, WGBO art. 7:456): export per
  patiënt als afdrukbaar overzicht. Eerste afschrift kosteloos.
- **Correctie/aanvulling** (art. 16, WGBO): wijzigen met versie­geschiedenis;
  een eigen verklaring van de patiënt kan worden toegevoegd.
- **Vernietiging** (WGBO art. 7:455): op verzoek, tenzij een aanmerkelijk
  belang van een ander zich verzet. Vastleggen dat het verzoek is uitgevoerd.
- **Informeren**: elke betrokkene weet dat er een dossier wordt bijgehouden
  en waarom (mondeling volstaat; vastleggen in het dossier).

## Back-ups
- Back-ups zijn versleuteld (zie `docs/formaat.md`) en worden minstens
  wekelijks gemaakt; de app herinnert eraan.
- **Bewaarbeleid**: bewaar de laatste vier wekelijkse back-ups en verwijder
  oudere.
- **Vernietiging** (WGBO art. 7:455): de app wist een vernietigd dossier uit
  de actieve opslag, maar kan back-upbestanden buiten de app niet wissen.
  Door het bewaarbeleid bestaan vernietigde gegevens hooguit ongeveer vier
  weken in back-ups. Maak na een vernietiging direct een nieuwe back-up. Wie
  een back-up van vóór een vernietiging terugzet, voert de vernietiging
  opnieuw uit.

## DPIA
Een DPIA is verplicht bij grootschalige verwerking van gezondheidsgegevens.
Dat is hier niet het geval, maar een korte DPIA wordt aanbevolen omdat het om
bijzondere gegevens gaat. Uit te voeren vóór ingebruikname (fase 2).

## Datalekken
- Een datalek met gezondheidsgegevens moet binnen 72 uur bij de Autoriteit
  Persoonsgegevens worden gemeld als het een risico vormt, en vaak ook aan
  de betrokkenen.
- Een verloren telefoon met een sterk wachtwoord op de app is in de regel
  geen meldplichtig risico; uitgelekte sleutels of leesbare gegevens wel.
- Elk incident, ook als het niet gemeld hoeft te worden, vastleggen in
  een incidentenregister buiten de repository (bijv. in de app zelf), zeker
  als het details over personen bevat.

## BSN
Zorgaanbieders zijn bij de Wet gebruik BSN in de zorg verplicht het BSN te
gebruiken en te verifiëren. Verificatie (SBV-Z) vraagt een UZI-certificaat en
is in deze app niet mogelijk. Het BSN is daarom optioneel en wordt alleen
opgeslagen.

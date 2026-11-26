# AVG: verwerkingsregister en uitgangspunten

Beginversie, bij te houden naarmate de app groeit. Geen juridisch advies.
Bijgewerkt in de compliance-toets van 2026-11-26; zie ook de
[DPIA](dpia.md) (concept), de [MDR-toets](mdr.md) en
[vóór echte dossiers](voor-echte-dossiers.md).

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
| Verwerkers | Zie *Verwerkers en diensten* hieronder |
| Doorgifte buiten EER | Geen |
| Bewaartermijn | 20 jaar na de laatste wijziging van het dossier (WGBO art. 7:454), of langer als goed hulpverlenerschap dat vraagt; daarna vernietigen |
| Beveiliging | Versleuteld op het toestel (AES-GCM-256), hoofdwachtwoord + schermvergrendeling, automatisch vergrendelen, auditlog; zie `nen7510.md` |

## Verwerkers en diensten
| Dienst | Wat er staat | Persoonsgegevens? | Afspraak |
|---|---|---|---|
| Telefoon (Chrome, IndexedDB) | Alle dossiers, versleuteld | Ja, alleen versleuteld | Eigen toestel; geen verwerker |
| OneDrive (privéaccount Microsoft) | Versleutelde back-ups (`.dahis`); compliance-documenten (besluitenlog, DPIA-besluit, incidentenregister, checklist apparaten) | Back-ups: versleuteld, Microsoft heeft de sleutel niet. Incidentenregister: alleen patiëntnummers (gepseudonimiseerd, blijven persoonsgegevens). Eigen naam van de arts in de besluiten | Geen verwerkersovereenkomst (privéaccount). Restrisico geaccepteerd door de verwerkingsverantwoordelijke, 2026-11-26 ([DPIA](dpia.md) §6) |
| GitHub (repository, Pages) | Code en documentatie, openbaar | Nee (regel in `CLAUDE.md`, `privacy_check.py` in CI) | Geen verwerker |
| Google Calendar (agenda *App onderhoud*) | Onderhoudsafspraken (hersteltest, updates, herziening) | Nee | Geen verwerker |
| Claude (ontwikkeling) | Code en documentatie | Nee: nooit echte gegevens in sessies, issues of documenten | Geen verwerker |

### Incidentenregister en pseudonimisering
- Het incidentenregister staat op OneDrive en bevat per incident alleen
  **patiëntnummers**, geen namen, geboortedata of andere details die naar
  een persoon leiden (dus ook niet "mijn dochter" of een datum met een
  diagnose).
- De koppeling van nummer naar persoon staat **niet** op OneDrive. Tot
  fase 2 zijn er geen echte patiënten; daarna staat de koppeling
  versleuteld in de app zelf.
- Gepseudonimiseerde gegevens blijven persoonsgegevens (AVG overweging 26);
  daarom geldt het restrisico van OneDrive hierboven ook voor het register.

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
  wekelijks gemaakt; de app herinnert eraan na 7 dagen. De app biedt
  Delen (vanaf 0.4.0, met een wachttijd na wisselen van app) en Downloaden;
  bewaar het bestand daarna op
  OneDrive (zie *Verwerkers en diensten*).
- **Hersteltest**: elk kwartaal volgens de
  [herstelprocedure](herstelprocedure.md) §6 (agenda *App onderhoud*).
- **Bewaarbeleid**: bewaar de laatste vier wekelijkse back-ups en verwijder
  oudere, in Downloads én op OneDrive. Na downloaden of delen herinnert de
  app eraan, met de datum van de vorige back-up (vanaf 0.4.0,
  [#19](https://github.com/DrArts87/dahis/issues/19)); de app kan niet zien
  welke bestanden er buiten de app staan.
- **Vernietiging** (WGBO art. 7:455): de app wist een vernietigd dossier uit
  de actieve opslag, maar kan back-upbestanden buiten de app niet wissen.
  Door het bewaarbeleid bestaan vernietigde gegevens hooguit ongeveer vier
  weken in back-ups. Maak na een vernietiging direct een nieuwe back-up. Wie
  een back-up van vóór een vernietiging terugzet, voert de vernietiging
  opnieuw uit.

## DPIA
Een DPIA is verplicht bij grootschalige verwerking van gezondheidsgegevens.
Dat is hier niet het geval, maar een korte DPIA wordt aanbevolen omdat het om
bijzondere gegevens gaat. Concept: [`dpia.md`](dpia.md); aan te vullen en
het besluit te ondertekenen vóór echte dossiers.

## Datalekken
- Een datalek met gezondheidsgegevens moet binnen 72 uur bij de Autoriteit
  Persoonsgegevens worden gemeld als het een risico vormt, en vaak ook aan
  de betrokkenen.
- Een verloren telefoon met een sterk wachtwoord op de app is in de regel
  geen meldplichtig risico; uitgelekte sleutels of leesbare gegevens wel.
- Elk incident, ook als het niet gemeld hoeft te worden, vastleggen in
  het incidentenregister op OneDrive, met alleen patiëntnummers (zie
  *Incidentenregister en pseudonimisering*). Wat te doen bij verlies of een
  afwijking: [herstelprocedure](herstelprocedure.md).

## BSN
Zorgaanbieders zijn bij de Wet gebruik BSN in de zorg verplicht het BSN te
gebruiken en te verifiëren. Verificatie (SBV-Z) vraagt een UZI-certificaat en
is in deze app niet mogelijk. Het BSN is daarom optioneel en wordt alleen
opgeslagen.

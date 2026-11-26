# MDR: is Dahis een medisch hulpmiddel?

Eigen toets van 2026-11-26, **geen juridisch advies**. Opnieuw toetsen bij
elke uitbreiding die richting beslisondersteuning gaat (projectplan §8).

## Conclusie
Zolang Dahis alleen gegevens vastlegt, bewaart, toont en afdrukt, valt het
vermoedelijk **niet** onder de Medical Device Regulation (EU 2017/745). Er
zit geen functie in die uit gegevens van een patiënt een uitkomst afleidt
voor diagnose of behandeling. Het oordeel over een recept blijft volledig bij
de arts.

## Toetsing volgens MDCG 2019-11 (beslisboom)
De leidraad MDCG 2019-11 (*Qualification and classification of software*)
stelt een paar vragen achter elkaar:

1. **Is het software?** Ja.
2. **Is het een accessoire van een hulpmiddel, of stuurt het er een aan?**
   Nee.
3. **Voert het een bewerking op gegevens uit die verder gaat dan opslag,
   archivering, communicatie, eenvoudig zoeken of verliesvrije compressie?**
   Nee, in de huidige opzet:
   - het dossier legt vast wat de arts invoert (persoon, voorgeschiedenis,
     allergieën, medicatie);
   - zoeken en een lijst zijn eenvoudig zoeken;
   - het recept zet wat de arts kiest in een afdrukbaar formaat; de arts
     tekent met de hand;
   - het auditlog, de versleuteling en de back-up zijn beveiliging, geen
     medische bewerking.

   Bij "nee" stopt de beslisboom: geen medisch hulpmiddel.

Volgens de leidraad is een elektronisch patiëntendossier dat alleen
vastlegt en ontsluit in de regel geen hulpmiddel; losse modules met een
medische bewerking kunnen dat wel zijn en worden dan apart getoetst.

## Wat de conclusie verandert
Een functie uit deze lijst vraagt een nieuwe toets en een apart besluit
(`CLAUDE.md` §1, *Nooit*):

- doseeradvies, een berekening van de dosis (bijvoorbeeld op gewicht of
  nierfunctie);
- een waarschuwing voor interacties, contra-indicaties of allergieën die de
  app zelf afleidt;
- een suggestie voor diagnose of behandeling op basis van ingevoerde
  gegevens;
- het gebruik van NHG-Prescriptor of de G-Standaard (licentie, projectplan
  §8).

Het tonen van een allergie die de arts zelf heeft ingevoerd, naast het
recept, is vastleggen en tonen; een melding die de app zelf koppelt aan een
gekozen middel is beslisondersteuning.

## Bronnen
- Verordening (EU) 2017/745 (MDR), artikel 2 lid 1 en bijlage VIII regel 11.
- MDCG 2019-11, *Guidance on Qualification and Classification of Software
  in Regulation (EU) 2017/745 – MDR and Regulation (EU) 2017/746 – IVDR*.

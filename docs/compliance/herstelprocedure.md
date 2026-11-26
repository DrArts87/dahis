# Herstelprocedure

Wat te doen als de app of het toestel niet meer bruikbaar is, en hoe de
hersteltest gaat. Hoort bij [`nen7510.md`](nen7510.md) (Continuïteit, Back-up)
en [`avg.md`](avg.md) (Datalekken). Geen persoonsgegevens in dit document.

Nodig in alle gevallen: de laatste back-up (`.dahis`, op OneDrive) en het
wachtwoord van toen die back-up werd gemaakt, **of** de herstelsleutel (op
papier). De app staat op `https://drarts87.github.io/dahis/`.

## 1. Telefoon kwijt of gestolen
1. Beoordeel het als incident (`avg.md`, *Datalekken*) en noteer het in het
   incidentenregister. Met een sterk wachtwoord en een vergrendelde telefoon
   is het in de regel geen meldplichtig risico; uitgelekte wachtwoorden of
   een ontgrendelde telefoon wel.
2. Wis de telefoon op afstand als dat kan (Google *Vind mijn apparaat*).
3. Herstel op een nieuw toestel volgens §2.

## 2. Nieuw of ander toestel
1. Open de app in Chrome en installeer hem op het startscherm.
2. Controleer onder Meer → Over deze app de versie en de codehash tegen de
   laatste release op GitHub.
3. Kies op het welkomstscherm *Back-up terugzetten*, kies het bestand en
   gebruik het wachtwoord van die back-up of de herstelsleutel (met de
   herstelsleutel kies je meteen een nieuw wachtwoord).
4. Ontgrendel, open het logboek en maak meteen een nieuwe back-up: die hoort
   bij deze installatie.

Wijzigingen sinds de laatste back-up gaan verloren.

## 3. Wachtwoord vergeten
1. Kies op het vergrendelscherm *Wachtwoord vergeten? Herstelsleutel
   gebruiken* en typ alle 14 groepen.
2. Kies een nieuw wachtwoord. Het oude werkt daarna niet meer op dit toestel;
   oude back-ups blijven te openen met het wachtwoord van toen of met de
   herstelsleutel.
3. Maak een nieuwe back-up.

Wachtwoord én herstelsleutel kwijt: de gegevens zijn niet terug te halen,
ook niet door de maker. Alleen "Alles wissen" en opnieuw inrichten is
mogelijk. Daarom de herstelsleutel op papier op een veilige plek, niet bij
de telefoon.

## 4. De app meldt een afwijking (scherm *Gestopt*)
1. Noteer de code van de afwijking (bijvoorbeeld `chain`) en beoordeel het
   als incident.
2. Maak geen nieuwe gegevens aan. Kies *Alles wissen…* en zet daarna de
   laatste back-up terug volgens §2 stap 3–4. Controleer vooraf eventueel
   het back-upbestand vanaf het vergrendelscherm (*Back-up controleren*).
3. Lukt terugzetten niet, of is de oorzaak onduidelijk: meld het als
   beveiligingsprobleem via *Security* → *Report a vulnerability*, zonder
   gegevens.

Een forensisch bestand van de beschadigde opslag komt na de alpha.

## 5. Browser heeft de opslag gewist
Dezelfde stappen als §2. De app vraagt bij het inrichten om duurzame opslag
(`storage.persist()`); de status staat onder Instellingen → Opslag.

## 6. Hersteltest (elk kwartaal, agenda *App onderhoud*)
1. Maak in de app een back-up en download die.
2. Open op de pc een **wegwerpprofiel** in Chrome en ga naar de app.
3. Zet de back-up terug, één keer met het wachtwoord en (zo mogelijk) één
   keer met de herstelsleutel.
4. Controleer: ontgrendelen lukt, geen afwijking, het logboek loopt door
   met "Back-up teruggezet".
5. Verwijder het wegwerpprofiel en noteer datum en uitkomst in het
   besluitenlog op OneDrive.

Lukt een stap niet: beoordeel het als incident en maak een issue (zonder
gegevens).

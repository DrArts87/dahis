# Plan: Instellingen met vaste keuzes, Opslag naar Meer (#29)

## Open issues nagelopen
- Gaat mee: [#29](https://github.com/DrArts87/dahis/issues/29) (`Closes #29`).
- Geraakt: [#27](https://github.com/DrArts87/dahis/issues/27) (UI-browsertest:
  scenario voor de knoppen en *Anders*), [#30](https://github.com/DrArts87/dahis/issues/30)
  (delen komt mogelijk terug; de waarschuwing bij *Direct* blijft daarom staan).
- Niet geraakt: #18, #24, #25.

## Doel
Het instellingenscherm overzichtelijker maken, ontworpen en afgestemd op het
ontwerpcanvas (alleen verzonnen gegevens):
- elke vergrendelinstelling een eigen kaart met vaste keuzes en *Anders*;
- uitleg bij de instelling in plaats van een lange tekst onderaan;
- *Opslag* naar *Meer → Gegevens*.

## Omvang
Alleen `app/` (schermen, teksten, opmaak, één icoon) en tests. Geen wijziging
aan sleutels, grenzen of standaarden van instellingen, opslag, formaat of
schema: de knoppen schrijven dezelfde waarden via `saveSetting`.

## Taken
1. `settings.js`: `PRESETS` (niets doen: 1, 3, 5, 10; wisselen van app:
   Direct, 1, 5, 10) en `isPreset`.
2. `app.js`: `minutesChoice()` met knoppen (`aria-pressed`, groep met
   `aria-label`, vaste id's zodat de focus na opnieuw tekenen terugkomt) en
   *Anders* met de bestaande keuzelijst (label *Aantal minuten*). *Anders* staat
   open na een tik erop of als de bewaarde waarde geen vaste keuze is; die
   schermstatus (`ui.other`) wordt niet opgeslagen en vervalt bij een ander
   tabblad.
3. Waarschuwing alleen bij *Direct*: "Bij "Direct" werkt delen via het
   deelmenu niet." (tekst blijft, delen komt mogelijk terug, #30). De lange
   uitleg onderaan vervalt.
4. Eigen icoon `i-swap` voor wisselen van app; *Wachtwoord wijzigen* in een
   eigen kaart.
5. *Opslag* op *Meer → Gegevens*; de opslagstatus wordt ververst bij het
   tabblad *Meer* in plaats van *Instellingen*. Kop *Toestel* vervalt.
6. Teksten: `settings.other`, `settings.otherLabel`, `settings.directWarn`,
   `more.storage`; vervallen: `settings.device`, `settings.storage`,
   `settings.awayNote`.
7. Opmaak: kaart met kop, rij van vijf knoppen (≥ 44 px), gekozen knop in de
   accentkleur, licht en donker.
8. Tests in `settings.test.mjs`; versie 0.4.4.

## Risico's
- Vijf knoppen op een smal scherm: gecontroleerd op 360 px, tekst past.
- Een bewaarde waarde buiten de knoppen (bijv. 7) moet zichtbaar blijven:
  *Anders* is dan gekozen met de keuzelijst open.
- De melding na de update naar 0.4.0 (*Aanpassen*) springt naar Instellingen
  en blijft werken.

## Acceptatiecriteria
- Een knop kiezen slaat de waarde direct op (*Instelling opgeslagen.*); na
  opnieuw openen staat dezelfde knop gekozen.
- *Anders* toont de keuzelijst met het volledige bereik; 7 toont bij openen
  *Anders* met 7.
- De waarschuwing verschijnt alleen bij *Direct*.
- *Opslag* staat op *Meer → Gegevens* met actuele waarde, niet meer in
  Instellingen.
- Bedienbaar met toetsenbord en schermlezer; contrast ≥ 4,5:1, licht en
  donker.
- Alle controles in CI groen.

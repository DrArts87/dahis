# DrArtsHIS (Dahis)

Een klein, persoonlijk huisartsinformatiesysteem voor een BIG-geregistreerd
arts: een versleuteld patiëntenbestand voor de eigen kring en een
voorschrijfmodule voor papieren recepten. Draait als PWA op de telefoon;
alle gegevens blijven versleuteld op het toestel. Browser op de laptop en
synchronisatie via Home Assistant zijn toekomstwensen.

**Status:** in ontwerp. Zie [het projectplan](docs/plans/2026-11-25-projectplan.md).

## Principes
- **Versleuteld en lokaal.** Alle persoons- en medische gegevens worden op
  de telefoon versleuteld opgeslagen; er is geen server.
- **Geen dependencies.** Python-standaardbibliotheek en platte
  HTML/CSS/JS, zodat er zo weinig mogelijk code van derden meedraait.
- **Niets op internet.** De app maakt alleen verbinding om updates van de
  eigen code op te halen, en alleen als je daar zelf om vraagt.
- **Code en data gescheiden.** Deze repository bevat geen enkel echt
  gegeven; zie `tools/privacy_check.py`.

## Geen medisch hulpmiddel
Dahis is bedoeld voor eigen gebruik door de arts zelf. De software geeft
geen doseeradvies en controleert geen interacties; de arts blijft
verantwoordelijk voor elk recept. Gebruik door anderen is op eigen risico.

## Documentatie
- [Projectplan](docs/plans/2026-11-25-projectplan.md)
- [AVG](docs/compliance/avg.md)
- [NEN 7510 / 7513](docs/compliance/nen7510.md)
- [Beveiliging melden](SECURITY.md)

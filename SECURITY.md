# Beveiliging

Dahis verwerkt medische gegevens. Vind je een kwetsbaarheid, meld die dan
**niet** in een openbaar issue, maar via GitHub: tabblad *Security* →
*Report a vulnerability* (private vulnerability reporting).

Zet nooit echte persoons- of medische gegevens in een melding, issue of pull
request, ook niet als voorbeeld.

## Ontwerp in het kort
- Alle gegevens versleuteld op het toestel met Web Crypto (AES-GCM-256);
  sleutel alleen in het geheugen, afgeleid van het hoofdwachtwoord.
- Herstelsleutel op papier; versleutelde back-ups als bestand.
- Automatisch vergrendelen bij inactiviteit en naar de achtergrond gaan.
- Strikte Content-Security-Policy, geen externe scripts, geen
  netwerkverkeer behalve zelf gestarte updates.
- Auditlog volgens NEN 7513.

Zie `docs/compliance/nen7510.md` voor de volledige lijst maatregelen.

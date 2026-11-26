# Beveiliging

Dahis verwerkt medische gegevens. Vind je een kwetsbaarheid, meld die dan
**niet** in een openbaar issue, maar via GitHub: tabblad *Security* →
*Report a vulnerability* (private vulnerability reporting).

Zet nooit echte persoons- of medische gegevens in een melding, issue of pull
request, ook niet als voorbeeld.

## Ontwerp in het kort
- Alle gegevens versleuteld op het toestel met Web Crypto (AES-GCM-256);
  sleutel alleen in het geheugen, afgeleid van het hoofdwachtwoord met
  PBKDF2-SHA256 (standaard 2.000.000 rondes; oudere wraps worden bij
  ontgrendelen verzwaard).
- Herstelsleutel op papier; versleutelde back-ups als bestand.
- Automatisch vergrendelen bij inactiviteit (standaard 3 minuten) en na
  wisselen van app met een instelbare wachttijd (0–15 minuten, standaard
  5); tijdens een handeling of met de herstelsleutel op het scherm direct.
  Vergrendelen herlaadt de pagina.
- Strikte Content-Security-Policy, geen externe scripts, geen
  netwerkverkeer behalve zelf gestarte updates.
- Auditlog volgens NEN 7513.

Zie `docs/compliance/nen7510.md` voor de volledige lijst maatregelen.

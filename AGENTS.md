# Dahis: instructies voor Codex

Dit bestand is voor Codex als externe auditor van de pull requests. De
werkafspraken staan in [`CLAUDE.md`](CLAUDE.md) en gaan altijd voor; lees
vooral §1 *Nooit* (privacy, geen externe scripts of dependencies, geen
doseeradvies of interactiecontrole) en §5 *Valkuilen* (formaat en back-ups
zijn een contract met bestaande gegevens).

De repository en de Pages-site zijn **public**. Gebruik in reproducties,
voorbeelden en comments nooit echte persoons- of medische gegevens; alleen
verzonnen testwaarden (een verzonnen BSN haalt de 11-proef niet).

## Review guidelines

Een review is één comment in de pull request, in het Nederlands, kort en
in deze vorm. Laat een blok weg als er niets in staat.

```markdown
> 🤖 **Review door Codex** (AI-agent van OpenAI), op verzoek van de gebruiker

**Oordeel: mergen | eerst oplossen | akkoord voor testgegevens, niet voor echte dossiers**
Gereviewd: <commit>. Sinds de vorige ronde: <commit>..<commit> (of: eerste ronde)

### Bevindingen
- **[R1] [P1] Titel in één zin**
  Scenario: stappen → wat er misgaat. Gereproduceerd in Node / Chromium / alleen code gelezen.
  Voorstel: wat er moet veranderen en hoe het te testen is.
  Links: [bestand](permalink op de commit met #Lx-Ly)

### Herreview
- R1: opgelost / deels / niet opgelost, met bewijs (test, reproductie, regel)

### Compliance en vóór echte dossiers
- Punten die de merge niet blokkeren maar wel gebruik met echte gegevens.

### Voorstel voor een issue
- Titel, één zin, prioriteit.

Gedraaid: <n> Node-tests, <n> Python-tests, <n> Chromium-tests, privacy, releasehash.
Niet gecontroleerd: OnePlus, ontwerpcanvas, …

---
_Geschreven door Codex (OpenAI). Niet door een mens gecontroleerd vóór plaatsing, tenzij hierboven anders vermeld._
```

### Regels

- **Zeg wie je bent.** Elke tekst die je op GitHub schrijft (review,
  comment, issue, PR-beschrijving) begint met de kop en eindigt met de
  voettekst uit het voorbeeld, ook als hij onder het account van de
  gebruiker komt te staan. Zo ziet elke lezer welke AI wat schreef. Een
  tekst zonder kop is van de gebruiker zelf.
- **Vaste ID's per PR.** Bevindingen heten R1, R2, … en houden hun nummer in
  alle rondes van dezelfde PR. Een nieuwe ronde telt door (R4, R5, …) en
  begint niet opnieuw bij 1.
- **Prioriteit.** P1 blokkeert de merge. P2 hoort vóór de merge, tenzij de
  gebruiker uitstelt. P3 mag een vervolgissue worden. Compliance-punten
  staan in hun eigen blok en niet tussen de codebevindingen.
- **Scenario boven mening.** Elke bevinding noemt concrete stappen en wat er
  dan misgaat, en of dat gereproduceerd is. Zonder scenario is het hooguit
  een P3.
- **Lees eerst de PR-beschrijving.** Volg *Focus*, sla *Buiten de review*
  over en heropen niets onder *Besloten* (B1, B2, …). Zie je bij een besluit
  een nieuw risico, maak dan een nieuw ID met "raakt B2" en leg uit wat er
  nieuw is.
- **Herreview alleen op de delta.** Bij een volgende ronde: de eerdere ID's
  nalopen (blok *Herreview*) en de wijzigingen sinds de vorige gereviewde
  commit beoordelen op regressies. De reactie van Claude noemt die commits.
  Geen volledige nieuwe review, tenzij de gebruiker erom vraagt.
- **Links** zijn permalinks op de gereviewde commit, met regelbereik.
- **Grenzen eerlijk noemen.** Zeg wat je niet hebt kunnen controleren:
  de OnePlus, het ontwerpcanvas (privé), OneDrive en documenten buiten de
  repository.
- **Geen ontwerpwijzigingen buiten de scope.** Een wens die niet uit deze PR
  volgt, wordt een voorstel voor een issue en geen bevinding.

# Dahis: werkafspraken

De gebruiker heeft het laatste woord; is een regel onduidelijk, vraag dan in
plaats van te gokken.

## 1. Goedkeuring

### Vrij
- Bestanden lezen en doorzoeken, git-geschiedenis, documentatie, het web.
- Alleen-lezen commando's: `git status`, `git log`, `git diff`,
  `python3 -m py_compile`, `python3 tools/privacy_check.py`.

### Eerst een plan, dan uitvoeren
- Presenteer voor elke wijziging een kort plan en wacht op akkoord. Een
  goedgekeurd plan mag op een topic-branch worden uitgevoerd; wijkt het werk
  af, stop en vraag opnieuw.

### Altijd apart vragen
- `git commit`, `git push`, een pull request openen of mergen.
- Bestanden of branches verwijderen, geschiedenis herschrijven.
- Een externe dependency toevoegen (alleen Python-standaardbibliotheek en
  platte HTML/CSS/JS; dat is een ontwerpprincipe).
- Het databaseschema of het versleutelingsformaat wijzigen.
- Repository-instellingen, GitHub Pages of GitHub-workflows aanpassen.
- Alles buiten deze repository, inclusief hosting en de installatie op de
  telefoon.

### Nooit
- Direct op `main` committen.
- Echte persoons- of medische gegevens lezen, tonen of committen: de
  database in `data/`, back-ups, exports, recepten, BSN's, namen,
  geboortedata, diagnoses. Ook niet als voorbeeld in code, tests, issues of
  documentatie. De repository en de Pages-site zijn **public**.
- Patiëntgegevens onversleuteld opslaan, loggen of over het netwerk sturen.
- Externe scripts, CDN's, analytics of fonts laden, of andere
  netwerkverbindingen dan het ophalen van de eigen app-code.
- Doseeradvies of interactiecontrole bouwen zonder apart besluit (MDR).

## 2. Workflows

Ontwikkelomgeving: Windows met PowerShell. Geef commando's in een vorm die
in PowerShell werkt: `python3` (of `py`), geen `&&`-ketens voor PowerShell 5,
geen Unix-only commando's als `grep`, `sed` of `rm -rf`. Paden met `/` werken
in git en Python ook op Windows.

Commando's die Claude zelf uitvoert in een cloudsessie draaien op Linux; de
Windows-regel geldt voor commando's die de gebruiker krijgt.

Begin van een sessie
1. `git switch main` en daarna `git pull`
2. Eenmalig per checkout: `git config core.hooksPath .githooks`. De
   pre-commit-hook werkt `app/sw.js` bij met `tools/release.py` en stopt de
   commit als er iets veranderd is.
3. Lees [`docs/overdracht.md`](docs/overdracht.md) voor de stand van zaken,
   de werkwijze en de volgende stap.

Na een codewijziging
1. `python3 tools/release.py` na elke wijziging in `app/` (anders weigert de
   service worker de nieuwe bestanden), `python3 -m py_compile tools/*.py`,
   `python3 -m unittest discover -s tests`, `node --check` op de
   JS-bestanden en `node --test tests/*.test.mjs`. CI (`controle.yml`)
   controleert hetzelfde.
2. De app lokaal serveren (`python3 -m http.server`) en in de browser
   controleren met een wegwerpprofiel, nooit met echte gegevens.

Voor een commit
1. `git status`: niets uit `data/`, geen database, export, back-up of PDF.
2. `git diff --staged` lezen.
3. `python3 tools/privacy_check.py`. Namen en diagnoses herkent het script
   niet; die blijf je zelf nalopen.

## 3. Branches en commits
- `main` is beschermd, ook voor beheerders: alleen via pull request, de drie
  controles uit `controle.yml` moeten groen zijn, ondertekende commits,
  lineaire geschiedenis. Alleen squash merge; de branch wordt na het mergen
  automatisch verwijderd.
- Mergen doet de gebruiker op GitHub (*Squash and merge*), nooit Claude.
- Alle commits zijn ondertekend met een SSH-sleutel. Commits van de
  gebruiker met de eigen sleutel; commits uit een Claude-cloudsessie met de
  sleutel van die sessie, op naam van Claude. Een commit die GitHub niet als
  *Verified* toont, wordt niet gemerged maar opnieuw gemaakt. Bij een squash
  merge ondertekent GitHub de commit op `main` zelf.
- Topic-branches: `feat/...`, `fix/...`, `docs/...`, `refactor/...`, `chore/...`.
- Conventional Commits met Nederlandse omschrijving.

## 4. Plannen
Features en refactors krijgen een plan in `docs/plans/JJJJ-MM-DD-onderwerp.md`
met doel, omvang, taken, risico's en acceptatiecriteria.

## 5. Valkuilen
- Versleutelingsformaat, sleutelafleiding en back-upformaat zijn een
  contract met bestaande gegevens en back-ups: wijzigen alleen met
  versienummer en migratie. Oude back-ups moeten altijd terug te zetten zijn.
- Verzonnen BSN's in tests moeten de 11-proef **niet** halen.
- Python 3.9 is de ondergrens; geen `match` of `X | Y` in annotaties.
- Gesprek, documentatie, commitberichten en gebruikersteksten in het
  Nederlands; identifiers in het Engels.

## 6. Terugkoppeling
- Elke terugkoppeling van Claude (plan, verslag, antwoord) begint met een
  korte uitleg in gewone taal ("ELI5"): wat er speelt, wat er gedaan is en
  wat de gebruiker moet beslissen, zonder vakjargon. Daaronder volgt de
  uitgebreide, technische informatie.

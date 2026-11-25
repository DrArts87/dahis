# Releaseprocedure en GitHub Pages

Taak 9 uit het [plan fase 1](plans/2026-11-25-fase-1-fundament.md) §5.
De app staat op `https://drarts87.github.io/dahis/`. Alleen de map `app/`
wordt gepubliceerd; er gaan nooit gegevens naar GitHub.

## Hoe het werkt
- De workflow [`pages.yml`](../.github/workflows/pages.yml) start **alleen**
  bij een versietag `vX.Y.Z`. Een merge naar `main` publiceert niets.
- Hij controleert eerst hetzelfde als CI (Python 3.9, JavaScript,
  privacy), en daarna:
  - de tag heeft de vorm `vX.Y.Z` en wijst naar een commit op `main`;
  - de tag is gelijk aan `VERSION` in `app/sw.js`;
  - `tools/release.py --check` slaagt (hashes kloppen).
- Dan pakt hij `app/` in en publiceert hij die met de officiële actions
  `actions/upload-pages-artifact` en `actions/deploy-pages`, vastgepind op
  een commit-SHA. De samenvatting van de run toont versie en codehash.
- Op de telefoon ziet de app de nieuwe versie bij de volgende controle en
  toont "Nieuwe versie staat klaar"; pas na een tik op Bijwerken wordt
  die actief.

## Eenmalig instellen (gebruiker, op GitHub)
1. **Pages**: *Settings → Pages → Build and deployment → Source: GitHub
   Actions*.
2. **Alleen vanaf tags publiceren**: *Settings → Environments →
   github-pages → Deployment branches and tags → Selected branches and
   tags*. Verwijder een eventuele regel voor `main` en voeg toe: type
   *Tag*, patroon `v*`.
3. **Geen andere Pages-site op het account** (plan fase 1 §3): controleer
   bij elke andere repository *Settings → Pages* dat Pages uit staat, en
   dat er geen repository `drarts87.github.io` is.
4. Optioneel: *Settings → Rules → Rulesets → New tag ruleset* voor `v*`
   met *Restrict creations, updates and deletions*, zodat alleen jij
   versietags kunt maken of wijzigen.

## Een versie publiceren
1. **Versienummer** (niet nodig voor de eerste publicatie, `0.1.0`): op een
   branch `python3 tools/release.py --versie X.Y.Z`, via een pull request
   naar `main` en *Squash and merge*.
2. **Release maken**: *Releases → Draft a new release*:
   - *Choose a tag*: `vX.Y.Z` (nieuw), *Target*: `main`;
   - titel `vX.Y.Z`; in de notities de codehash (regel `CODE_HASH` in
     `app/sw.js` op `main`) en een korte omschrijving;
   - *Publish release*. Dit kan ook vanaf de telefoon.
3. **Controleren**: *Actions → Pages* is groen; de samenvatting toont
   dezelfde codehash.
4. **Op de telefoon**: open de app, tik op *Bijwerken* zodra de melding
   verschijnt, en vergelijk onder *Meer → Over deze app* versie en
   codehash met de release.

Een tag wordt nooit hergebruikt of verplaatst. Terug naar een eerdere
versie gaat met een nieuwe, hogere versie van de oude code.

## Checklist per release
- [ ] De controles op `main` zijn groen.
- [ ] `VERSION` in `app/sw.js` is verhoogd (behalve bij `0.1.0`).
- [ ] Er is geen andere Pages-site op het account.
- [ ] Release `vX.Y.Z` op `main`, met codehash in de notities.
- [ ] Workflow *Pages* groen; codehash in de samenvatting gelijk.
- [ ] Op de telefoon bijgewerkt; versie en codehash gecontroleerd.
- [ ] Tot de voorwaarde voor echte dossiers (plan fase 1 §7) is vervuld:
      alleen testgegevens.

## Eerste keer op de telefoon
1. Open `https://drarts87.github.io/dahis/` in Chrome op de OnePlus.
2. *⋮ → App installeren*; open Dahis daarna vanaf het startscherm.
3. Richt de app in met een testwachtwoord; bewaar de herstelsleutel
   alleen als test.
4. *Meer → Snelheid meten*: noteer de duur bij 600.000 en bij 10.000.000
   rondes (open punt uit taak 5).
5. Testgegevens later weg: *Meer → Alles wissen*. Opnieuw installeren is
   niet nodig; het adres blijft hetzelfde.

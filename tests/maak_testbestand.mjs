// Maakt tests/fixtures/testbestand-formaat-1.json: een back-up van formaat 1
// (formaat §14) met verzonnen inhoud, een bekend testwachtwoord en de
// herstelsleutel die erbij hoort. Elke versie van de app moet dit bestand
// kunnen terugzetten (tests/testbestand.test.mjs, tests/browser.mjs).
//
// Alleen opnieuw draaien bij een bewuste formaatwijziging, en dan als
// testbestand van het nieuwe formaat naast dit bestand; dit bestand blijft.
// Het bestand staat als tekst in JSON, want .dahis-bestanden weigert
// tools/privacy_check.py terecht.
//
// Gebruik:  node tests/maak_testbestand.mjs
import { writeFileSync } from 'node:fs';
import * as V from '../app/js/vault.js';

const PASSWORD = 'testbestand formaat een wachtwoord';
const NOW = new Date('2026-11-25T12:00:00.000Z');
const RECORDS = [
  { kind: 'test_persoon', data: { omschrijving: 'Verzonnen testwaarde A' } },
  { kind: 'test_persoon', data: { omschrijving: 'Verzonnen testwaarde B' } },
  { kind: 'test_recept', data: { omschrijving: 'Verzonnen testwaarde C' } },
];

async function write(store, session, factory) {
  let tx;
  while ((tx = await V.nextPrelude(store, session, { now: NOW }))) V.applyTx(store, tx);
  tx = await factory();
  V.applyTx(store, tx);
  return tx;
}

const store = V.emptyStore();
const created = await V.createInstallation({ password: PASSWORD, now: NOW });
V.applyTx(store, created.tx);
const { session } = await V.unlock(store, { password: PASSWORD });
await write(store, session, () => V.unlockTx(store, session, { now: NOW }));
const records = [];
for (const r of RECORDS) {
  const tx = await write(store, session, () => V.putRecordTx(store, session, Object.assign({ now: NOW }, r)));
  records.push({ id: tx.putRecords[0].id, kind: r.kind, data: r.data });
}
// Een tweede versie van het eerste record en een verwijderd record.
const second = await write(store, session, () => V.putRecordTx(store, session, {
  id: records[0].id, kind: records[0].kind, data: { omschrijving: 'Verzonnen testwaarde A2' }, now: NOW,
}));
records[0].data = { omschrijving: 'Verzonnen testwaarde A2' };
records[0].version = second.putRecords[0].version;
await write(store, session, () => V.deleteRecordTx(store, session, { id: records[2].id, now: NOW }));
records[2].deleted = true;
await write(store, session, () => V.exportTx(store, session, { now: NOW }));
const text = await V.buildBackupFile(store, session, { now: NOW, appVersion: 'testbestand' });

const fixture = {
  formaat: 1,
  beschrijving: 'Back-up van formaat 1 met verzonnen inhoud (formaat §14). Elke versie van de app moet dit bestand kunnen terugzetten. Niet wijzigen.',
  wachtwoord: PASSWORD,
  herstelsleutel: created.recoveryKey,
  gemaakt: NOW.toISOString(),
  records,
  logregels: store.audit.length,
  bestand: text,
};
writeFileSync(new URL('./fixtures/testbestand-formaat-1.json', import.meta.url), JSON.stringify(fixture, null, 2) + '\n');
console.log('testbestand-formaat-1.json:', text.length, 'bytes,', store.audit.length, 'logregels');

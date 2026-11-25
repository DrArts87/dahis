// Het testbestand van formaat 1 (tests/fixtures/testbestand-formaat-1.json,
// formaat §14): elke versie van de app moet het kunnen terugzetten, met het
// wachtwoord en met de herstelsleutel. Alleen verzonnen inhoud.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as C from '../app/js/crypto.js';
import * as V from '../app/js/vault.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/testbestand-formaat-1.json', import.meta.url), 'utf8'));
const FILE = C.utf8(fixture.bestand);
const NOW = new Date('2026-11-26T09:00:00.000Z');
const NEW_PASSWORD = 'nieuw wachtwoord na het testbestand';

async function openRestored(secret, newPassword) {
  const store = V.emptyStore();
  V.applyTx(store, (await V.restoreTx(FILE, secret, { newPassword, now: NOW })).tx);
  const { session } = await V.unlock(store, { password: newPassword || fixture.wachtwoord });
  await V.fullCheck(store, session);
  return { store, session };
}

async function assertContents(store, session) {
  for (const r of fixture.records) {
    const rec = await V.readRecord(store, session, r.id);
    if (r.deleted) assert.equal(rec.content.deleted, true, r.id);
    else assert.deepEqual(rec.content.data, r.data, r.id);
    if (r.version) assert.equal(rec.row.version, r.version);
  }
}

test('testbestand formaat 1: samenvatting klopt', async () => {
  assert.equal(fixture.formaat, 1);
  const summary = await V.checkBackupFile(FILE, { password: fixture.wachtwoord });
  assert.equal(summary.createdAt, fixture.gemaakt);
  assert.equal(summary.audit, fixture.logregels);
});

test('testbestand formaat 1: terugzetten met het wachtwoord', async () => {
  const { store, session } = await openRestored({ password: fixture.wachtwoord });
  await assertContents(store, session);
});

test('testbestand formaat 1: terugzetten met de herstelsleutel en een nieuw wachtwoord', async () => {
  const { store, session } = await openRestored({ recoveryKey: fixture.herstelsleutel }, NEW_PASSWORD);
  await assertContents(store, session);
  await assert.rejects(V.unlock(store, { password: fixture.wachtwoord }), C.WrongSecretError);
});

test('testbestand formaat 1: geen testwaarde leesbaar in het bestand', () => {
  for (const r of fixture.records) {
    if (r.data) assert.equal(fixture.bestand.includes(r.data.omschrijving), false);
  }
  assert.equal(fixture.bestand.includes('Verzonnen'), false);
});

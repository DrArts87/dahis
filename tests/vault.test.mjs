// Tests van de bewerkingen van formaat 1 in het geheugen (app/js/vault.js).
// Alleen verzonnen gegevens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as C from '../app/js/crypto.js';
import * as V from '../app/js/vault.js';
import { TEST_ITERATIONS } from './helpers/kluis.mjs';

const PASSWORD = 'correct paard batterij nietje';
const PASSWORD2 = 'een heel ander wachtwoord 2';
const NOW = new Date('2026-11-25T12:00:00.000Z');
const SECRET_TEXT = 'Testpersoon Jansen';

async function commit(store, tx) {
  if (tx) V.applyTx(store, tx);
}

// Voorafgaande transacties (nieuwe schrijfsleutel, reservering) zoals de
// schrijfwachtrij in store.js ze uitvoert.
async function prelude(store, session, now = NOW) {
  let tx;
  while ((tx = await V.nextPrelude(store, session, { now }))) V.applyTx(store, tx);
}

async function write(store, session, factory) {
  await prelude(store, session);
  const tx = await factory();
  V.applyTx(store, tx);
  return tx;
}

async function setup() {
  const store = V.emptyStore();
  const { tx, session, recoveryKey } = await V.createInstallation({ password: PASSWORD, now: NOW, iterations: TEST_ITERATIONS });
  V.applyTx(store, tx);
  return { store, session, recoveryKey };
}

async function unlockAndLog(store, secret) {
  const { session } = await V.unlock(store, secret);
  await write(store, session, () => V.unlockTx(store, session, { now: NOW }));
  return session;
}

async function putRecord(store, session, fields) {
  return write(store, session, () => V.putRecordTx(store, session, Object.assign({ now: NOW }, fields)));
}

async function auditActions(store, session) {
  const rows = store.audit.slice().sort((a, b) => a.seq - b.seq);
  const out = [];
  let hPrev = C.ZERO_HASH;
  for (const row of rows) {
    const c = await C.openAudit((await session.subkeys(row.kid)).audit, session.epochOf(row.kid), row, hPrev);
    out.push(c);
    hPrev = row.h;
  }
  return out;
}

function clone(store) {
  return structuredClone(store);
}

function allBytes(store) {
  const parts = [];
  const walk = (v) => {
    if (v instanceof Uint8Array) parts.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    else if (typeof v === 'string') parts.push(C.utf8(v));
  };
  walk(store);
  return C.concat(...parts);
}

function contains(haystack, needle) {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

async function expectIntegrity(promise, code) {
  await assert.rejects(promise, (err) => err instanceof C.IntegrityError && err.code === code);
}

test('onboarding, ontgrendelen, record schrijven en lezen, beide controles', async () => {
  const { store, recoveryKey } = await setup();
  assert.match(recoveryKey, /^([0-9A-HJKMNP-TV-Z]{4}-){13}[0-9A-HJKMNP-TV-Z]{4}$/);
  const session = await unlockAndLog(store, { password: PASSWORD });
  const tx = await putRecord(store, session, { kind: 'test_persoon', data: { naam: SECRET_TEXT } });
  const id = tx.putRecords[0].id;
  const read = await V.readRecord(store, session, id);
  assert.equal(read.content.data.naam, SECRET_TEXT);
  await V.quickCheck(store, session);
  await V.fullCheck(store, session);
  const actions = (await auditActions(store, session)).map((c) => c.action);
  assert.deepEqual(actions, ['create', 'unlock', 'create']);
  assert.equal(contains(allBytes(store), C.utf8(SECRET_TEXT)), false, 'testwaarde leesbaar in de opslag');
});

test('onjuist wachtwoord: WrongSecretError, en de pogingen worden later gelogd', async () => {
  const { store } = await setup();
  await assert.rejects(V.unlock(store, { password: 'fout wachtwoord van lengte' }), C.WrongSecretError);
  V.applyTx(store, V.failedUnlockTx(store, NOW));
  V.applyTx(store, V.failedUnlockTx(store, NOW));
  const session = await unlockAndLog(store, { password: PASSWORD });
  const log = await auditActions(store, session);
  assert.deepEqual(log.slice(-2).map((c) => [c.action, c.detail]), [['unlock_failed', 2], ['unlock', 'password']]);
  assert.equal(store.meta.failed_unlocks.count, 0);
});

test('herstelsleutel: ontgrendelen, nieuw wachtwoord; oud werkt niet meer, nieuw wel', async () => {
  const { store, recoveryKey } = await setup();
  const messy = recoveryKey.toLowerCase().replace(/-/g, ' ');
  const { session } = await V.unlock(store, { recoveryKey: messy });
  await write(store, session, () => V.changePasswordTx(store, session,
    { current: { recoveryKey }, newPassword: PASSWORD2, detail: 'recovery', now: NOW, iterations: TEST_ITERATIONS }));
  await assert.rejects(V.unlock(store, { password: PASSWORD }), C.WrongSecretError);
  const s2 = await unlockAndLog(store, { password: PASSWORD2 });
  await V.fullCheck(store, s2);
  const actions = (await auditActions(store, s2)).map((c) => c.action);
  assert.deepEqual(actions, ['create', 'recovery_used', 'password_change', 'unlock']);
});

test('tikfout in de herstelsleutel wordt herkend zonder ontsleutelpoging', async () => {
  const { store, recoveryKey } = await setup();
  const last = recoveryKey.slice(-1) === '0' ? '1' : '0';
  await assert.rejects(V.unlock(store, { recoveryKey: recoveryKey.slice(0, -1) + last }), C.RecoveryKeyTypoError);
});

test('versies, verwijderen en vernietigen', async () => {
  const { store } = await setup();
  const session = await unlockAndLog(store, { password: PASSWORD });
  const id = (await putRecord(store, session, { kind: 'test_persoon', data: { v: 1 } })).putRecords[0].id;
  await putRecord(store, session, { id, kind: 'test_persoon', data: { v: 2 } });
  assert.equal((await V.readRecord(store, session, id)).content.data.v, 2);
  await write(store, session, () => V.deleteRecordTx(store, session, { id, now: NOW }));
  assert.equal((await V.readRecord(store, session, id)).content.deleted, true);
  assert.equal(store.records.filter((r) => r.id === id).length, 3);
  // Alle versies blijven te lezen, oudste eerst (review PR #56: tellerhistorie).
  const versions = await V.readRecordVersions(store, session, id);
  assert.deepEqual(versions.map((v) => v.row.version), [1, 2, 3]);
  assert.deepEqual(versions.map((v) => (v.content.deleted ? 'weg' : v.content.data.v)), [1, 2, 'weg']);
  assert.deepEqual(await V.readRecordVersions(store, session, 'bestaat-niet'), []);
  await write(store, session, () => V.destroyRecordTx(store, session, { id, now: NOW }));
  assert.equal(store.records.length, 0);
  await V.fullCheck(store, session);
});

test('ontbrekende nieuwste versie valt op bij ontgrendelen (state)', async () => {
  const { store } = await setup();
  const session = await unlockAndLog(store, { password: PASSWORD });
  const id = (await putRecord(store, session, { kind: 'test_persoon', data: { v: 1 } })).putRecords[0].id;
  await putRecord(store, session, { id, kind: 'test_persoon', data: { v: 2 } });
  store.records = store.records.filter((r) => !(r.id === id && r.version === 2));
  await expectIntegrity(V.unlock(store, { password: PASSWORD }), 'state');
});

test('gewijzigde oudere auditregel met ongewijzigde h: snel niet, volledig wel', async () => {
  const { store } = await setup();
  let session = await unlockAndLog(store, { password: PASSWORD });
  await putRecord(store, session, { kind: 'test_persoon', data: { v: 1 } });
  const row = store.audit.find((r) => r.seq === 1);
  row.ct = row.ct.slice();
  row.ct[5] ^= 1;
  ({ session } = await V.unlock(store, { password: PASSWORD }));
  await expectIntegrity(V.fullCheck(store, session), 'chain');
});

test('teruggezet deel van het log met oud controlepunt valt op (state)', async () => {
  const { store } = await setup();
  const session = await unlockAndLog(store, { password: PASSWORD });
  const old = clone(store);
  await putRecord(store, session, { kind: 'test_persoon', data: { v: 1 } });
  store.audit = old.audit;
  store.meta.checkpoint = old.meta.checkpoint;
  await expectIntegrity(V.unlock(store, { password: PASSWORD }), 'state');
});

test('gewijzigde write_keys valt op (keys)', async () => {
  const { store } = await setup();
  store.meta.write_keys = store.meta.write_keys.concat([{ kid: 2, epoch: 1, salt: C.randomBytes(16) }]);
  await expectIntegrity(V.unlock(store, { password: PASSWORD }), 'keys');
});

test('mislukte transactie, herstart, nieuwe versleuteling: geen tellerplaats opnieuw', async () => {
  const { store } = await setup();
  const s1 = await unlockAndLog(store, { password: PASSWORD });
  await V.prepareReservation(store, s1, 2).then((r) => commit(store, r));
  await V.putRecordTx(store, s1, { kind: 'test_persoon', data: { v: 1 }, now: NOW }); // niet toegepast: crash
  const usedBeforeCrash = s1.counter;
  const { session: s2 } = await V.unlock(store, { password: PASSWORD });
  assert.ok(s2.counter >= usedBeforeCrash, 'teller na herstart moet voorbij alle gebruikte plaatsen liggen');
  await prelude(store, s2);
  V.applyTx(store, await V.unlockTx(store, s2, { now: NOW }));
  await V.fullCheck(store, s2);
});

test('concurrerende transactie wordt geweigerd en verandert niets', async () => {
  const { store } = await setup();
  const session = await unlockAndLog(store, { password: PASSWORD });
  await commit(store, await V.prepareReservation(store, session, 4));
  const a = await V.putRecordTx(store, session, { kind: 'test_persoon', data: { v: 1 }, now: NOW });
  const b = await V.putRecordTx(store, session, { kind: 'test_persoon', data: { v: 2 }, now: NOW });
  V.applyTx(store, a);
  const before = clone(store);
  assert.throws(() => V.applyTx(store, b), V.ConflictError);
  assert.deepEqual(store, before);
});

async function makeBackup(store, session) {
  await write(store, session, () => V.exportTx(store, session, { now: NOW }));
  return C.utf8(await V.buildBackupFile(store, session, { now: NOW, appVersion: '0.1.0' }));
}

test('back-up terugzetten met wachtwoord op een lege opslag', async () => {
  const { store } = await setup();
  const session = await unlockAndLog(store, { password: PASSWORD });
  const id = (await putRecord(store, session, { kind: 'test_persoon', data: { naam: SECRET_TEXT } })).putRecords[0].id;
  const file = await makeBackup(store, session);
  assert.equal(contains(file, C.utf8(SECRET_TEXT)), false);
  const target = V.emptyStore();
  const { tx } = await V.restoreTx(file, { password: PASSWORD }, { now: NOW });
  V.applyTx(target, tx);
  assert.notEqual(target.meta.device_id, store.meta.device_id);
  const s2 = await unlockAndLog(target, { password: PASSWORD });
  await V.fullCheck(target, s2);
  assert.equal((await V.readRecord(target, s2, id)).content.data.naam, SECRET_TEXT);
  assert.ok(target.meta.checkpoint.kid > store.meta.checkpoint.kid);
  const actions = (await auditActions(target, s2)).map((c) => c.action);
  assert.deepEqual(actions.slice(-4), ['export', 'write_key', 'import', 'unlock']);
});

test('back-up terugzetten met herstelsleutel: nieuw wachtwoord verplicht; daarna opent de app met het nieuwe', async () => {
  const { store, recoveryKey } = await setup();
  const session = await unlockAndLog(store, { password: PASSWORD });
  await putRecord(store, session, { kind: 'test_persoon', data: { v: 1 } });
  const file = await makeBackup(store, session);
  await assert.rejects(V.restoreTx(file, { recoveryKey }, { now: NOW }), C.FormatError);
  const target = V.emptyStore();
  V.applyTx(target, (await V.restoreTx(file, { recoveryKey }, { newPassword: PASSWORD2, now: NOW, iterations: TEST_ITERATIONS })).tx);
  await assert.rejects(V.unlock(target, { password: PASSWORD }), C.WrongSecretError);
  const s2 = await unlockAndLog(target, { password: PASSWORD2 });
  await V.fullCheck(target, s2);
  const actions = (await auditActions(target, s2)).map((c) => c.action);
  assert.ok(actions.includes('recovery_used') && actions.includes('import'));
});

test('ongeldig back-upbestand wordt geweigerd; de lege opslag blijft leeg', async () => {
  const { store } = await setup();
  const session = await unlockAndLog(store, { password: PASSWORD });
  const file = await makeBackup(store, session);
  const text = new TextDecoder().decode(file);
  const [line1, line2] = text.split('\n');
  const variants = {
    'inhoud gewijzigd': line1 + '\n' + (line2[10] === 'A' ? line2.slice(0, 10) + 'B' : line2.slice(0, 10) + 'A') + line2.slice(11) + '\n',
    'header met spatie': line1.replace('{"magic"', '{ "magic"') + '\n' + line2 + '\n',
    'iterations gewijzigd': line1.replace('"iterations":' + store.meta.kdf.iterations, '"iterations":' + (store.meta.kdf.iterations + 1)) + '\n' + line2 + '\n',
    'extra regel': text + 'x\n',
    'zonder afsluitende regel': text.slice(0, -1),
    'BOM': '﻿' + text,
    'CRLF': text.replace(/\n/g, '\r\n'),
  };
  assert.notEqual(variants['iterations gewijzigd'], text, 'de variant wijzigt echt iets');
  for (const [name, bad] of Object.entries(variants)) {
    const target = V.emptyStore();
    await assert.rejects(V.restoreTx(C.utf8(bad), { password: PASSWORD }, { now: NOW }), Error, name);
    assert.deepEqual(target, V.emptyStore(), name);
  }
});

test('herhaald herstel van dezelfde back-up geeft telkens een nieuwe schrijfsleutel', async () => {
  const { store } = await setup();
  const session = await unlockAndLog(store, { password: PASSWORD });
  const file = await makeBackup(store, session);
  const a = await V.restoreTx(file, { password: PASSWORD }, { now: NOW });
  const b = await V.restoreTx(file, { password: PASSWORD }, { now: NOW });
  const newA = a.tx.putMeta.write_keys.at(-1);
  const newB = b.tx.putMeta.write_keys.at(-1);
  assert.equal(C.equalBytes(newA.salt, newB.salt), false);
  assert.equal(a.tx.putMeta.reservation.kid, newA.kid);
});

async function tamperBackup(file, dataKey, change) {
  const [line1, line2] = new TextDecoder().decode(file).split('\n');
  const header = C.parseHeader(line1);
  const payload = await C.decodeBackupPayload(dataKey, header, line1, line2);
  change(payload, header);
  return C.utf8(await C.encodeBackupFile(dataKey, header, payload));
}

test('back-up met gewijzigde write_keys wordt geweigerd (keys)', async () => {
  const { store } = await setup();
  const session = await unlockAndLog(store, { password: PASSWORD });
  const file = await makeBackup(store, session);
  const bad = await tamperBackup(file, session.dataKeys.get(1), (p) => {
    p.write_keys[0].salt = C.b64(C.randomBytes(16));
  });
  await expectIntegrity(V.restoreTx(bad, { password: PASSWORD }, { now: NOW }), 'keys');
});

test('sleutels vernieuwen; back-up met controlepunt uit een eerdere epoch wordt geweigerd', async () => {
  const { store } = await setup();
  let session = await unlockAndLog(store, { password: PASSWORD });
  const id = (await putRecord(store, session, { kind: 'test_persoon', data: { v: 1 } })).putRecords[0].id;
  await commit(store, await V.prepareReservation(store, session, 0));
  const { tx, recoveryKey } = await V.rotateKeysTx(store, session, { current: { password: PASSWORD }, newPassword: PASSWORD2, now: NOW, iterations: TEST_ITERATIONS });
  V.applyTx(store, tx);
  assert.equal(store.meta.epoch, 2);
  await assert.rejects(V.unlock(store, { password: PASSWORD }), C.WrongSecretError);
  session = await unlockAndLog(store, { password: PASSWORD2 });
  assert.equal((await V.readRecord(store, session, id)).content.data.v, 1);
  await putRecord(store, session, { kind: 'test_persoon', data: { v: 2 } });
  await V.fullCheck(store, session);

  const file = await makeBackup(store, session);
  const target = V.emptyStore();
  V.applyTx(target, (await V.restoreTx(file, { recoveryKey }, { newPassword: PASSWORD, now: NOW, iterations: TEST_ITERATIONS })).tx);
  const s3 = await unlockAndLog(target, { password: PASSWORD });
  await V.fullCheck(target, s3);

  const oldKid = store.meta.write_keys.find((w) => w.epoch === 1).kid;
  const bad = await tamperBackup(file, session.dataKeys.get(2), (p) => { p.checkpoint.kid = oldKid; });
  await expectIntegrity(V.restoreTx(bad, { password: PASSWORD2 }, { now: NOW }), 'keys');
});

test('nieuwe schrijfsleutel als het budget op raakt; keten loopt door', async () => {
  const { store } = await setup();
  const session = await unlockAndLog(store, { password: PASSWORD });
  const before = session.kid;
  V.applyTx(store, await V.rollWriteKey(store, session, { now: NOW }));
  assert.equal(session.kid, before + 1);
  await putRecord(store, session, { kind: 'test_persoon', data: { v: 1 } });
  await V.fullCheck(store, session);
  const s2 = await unlockAndLog(store, { password: PASSWORD });
  await V.fullCheck(store, s2);
});

test('niet toegepaste nieuwe schrijfsleutel laat geen subsleutel achter', async () => {
  const { store } = await setup();
  const session = await unlockAndLog(store, { password: PASSWORD });
  await V.rollWriteKey(store, session, { now: NOW });           // niet toegepast
  const next = session.kid + 1;
  assert.equal(session.subkeyCache.has(next), false);
  V.applyTx(store, await V.rollWriteKey(store, session, { now: NOW }));
  assert.equal(session.kid, next);
  await V.fullCheck(store, session);
});

// --- Logboek lezen (taak 6) -------------------------------------------------------------

test('logboek lezen: nieuwste eerst, bladeren, en er wordt niets geschreven', async () => {
  const { store } = await setup();
  const session = await unlockAndLog(store, { password: PASSWORD });
  for (let i = 0; i < 4; i++) await putRecord(store, session, { kind: 'test_persoon', data: { v: i } });
  const before = clone(store);
  const total = store.audit.length;
  const first = await V.readAuditPage(store, session, { limit: 3 });
  assert.deepEqual(first.entries.map((e) => e.seq), [total, total - 1, total - 2]);
  assert.equal(first.next, total - 2);
  assert.equal(first.entries[0].action, 'create');
  assert.equal(first.entries[0].kind, 'test_persoon');
  assert.ok(C.UUID_RE.test(first.entries[0].record_id));
  const seen = first.entries.slice();
  let next = first.next;
  while (next !== null) {
    const page = await V.readAuditPage(store, session, { before: next, limit: 3 });
    seen.push(...page.entries);
    next = page.next;
  }
  assert.deepEqual(seen.map((e) => e.seq), Array.from({ length: total }, (_, i) => total - i));
  const last = seen[seen.length - 1];
  assert.equal(last.action + ':' + last.detail, 'create:install');
  assert.ok(seen.some((e) => e.action === 'unlock' && e.detail === 'password'));
  assert.deepEqual(Object.keys(last).sort(), ['action', 'detail', 'kid', 'kind', 'record_id', 'result', 'seq', 'ts', 'version']);
  assert.deepEqual(store, before, 'lezen schrijft niets');
});

test('logboek lezen: een onleesbare regel of een gat is een afwijking (chain)', async () => {
  const { store } = await setup();
  const session = await unlockAndLog(store, { password: PASSWORD });
  await putRecord(store, session, { kind: 'test_persoon', data: { v: 1 } });
  const damaged = clone(store);
  const row = damaged.audit.find((r) => r.seq === 2);
  row.ct = row.ct.slice();
  row.ct[0] ^= 1;
  await expectIntegrity(V.readAuditPage(damaged, session), 'chain');
  const gap = clone(store);
  gap.audit = gap.audit.filter((r) => r.seq !== 2);
  await expectIntegrity(V.readAuditPage(gap, session), 'chain');
  // Wel leesbaar: alleen regels ná de beschadiging.
  const page = await V.readAuditPage(damaged, session, { limit: 1 });
  assert.equal(page.entries.length, 1);
});

// --- Review codebase PR #12, 2: grens aan de schrijvende kant -------------------------

test('back-up boven de grens wordt niet gemaakt; op de grens wel, en dan ook leesbaar', async () => {
  const { store } = await setup();
  const session = await unlockAndLog(store, { password: PASSWORD });
  const file = await V.buildBackupFile(store, session, { now: NOW });
  const size = C.utf8(file).length;
  assert.equal(file.length, size, 'alleen ASCII');
  await assert.rejects(V.buildBackupFile(store, session, { now: NOW, maxBytes: size - 1 }),
    (e) => e instanceof C.FormatError && /256 MiB/.test(e.message));
  const exact = await V.buildBackupFile(store, session, { now: NOW, maxBytes: size });
  assert.equal(C.utf8(exact).length, size);
  await V.inspectBackup(C.utf8(exact), { password: PASSWORD });
});

// --- Taak 7: gelijk aan de export, verify_backup, lezer per formaat ------------------

test('back-up direct na export is gelijk aan de export; verify_backup legt last_backup_at vast', async () => {
  const { store } = await setup();
  const session = await unlockAndLog(store, { password: PASSWORD });
  await putRecord(store, session, { kind: 'test_persoon', data: { naam: SECRET_TEXT } });
  const file = await makeBackup(store, session);
  const result = await V.verifyExportedBackup(store, session, file);
  assert.equal(result.records, 1);
  assert.equal(store.meta.last_backup_at, null);
  const later = new Date(NOW.getTime() + 1000);
  await write(store, session, () => V.verifyBackupTx(store, session, { now: later }));
  assert.equal(store.meta.last_backup_at, later.toISOString());
  const actions = (await auditActions(store, session)).map((c) => c.action + ':' + (c.detail ?? ''));
  assert.deepEqual(actions.slice(-2), ['export:', 'verify_backup:equal']);
  await V.fullCheck(store, session);
  // Na verify_backup verandert de opslag, maar de vergelijking gaat met de
  // momentopname van de export: nog steeds gelijk.
  await V.verifyExportedBackup(store, session, file);
});

test('gelijk aan de export faalt bij een bestand zonder export, van een andere opslag of gewijzigd', async () => {
  const { store } = await setup();
  const session = await unlockAndLog(store, { password: PASSWORD });
  // Zonder export-regel: het controlepunt wijst naar de regel unlock.
  const noExport = C.utf8(await V.buildBackupFile(store, session, { now: NOW }));
  await assert.rejects(V.verifyExportedBackup(store, session, noExport),
    (e) => e instanceof V.BackupMismatchError && /geen export/.test(e.message));

  const other = await setup();
  const otherSession = await unlockAndLog(other.store, { password: PASSWORD });
  const foreign = await makeBackup(other.store, otherSession);
  await assert.rejects(V.verifyExportedBackup(store, session, foreign), V.BackupMismatchError);

  const file = await makeBackup(store, session);
  const before = clone(store);
  const tampered = await tamperBackup(file, session.dataKeys.get(1), (p) => {
    p.audit = p.audit.slice(0, -1);
  });
  // Een beschadigde inhoud is een gewone weigering, geen afwijking van de opslag.
  await assert.rejects(V.verifyExportedBackup(store, session, tampered),
    (e) => e instanceof V.BackupMismatchError && !(e instanceof C.IntegrityError));
  const cut = file.slice(0, file.length - 10);
  await assert.rejects(V.verifyExportedBackup(store, session, cut), V.BackupMismatchError);
  assert.deepEqual(store, before);
});

test('ouder bestand controleren: samenvatting, niets geschreven, verkeerd geheim geweigerd', async () => {
  const { store, recoveryKey } = await setup();
  const session = await unlockAndLog(store, { password: PASSWORD });
  await putRecord(store, session, { kind: 'test_persoon', data: { v: 1 } });
  const file = await makeBackup(store, session);
  const before = clone(store);
  const summary = await V.checkBackupFile(file, { password: PASSWORD });
  assert.deepEqual(Object.keys(summary).sort(), ['appVersion', 'audit', 'createdAt', 'records', 'route']);
  assert.equal(summary.route, 'password');
  assert.equal(summary.records, 1);
  assert.equal(summary.appVersion, '0.1.0');
  assert.equal(summary.createdAt, NOW.toISOString());
  assert.equal((await V.checkBackupFile(file, { recoveryKey })).route, 'recovery');
  await assert.rejects(V.checkBackupFile(file, { password: PASSWORD2 }), C.WrongSecretError);
  assert.deepEqual(store, before);
});

test('back-up van een onbekend (nieuwer) formaat geeft een eigen melding', async () => {
  const { store } = await setup();
  const session = await unlockAndLog(store, { password: PASSWORD });
  const text = new TextDecoder().decode(await makeBackup(store, session));
  const newer = C.utf8(text.replace('"format":1', '"format":2'));
  await assert.rejects(V.restoreTx(newer, { password: PASSWORD }, { now: NOW }),
    (e) => e instanceof V.UnknownBackupFormatError && e.format === 2);
  await assert.rejects(V.checkBackupFile(newer, { password: PASSWORD }), V.UnknownBackupFormatError);
  // Geen bruikbaar nummer: gewone weigering door de strikte lezer.
  const broken = C.utf8(text.replace('"format":1', '"format":"1"'));
  await assert.rejects(V.restoreTx(broken, { password: PASSWORD }, { now: NOW }),
    (e) => e instanceof C.FormatError && !(e instanceof V.UnknownBackupFormatError));
});

// --- Stap D1: PBKDF2-standaard en KDF-upgrade (§12.2 stap 6) -----------------------------

test('nieuwe wraps met DEFAULT_ITERATIONS (2.000.000): installatie en wachtwoord wijzigen', async () => {
  assert.equal(C.DEFAULT_ITERATIONS, 2000000);
  assert.equal(C.MIN_ITERATIONS, 600000);
  // Echte standaard: geen iterations meegegeven, zoals de app (issue #26).
  const store = V.emptyStore();
  V.applyTx(store, (await V.createInstallation({ password: PASSWORD, now: NOW })).tx);
  assert.equal(store.meta.kdf.iterations, 2000000);
  const session = await unlockAndLog(store, { password: PASSWORD });
  await write(store, session, () => V.changePasswordTx(store, session,
    { current: { password: PASSWORD }, newPassword: PASSWORD2, now: NOW }));
  assert.equal(store.meta.kdf.iterations, 2000000);
  assert.equal(V.needsKdfUpgrade(store.meta, session, PASSWORD2), false);
});

test('iterations in tests: minimum toegestaan, buiten de grenzen van het formaat geweigerd (issue #26)', async () => {
  const { store } = await setup();
  assert.equal(store.meta.kdf.iterations, TEST_ITERATIONS);
  const { session } = await V.unlock(store, { password: PASSWORD });
  assert.equal(V.needsKdfUpgrade(store.meta, session, PASSWORD, TEST_ITERATIONS), false, 'test-drempel: geen upgrade');
  assert.equal(V.needsKdfUpgrade(store.meta, session, PASSWORD), true, 'echte standaard: wel upgrade');
  for (const bad of [C.MIN_ITERATIONS - 1, C.MAX_ITERATIONS + 1, 1000, 1.5]) {
    await assert.rejects(V.createInstallation({ password: PASSWORD, now: NOW, iterations: bad }), C.FormatError, String(bad));
  }
});

test('KDF-upgrade in de unlock-transactie: 600.000 wordt 2.000.000, zelfde wachtwoord, één transactie', async () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/testbestand-formaat-1.json', import.meta.url), 'utf8'));
  const store = V.emptyStore();
  V.applyTx(store, (await V.restoreTx(C.utf8(fixture.bestand), { password: fixture.wachtwoord }, { now: NOW })).tx);
  assert.equal(store.meta.kdf.iterations, 600000);
  const recoveryBefore = structuredClone(store.meta.recovery);
  const { session } = await V.unlock(store, { password: fixture.wachtwoord });
  assert.equal(V.needsKdfUpgrade(store.meta, session, fixture.wachtwoord), true);
  assert.equal(V.needsKdfUpgrade(store.meta, session, undefined), false);
  const tx = await write(store, session, () => V.unlockTx(store, session, { now: NOW, password: fixture.wachtwoord }));
  assert.equal(tx.putMeta.kdf.iterations, 2000000, 'wrap en logregels in dezelfde transactie');
  assert.equal(store.meta.kdf.iterations, 2000000);
  assert.deepEqual(store.meta.recovery, recoveryBefore, 'herstelsleutel ongewijzigd');
  const s2 = await unlockAndLog(store, { password: fixture.wachtwoord });
  await V.fullCheck(store, s2);
  const s3 = await unlockAndLog(store, { recoveryKey: fixture.herstelsleutel });
  const log = (await auditActions(store, s3)).map((c) => c.action + ':' + c.detail);
  assert.deepEqual(log.slice(-4), ['unlock:password', 'password_change:kdf_upgrade', 'unlock:password', 'unlock:recovery']);
  assert.equal(log.filter((x) => x === 'password_change:kdf_upgrade').length, 1);
});

test('geen KDF-upgrade bij de herstelsleutel', async () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/testbestand-formaat-1.json', import.meta.url), 'utf8'));
  const store = V.emptyStore();
  V.applyTx(store, (await V.restoreTx(C.utf8(fixture.bestand), { password: fixture.wachtwoord }, { now: NOW })).tx);
  const { session } = await V.unlock(store, { recoveryKey: fixture.herstelsleutel });
  assert.equal(V.needsKdfUpgrade(store.meta, session, 'wat dan ook hier'), false);
  await write(store, session, () => V.unlockTx(store, session, { now: NOW }));
  assert.equal(store.meta.kdf.iterations, 600000);
});

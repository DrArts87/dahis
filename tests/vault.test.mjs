// Tests van de bewerkingen van formaat 1 in het geheugen (app/js/vault.js).
// Alleen verzonnen gegevens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../app/js/crypto.js';
import * as V from '../app/js/vault.js';

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
  const { tx, session, recoveryKey } = await V.createInstallation({ password: PASSWORD, now: NOW });
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
    { current: { recoveryKey }, newPassword: PASSWORD2, detail: 'recovery', now: NOW }));
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
  V.applyTx(target, (await V.restoreTx(file, { recoveryKey }, { newPassword: PASSWORD2, now: NOW })).tx);
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
    'iterations gewijzigd': line1.replace('"iterations":600000', '"iterations":600001') + '\n' + line2 + '\n',
    'extra regel': text + 'x\n',
    'zonder afsluitende regel': text.slice(0, -1),
    'BOM': '﻿' + text,
    'CRLF': text.replace(/\n/g, '\r\n'),
  };
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
  const { tx, recoveryKey } = await V.rotateKeysTx(store, session, { current: { password: PASSWORD }, newPassword: PASSWORD2, now: NOW });
  V.applyTx(store, tx);
  assert.equal(store.meta.epoch, 2);
  await assert.rejects(V.unlock(store, { password: PASSWORD }), C.WrongSecretError);
  session = await unlockAndLog(store, { password: PASSWORD2 });
  assert.equal((await V.readRecord(store, session, id)).content.data.v, 1);
  await putRecord(store, session, { kind: 'test_persoon', data: { v: 2 } });
  await V.fullCheck(store, session);

  const file = await makeBackup(store, session);
  const target = V.emptyStore();
  V.applyTx(target, (await V.restoreTx(file, { recoveryKey }, { newPassword: PASSWORD, now: NOW })).tx);
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

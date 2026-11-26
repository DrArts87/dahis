// Tests van de schrijfwachtrij en de voorwaarden van de kluis (audit A1, A2,
// A4) met een opslag in het geheugen. IndexedDB zelf: tests/browser.html.
// Alleen verzonnen gegevens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../app/js/crypto.js';
import * as V from '../app/js/vault.js';
import { TEST_ITERATIONS } from './helpers/kluis.mjs';
import { MemoryBackend, WriteQueue } from '../app/js/store.js';

const PASSWORD = 'correct paard batterij nietje';
const PASSWORD2 = 'een heel ander wachtwoord 2';
const T0 = new Date('2026-11-25T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

function clockAt(start) {
  const c = { now: new Date(start) };
  c.fn = () => new Date(c.now);
  c.advance = (ms) => { c.now = new Date(c.now.getTime() + ms); };
  return c;
}

async function install(clock) {
  const backend = new MemoryBackend();
  const queue = new WriteQueue(backend, { clock: clock.fn });
  const { tx } = await V.createInstallation({ password: PASSWORD, now: clock.fn(), iterations: TEST_ITERATIONS });
  await queue.runPlain(() => tx);
  return { backend, queue };
}

async function unlock(backend, queue, secret = { password: PASSWORD }) {
  const { session } = await V.unlock(backend.store, secret);
  await queue.run(session, (store, s, now) => V.unlockTx(store, s, { now }));
  return session;
}

function putRecord(queue, session, data) {
  return queue.run(session, (store, s, now) => V.putRecordTx(store, s, { kind: 'test_persoon', data, now }));
}

async function actions(store, session) {
  const rows = store.audit.slice().sort((a, b) => a.seq - b.seq);
  const out = [];
  let hPrev = C.ZERO_HASH;
  for (const row of rows) {
    out.push((await C.openAudit((await session.subkeys(row.kid)).audit, session.epochOf(row.kid), row, hPrev)).action);
    hPrev = row.h;
  }
  return out;
}

test('termijn niet verstreken: geen volledige controle, geen integrity_check', async () => {
  const clock = clockAt(T0);
  const { backend, queue } = await install(clock);
  clock.advance(6 * DAY);
  const session = await unlock(backend, queue);
  await putRecord(queue, session, { v: 1 });
  assert.deepEqual(await actions(backend.store, session), ['create', 'unlock', 'create']);
});

test('termijn verstreken bij ontgrendelen: controle vóór de eerste schrijfactie, en gelogd', async () => {
  const clock = clockAt(T0);
  const { backend, queue } = await install(clock);
  clock.advance(7 * DAY);
  const { session } = await V.unlock(backend.store, { password: PASSWORD });
  assert.equal(V.fullCheckDue(session, clock.fn()), true);
  // Zonder de wachtrij weigert de kluis zelf.
  await assert.rejects(V.unlockTx(backend.store, session, { now: clock.fn() }), V.FullCheckDueError);
  await queue.run(session, (store, s, now) => V.unlockTx(store, s, { now }));
  assert.deepEqual(await actions(backend.store, session), ['create', 'unlock', 'integrity_check']);
  assert.equal(V.fullCheckDue(session, clock.fn()), false);
  // Na de regel telt de termijn opnieuw, ook na opnieuw ontgrendelen.
  clock.advance(DAY);
  const s2 = await unlock(backend, queue);
  assert.equal(V.fullCheckDue(s2, clock.fn()), false);
});

test('sessie loopt over de termijn heen: controle vóór de volgende schrijfactie', async () => {
  const clock = clockAt(T0);
  const { backend, queue } = await install(clock);
  const session = await unlock(backend, queue);
  clock.advance(8 * DAY);
  await putRecord(queue, session, { v: 1 });
  const list = await actions(backend.store, session);
  assert.deepEqual(list.slice(-2), ['create', 'integrity_check']);
});

test('klok teruggezet: controle is verschuldigd', async () => {
  const clock = clockAt(T0);
  const { backend } = await install(clock);
  const { session } = await V.unlock(backend.store, { password: PASSWORD });
  assert.equal(V.fullCheckDue(session, new Date(T0.getTime() - DAY)), true);
});

test('verschuldigde controle die schade vindt: opslag ongewijzigd, wachtrij gestopt', async () => {
  const clock = clockAt(T0);
  const { backend, queue } = await install(clock);
  let session = await unlock(backend, queue);
  await putRecord(queue, session, { v: 1 });
  await putRecord(queue, session, { v: 2 });
  // Oudere auditregel beschadigen, h ongewijzigd (snelle controle ziet het niet).
  const rows = backend.disk.audit.slice().sort((a, b) => a.seq - b.seq);
  const target = rows[1];
  const ct = target.ct.slice();
  ct[0] ^= 1;
  backend.disk.audit = backend.disk.audit.map((r) => (r === target ? Object.assign({}, r, { ct }) : r));
  await backend.reload();
  clock.advance(8 * DAY);
  ({ session } = await V.unlock(backend.store, { password: PASSWORD }));
  const before = structuredClone(backend.disk);
  await assert.rejects(queue.run(session, (store, s, now) => V.unlockTx(store, s, { now })),
    (err) => err instanceof C.IntegrityError && err.code === 'chain');
  assert.deepEqual(backend.disk, before);
  await assert.rejects(putRecord(queue, session, { v: 3 }), C.IntegrityError);
  assert.deepEqual(backend.disk, before);
});

async function expectNewWriteKey(mutate) {
  const clock = clockAt(T0);
  const { backend, queue } = await install(clock);
  const s1 = await unlock(backend, queue);
  const oldKid = s1.kid;
  const oldSalts = backend.disk.meta.write_keys.map((w) => C.b64(w.salt));
  mutate(backend.disk.meta, s1);
  await backend.reload();
  const { session } = await V.unlock(backend.store, { password: PASSWORD });
  assert.equal(session.needsNewWriteKey, true);
  await queue.run(session, (store, s, now) => V.unlockTx(store, s, { now }));
  assert.equal(session.kid, oldKid + 1);
  const fresh = backend.disk.meta.write_keys.find((w) => w.kid === session.kid);
  assert.ok(!oldSalts.includes(C.b64(fresh.salt)));
  assert.equal(backend.disk.meta.reservation.kid, session.kid);
  // Alles na het ontgrendelen is met de nieuwe sleutel versleuteld.
  const last = backend.disk.audit.reduce((a, b) => (a.seq > b.seq ? a : b));
  assert.equal(last.kid, session.kid);
  const list = await actions(backend.store, session);
  assert.deepEqual(list.slice(-2), ['write_key', 'unlock']);
  await V.fullCheck(backend.store, session);
  const s3 = await unlock(backend, queue);
  assert.equal(s3.needsNewWriteKey, false);
}

test('A2: reservering met ongeldige HMAC geeft een nieuwe schrijfsleutel', async () => {
  await expectNewWriteKey((meta) => {
    const mac = meta.reservation.mac.slice();
    mac[0] ^= 1;
    meta.reservation = Object.assign({}, meta.reservation, { mac });
  });
});

test('A2: ontbrekende reservering geeft een nieuwe schrijfsleutel', async () => {
  await expectNewWriteKey((meta) => { delete meta.reservation; });
});

test('A2: reservering van een oudere schrijfsleutel geeft een nieuwe schrijfsleutel', async () => {
  const clock = clockAt(T0);
  const { backend, queue } = await install(clock);
  const s1 = await unlock(backend, queue);
  const oldReservation = backend.disk.meta.reservation;
  await queue.run(s1, (store, s, now) => V.rollWriteKey(store, s, { now }));
  assert.equal(s1.kid, oldReservation.kid + 1);
  backend.disk.meta.reservation = oldReservation;   // geldige mac, oudere kid
  await backend.reload();
  const { session } = await V.unlock(backend.store, { password: PASSWORD });
  assert.equal(session.needsNewWriteKey, true);
  await queue.run(session, (store, s, now) => V.unlockTx(store, s, { now }));
  assert.equal(session.kid, s1.kid + 1);
  await V.fullCheck(backend.store, session);
});

test('A2: reservering met onbekende kid blijft een afwijking (keys)', async () => {
  const clock = clockAt(T0);
  const { backend, queue } = await install(clock);
  await unlock(backend, queue);
  backend.disk.meta.reservation = Object.assign({}, backend.disk.meta.reservation, { kid: 99 });
  await backend.reload();
  await assert.rejects(V.unlock(backend.store, { password: PASSWORD }),
    (err) => err instanceof C.IntegrityError && err.code === 'keys');
});

test('A4: sleutels vernieuwen weigert het huidige wachtwoord', async () => {
  const clock = clockAt(T0);
  const { backend, queue } = await install(clock);
  const session = await unlock(backend, queue);
  const before = structuredClone(backend.disk);
  await assert.rejects(queue.run(session, async (store, s, now) => (await V.rotateKeysTx(store, s, {
    current: { password: PASSWORD }, newPassword: PASSWORD.normalize('NFD'), now, iterations: TEST_ITERATIONS,
  })).tx), V.PasswordReuseError);
  assert.deepEqual(backend.disk, before);
  let recoveryKey;
  await queue.run(session, async (store, s, now) => {
    const r = await V.rotateKeysTx(store, s, { current: { password: PASSWORD }, newPassword: PASSWORD2, now, iterations: TEST_ITERATIONS });
    recoveryKey = r.recoveryKey;
    return r.tx;
  });
  assert.equal(backend.disk.meta.epoch, 2);
  assert.ok(recoveryKey);
  await unlock(backend, queue, { password: PASSWORD2 });
});

test('mislukte pogingen: unlock_failed in de eerste schrijvende transactie', async () => {
  const clock = clockAt(T0);
  const { backend, queue } = await install(clock);
  await assert.rejects(V.unlock(backend.store, { password: PASSWORD2 }), C.WrongSecretError);
  await queue.runPlain((store, now) => V.failedUnlockTx(store, now));
  await queue.runPlain((store, now) => V.failedUnlockTx(store, now));
  // Zonder reservering is een nieuwe schrijfsleutel de eerste schrijfactie.
  delete backend.disk.meta.reservation;
  await backend.reload();
  const { session } = await V.unlock(backend.store, { password: PASSWORD });
  await queue.run(session, (store, s, now) => V.unlockTx(store, s, { now }));
  assert.deepEqual(await actions(backend.store, session), ['create', 'unlock_failed', 'write_key', 'unlock']);
  assert.equal(backend.disk.meta.failed_unlocks.count, 0);
});

test('wachtrij: schrijfacties lopen één voor één, in volgorde', async () => {
  const clock = clockAt(T0);
  const { backend, queue } = await install(clock);
  const session = await unlock(backend, queue);
  const order = [];
  const jobs = [1, 2, 3, 4, 5].map((v) => queue.run(session, async (store, s, now) => {
    order.push('start ' + v);
    const tx = await V.putRecordTx(store, s, { kind: 'test_persoon', data: { v }, now });
    order.push('klaar ' + v);
    return tx;
  }));
  await Promise.all(jobs);
  assert.deepEqual(order, [1, 2, 3, 4, 5].flatMap((v) => ['start ' + v, 'klaar ' + v]));
  assert.equal(backend.disk.records.length, 5);
  await V.fullCheck(backend.store, session);
});

test('wachtrij: een mislukte schrijfactie houdt de volgende niet tegen', async () => {
  const clock = clockAt(T0);
  const { backend, queue } = await install(clock);
  const session = await unlock(backend, queue);
  const bad = queue.run(session, async () => { throw new Error('mislukt'); });
  const good = putRecord(queue, session, { v: 1 });
  await assert.rejects(bad, /mislukt/);
  await good;
  assert.equal(backend.disk.records.length, 1);
});

test('wachtrij: conflict stopt de wachtrij en verandert niets', async () => {
  const clock = clockAt(T0);
  const { backend, queue } = await install(clock);
  const session = await unlock(backend, queue);
  // Een andere schrijver verandert het controlepunt.
  const other = new MemoryBackend(backend.disk);
  const s2 = await unlock(other, new WriteQueue(other, { clock: clock.fn }));
  assert.ok(s2);
  const before = structuredClone(backend.disk);
  await assert.rejects(putRecord(queue, session, { v: 1 }), V.ConflictError);
  assert.deepEqual(backend.disk, before);
  await assert.rejects(putRecord(queue, session, { v: 2 }), V.ConflictError);
});

test('reservering raakt op: de wachtrij legt eerst een nieuwe vast', async () => {
  const clock = clockAt(T0);
  const { backend, queue } = await install(clock);
  const session = await unlock(backend, queue);
  session.until = session.counter + V.PRELUDE_HEADROOM - 1;   // bijna op
  const before = backend.disk.meta.reservation.until;
  await putRecord(queue, session, { v: 1 });
  assert.ok(backend.disk.meta.reservation.until > before);
  assert.ok(session.counter <= backend.disk.meta.reservation.until);
});

test('volledige controle op verzoek schrijft integrity_check', async () => {
  const clock = clockAt(T0);
  const { backend, queue } = await install(clock);
  const session = await unlock(backend, queue);
  await queue.run(session, (store, s, now) => V.integrityCheckTx(store, s, { now }));
  assert.deepEqual((await actions(backend.store, session)).slice(-1), ['integrity_check']);
});

test('review PR #9: vervangen controlepunt met dezelfde kid valt op bij de verschuldigde controle', async () => {
  const clock = clockAt(T0);
  const { backend, queue } = await install(clock);
  const session = await unlock(backend, queue);
  await putRecord(queue, session, { v: 1 });
  const older = backend.disk.meta.checkpoint;          // geldig, zelfde kid
  await putRecord(queue, session, { v: 2 });
  assert.equal(older.kid, backend.disk.meta.checkpoint.kid);
  backend.disk.meta.checkpoint = older;
  const before = structuredClone(backend.disk);
  clock.advance(8 * DAY);                               // controle verschuldigd: wachtrij leest opnieuw in
  await assert.rejects(putRecord(queue, session, { v: 3 }),
    (err) => err instanceof C.IntegrityError && err.code === 'checkpoint');
  assert.deepEqual(backend.disk, before);
  await assert.rejects(putRecord(queue, session, { v: 4 }), C.IntegrityError);
  assert.deepEqual(backend.disk, before);
});

test('review PR #9: snelle en volledige controle authenticeren het opgeslagen controlepunt', async () => {
  const clock = clockAt(T0);
  const { backend, queue } = await install(clock);
  const session = await unlock(backend, queue);
  await putRecord(queue, session, { v: 1 });
  const older = backend.store.meta.checkpoint;
  await putRecord(queue, session, { v: 2 });
  await V.quickCheck(backend.store, session);
  backend.store.meta.checkpoint = older;
  await assert.rejects(V.quickCheck(backend.store, session), (err) => err instanceof C.IntegrityError && err.code === 'checkpoint');
  await assert.rejects(V.fullCheck(backend.store, session), (err) => err instanceof C.IntegrityError && err.code === 'checkpoint');
  // De back-upvariant is niet van buiten te kiezen.
  await assert.rejects(V.quickCheck(backend.store, session, { backup: true }), (err) => err instanceof C.IntegrityError && err.code === 'checkpoint');
  await assert.rejects(V.fullCheck(backend.store, session, { backup: true }), (err) => err instanceof C.IntegrityError && err.code === 'checkpoint');
  assert.equal(session.fullCheckPending, false);
});

test('review PR #9: zonder geldige reservering weigert de kluis ook buiten de wachtrij', async () => {
  const clock = clockAt(T0);
  const { backend, queue } = await install(clock);
  await unlock(backend, queue);
  delete backend.disk.meta.reservation;
  await backend.reload();
  const { session } = await V.unlock(backend.store, { password: PASSWORD });
  assert.equal(session.needsNewWriteKey, true);
  await assert.rejects(V.prepareReservation(backend.store, session, 10), V.WriteKeyNeededError);
  await assert.rejects(V.putRecordTx(backend.store, session, { kind: 'test_persoon', data: { v: 1 }, now: clock.fn() }), V.WriteKeyNeededError);
  await assert.rejects(V.unlockTx(backend.store, session, { now: clock.fn() }), V.WriteKeyNeededError);
  const counter = session.counter;
  // Een niet toegepaste nieuwe schrijfsleutel laat de eis staan.
  await V.rollWriteKey(backend.store, session, { now: clock.fn() });
  assert.equal(session.needsNewWriteKey, true);
  assert.equal(session.counter, counter);
  V.applyTx(backend.store, await V.rollWriteKey(backend.store, session, { now: clock.fn() }));
  assert.equal(session.needsNewWriteKey, false);
  assert.ok(await V.prepareReservation(backend.store, session, 1 << 17));
});

// Browsertests van app/js/store.js op echte IndexedDB (tests/browser.html).
// Alleen verzonnen gegevens; elke test gebruikt een eigen database.
//
// Met ?alleen=hulp draaien de tests niet en staan alleen de hulpfuncties in
// window.dahisTest klaar (herladen midden in een schrijfactie, twee
// tabbladen); een stuurscript buiten de repository gebruikt die.
import * as C from '../app/js/crypto.js';
import * as V from '../app/js/vault.js';
import {
  IdbBackend, WriteQueue, StoreError, AlreadyOpenError,
  acquireLock, openStorage, storageStatus,
} from '../app/js/store.js';
import * as S from '../app/js/signature.js';

const PASSWORD = 'correct paard batterij nietje';
const PASSWORD2 = 'een heel ander wachtwoord 2';
const SECRET_TEXT = 'Testpersoon Jansen';
const T0 = new Date('2026-11-25T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const RUN = Date.now().toString(36);
let counter = 0;

function dbName(label) {
  counter += 1;
  return 'dahis-test-' + RUN + '-' + counter + '-' + label;
}

function assert(cond, message) {
  if (!cond) throw new Error('Mislukt: ' + message);
}

async function rejects(promise, check, message) {
  try {
    await promise;
  } catch (err) {
    if (!check(err)) throw new Error('Verkeerde fout bij ' + message + ': ' + err.name + ': ' + err.message);
    return err;
  }
  throw new Error('Geen fout bij ' + message);
}

// Canonieke tekst van een opslag, om twee toestanden te vergelijken.
function canon(store) {
  const conv = (v) => {
    if (v instanceof Uint8Array) return 'b64:' + C.b64(v);
    if (Array.isArray(v)) return v.map(conv);
    if (v && typeof v === 'object') {
      const out = {};
      for (const k of Object.keys(v).sort()) out[k] = conv(v[k]);
      return out;
    }
    return v;
  };
  const records = store.records.slice().sort((a, b) => (a.id + ':' + a.version < b.id + ':' + b.version ? -1 : 1));
  const audit = store.audit.slice().sort((a, b) => a.seq - b.seq);
  return JSON.stringify(conv({ meta: store.meta, records, audit }));
}

async function dump(name) {
  const b = await IdbBackend.open(name);
  try {
    return canon(b.store);
  } finally {
    b.close();
  }
}

function clockAt(start) {
  const c = { now: new Date(start) };
  c.fn = () => new Date(c.now);
  c.advance = (ms) => { c.now = new Date(c.now.getTime() + ms); };
  return c;
}

async function install(name, clock = clockAt(T0)) {
  const backend = await IdbBackend.open(name);
  const queue = new WriteQueue(backend, { clock: clock.fn });
  const r = await V.createInstallation({ password: PASSWORD, now: clock.fn() });
  await queue.runPlain(() => r.tx);
  return { backend, queue, clock, recoveryKey: r.recoveryKey, session: r.session };
}

async function unlock(backend, queue, secret = { password: PASSWORD }) {
  const { session } = await V.unlock(backend.store, secret);
  await queue.run(session, (store, s, now) => V.unlockTx(store, s, { now }));
  return session;
}

function putRecord(queue, session, data, id) {
  return queue.run(session, (store, s, now) => V.putRecordTx(store, s, { id, kind: 'test_persoon', data, now }));
}

async function reopen(name, clock) {
  const backend = await IdbBackend.open(name);
  return { backend, queue: new WriteQueue(backend, { clock: clock.fn }) };
}

function contains(haystack, needle) {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

const abortHook = { afterWrite: (t) => t.abort() };

// --- Tests ---------------------------------------------------------------------

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('end-to-end: onboarding, ontgrendelen, schrijven, vergrendelen, back-up, wissen, terugzetten', async () => {
  const name = dbName('e2e');
  let { backend, queue, clock, recoveryKey } = await install(name);
  backend.close();

  ({ backend, queue } = await reopen(name, clock));
  let session = await unlock(backend, queue);
  const id = (await putRecord(queue, session, { naam: SECRET_TEXT })).putRecords[0].id;
  await putRecord(queue, session, { naam: SECRET_TEXT, v: 2 }, id);
  backend.close();                                     // vergrendelen: alles uit het geheugen

  ({ backend, queue } = await reopen(name, clock));
  session = await unlock(backend, queue);
  assert((await V.readRecord(backend.store, session, id)).content.data.v === 2, 'nieuwste versie gelezen');
  await V.fullCheck(backend.store, session);

  const raw = C.utf8(canon(backend.store));
  assert(!contains(raw, C.utf8(SECRET_TEXT)), 'testwaarde niet leesbaar in IndexedDB');

  await queue.run(session, (store, s, now) => V.exportTx(store, s, { now }));
  const file = C.utf8(await V.buildBackupFile(backend.store, session, { now: clock.fn(), appVersion: '0.1.0' }));
  assert(!contains(file, C.utf8(SECRET_TEXT)), 'testwaarde niet leesbaar in de back-up');
  backend.close();
  await IdbBackend.deleteDatabase(name);              // alles wissen
  assert((await dump(name)) === canon(V.emptyStore()), 'opslag leeg na wissen');

  // Terugzetten met het wachtwoord.
  ({ backend, queue } = await reopen(name, clock));
  await queue.runPlain(async (store, now) => (await V.restoreTx(file, { password: PASSWORD }, { now })).tx);
  backend.close();
  ({ backend, queue } = await reopen(name, clock));
  session = await unlock(backend, queue);
  assert((await V.readRecord(backend.store, session, id)).content.data.v === 2, 'record na terugzetten');
  await V.fullCheck(backend.store, session);
  backend.close();

  // Terugzetten met de herstelsleutel op een andere lege opslag, nieuw wachtwoord.
  const other = dbName('herstel');
  ({ backend, queue } = await reopen(other, clock));
  await rejects(V.restoreTx(file, { recoveryKey }, { now: clock.fn() }), (e) => e instanceof C.FormatError, 'herstel zonder nieuw wachtwoord');
  await queue.runPlain(async (store, now) => (await V.restoreTx(file, { recoveryKey }, { newPassword: PASSWORD2, now })).tx);
  backend.close();
  ({ backend, queue } = await reopen(other, clock));
  await rejects(V.unlock(backend.store, { password: PASSWORD }), (e) => e instanceof C.WrongSecretError, 'oud wachtwoord');
  session = await unlock(backend, queue, { password: PASSWORD2 });
  await V.fullCheck(backend.store, session);
  backend.close();
  await IdbBackend.deleteDatabase(name);
  await IdbBackend.deleteDatabase(other);
});

test('Web Lock: een tweede opening krijgt "Dahis is al geopend"', async () => {
  const lockName = 'dahis-test-slot-' + RUN;
  const first = await acquireLock(lockName);
  assert(first, 'eerste slot');
  assert((await acquireLock(lockName)) === null, 'tweede slot geweigerd');
  await rejects(openStorage({ name: dbName('slot'), lockName }), (e) => e instanceof AlreadyOpenError && e.message === 'Dahis is al geopend', 'openStorage');
  await first.release();
  const name = dbName('slot');
  const opened = await openStorage({ name, lockName });
  await opened.close();
  await IdbBackend.deleteDatabase(name);
});

test('append-only: een bestaande auditregel overschrijven breekt de transactie af', async () => {
  const name = dbName('append');
  const { backend, queue } = await install(name);
  const session = await unlock(backend, queue);
  const before = await dump(name);
  const tx = await V.putRecordTx(backend.store, session, { kind: 'test_persoon', data: { v: 1 }, now: T0 });
  tx.putAudit = tx.putAudit.map((a) => Object.assign({}, a, { seq: 1 }));
  await rejects(backend.commit(tx), (e) => e instanceof StoreError, 'add op bestaande seq');
  assert((await dump(name)) === before, 'opslag ongewijzigd');
  assert(canon(backend.store) === before, 'kopie in het geheugen ongewijzigd');
  backend.close();
  await IdbBackend.deleteDatabase(name);
});

test('onderbreking bij onboarding: opslag blijft leeg, nieuwe poging met nieuwe salt', async () => {
  const name = dbName('onboarding');
  const backend = await IdbBackend.open(name);
  const queue = new WriteQueue(backend);
  const first = await V.createInstallation({ password: PASSWORD, now: T0 });
  backend.testHooks = abortHook;
  await rejects(queue.runPlain(() => first.tx), (e) => e instanceof StoreError, 'afgebroken onboarding');
  backend.testHooks = null;
  assert((await dump(name)) === canon(V.emptyStore()), 'opslag leeg');
  const second = await V.createInstallation({ password: PASSWORD, now: T0 });
  await queue.runPlain(() => second.tx);
  const salt = (tx) => C.b64(tx.putMeta.write_keys[0].salt);
  assert(salt(first.tx) !== salt(second.tx), 'nieuwe salt');
  backend.close();
  const again = await reopen(name, clockAt(T0));
  const session = await unlock(again.backend, again.queue);
  await V.fullCheck(again.backend.store, session);
  again.backend.close();
  await IdbBackend.deleteDatabase(name);
});

test('onderbreking bij een schrijfactie: opslag ongewijzigd, volgende poging slaagt', async () => {
  const name = dbName('schrijven');
  let { backend, queue, clock } = await install(name);
  let session = await unlock(backend, queue);
  const before = await dump(name);
  const counter = session.counter;
  backend.testHooks = abortHook;
  await rejects(putRecord(queue, session, { v: 1 }), (e) => e instanceof StoreError, 'afgebroken schrijfactie');
  backend.testHooks = null;
  assert((await dump(name)) === before, 'opslag ongewijzigd');
  assert(canon(backend.store) === before, 'kopie in het geheugen ongewijzigd');
  assert(session.counter > counter, 'tellerplaatsen blijven verbruikt');
  await putRecord(queue, session, { v: 2 });
  backend.close();
  ({ backend, queue } = await reopen(name, clock));
  session = await unlock(backend, queue);
  assert(backend.store.records.length === 1, 'precies één record');
  await V.fullCheck(backend.store, session);
  backend.close();
  await IdbBackend.deleteDatabase(name);
});

test('onderbreking bij terugzetten: opslag blijft leeg, nieuwe poging met nieuwe salt', async () => {
  const src = dbName('bron');
  const { backend, queue, clock } = await install(src);
  const session = await unlock(backend, queue);
  await putRecord(queue, session, { v: 1 });
  await queue.run(session, (store, s, now) => V.exportTx(store, s, { now }));
  const file = C.utf8(await V.buildBackupFile(backend.store, session, { now: clock.fn() }));
  backend.close();

  const name = dbName('terugzetten');
  const target = await reopen(name, clock);
  const first = await V.restoreTx(file, { password: PASSWORD }, { now: clock.fn() });
  target.backend.testHooks = abortHook;
  await rejects(target.queue.runPlain(() => first.tx), (e) => e instanceof StoreError, 'afgebroken terugzetten');
  target.backend.testHooks = null;
  assert((await dump(name)) === canon(V.emptyStore()), 'opslag leeg');
  const second = await V.restoreTx(file, { password: PASSWORD }, { now: clock.fn() });
  await target.queue.runPlain(() => second.tx);
  const newest = (tx) => tx.putMeta.write_keys[tx.putMeta.write_keys.length - 1];
  assert(C.b64(newest(first.tx).salt) !== C.b64(newest(second.tx).salt), 'nieuwe salt');
  target.backend.close();
  const again = await reopen(name, clock);
  const s = await unlock(again.backend, again.queue);
  await V.fullCheck(again.backend.store, s);
  again.backend.close();
  await IdbBackend.deleteDatabase(src);
  await IdbBackend.deleteDatabase(name);
});

test('terugzetten op een niet-lege opslag wordt geweigerd', async () => {
  const name = dbName('nietleeg');
  const { backend, queue, clock } = await install(name);
  const session = await unlock(backend, queue);
  await queue.run(session, (store, s, now) => V.exportTx(store, s, { now }));
  const file = C.utf8(await V.buildBackupFile(backend.store, session, { now: clock.fn() }));
  const before = await dump(name);
  const { tx } = await V.restoreTx(file, { password: PASSWORD }, { now: clock.fn() });
  await rejects(backend.commit(tx), (e) => e instanceof V.ConflictError, 'niet-lege opslag');
  assert((await dump(name)) === before, 'opslag ongewijzigd');
  backend.close();
  await IdbBackend.deleteDatabase(name);
});

test('verschuldigde volledige controle met schade in IndexedDB: opslag ongewijzigd', async () => {
  const name = dbName('schade');
  let { backend, queue, clock } = await install(name);
  let session = await unlock(backend, queue);
  await putRecord(queue, session, { v: 1 });
  await putRecord(queue, session, { v: 2 });
  backend.close();
  // Oudere auditregel beschadigen; h blijft gelijk.
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  await new Promise((resolve, reject) => {
    const t = db.transaction('audit', 'readwrite');
    const s = t.objectStore('audit');
    const req = s.get(2);
    req.onsuccess = () => {
      const row = req.result;
      row.ct = row.ct.slice();
      row.ct[0] ^= 1;
      s.put(row);
    };
    t.oncomplete = resolve;
    t.onabort = () => reject(t.error);
  });
  db.close();
  const before = await dump(name);
  clock.advance(8 * DAY);
  ({ backend, queue } = await reopen(name, clock));
  ({ session } = await V.unlock(backend.store, { password: PASSWORD }));   // snelle controle slaagt
  await rejects(queue.run(session, (store, s, now) => V.unlockTx(store, s, { now })),
    (e) => e instanceof C.IntegrityError && e.code === 'chain', 'verschuldigde controle');
  await rejects(putRecord(queue, session, { v: 3 }), (e) => e instanceof C.IntegrityError, 'wachtrij gestopt');
  backend.close();
  assert((await dump(name)) === before, 'opslag ongewijzigd');
  await IdbBackend.deleteDatabase(name);
});

test('vervangen controlepunt (zelfde kid) in IndexedDB: verschuldigde controle weigert, opslag ongewijzigd', async () => {
  const name = dbName('controlepunt');
  const { backend, queue, clock } = await install(name);
  const session = await unlock(backend, queue);
  await putRecord(queue, session, { v: 1 });
  const older = backend.store.meta.checkpoint;          // geldig, zelfde kid
  await putRecord(queue, session, { v: 2 });
  assert(older.kid === backend.store.meta.checkpoint.kid, 'zelfde kid');
  // Buiten de sessie om het oudere controlepunt terugzetten.
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  await new Promise((resolve, reject) => {
    const t = db.transaction('meta', 'readwrite');
    t.objectStore('meta').put(older, 'checkpoint');
    t.oncomplete = resolve;
    t.onabort = () => reject(t.error);
  });
  db.close();
  const before = await dump(name);
  clock.advance(8 * DAY);                               // de wachtrij leest de opslag opnieuw in
  await rejects(putRecord(queue, session, { v: 3 }),
    (e) => e instanceof C.IntegrityError && e.code === 'checkpoint', 'vervangen controlepunt');
  await rejects(putRecord(queue, session, { v: 4 }), (e) => e instanceof C.IntegrityError, 'wachtrij gestopt');
  backend.close();
  assert((await dump(name)) === before, 'opslag ongewijzigd');
  await IdbBackend.deleteDatabase(name);
});

test('vernietigen verwijdert alle versies uit IndexedDB', async () => {
  const name = dbName('vernietigen');
  let { backend, queue, clock } = await install(name);
  let session = await unlock(backend, queue);
  const id = (await putRecord(queue, session, { v: 1 })).putRecords[0].id;
  await putRecord(queue, session, { v: 2 }, id);
  const keep = (await putRecord(queue, session, { v: 3 })).putRecords[0].id;
  await queue.run(session, (store, s, now) => V.destroyRecordTx(store, s, { id, now }));
  backend.close();
  ({ backend, queue } = await reopen(name, clock));
  assert(backend.store.records.every((r) => r.id === keep) && backend.store.records.length === 1, 'alleen het andere record');
  session = await unlock(backend, queue);
  await V.fullCheck(backend.store, session);
  backend.close();
  await IdbBackend.deleteDatabase(name);
});

test('logboek lezen op IndexedDB schrijft niets; onleesbare regel geeft chain', async () => {
  const name = dbName('logboek');
  const { backend, queue } = await install(name);
  const session = await unlock(backend, queue);
  await putRecord(queue, session, { v: 1 });
  const before = await dump(name);
  const page = await V.readAuditPage(backend.store, session);
  assert(page.entries[0].action === 'create' && page.next === null, 'nieuwste eerst, alles op één bladzijde');
  assert(page.entries[page.entries.length - 1].detail === 'install', 'begint bij de installatie');
  assert((await dump(name)) === before, 'opslag ongewijzigd');
  const copy = structuredClone(backend.store);
  copy.audit[0].ct = copy.audit[0].ct.slice();
  copy.audit[0].ct[0] ^= 1;
  await rejects(V.readAuditPage(copy, session), (e) => e instanceof C.IntegrityError && e.code === 'chain', 'onleesbare regel');
  backend.close();
  await IdbBackend.deleteDatabase(name);
});

test('meting van de controles in de browser (klein) raakt IndexedDB niet', async () => {
  const { measureChecks } = await import('../app/js/benchmark.js');
  const before = (await indexedDB.databases()).length;
  const r = await measureChecks({ auditRows: 200, recordVersions: 20 });
  assert(r.fullMs >= 0 && r.quickMs >= 0 && r.buildMs >= 0, 'duren');
  assert((await indexedDB.databases()).length === before, 'geen database aangemaakt');
});

test('geblokkeerd wissen wacht en slaagt zodra de andere verbinding sluit (review codebase PR #12, 1)', async () => {
  const name = dbName('wissen');
  const installed = await install(name);
  installed.backend.close();
  // Een verbinding die niet vanzelf sluit bij versionchange (IdbBackend doet
  // dat wel), zoals een ander programma of een oud tabblad.
  const backend = await new Promise((resolve, reject) => {
    const req = indexedDB.open(name);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  let blocked = false;
  let settled = false;
  const deleting = IdbBackend.deleteDatabase(name, { onBlocked: () => { blocked = true; } })
    .then(() => { settled = true; });
  await new Promise((r) => setTimeout(r, 200));
  assert(blocked, 'onBlocked gemeld');
  assert(!settled, 'nog niet klaar en geen fout zolang de verbinding open is');
  backend.close();
  await deleting;
  assert(settled, 'gewist na sluiten');
  const names = (await indexedDB.databases()).map((d) => d.name);
  assert(!names.includes(name), 'database weg');
});

// --- Taak 7 -----------------------------------------------------------------------------

test('back-up gelijk aan de export op IndexedDB: verify_backup en last_backup_at duurzaam', async () => {
  const name = dbName('export');
  let { backend, queue, clock } = await install(name);
  let session = await unlock(backend, queue);
  await putRecord(queue, session, { naam: SECRET_TEXT });
  await queue.run(session, (store, s, now) => V.exportTx(store, s, { now }));
  const file = C.utf8(await V.buildBackupFile(backend.store, session, { now: clock.fn() }));
  await V.verifyExportedBackup(backend.store, session, file);
  clock.advance(1000);
  await queue.run(session, (store, s, now) => V.verifyBackupTx(store, s, { now }));
  backend.close();
  ({ backend, queue } = await reopen(name, clock));
  assert(backend.store.meta.last_backup_at === clock.fn().toISOString(), 'last_backup_at vastgelegd');
  session = await unlock(backend, queue);
  // Na herladen nog steeds gelijk aan de (vastgelegde) export.
  await V.verifyExportedBackup(backend.store, session, file);
  const other = C.utf8(await V.buildBackupFile(backend.store, session, { now: clock.fn() }));
  await rejects(V.verifyExportedBackup(backend.store, session, other), (e) => e instanceof V.BackupMismatchError, 'bestand zonder export');
  await V.fullCheck(backend.store, session);
  backend.close();
  await IdbBackend.deleteDatabase(name);
});

test('testbestand formaat 1 terugzetten op IndexedDB, met wachtwoord en met herstelsleutel', async () => {
  const fixture = await (await fetch('fixtures/testbestand-formaat-1.json')).json();
  const file = C.utf8(fixture.bestand);
  const clock = clockAt(T0);
  const routes = [
    { secret: { password: fixture.wachtwoord }, password: fixture.wachtwoord },
    { secret: { recoveryKey: fixture.herstelsleutel }, newPassword: PASSWORD2, password: PASSWORD2 },
  ];
  for (const route of routes) {
    const name = dbName('testbestand');
    let { backend, queue } = await reopen(name, clock);
    await queue.runPlain(async (store, now) => (await V.restoreTx(file, route.secret, { newPassword: route.newPassword, now })).tx);
    backend.close();
    ({ backend, queue } = await reopen(name, clock));
    const session = await unlock(backend, queue, { password: route.password });
    await V.fullCheck(backend.store, session);
    for (const r of fixture.records) {
      const rec = await V.readRecord(backend.store, session, r.id);
      assert(r.deleted ? rec.content.deleted === true : rec.content.data.omschrijving === r.data.omschrijving, 'record ' + r.id);
    }
    backend.close();
    await IdbBackend.deleteDatabase(name);
  }
});

// --- Handtekening (0.5.2): tekenen, afbeelding, tonen op echte canvas -------------------
// Alleen een getekende krabbel uit de test zelf, nooit een echte handtekening.

function testCanvas(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  draw(ctx);
  return c;
}

function scribble(ctx, w, h, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(w * 0.1, h * 0.7);
  ctx.bezierCurveTo(w * 0.3, h * 0.1, w * 0.5, h * 0.9, w * 0.9, h * 0.3);
  ctx.stroke();
}

test('handtekening: een tekening wordt een geldig, bijgesneden PNG binnen de grenzen', async () => {
  const drawn = testCanvas(680, 420, (ctx) => scribble(ctx, 680, 420, '#000000'));
  const sig = await S.fromSource(drawn, 680, 420);
  assert(S.isValidSignature(sig), 'geldig');
  assert(sig.width <= S.MAX_WIDTH && sig.height <= S.MAX_HEIGHT, 'binnen de grenzen');
  assert(sig.width < 680, 'bijgesneden of verkleind');
  await rejects(S.fromSource(testCanvas(200, 100, () => {}), 200, 100), (e) => e.code === 'empty', 'leeg tekenvak');
});

test('handtekening: foto op wit papier; wit wordt transparant, te groot of geen afbeelding geweigerd', async () => {
  const photo = testCanvas(1200, 800, (ctx) => {
    ctx.fillStyle = '#f4f4f0';                 // licht papier
    ctx.fillRect(0, 0, 1200, 800);
    scribble(ctx, 1200, 800, '#1a2a6c');       // blauwe pen
  });
  const blob = await new Promise((r) => photo.toBlob(r, 'image/png'));
  const sig = await S.fromFile(new File([blob], 'foto.png', { type: 'image/png' }));
  assert(S.isValidSignature(sig), 'geldig');
  // Hoek is papier: moet transparant zijn.
  const bitmap = await createImageBitmap(new Blob([S.base64ToBytes(sig.png)], { type: 'image/png' }));
  const check = testCanvas(bitmap.width, bitmap.height, (ctx) => ctx.drawImage(bitmap, 0, 0));
  const corner = check.getContext('2d').getImageData(0, 0, 1, 1).data;
  assert(corner[3] === 0, 'papier transparant');
  await rejects(S.fromFile(new File(['tekst'], 'a.txt', { type: 'text/plain' })), (e) => e.code === 'type', 'geen afbeelding');
  await rejects(S.fromFile({ size: S.MAX_FILE_BYTES + 1, type: 'image/png' }), (e) => e.code === 'size', 'te groot');
  await rejects(S.fromFile(new File([new Uint8Array([1, 2, 3])], 'kapot.png', { type: 'image/png' })),
    (e) => e.code === 'image', 'onleesbaar');
});

test('handtekening: tonen op een canvas zonder <img> (CSP blijft img-src self)', async () => {
  const drawn = testCanvas(680, 420, (ctx) => scribble(ctx, 680, 420, '#000000'));
  const sig = await S.fromSource(drawn, 680, 420);
  const view = document.createElement('canvas');
  view.width = 340; view.height = 210;
  assert(await S.drawSignature(view, sig), 'getekend');
  const px = view.getContext('2d').getImageData(0, 0, 340, 210).data;
  let ink = 0;
  for (let i = 3; i < px.length; i += 4) if (px[i] > 0) ink++;
  assert(ink > 50, 'inkt zichtbaar');
  assert(!(await S.drawSignature(view, { type: 'image/png' })), 'ongeldige inhoud niet getekend');
});

test('opslagstatus is op te vragen', async () => {
  const s = await storageStatus();
  assert(s.supported === true && typeof s.persisted === 'boolean', 'status');
});

// --- Hulpfuncties voor het stuurscript ---------------------------------------------

window.dahisTest = {
  async installed(name) {
    const { backend } = await install(name);
    backend.close();
  },
  // Begint onboarding en geeft terug zodra de transactie is verstuurd.
  async startOnboarding(name) {
    const backend = await IdbBackend.open(name);
    const { tx } = await V.createInstallation({ password: PASSWORD, now: T0 });
    backend.commit(tx).catch(() => undefined);
  },
  // Ontgrendelt en begint een schrijfactie; geeft terug zodra ze is verstuurd.
  async startWrite(name) {
    const { backend, queue } = await reopen(name, clockAt(T0));
    const session = await unlock(backend, queue);
    const tx = await V.putRecordTx(backend.store, session, { kind: 'test_persoon', data: { v: 1 }, now: T0 });
    backend.commit(tx).catch(() => undefined);
  },
  // 'leeg', 'volledig' (ontgrendelt en volledige controle slaagt) of een fout.
  async inspect(name) {
    const backend = await IdbBackend.open(name);
    try {
      const st = backend.store;
      if (!Object.keys(st.meta).length && !st.records.length && !st.audit.length) return { state: 'leeg' };
      const queue = new WriteQueue(backend, { clock: () => new Date(T0) });
      const session = await unlock(backend, queue);
      await V.fullCheck(backend.store, session);
      return { state: 'volledig', records: backend.store.records.length };
    } catch (err) {
      return { state: 'fout', error: err.name + ': ' + err.message };
    } finally {
      backend.close();
    }
  },
  async remove(name) {
    await IdbBackend.deleteDatabase(name);
  },
  // Houdt het slot vast als dat lukt.
  async tryOpen(name) {
    try {
      window.dahisOpened = await openStorage({ name });
      return 'open';
    } catch (err) {
      return err instanceof AlreadyOpenError ? err.message : 'fout: ' + err.message;
    }
  },
};

// --- Uitvoeren ------------------------------------------------------------------------

async function runAll() {
  const list = document.getElementById('uitslag');
  const results = [];
  for (const t of tests) {
    const li = document.createElement('li');
    li.textContent = t.name + ' … ';
    list.append(li);
    const start = performance.now();
    try {
      await t.fn();
      li.className = 'ok';
      li.textContent = t.name + ': geslaagd (' + Math.round(performance.now() - start) + ' ms)';
      results.push({ name: t.name, ok: true });
    } catch (err) {
      li.className = 'fout';
      li.textContent = t.name + ': MISLUKT\n' + (err && err.stack ? err.stack : String(err));
      results.push({ name: t.name, ok: false, error: String(err && err.message) });
    }
  }
  const failed = results.filter((r) => !r.ok).length;
  document.getElementById('status').textContent = failed ? failed + ' van ' + results.length + ' tests mislukt' : 'Alle ' + results.length + ' tests geslaagd';
  window.dahisResults = results;
}

if (new URLSearchParams(location.search).get('alleen') === 'hulp') {
  document.getElementById('status').textContent = 'Alleen hulpfuncties geladen';
  window.dahisReady = true;
} else {
  runAll();
}

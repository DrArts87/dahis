// Tests van app/js/controller.js met een opslag in het geheugen (taak 5).
// Alleen verzonnen gegevens. De schermen zelf: browsercontrole met
// Playwright buiten de repository.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as C from '../app/js/crypto.js';
import * as V from '../app/js/vault.js';
import { MemoryBackend, WriteQueue, AlreadyOpenError } from '../app/js/store.js';
import {
  AppController, ERASE_WORD, MEASURE_CHECK_SIZES, MEASURE_BACKUP_MIB, BACKUP_REMINDER_MS,
  backupDue, backupFileName, normalizeGroup, PICKER_AWAY_MS, PICKER_ARM_MS,
} from '../app/js/controller.js';
import { measureChecks } from '../app/js/benchmark.js';
import { SETTINGS_KIND } from '../app/js/settings.js';
import {
  TEST_ITERATIONS, REAL_ITERATIONS, TEST_PRESCRIBER, TEST_SIGNATURE, makeTestSignature, TEST_PATIENT, TEST_BSN_FAILING,
} from './helpers/kluis.mjs';
import { PATIENT_KIND, PATIENT_COUNTER_KIND, MAX_PATIENT_NUMBER } from '../app/js/patient.js';

const PASSWORD = 'correct paard batterij nietje';
const PASSWORD2 = 'een heel ander wachtwoord 2';
const T0 = new Date('2026-11-25T12:00:00.000Z');

function canon(store) {
  return JSON.stringify(store, (k, v) => (v instanceof Uint8Array ? 'b64:' + C.b64(v) : v));
}

// Een "toestel": opslag die herladen overleeft, en tellers voor de
// neveneffecten van de controller. `iterations`: PBKDF2-rondes voor nieuwe
// wraps (issue #26); standaard het minimum van het formaat, REAL_ITERATIONS
// in de tests over de standaard en de KDF-upgrade.
function device(iterations = TEST_ITERATIONS) {
  const dev = {
    iterations,
    backend: new MemoryBackend(),
    now: new Date(T0),
    reloads: 0,
    closes: 0,
    deletes: 0,
    open: false,
  };
  dev.clock = () => new Date(dev.now);
  dev.controller = (extra = {}) => new AppController(Object.assign({
    openStorage: async () => {
      if (dev.open) throw new AlreadyOpenError();
      dev.open = true;
      dev.backend.store = structuredClone(dev.backend.disk);
      return {
        backend: dev.backend,
        queue: new WriteQueue(dev.backend, { clock: dev.clock }),
        close: async () => { dev.closes += 1; dev.open = false; },
      };
    },
    deleteDatabase: async () => { dev.deletes += 1; dev.backend = new MemoryBackend(); },
    reload: () => { dev.reloads += 1; },
    clock: dev.clock,
    kdfIterations: dev.iterations,
    requestPersist: async () => true,
    storageStatus: async () => ({ supported: true, persisted: true, usage: 1024, quota: 1e9 }),
  }, extra));
  return dev;
}

// Voorbereide testkluis (issue #26, voorstel auditor): de eerste onboarding
// per aantal rondes loopt de hele route; daarna krijgt elk toestel een verse
// kopie van die opslag, met dezelfde neveneffecten (één keer herladen).
// Tests over de onboarding zelf gebruiken onboardFull().
const templates = new Map();

async function onboard(dev) {
  const t = templates.get(dev.iterations);
  if (t && dev.now.getTime() === T0.getTime() && !dev.open) {
    dev.backend.disk = structuredClone(t.disk);
    dev.backend.store = structuredClone(t.disk);
    dev.reloads += 1;
    dev.closes += 1;
    return { recoveryKey: t.recoveryKey };
  }
  const result = await onboardFull(dev);
  if (!t && dev.now.getTime() === T0.getTime()) {
    templates.set(dev.iterations, { disk: structuredClone(dev.backend.disk), recoveryKey: result.recoveryKey });
  }
  return result;
}

async function onboardFull(dev) {
  const app = dev.controller();
  await app.start();
  assert.equal(app.state.view, 'onboarding');
  app.goToStep('password');
  assert.equal(await app.choosePassword(PASSWORD, PASSWORD), true);
  assert.equal(app.state.step, 'key');
  const recoveryKey = app.state.recoveryKey.join('-');
  app.goToStep('check');
  const answers = app.state.groups.map((g) => app.state.recoveryKey[g]);
  assert.equal(await app.confirmRecoveryGroups(answers), true);
  assert.equal(app.state.step, 'done');
  await app.lock();
  // Vaste stap D2: na de eerste ontgrendeling de voorschrijver invullen.
  dev.open = false;
  const first = dev.controller();
  await first.start();
  assert.equal(await first.unlock({ password: PASSWORD }), true);
  assert.equal(first.state.view, 'prescriber');
  assert.equal(await first.savePrescriber(TEST_PRESCRIBER, TEST_SIGNATURE), true);
  assert.equal(first.state.view, 'ready');
  await first.lock();
  dev.reloads -= 1;   // zoals voorheen: één herlading per onboarding
  dev.closes -= 1;
  return { recoveryKey };
}

async function unlocked(dev, secret = { password: PASSWORD }) {
  const app = dev.controller();
  await app.start();
  assert.equal(app.state.view, 'locked');
  await app.unlock(secret);
  return app;
}

async function auditActions(store, secret = { password: PASSWORD }) {
  const { session } = await V.unlock(store, secret);
  const rows = store.audit.slice().sort((a, b) => a.seq - b.seq);
  const out = [];
  let hPrev = C.ZERO_HASH;
  for (const row of rows) {
    const c = await C.openAudit((await session.subkeys(row.kid)).audit, session.epochOf(row.kid), row, hPrev);
    out.push(c.action + (c.detail === null ? '' : ':' + c.detail));
    hPrev = row.h;
  }
  return out;
}

test('onboarding: pas na de controle van de herstelsleutel wordt opgeslagen', async () => {
  const dev = device();
  const app = dev.controller();
  await app.start();
  assert.equal(app.state.view, 'onboarding');
  assert.equal(app.state.step, 'intro');
  assert.equal(app.shouldLockOnHide(), false);
  app.goToStep('check');                       // niet toegestaan vanaf intro
  assert.equal(app.state.step, 'intro');
  app.goToStep('password');

  assert.equal(await app.choosePassword('te kort', 'te kort'), false);
  assert.equal(app.state.message.key, 'password.tooShort');
  assert.equal(await app.choosePassword(PASSWORD, PASSWORD2), false);
  assert.equal(app.state.message.key, 'password.mismatch');
  assert.equal(app.state.step, 'password');

  assert.equal(await app.choosePassword(PASSWORD, PASSWORD), true);
  assert.equal(app.state.recoveryKey.length, 14);
  assert.equal(app.state.groups.length, 2);
  assert.notEqual(app.state.groups[0], app.state.groups[1]);
  assert.equal(typeof app.state.pbkdfMs, 'number');
  assert.equal(app.shouldLockOnHide(), true);
  assert.equal(canon(dev.backend.disk), canon(V.emptyStore()), 'nog niets opgeslagen');

  app.goToStep('check');
  assert.equal(await app.confirmRecoveryGroups(['AAAA', 'BBBB']), false);
  assert.equal(app.state.message.key, 'onboarding.check.wrong');
  assert.equal(canon(dev.backend.disk), canon(V.emptyStore()), 'foute groepen: niets opgeslagen');

  // Kleine letters en verwisselbare tekens tellen als gelijk.
  const answers = app.state.groups.map((g) => app.state.recoveryKey[g].toLowerCase().replace(/1/g, 'l'));
  assert.equal(await app.confirmRecoveryGroups(answers), true);
  assert.equal(app.state.step, 'done');
  assert.equal(app.state.recoveryKey, null);
  assert.equal(app.state.storage.persisted, true);
  assert.ok(dev.backend.disk.meta.checkpoint);
  assert.deepEqual(await auditActions(dev.backend.disk), ['create:install']);

  await app.lock();
  assert.equal(app.state.view, 'locking');
  assert.equal(dev.closes, 1);
  assert.equal(dev.reloads, 1);
});

test('normalizeGroup volgt de invoerregels van de herstelsleutel', () => {
  assert.equal(normalizeGroup(' ab-io '), 'AB10');
  assert.equal(normalizeGroup('l0O1'), '1001');
  assert.equal(normalizeGroup(undefined), '');
});

test('onjuist wachtwoord: alleen de teller, daarna ontgrendelen en loggen', async () => {
  const dev = device();
  await onboard(dev);
  const app = dev.controller();
  await app.start();
  assert.equal(app.state.view, 'locked');
  assert.equal(app.shouldLockOnHide(), false);
  await app.unlock({ password: PASSWORD2 });
  assert.equal(app.state.view, 'locked');
  assert.equal(app.state.message.key, 'unlock.wrong');
  assert.equal(app.state.failedUnlocks, 1);
  assert.equal(dev.backend.disk.meta.failed_unlocks.count, 1);

  await app.unlock({ password: PASSWORD });
  assert.equal(app.state.view, 'ready');
  assert.equal(app.state.failedUnlocks, 0);
  assert.equal(app.shouldLockOnHide(), true);
  assert.equal(dev.backend.disk.meta.failed_unlocks.count, 0);
  const actions = await auditActions(dev.backend.disk);
  assert.ok(actions.includes('unlock_failed:1'));
  assert.equal(actions[actions.length - 1], 'unlock:password');
  assert.ok(!actions.some((a) => a.startsWith('lock')), 'vergrendelen wordt niet gelogd');
});

test('herstelsleutel: eerst een nieuw wachtwoord, daarna werkt het oude niet meer', async () => {
  const dev = device();
  const { recoveryKey } = await onboard(dev);

  // Tikfout: melding, niets geschreven.
  let app = dev.controller();
  await app.start();
  const before = canon(dev.backend.disk);
  const typo = recoveryKey.slice(0, -1) + (recoveryKey.endsWith('0') ? '1' : '0');
  await app.unlock({ recoveryKey: typo });
  assert.equal(app.state.message.key, 'unlock.typo');
  assert.equal(canon(dev.backend.disk), before);

  await app.unlock({ recoveryKey: recoveryKey.toLowerCase() });
  assert.equal(app.state.view, 'recovery-password');
  assert.equal(app.shouldLockOnHide(), true);
  assert.equal(await app.saveSetting('lock.idleMinutes', 5), false, 'eerst een nieuw wachtwoord');
  assert.equal(await app.setRecoveryPassword(PASSWORD2, PASSWORD), false);
  assert.equal(app.state.view, 'recovery-password');
  assert.equal(await app.setRecoveryPassword(PASSWORD2, PASSWORD2), true);
  assert.equal(app.state.view, 'ready');
  assert.equal(app.state.message.key, 'recovery.done');
  await app.lock();

  app = dev.controller();
  await app.start();
  await app.unlock({ password: PASSWORD });
  assert.equal(app.state.message.key, 'unlock.wrong');
  await app.unlock({ password: PASSWORD2 });
  assert.equal(app.state.view, 'ready');
  const actions = await auditActions(dev.backend.disk, { password: PASSWORD2 });
  const i = actions.indexOf('unlock:recovery');
  assert.ok(i > 0);
  assert.deepEqual(actions.slice(i + 1, i + 3), ['recovery_used', 'password_change:recovery']);
});

test('wachtwoord wijzigen met het huidige wachtwoord of de herstelsleutel', async () => {
  const dev = device();
  const { recoveryKey } = await onboard(dev);
  let app = await unlocked(dev);
  assert.equal(await app.changePassword({ password: PASSWORD2 }, PASSWORD2, PASSWORD2), false);
  assert.equal(app.state.message.key, 'password.wrongCurrent');
  assert.equal(app.state.view, 'ready');
  assert.equal(await app.changePassword({ recoveryKey }, PASSWORD2, PASSWORD2), true);
  assert.equal(app.state.message.key, 'password.changed');
  await app.lock();
  app = await unlocked(dev, { password: PASSWORD2 });
  assert.equal(app.state.view, 'ready');
});

test('instellingen: versleuteld in de kluis, met grenzen, en na ontgrendelen terug', async () => {
  const dev = device();
  await onboard(dev);
  let app = await unlocked(dev);
  assert.equal(app.state.settings['lock.idleMinutes'], 3);
  const before = canon(dev.backend.disk);
  assert.equal(await app.saveSetting('lock.idleMinutes', 99), false);
  assert.equal(app.state.message.key, 'settings.invalid');
  assert.equal(await app.saveSetting('onbekend', 1), false);
  assert.equal(canon(dev.backend.disk), before);

  assert.equal(await app.saveSetting('lock.idleMinutes', 7), true);
  assert.equal(await app.saveSetting('lock.idleMinutes', 9), true);
  const rows = dev.backend.disk.records.filter((r) => r.kind === SETTINGS_KIND);
  assert.equal(new Set(rows.map((r) => r.id)).size, 1, 'één record met versies');
  assert.deepEqual(rows.map((r) => r.version).sort(), [1, 2]);
  assert.ok(!canon(dev.backend.disk).includes('idleMinutes'), 'niet leesbaar opgeslagen');
  await app.lock();

  app = await unlocked(dev);
  assert.equal(app.state.settings['lock.idleMinutes'], 9);
});

test('volledige controle op verzoek wordt gelogd', async () => {
  const dev = device();
  await onboard(dev);
  const app = await unlocked(dev);
  dev.now = new Date(T0.getTime() + 60 * 1000);
  assert.equal(await app.runFullCheck(), true);
  assert.equal(app.state.message.key, 'check.ok');
  assert.equal(app.state.lastFullCheckAt, dev.now.getTime());
  const actions = await auditActions(dev.backend.disk);
  assert.equal(actions[actions.length - 1], 'integrity_check');
});

test('afwijking bij ontgrendelen: gestopt, opslag ongewijzigd', async () => {
  const dev = device();
  await onboard(dev);
  const last = Math.max(...dev.backend.disk.audit.map((r) => r.seq));
  const row = dev.backend.disk.audit.find((r) => r.seq === last);
  row.h = new Uint8Array(32);                 // kop van de keten klopt niet meer
  const before = canon(dev.backend.disk);
  const app = dev.controller();
  await app.start();
  await app.unlock({ password: PASSWORD });
  assert.equal(app.state.view, 'halted');
  assert.equal(typeof app.state.haltCode, 'string');
  assert.equal(app.state.haltCheck, 'quick');
  assert.equal(canon(dev.backend.disk), before);
  assert.equal(app.shouldLockOnHide(), true);
  assert.equal(await app.saveSetting('lock.idleMinutes', 5), false);
  assert.equal(canon(dev.backend.disk), before);
});

test('afwijking tijdens gebruik: wachtrij stopt en de app ook', async () => {
  const dev = device();
  await onboard(dev);
  const app = await unlocked(dev);
  // Een andere schrijver vervangt het controlepunt.
  dev.backend.store.meta.checkpoint = Object.assign({}, dev.backend.store.meta.checkpoint, { iv: new Uint8Array(12) });
  await app.saveSetting('lock.idleMinutes', 5);
  assert.equal(app.state.view, 'halted');
  assert.equal(app.state.haltCode, 'conflict');
});

test('alles wissen vraagt het woord en wist dan de opslag', async () => {
  const dev = device();
  await onboard(dev);
  const app = await unlocked(dev);
  assert.equal(await app.eraseAll('wissen?'), false);
  assert.equal(app.state.message.key, 'erase.confirmWrong');
  assert.equal(dev.deletes, 0);
  assert.equal(await app.eraseAll(ERASE_WORD), true);
  assert.equal(dev.deletes, 1);
  assert.equal(app.state.view, 'locking');
  assert.ok(dev.reloads >= 2);
  const fresh = dev.controller();
  await fresh.start();
  assert.equal(fresh.state.view, 'onboarding');
});

test('al geopend en meting', async () => {
  const dev = device();
  const first = dev.controller();
  await first.start();
  const second = dev.controller();
  await second.start();
  assert.equal(second.state.view, 'already-open');

  assert.equal(await first.measure(12345), false);
  assert.equal(await first.measure(C.DEFAULT_ITERATIONS), true);
  assert.equal(typeof first.state.measurements[C.DEFAULT_ITERATIONS], 'number');
  assert.equal(canon(dev.backend.disk), canon(V.emptyStore()), 'meten slaat niets op');
});

test('verborgen tijdens ontgrendelen: geen sessie, niets geschreven (review PR #10, P1)', async () => {
  const dev = device();
  await onboard(dev);
  const app = dev.controller();
  await app.start();
  const before = canon(dev.backend.disk);
  const pending = app.unlock({ password: PASSWORD });
  assert.equal(app.state.busy, true);
  assert.equal(app.shouldLockOnHide(), true, 'lopende poging telt als geheim');
  await app.lock();
  assert.equal(await pending, false);
  assert.equal(app.state.view, 'locking');
  assert.equal(app.session, null);
  assert.equal(canon(dev.backend.disk), before, 'geen regel unlock na vergrendelen');
});

test('verborgen tijdens het kiezen van het wachtwoord: geen herstelsleutel getoond', async () => {
  const dev = device();
  const app = dev.controller();
  await app.start();
  app.goToStep('password');
  const pending = app.choosePassword(PASSWORD, PASSWORD);
  await app.lock();
  assert.equal(await pending, false);
  assert.equal(app.state.view, 'locking');
  assert.equal(app.pending, null);
  assert.equal(app.state.recoveryKey, null);
});

test('alles wissen: slot pas vrij na het verwijderen (review PR #10, P2)', async () => {
  const dev = device();
  await onboard(dev);
  const events = [];
  const app = dev.controller({
    openStorage: async () => {
      dev.backend.store = structuredClone(dev.backend.disk);
      const backend = dev.backend;
      backend.close = () => events.push('verbinding dicht');
      return {
        backend,
        queue: new WriteQueue(backend, { clock: dev.clock }),
        close: async () => { backend.close(); events.push('slot vrij'); },
      };
    },
    deleteDatabase: async () => { events.push('verwijderd'); dev.backend = new MemoryBackend(); },
  });
  await app.start();
  await app.unlock({ password: PASSWORD });
  assert.equal(app.state.view, 'ready');
  const erasing = app.eraseAll(ERASE_WORD);
  await app.lock();                      // verbergen tijdens wissen verandert de volgorde niet
  assert.equal(await erasing, true);
  assert.deepEqual(events.filter((e, i) => events.indexOf(e) === i), ['verbinding dicht', 'verwijderd', 'slot vrij']);
  assert.ok(events.indexOf('slot vrij') > events.indexOf('verwijderd'));
});

// --- Taak 6: logboek en controles ------------------------------------------------------

const DAY = 24 * 60 * 60 * 1000;

test('logboek: regels nieuwste eerst, bladeren, en er wordt niets geschreven', async () => {
  const dev = device();
  await onboard(dev);
  const app = await unlocked(dev);
  for (let i = 0; i < 3; i++) await app.saveSetting('lock.idleMinutes', 4 + i);
  const total = dev.backend.disk.audit.length;
  const before = canon(dev.backend.disk);
  assert.equal(await app.openAuditLog(), true);
  const first = app.state.audit.entries;
  assert.equal(first[0].seq, total);
  assert.equal(first[0].action, 'update');
  assert.equal(first[first.length - 1].action + ':' + first[first.length - 1].detail, 'create:install');
  assert.equal(app.state.audit.next, null);
  assert.equal(await app.moreAuditLog(), false, 'geen oudere regels');
  assert.equal(canon(dev.backend.disk), before, 'lezen schrijft niets');
  app.closeAuditLog();
  assert.equal(app.state.audit, null);
  await app.lock();
  assert.equal(app.state.audit, null);
});

test('logboek: een onleesbare regel stopt de app (chain), opslag ongewijzigd', async () => {
  const dev = device();
  await onboard(dev);
  const app = await unlocked(dev);
  const row = dev.backend.store.audit.find((r) => r.seq === 1);
  row.ct = row.ct.slice();
  row.ct[0] ^= 1;
  const before = canon(dev.backend.disk);
  assert.equal(await app.openAuditLog(), false);
  assert.equal(app.state.view, 'halted');
  assert.equal(app.state.haltCode, 'chain');
  assert.equal(canon(dev.backend.disk), before);
});

test('verschuldigde controle bij ontgrendelen: zichtbaar, met duur, en gelogd na unlock', async () => {
  const dev = device();
  await onboard(dev);
  dev.now = new Date(T0.getTime() + 8 * DAY);
  const seen = [];
  const app = dev.controller();
  app.subscribe((st) => { if (st.checking) seen.push(st.view); });
  await app.start();
  await app.unlock({ password: PASSWORD });
  assert.equal(app.state.view, 'ready');
  assert.ok(seen.includes('locked'), 'controle zichtbaar tijdens ontgrendelen');
  assert.equal(app.state.checking, false);
  assert.equal(typeof app.state.lastCheckMs, 'number');
  assert.equal(app.state.lastFullCheckAt, dev.now.getTime());
  const actions = await auditActions(dev.backend.disk);
  assert.deepEqual(actions.slice(-2), ['unlock:password', 'integrity_check']);
});

test('klok teruggezet: laatste controle in de toekomst, dus verschuldigd', async () => {
  const dev = device();
  await onboard(dev);
  dev.now = new Date(T0.getTime() - DAY);
  const app = await unlocked(dev);
  assert.equal(app.state.view, 'ready');
  const actions = await auditActions(dev.backend.disk);
  assert.deepEqual(actions.slice(-2), ['unlock:password', 'integrity_check']);
});

test('verschuldigde controle vindt schade aan een oudere regel: gestopt, niets geschreven', async () => {
  const dev = device();
  await onboard(dev);
  let app = await unlocked(dev);
  await app.saveSetting('lock.idleMinutes', 5);
  await app.lock();
  const row = dev.backend.disk.audit.find((r) => r.seq === 2);
  row.ct = row.ct.slice();
  row.ct[0] ^= 1;                              // h blijft gelijk: de snelle controle ziet dit niet
  const before = canon(dev.backend.disk);
  dev.now = new Date(T0.getTime() + 8 * DAY);
  app = dev.controller();
  await app.start();
  await app.unlock({ password: PASSWORD });
  assert.equal(app.state.view, 'halted');
  assert.equal(app.state.haltCode, 'chain');
  assert.equal(app.state.haltCheck, 'full');
  assert.equal(app.state.checking, false);
  assert.equal(canon(dev.backend.disk), before, 'opslag ongewijzigd');
});

test('controle op verzoek: duur getoond; meting van de controles slaat niets op', async () => {
  const dev = device();
  await onboard(dev);
  let t = 0;
  const app = await (async () => {
    const a = dev.controller({
      timer: () => (t += 250),
      measureChecks: (o) => measureChecks(Object.assign({}, o, { auditRows: 12, recordVersions: 2 })),
    });
    await a.start();
    await a.unlock({ password: PASSWORD });
    return a;
  })();
  assert.equal(await app.runFullCheck(), true);
  assert.equal(app.state.lastCheckMs, 250);
  const before = canon(dev.backend.disk);
  assert.equal(await app.measureCheck(MEASURE_CHECK_SIZES.length), false);
  assert.equal(await app.measureCheck(0), true);
  const r = app.state.checkMeasurements[0];
  assert.deepEqual(Object.keys(r).sort(), ['buildMs', 'fullMs', 'quickMs']);
  assert.equal(canon(dev.backend.disk), before, 'meten slaat niets op');
});

// --- Review PR #12 ------------------------------------------------------------------

function failReloadOnce(dev) {
  const backend = dev.backend;
  const original = backend.reload.bind(backend);
  backend.reload = async () => {
    backend.reload = original;
    const err = new Error('Inlezen afgebroken');
    err.name = 'StoreError';
    throw err;
  };
}

test('P2: inlezen mislukt bij de controle op verzoek: geen lopende controle meer zichtbaar', async () => {
  const dev = device();
  await onboard(dev);
  const app = await unlocked(dev);
  failReloadOnce(dev);
  assert.equal(await app.runFullCheck(), false);
  assert.equal(app.state.view, 'ready');
  assert.equal(app.state.checking, false);
  assert.equal(app.state.message.key, 'error.unexpected');
  assert.equal(app.checkKind, null);
  assert.equal(await app.runFullCheck(), true, 'daarna lukt het wel');
});

test('P2: inlezen mislukt bij een verschuldigde controle: geen lopende controle meer zichtbaar', async () => {
  const dev = device();
  await onboard(dev);
  dev.now = new Date(T0.getTime() + 8 * DAY);
  const app = dev.controller();
  await app.start();
  failReloadOnce(dev);
  await app.unlock({ password: PASSWORD });
  assert.equal(app.state.view, 'locked');
  assert.equal(app.state.checking, false);
  assert.equal(app.state.message.key, 'error.unexpected');
  assert.equal(app.checkKind, null);
});

test('P3: een leesactie van vóór het sluiten vult het logboek niet opnieuw', async () => {
  const dev = device();
  await onboard(dev);
  const app = await unlocked(dev);
  const first = app.openAuditLog();
  app.closeAuditLog();
  assert.equal(await first, false);
  assert.equal(app.state.audit, null, 'gesloten blijft gesloten');

  // Sluiten en meteen weer openen terwijl de oude leesactie loopt.
  const old = app.openAuditLog();
  app.closeAuditLog();
  const again = app.openAuditLog();
  assert.equal(app.state.audit, null, 'geen oude lijst zichtbaar');
  await again;
  await old;
  assert.ok(app.state.audit && app.state.audit.entries.length > 0, 'nieuwe lijst geladen');
  assert.equal(app.auditOpen, true);

  // Bladeren na sluiten doet niets.
  app.closeAuditLog();
  assert.equal(await app.moreAuditLog(), false);
  assert.equal(app.state.audit, null);
});

test('codebase-review 1: geblokkeerd wissen wacht met het slot vast tot het lukt', async () => {
  const dev = device();
  await onboard(dev);
  let finish;
  const app = dev.controller({
    deleteDatabase: ({ onBlocked }) => new Promise((resolve) => {
      onBlocked();
      finish = () => { dev.deletes += 1; dev.backend = new MemoryBackend(); resolve(); };
    }),
  });
  await app.start();
  await app.unlock({ password: PASSWORD });
  const closes = dev.closes;
  const erasing = app.eraseAll(ERASE_WORD);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(app.state.message.key, 'erase.waiting');
  assert.equal(dev.closes, closes, 'slot nog vast tijdens het wachten');
  assert.equal(app.state.view, 'ready');
  finish();
  assert.equal(await erasing, true);
  assert.equal(dev.closes, closes + 1);
  assert.equal(app.state.view, 'locking');
});

// --- Taak 7: back-up maken, controleren en terugzetten ---------------------------------

// Gekozen bestand zoals een File: grootte vóór de inhoud.
function chosen(bytes, name = 'dahis-backup-20261125-1300.dahis') {
  const f = { name, size: bytes.length, reads: 0 };
  f.arrayBuffer = async () => { f.reads += 1; return bytes.slice().buffer; };
  return f;
}

async function backupOf(dev) {
  const app = await unlocked(dev);
  assert.equal(await app.makeBackup({ appVersion: '0.3.0' }), true);
  const file = app.backupForDownload();
  assert.ok(file && file.text.endsWith('\n'));
  return { app, bytes: C.utf8(file.text), name: file.name };
}

test('back-up maken: export, direct daarna verify_backup equal, en de herinnering verdwijnt', async () => {
  const dev = device();
  await onboard(dev);
  const app = await unlocked(dev);
  assert.equal(app.state.lastBackupAt, null);
  assert.equal(backupDue(app.state.lastBackupAt, dev.now.getTime()), true);
  dev.now = new Date('2026-11-25T13:05:00.000Z');
  assert.equal(await app.makeBackup({ appVersion: '0.3.0' }), true);
  assert.equal(app.state.message.key, 'backup.ready');
  assert.equal(app.state.backup.name, backupFileName(dev.now));
  assert.equal(app.state.lastBackupAt, dev.now.getTime());
  assert.equal(dev.backend.disk.meta.last_backup_at, dev.now.toISOString());
  assert.equal(backupDue(app.state.lastBackupAt, dev.now.getTime()), false);
  assert.equal(typeof app.state.lastCheckMs, 'number');
  const actions = await auditActions(dev.backend.disk);
  assert.deepEqual(actions.slice(-2), ['export', 'verify_backup:equal']);
  // Het bestand bevat de opslag van het moment van de export.
  const summary = await V.checkBackupFile(C.utf8(app.backupForDownload().text), { password: PASSWORD });
  assert.equal(summary.appVersion, '0.3.0');
  assert.equal(summary.audit, actions.length - 1);
  // Sluiten of vergrendelen laat het bestand los.
  app.closeBackup();
  assert.equal(app.backupForDownload(), null);
  assert.equal(app.state.backup, null);
  await app.makeBackup();
  await app.lock();
  assert.equal(app.backupForDownload(), null);
  // Na herladen: last_backup_at uit de opslag.
  const again = await unlocked(dev);
  assert.equal(again.state.lastBackupAt, dev.now.getTime());
});

test('herinnering: nooit, na 7 dagen, en bij een tijdstip in de toekomst', () => {
  const now = Date.parse('2026-11-25T12:00:00.000Z');
  assert.equal(backupDue(null, now), true);
  assert.equal(backupDue(now - BACKUP_REMINDER_MS + 1, now), false);
  assert.equal(backupDue(now - BACKUP_REMINDER_MS, now), true);
  assert.equal(backupDue(now + 60000, now), true);
  assert.equal(backupFileName(new Date(2026, 0, 5, 7, 3)), 'dahis-backup-20260105-0703.dahis');
});

test('terugzetten met wachtwoord op een lege opslag; daarna ontgrendelen en import in het log', async () => {
  const a = device();
  await onboard(a);
  const { bytes } = await backupOf(a);
  const b = device();
  const app = b.controller();
  await app.start();
  app.goToStep('restore');
  assert.equal(app.state.step, 'restore');
  assert.equal(app.shouldLockOnHide(), false, 'bestandskiezer: geen geheimen, niet vergrendelen');
  assert.equal(await app.restoreBackup(chosen(bytes), { password: PASSWORD }), true);
  assert.equal(app.state.step, 'restored');
  assert.equal(app.shouldLockOnHide(), false);
  assert.notEqual(b.backend.disk.meta.device_id, a.backend.disk.meta.device_id);
  await app.lock();
  const opened = await unlocked(b);
  assert.equal(opened.state.view, 'ready');
  assert.equal(opened.state.lastBackupAt, null, 'nieuwe installatie: eerst een nieuwe back-up');
  const actions = await auditActions(b.backend.disk);
  // verify_backup komt ná de export en zit dus niet in het bestand.
  assert.deepEqual(actions.slice(-5), ['unlock:password', 'export', 'write_key:' + b.backend.disk.meta.write_keys.at(-1).kid, 'import', 'unlock:password']);
  await V.fullCheck(b.backend.disk, (await V.unlock(b.backend.disk, { password: PASSWORD })).session);
});

test('terugzetten met de herstelsleutel: nieuw wachtwoord verplicht; daarna alleen dat wachtwoord', async () => {
  const a = device();
  const { recoveryKey } = await onboard(a);
  const { bytes } = await backupOf(a);
  const b = device();
  const app = b.controller();
  await app.start();
  app.goToStep('restore');
  assert.equal(await app.restoreBackup(chosen(bytes), { recoveryKey }, 'kort', 'kort'), false);
  assert.equal(app.state.message.key, 'password.tooShort');
  assert.equal(await app.restoreBackup(chosen(bytes), { recoveryKey }, PASSWORD2, PASSWORD), false);
  assert.equal(app.state.message.key, 'password.mismatch');
  assert.equal(canon(b.backend.disk), canon(V.emptyStore()));
  assert.equal(await app.restoreBackup(chosen(bytes), { recoveryKey }, PASSWORD2, PASSWORD2), true);
  await app.lock();
  const locked = b.controller();
  b.open = false;
  await locked.start();
  await locked.unlock({ password: PASSWORD });
  assert.equal(locked.state.message.key, 'unlock.wrong');
  await locked.unlock({ password: PASSWORD2 });
  assert.equal(locked.state.view, 'ready');
  const actions = await auditActions(b.backend.disk, { password: PASSWORD2 });
  assert.ok(actions.includes('recovery_used') && actions.includes('password_change:recovery') && actions.includes('import'));
  assert.equal(await locked.runFullCheck(), true);
});

test('ongeldig of te groot bestand bij terugzetten: melding, opslag blijft leeg, opnieuw proberen lukt', async () => {
  const a = device();
  await onboard(a);
  const { bytes } = await backupOf(a);
  const b = device();
  const app = b.controller();
  await app.start();
  app.goToStep('restore');
  const empty = canon(V.emptyStore());

  const big = { name: 'x.dahis', size: C.MAX_BACKUP_BYTES + 1, arrayBuffer: async () => { throw new Error('mag niet inlezen'); } };
  assert.equal(await app.restoreBackup(big, { password: PASSWORD }), false);
  assert.equal(app.state.message.key, 'backup.tooBig');

  assert.equal(await app.restoreBackup(chosen(C.utf8('geen back-up\n')), { password: PASSWORD }), false);
  assert.equal(app.state.message.key, 'file.unusable');

  const text = new TextDecoder().decode(bytes);
  const [line1, line2] = text.split('\n');
  const flipped = line1 + '\n' + (line2[20] === 'A' ? 'B' : 'A').padStart(21, line2.slice(0, 20)) + line2.slice(21) + '\n';
  // Niet te ontsleutelen: dezelfde melding als een ander bestand.
  assert.equal(await app.restoreBackup(chosen(C.utf8(flipped)), { password: PASSWORD }), false);
  assert.equal(app.state.message.key, 'file.unusable');

  assert.equal(await app.restoreBackup(chosen(bytes), { password: PASSWORD2 }), false);
  assert.equal(app.state.message.key, 'file.wrongPassword');

  const newer = C.utf8(text.replace('"format":1', '"format":7'));
  assert.equal(await app.restoreBackup(chosen(newer), { password: PASSWORD }), false);
  assert.equal(app.state.message.key, 'backup.newerFormat');

  assert.equal(app.state.view, 'onboarding');
  assert.equal(app.state.step, 'restore');
  assert.equal(canon(b.backend.disk), empty);
  assert.equal(await app.restoreBackup(chosen(bytes), { password: PASSWORD }), true);
});

test('afgebroken terugzetten (transactie mislukt): opslag blijft leeg, nieuwe poging met een nieuwe schrijfsleutel', async () => {
  const a = device();
  await onboard(a);
  const { bytes } = await backupOf(a);
  const b = device();
  const app = b.controller();
  await app.start();
  app.goToStep('restore');
  const commit = b.backend.commit.bind(b.backend);
  let fail = true;
  const salts = [];
  b.backend.commit = async (tx) => {
    salts.push(C.b64(tx.putMeta.write_keys.at(-1).salt));
    if (fail) { fail = false; throw new Error('toestel uit'); }
    return commit(tx);
  };
  assert.equal(await app.restoreBackup(chosen(bytes), { password: PASSWORD }), false);
  assert.equal(canon(b.backend.disk), canon(V.emptyStore()));
  assert.equal(await app.restoreBackup(chosen(bytes), { password: PASSWORD }), true);
  assert.equal(salts.length, 2);
  assert.notEqual(salts[0], salts[1]);
});

test('back-up controleren op het vergrendelscherm: uitslag, niets geschreven, geen stop bij schade', async () => {
  const dev = device();
  const { recoveryKey } = await onboard(dev);
  const { app: first, bytes } = await backupOf(dev);
  await first.lock();
  dev.open = false;
  const app = dev.controller();
  await app.start();
  assert.equal(app.state.view, 'locked');
  const before = canon(dev.backend.disk);

  assert.equal(await app.checkFile(chosen(bytes), { password: PASSWORD }), true);
  assert.equal(app.state.message.key, 'fileCheck.ok');
  assert.equal(app.state.fileCheck.ok, true);
  assert.equal(app.state.fileCheck.summary.appVersion, '0.3.0');
  assert.equal(await app.checkFile(chosen(bytes), { recoveryKey }), true);

  assert.equal(await app.checkFile(chosen(bytes), { password: PASSWORD2 }), false);
  assert.equal(app.state.message.key, 'file.wrongPassword');
  assert.equal(app.state.failedUnlocks, 0, 'geen mislukte ontgrendeling van de opslag');

  const text = new TextDecoder().decode(bytes);
  const [line1, line2] = text.split('\n');
  const damaged = await (async () => {
    const { session } = await V.unlock(dev.backend.disk, { password: PASSWORD });
    const header = C.parseHeader(line1);
    const payload = await C.decodeBackupPayload(session.dataKeys.get(1), header, line1, line2);
    payload.audit = payload.audit.slice(0, -1);
    return C.utf8(await C.encodeBackupFile(session.dataKeys.get(1), header, payload));
  })();
  assert.equal(await app.checkFile(chosen(damaged), { password: PASSWORD }), false);
  assert.equal(app.state.message.key, 'file.damaged');
  assert.equal(app.state.fileCheck.ok, false);
  assert.equal(typeof app.state.fileCheck.code, 'string');
  assert.equal(app.state.view, 'locked', 'een beschadigd bestand stopt de app niet');
  assert.equal(canon(dev.backend.disk), before);
  // Ontgrendelen werkt daarna gewoon.
  await app.unlock({ password: PASSWORD });
  assert.equal(app.state.view, 'ready');
  assert.equal(app.state.fileCheck, null);
});

test('meting grote back-up: alleen de vaste groottes, niets opgeslagen', async () => {
  const dev = device();
  await onboard(dev);
  const calls = [];
  const app = dev.controller({
    measureBackup: async (o) => { calls.push(o.targetBytes); return { bytes: o.targetBytes, buildMs: 1, writeMs: 2, readMs: 3 }; },
  });
  dev.open = false;
  await app.start();
  const before = canon(dev.backend.disk);
  assert.equal(await app.measureBackup(3), false);
  assert.equal(await app.measureBackup(MEASURE_BACKUP_MIB[0]), true);
  assert.deepEqual(calls, [MEASURE_BACKUP_MIB[0] * 1024 * 1024]);
  assert.equal(app.state.backupMeasurements[MEASURE_BACKUP_MIB[0]].readMs, 3);
  assert.equal(canon(dev.backend.disk), before);
});

test('review PR #14, 1: uitslag van een gecontroleerd bestand verdwijnt bij een ander bestand', async () => {
  const dev = device();
  await onboard(dev);
  const { app: first, bytes } = await backupOf(dev);
  await first.lock();
  dev.open = false;
  const app = dev.controller();
  await app.start();
  assert.equal(await app.checkFile(chosen(bytes), { password: PASSWORD }), true);
  assert.equal(app.state.fileCheck.ok, true);
  app.clearFileCheck();
  assert.equal(app.state.fileCheck, null);
  assert.equal(app.state.message, null);
});

// --- Stap D1: wachttijd na wisselen van app, werkstand, KDF-upgrade ---------------------

const MIN = 60 * 1000;

// Toestel met nagebootste timers (setTimeout van de wachttijd).
function timedDevice(iterations) {
  const dev = device(iterations);
  dev.timers = new Map();
  let nextId = 1;
  const base = dev.controller;
  dev.controller = (extra = {}) => base(Object.assign({
    setTimer: (fn, ms) => { const id = nextId++; dev.timers.set(id, { fn, ms }); return id; },
    clearTimer: (id) => { dev.timers.delete(id); },
  }, extra));
  dev.advance = (ms) => { dev.now = new Date(dev.now.getTime() + ms); };
  return dev;
}

async function readyApp(dev, extra) {
  await onboard(dev);
  const app = dev.controller(extra);
  await app.start();
  await app.unlock({ password: PASSWORD });
  assert.equal(app.state.view, 'ready');
  return app;
}

test('D1: binnen de wachttijd terug: alles staat er nog; terugkomen telt als activiteit', async () => {
  const dev = timedDevice();
  const app = await readyApp(dev);
  assert.equal(app.state.settings['lock.awayMinutes'], 5);
  app.showScreen('more', 'backup');
  dev.advance(1 * MIN);
  app.hidden();
  assert.equal(app.state.view, 'ready');
  assert.equal(dev.timers.size, 1);
  assert.equal([...dev.timers.values()][0].ms, 5 * MIN);
  dev.advance(5 * MIN - 1);
  app.visible();
  assert.equal(app.state.view, 'ready');
  assert.equal(dev.timers.size, 0, 'timer opgeruimd');
  assert.deepEqual([app.state.work.tab, app.state.work.sub], ['more', 'backup']);
  // Weg (bijna 5 min) telt niet mee voor de inactiviteit van 3 min.
  app.idleTick();
  assert.equal(app.state.view, 'ready');
  dev.advance(3 * MIN - 1);
  app.idleTick();
  assert.equal(app.state.view, 'ready');
  dev.advance(1);
  app.idleTick();
  assert.equal(app.state.view, 'locking', 'inactiviteit werkt als voorheen');
  await new Promise((r) => setImmediate(r));
  assert.equal(dev.reloads, 2);
});

test('D1: na de wachttijd terug, of de klok liep terug: vergrendeld', async () => {
  for (const [name, step] of [['precies de wachttijd', 5 * MIN], ['ruim erna', 60 * MIN], ['klok terug', -1000]]) {
    const dev = timedDevice();
    const app = await readyApp(dev);
    app.hidden();
    dev.advance(step);
    app.visible();
    assert.equal(app.state.view, 'locking', name);
    assert.equal(app.session, null, name);
    assert.equal(dev.timers.size, 0, name);
  }
});

test('D1: timer op de achtergrond vergrendelt al tijdens het wegzijn', async () => {
  const dev = timedDevice();
  const app = await readyApp(dev);
  app.hidden();
  const [timer] = dev.timers.values();
  // Inactiviteit telt niet terwijl de app verborgen is.
  dev.advance(4 * MIN);
  app.idleTick();
  assert.equal(app.state.view, 'ready');
  timer.fn();
  assert.equal(app.state.view, 'locking');
  app.visible();
  await new Promise((r) => setImmediate(r));
  assert.equal(dev.reloads, 2, 'maar één keer vergrendeld');
});

test('D1: wachttijd 0 en pagehide: direct vergrendelen', async () => {
  const dev = timedDevice();
  const app = await readyApp(dev);
  assert.equal(await app.saveSetting('lock.awayMinutes', 0), true);
  app.hidden();
  assert.equal(app.state.view, 'locking');
  assert.equal(dev.timers.size, 0);

  const dev2 = timedDevice();
  const app2 = await readyApp(dev2);
  app2.pageClosed();
  assert.equal(app2.state.view, 'locking');
});

test('D1: wachttijd 15 en terug na 14 minuten', async () => {
  const dev = timedDevice();
  const app = await readyApp(dev);
  assert.equal(await app.saveSetting('lock.awayMinutes', 15), true);
  app.hidden();
  dev.advance(14 * MIN);
  app.visible();
  assert.equal(app.state.view, 'ready');
});

test('D1: andere geheime toestanden vergrendelen direct (besluit 3)', async () => {
  // Lopende handeling (ontgrendelen).
  const dev = timedDevice();
  await onboard(dev);
  const app = dev.controller();
  await app.start();
  const pending = app.unlock({ password: PASSWORD });
  app.hidden();
  assert.equal(await pending, false);
  assert.equal(app.state.view, 'locking');
  assert.equal(app.session, null);

  // Herstelsleutel op het scherm (onboarding).
  const dev2 = timedDevice();
  const app2 = dev2.controller();
  await app2.start();
  app2.goToStep('password');
  await app2.choosePassword(PASSWORD, PASSWORD);
  assert.equal(app2.state.step, 'key');
  app2.hidden();
  assert.equal(app2.state.view, 'locking');
  assert.equal(app2.state.recoveryKey, null);

  // Nieuw wachtwoord na herstel.
  const dev3 = timedDevice();
  const { recoveryKey } = await onboard(dev3);
  const app3 = dev3.controller();
  await app3.start();
  await app3.unlock({ recoveryKey });
  assert.equal(app3.state.view, 'recovery-password');
  app3.hidden();
  assert.equal(app3.state.view, 'locking');
  assert.equal(app3.recoverySecret, null);

  // Lopende handeling in 'ready' (back-up maken).
  const dev4 = timedDevice();
  const app4 = await readyApp(dev4);
  const making = app4.makeBackup();
  app4.hidden();
  assert.equal(await making, false);
  assert.equal(app4.state.view, 'locking');

  // Zonder geheimen (vergrendelscherm): niets.
  const dev5 = timedDevice();
  await onboard(dev5);
  const app5 = dev5.controller();
  await app5.start();
  app5.hidden();
  app5.visible();
  assert.equal(app5.state.view, 'locked');
  assert.equal(dev5.timers.size, 0);
});

test('D1: werkstand: scherm en werkvelden; save bij vergrendelen zonder geheimen, load na ontgrendelen', async () => {
  const saved = [];
  let toLoad = null;
  const workStore = {
    save: async (work, session) => { saved.push({ work: structuredClone(work), hasSession: Boolean(session) }); return true; },
    load: async () => toLoad,
    clear: async () => true,
  };
  const dev = timedDevice();
  const app = await readyApp(dev, { workStore });
  assert.deepEqual(app.state.work, { tab: 'patients', sub: null, form: null });
  app.showScreen('settings', 'password');
  app.setWorkField('notitie', 'verzonnen concepttekst');
  assert.deepEqual(app.state.work.form, { fields: { notitie: 'verzonnen concepttekst' } });
  app.showScreen('settings', 'password');
  assert.ok(app.state.work.form, 'zelfde scherm: formulier blijft');
  app.showSub('about');
  assert.equal(app.state.work.form, null, 'ander scherm: formulier vervalt');
  app.showScreen('nergens', 'onbekend');
  assert.deepEqual([app.state.work.tab, app.state.work.sub], ['patients', null]);
  app.showScreen('more', 'audit');
  app.setWorkField('veld', 'x');
  await app.lock();
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0], { work: { tab: 'more', sub: 'audit', form: { fields: { veld: 'x' } } }, hasSession: true });
  assert.ok(!JSON.stringify(saved).includes(PASSWORD), 'geen wachtwoord in de werkstand');
  assert.deepEqual(app.state.work, { tab: 'patients', sub: null, form: null }, 'uit het geheugen');

  // Na ontgrendelen: load; geldig wordt overgenomen, ongeldig wordt het hoofdscherm.
  toLoad = { tab: 'more', sub: 'backup', form: { fields: { a: 'b', n: 3 } } };
  dev.open = false;
  const again = dev.controller({ workStore });
  await again.start();
  await again.unlock({ password: PASSWORD });
  assert.deepEqual(again.state.work, { tab: 'more', sub: 'backup', form: { fields: { a: 'b' } } });
  await again.lock();
  toLoad = { tab: '__proto__', sub: 'x' };
  dev.open = false;
  const third = dev.controller({ workStore });
  await third.start();
  await third.unlock({ password: PASSWORD });
  assert.deepEqual(third.state.work, { tab: 'patients', sub: null, form: null });
});

test('D1: standaard NullWorkStore bewaart niets; na ontgrendelen het hoofdscherm', async () => {
  const dev = timedDevice();
  const app = await readyApp(dev);
  app.showScreen('more', 'backup');
  await app.lock();
  dev.open = false;
  const again = dev.controller();
  await again.start();
  await again.unlock({ password: PASSWORD });
  assert.deepEqual(again.state.work, { tab: 'patients', sub: null, form: null });
});

test('D1: geen KDF-upgrade bij de herstelsleutel; het nieuwe wachtwoord krijgt 2.000.000', async () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/testbestand-formaat-1.json', import.meta.url), 'utf8'));
  const dev = device(REAL_ITERATIONS);
  const app = dev.controller();
  await app.start();
  app.goToStep('restore');
  assert.equal(await app.restoreBackup(chosen(C.utf8(fixture.bestand)), { password: fixture.wachtwoord }), true);
  await app.lock();
  const opened = await unlocked(dev, { recoveryKey: fixture.herstelsleutel });
  assert.equal(opened.state.view, 'recovery-password');
  assert.equal(dev.backend.disk.meta.kdf.iterations, 600000);
  assert.equal(await opened.setRecoveryPassword(PASSWORD2, PASSWORD2), true);
  assert.equal(dev.backend.disk.meta.kdf.iterations, 2000000);
});

test('D1 en #19: na downloaden of delen de herinnering met de vorige back-up', async () => {
  const dev = device();
  await onboard(dev);
  const app = await unlocked(dev);
  assert.equal(await app.makeBackup({ appVersion: '0.4.0' }), true);
  assert.equal(app.state.backup.previousAt, null);
  assert.equal(app.state.backup.saved, false);
  const before = canon(dev.backend.disk);
  app.backupSaved(app.state.backup.id + 1);
  assert.equal(app.state.backup.saved, false, 'alleen de eigen export (review PR #23, P2)');
  app.backupSaved(app.state.backup.id);
  assert.equal(app.state.backup.saved, true);
  assert.equal(canon(dev.backend.disk), before, 'niets geschreven');
  const first = app.state.lastBackupAt;
  dev.now = new Date(dev.now.getTime() + 60 * 1000);
  assert.equal(await app.makeBackup({ appVersion: '0.4.0' }), true);
  assert.equal(app.state.backup.previousAt, first);
  assert.equal(app.state.backup.saved, false);
});

// --- Review PR #23 ------------------------------------------------------------------------

test('review PR #23 P1-3: mislukte commit van unlock met KDF-upgrade: niets gelogd, opnieuw proberen lukt', async () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/testbestand-formaat-1.json', import.meta.url), 'utf8'));
  const dev = device(REAL_ITERATIONS);
  const app = dev.controller();
  await app.start();
  app.goToStep('restore');
  assert.equal(await app.restoreBackup(chosen(C.utf8(fixture.bestand)), { password: fixture.wachtwoord }), true);
  await app.lock();
  dev.open = false;
  const unlocksBefore = (await auditActions(dev.backend.disk, { password: fixture.wachtwoord }))
    .filter((x) => x === 'unlock:password').length;
  const auditBefore = dev.backend.disk.audit.length;
  const commit = dev.backend.commit.bind(dev.backend);
  let fail = true;
  dev.backend.commit = async (tx) => {
    if (fail && tx.putMeta && tx.putMeta.kdf) { fail = false; throw new Error('opslag vol'); }
    return commit(tx);
  };
  const a = dev.controller();
  await a.start();
  assert.equal(await a.unlock({ password: fixture.wachtwoord }), false);
  assert.equal(a.state.view, 'locked');
  assert.equal(a.state.message.key, 'error.unexpected');
  assert.equal(a.session, null);
  assert.equal(dev.backend.disk.audit.length, auditBefore, 'geen regel unlock van de mislukte poging');
  assert.equal(dev.backend.disk.meta.kdf.iterations, 600000, 'oude wrap blijft');
  // Opnieuw met hetzelfde (juiste) wachtwoord: lukt, één keer kdf_upgrade.
  const oldSalt = C.b64(dev.backend.disk.meta.kdf.salt);
  assert.equal(await a.unlock({ password: fixture.wachtwoord }), true);
  // Het testbestand heeft geen voorschrijver: eerst de vaste stap (D2).
  assert.equal(a.state.view, 'prescriber');
  assert.equal(dev.backend.disk.meta.kdf.iterations, 2000000);
  assert.notEqual(C.b64(dev.backend.disk.meta.kdf.salt), oldSalt, 'nieuwe salt_w');
  // Volgende ontgrendeling: geen tweede upgrade; de opslag is in orde.
  await a.lock();
  dev.open = false;
  const again = await unlocked(dev, { password: fixture.wachtwoord });
  assert.equal(again.state.view, 'prescriber');
  await V.fullCheck(dev.backend.disk, (await V.unlock(dev.backend.disk, { password: fixture.wachtwoord })).session);
  const actions = await auditActions(dev.backend.disk, { password: fixture.wachtwoord });
  assert.equal(actions.filter((x) => x === 'password_change:kdf_upgrade').length, 1);
  assert.equal(actions.filter((x) => x === 'unlock:password').length, unlocksBefore + 2,
    'alleen de unlocks van de geslaagde pogingen');
  assert.deepEqual(actions.slice(-3), ['unlock:password', 'password_change:kdf_upgrade', 'unlock:password']);
});

test('review PR #23 P1-3: verbergen tijdens unlock met KDF-upgrade: geen sessie; daarna werkt het wachtwoord', async () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/testbestand-formaat-1.json', import.meta.url), 'utf8'));
  const dev = timedDevice(REAL_ITERATIONS);
  const app = dev.controller();
  await app.start();
  app.goToStep('restore');
  assert.equal(await app.restoreBackup(chosen(C.utf8(fixture.bestand)), { password: fixture.wachtwoord }), true);
  await app.lock();
  dev.open = false;
  const a = dev.controller();
  await a.start();
  const pending = a.unlock({ password: fixture.wachtwoord });
  a.hidden();
  assert.equal(await pending, false);
  assert.equal(a.state.view, 'locking');
  assert.equal(a.session, null);
  dev.open = false;
  const b = dev.controller();
  await b.start();
  assert.equal(await b.unlock({ password: fixture.wachtwoord }), true);
  assert.equal(dev.backend.disk.meta.kdf.iterations, 2000000);
  const actions = await auditActions(dev.backend.disk, { password: fixture.wachtwoord });
  assert.equal(actions.filter((x) => x === 'password_change:kdf_upgrade').length, 1);
});

test('review PR #23 P1-1: geen wachttijd op het scherm Wachtwoord wijzigen', async () => {
  const dev = timedDevice();
  const app = await readyApp(dev);
  app.showScreen('settings', 'password');
  app.hidden();
  assert.equal(app.state.view, 'locking');
  assert.equal(dev.timers.size, 0);
});

test('review PR #23 P2: een werkstandopslag die niet antwoordt, houdt vergrendelen en ontgrendelen niet op', async () => {
  const never = new Promise(() => {});
  const workStore = { save: () => never, load: () => never, clear: async () => true };
  const dev = timedDevice();
  // Korte grens in de test; de app wacht hooguit WORK_STORE_MS (1 s).
  const app = await readyApp(dev, { workStore, workStoreMs: 50 });
  assert.equal(new AppController().deps.workStoreMs, 1000);
  assert.deepEqual(app.state.work, { tab: 'patients', sub: null, form: null });
  const t0 = Date.now();
  await app.lock();
  assert.ok(Date.now() - t0 < 3000);
  assert.equal(dev.closes >= 1, true, 'opslag gesloten');
});

test('review PR #23 P2: geladen werkstand niet toepassen na vergrendelen', async () => {
  let release;
  const workStore = {
    save: async () => true,
    load: () => new Promise((r) => { release = r; }),
    clear: async () => true,
  };
  const dev = timedDevice();
  await onboard(dev);
  const app = dev.controller({ workStore });
  await app.start();
  const pending = app.unlock({ password: PASSWORD });
  while (!release) await new Promise((r) => setImmediate(r));
  await app.lock();
  release({ tab: 'more', sub: 'backup' });
  assert.equal(await pending, false);
  assert.deepEqual(app.state.work, { tab: 'patients', sub: null, form: null });
});

test('review PR #23 P1-2: back-upscherm verlaten zonder downloaden of delen: eerst één waarschuwing', async () => {
  const dev = device();
  await onboard(dev);
  const app = await unlocked(dev);
  assert.equal(app.leaveBackup(), true, 'zonder bestand: gewoon weg');
  assert.equal(await app.makeBackup({ appVersion: '0.4.0' }), true);
  assert.equal(app.leaveBackup(), false);
  assert.equal(app.state.message.key, 'backup.notSaved');
  assert.equal(app.leaveBackup(), true, 'tweede keer wel');
  assert.equal(await app.makeBackup({ appVersion: '0.4.0' }), true);
  app.backupSaved(app.state.backup.id);
  assert.equal(app.leaveBackup(), true, 'opgeslagen: geen waarschuwing');
  const id = app.state.backup.id;
  assert.equal(app.backupOpen(id), true);
  app.closeBackup();
  assert.equal(app.backupOpen(id), false);
});

test('review PR #23: melding over de nieuwe wachttijd tot de instelling is bewaard', async () => {
  const dev = device();
  await onboard(dev);
  const app = await unlocked(dev);
  assert.equal(app.state.awayNotice, true, 'nog geen instelling bewaard');
  assert.equal(await app.acknowledgeAwayNotice(), true);
  assert.equal(app.state.awayNotice, false);
  await app.lock();
  dev.open = false;
  const again = await unlocked(dev);
  assert.equal(again.state.awayNotice, false);
  assert.equal(again.state.settings['lock.awayMinutes'], 5);
  // Een andere instelling wijzigen bewaart de wachttijd ook.
  const dev2 = device();
  await onboard(dev2);
  const b = await unlocked(dev2);
  assert.equal(await b.saveSetting('lock.idleMinutes', 4), true);
  assert.equal(b.state.awayNotice, false);
});

test('review PR #23 ronde 2: twee exports met dezelfde naam; een late deeluitkomst raakt alleen de eigen export', async () => {
  const dev = device();
  await onboard(dev);
  const app = await unlocked(dev);
  assert.equal(await app.makeBackup({ appVersion: '0.4.0' }), true);
  const first = app.state.backup;
  // Delen van de eerste loopt nog; in dezelfde minuut een tweede export.
  assert.equal(await app.makeBackup({ appVersion: '0.4.0' }), true);
  const second = app.state.backup;
  assert.equal(second.name, first.name, 'zelfde minuut, zelfde naam');
  assert.notEqual(second.id, first.id);
  app.backupSaved(first.id);             // vertraagde uitkomst van de eerste
  assert.equal(app.state.backup.saved, false, 'tweede niet als gedeeld gemarkeerd');
  assert.equal(app.backupOpen(first.id), false, 'geen foutmelding bij de tweede');
  app.backupSaved(second.id);
  assert.equal(app.state.backup.saved, true);
});

test('issue #26: de app zelf gebruikt de standaard (2.000.000); de controller geeft kdfIterations door', async () => {
  const app = new AppController();
  assert.equal(app.deps.kdfIterations, C.DEFAULT_ITERATIONS);
  assert.equal(TEST_ITERATIONS, C.MIN_ITERATIONS);
  // Doorgeven bij onboarding en wachtwoord wijzigen (de standaard zelf: vault.test.mjs).
  const dev = device();
  await onboardFull(dev);
  assert.equal(dev.backend.disk.meta.kdf.iterations, TEST_ITERATIONS);
  dev.open = false;
  const b = await unlocked(dev);
  assert.equal(await b.changePassword({ password: PASSWORD }, PASSWORD2, PASSWORD2), true);
  assert.equal(dev.backend.disk.meta.kdf.iterations, TEST_ITERATIONS);
});

// --- Stap D2: voorschrijver ------------------------------------------------------------------

async function prescriberLog(store) {
  const { session } = await V.unlock(store, { password: PASSWORD });
  const rows = store.audit.slice().sort((a, b) => a.seq - b.seq);
  const out = [];
  let hPrev = C.ZERO_HASH;
  for (const row of rows) {
    out.push(await C.openAudit((await session.subkeys(row.kid)).audit, session.epochOf(row.kid), row, hPrev));
    hPrev = row.h;
  }
  return out;
}

test('D2: vaste stap na de eerste ontgrendeling; ongeldige invoer schrijft niets', async () => {
  const dev = device();
  const app = dev.controller();
  await app.start();
  app.goToStep('password');
  await app.choosePassword(PASSWORD, PASSWORD);
  app.goToStep('check');
  await app.confirmRecoveryGroups(app.state.groups.map((g) => app.state.recoveryKey[g]));
  await app.lock();
  dev.open = false;
  const b = dev.controller();
  await b.start();
  await b.unlock({ password: PASSWORD });
  assert.equal(b.state.view, 'prescriber');
  assert.equal(b.shouldLockOnHide(), true, 'sessie open');
  const before = canon(dev.backend.disk);
  const bad = Object.assign({}, TEST_PRESCRIBER, { big: '123', email: '' });
  assert.equal(await b.savePrescriber(bad), false);
  assert.deepEqual(b.state.prescriberErrors, {
    big: 'prescriber.error.big', email: 'prescriber.error.required', signature: 'signature.error.required',
  });
  assert.equal(b.state.message.key, 'prescriber.invalid');
  assert.equal(b.state.view, 'prescriber');
  assert.equal(canon(dev.backend.disk), before, 'niets geschreven');
  // Andere handelingen kunnen nog niet.
  assert.equal(await b.saveSetting('lock.idleMinutes', 5), false);
  assert.equal(await b.makeBackup(), false);
  // Zonder handtekening: niet compleet (0.5.2, verplicht).
  assert.equal(await b.savePrescriber(TEST_PRESCRIBER), false);
  assert.deepEqual(b.state.prescriberErrors, { signature: 'signature.error.required' });
  assert.equal(canon(dev.backend.disk), before, 'niets geschreven');
  assert.equal(await b.savePrescriber(TEST_PRESCRIBER, TEST_SIGNATURE), true);
  assert.equal(b.state.view, 'ready');
  assert.deepEqual(b.state.prescriberErrors, {});
  assert.equal(b.state.message.key, 'prescriber.saved');
});

test('D2: in de vaste stap geldt de wachttijd (opzoeken in een andere app); vergrendelen wist de gegevens uit het geheugen', async () => {
  // Opslag zonder voorschrijver: alleen de onboarding, nog niet de vaste stap.
  const fresh = timedDevice();
  const a = fresh.controller();
  await a.start();
  a.goToStep('password');
  await a.choosePassword(PASSWORD, PASSWORD);
  a.goToStep('check');
  await a.confirmRecoveryGroups(a.state.groups.map((g) => a.state.recoveryKey[g]));
  await a.lock();
  fresh.open = false;
  const b = fresh.controller();
  await b.start();
  await b.unlock({ password: PASSWORD });
  assert.equal(b.state.view, 'prescriber');
  b.hidden();
  assert.equal(b.state.view, 'prescriber', 'niet direct vergrendeld');
  fresh.advance(2 * MIN);
  b.visible();
  assert.equal(b.state.view, 'prescriber');
  await b.savePrescriber(TEST_PRESCRIBER, TEST_SIGNATURE);
  await b.lock();
  assert.deepEqual(b.state.prescriber, {}, 'uit het geheugen');
  assert.equal(b.state.signature, null, 'handtekening uit het geheugen');
  assert.equal(b.prescriberId, null);
});

test('D2: wijzigen vanuit Instellingen; na opnieuw ontgrendelen terug; het logboek bevat geen waarden', async () => {
  const dev = device();
  await onboard(dev);
  const app = await unlocked(dev);
  assert.equal(app.state.view, 'ready');
  assert.deepEqual(app.state.prescriber, Object.assign({}, TEST_PRESCRIBER));
  app.showScreen('settings', 'prescriber');
  assert.equal(app.state.work.sub, 'prescriber');
  const changed = Object.assign({}, TEST_PRESCRIBER, { practice: 'Testpraktijk', postcode: '9999zz' });
  assert.equal(await app.savePrescriber(changed), true);
  assert.equal(app.state.view, 'ready');
  assert.equal(app.state.prescriber.postcode, '9999 ZZ', 'genormaliseerd opgeslagen');
  await app.lock();
  dev.open = false;
  const again = await unlocked(dev);
  assert.equal(again.state.prescriber.practice, 'Testpraktijk');
  const log = await prescriberLog(dev.backend.disk);
  const mine = log.filter((c) => c.kind === 'prescriber');
  assert.deepEqual(mine.map((c) => c.action), ['create', 'update']);
  const text = JSON.stringify(log);
  for (const v of ['Testpersoon', 'Teststraat', 'Testpraktijk', '00000000000', 'example.invalid']) {
    assert.ok(!text.includes(v), 'geen waarde in het logboek: ' + v);
  }
});

test('D2: de voorschrijver gaat mee in de back-up en komt terug bij terugzetten', async () => {
  const a = device();
  await onboard(a);
  const { bytes } = await backupOf(a);
  const b = device();
  const app = b.controller();
  await app.start();
  app.goToStep('restore');
  assert.equal(await app.restoreBackup(chosen(bytes), { password: PASSWORD }), true);
  await app.lock();
  b.open = false;
  const opened = await unlocked(b);
  assert.equal(opened.state.view, 'ready', 'geen vaste stap: al ingevuld');
  assert.deepEqual(opened.state.prescriber, Object.assign({}, TEST_PRESCRIBER));
});

test('D2: na herstel met de herstelsleutel eerst de vaste stap als de gegevens ontbreken', async () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/testbestand-formaat-1.json', import.meta.url), 'utf8'));
  const dev = device();
  const app = dev.controller();
  await app.start();
  app.goToStep('restore');
  assert.equal(await app.restoreBackup(chosen(C.utf8(fixture.bestand)), { password: fixture.wachtwoord }), true);
  await app.lock();
  dev.open = false;
  const b = await unlocked(dev, { recoveryKey: fixture.herstelsleutel });
  assert.equal(b.state.view, 'recovery-password');
  assert.equal(await b.setRecoveryPassword(PASSWORD2, PASSWORD2), true);
  assert.equal(b.state.view, 'prescriber');
});

test('D2: een opgeslagen veld dat niet (meer) klopt, maakt de registratie onvolledig', async () => {
  const dev = device();
  await onboard(dev);
  const app = await unlocked(dev);
  const id = app.prescriberId;
  // Schrijf een ongeldige versie zoals een oudere of gewijzigde app dat zou doen.
  await app.queue.run(app.session, (store, s, now) => V.putRecordTx(store, s, {
    id, kind: 'prescriber', data: Object.assign({}, TEST_PRESCRIBER, { big: 'onzin' }), schema: 1, now,
  }));
  await app.lock();
  dev.open = false;
  const again = await unlocked(dev);
  assert.equal(again.state.view, 'prescriber');
  assert.equal(again.state.prescriber.big, undefined);
  assert.equal(again.state.prescriber.name, TEST_PRESCRIBER.name, 'geldige velden blijven');
});

// --- Review PR #39 (fix 0.5.1) ---------------------------------------------------------------

test('review PR #39 P1: te lange nummers en tekst worden geweigerd, niet ingekort; niets geschreven', async () => {
  const dev = device();
  await onboard(dev);
  const app = await unlocked(dev);
  const before = canon(dev.backend.disk);
  for (const [field, value, error] of [
    ['big', '000000000000', 'prescriber.error.big'],          // 12 cijfers (geplakt)
    ['agb', '000000000', 'prescriber.error.agb'],              // 9 cijfers
    ['postcode', '9999 ZZZ', 'prescriber.error.postcode'],
    ['name', 'x'.repeat(101), 'prescriber.error.text'],
  ]) {
    const input = Object.assign({}, TEST_PRESCRIBER, { [field]: value });
    assert.equal(await app.savePrescriber(input), false, field);
    assert.equal(app.state.prescriberErrors[field], error, field);
    assert.equal(canon(dev.backend.disk), before, 'niets geschreven: ' + field);
  }
  assert.equal(app.state.prescriber.big, TEST_PRESCRIBER.big, 'opgeslagen waarde ongewijzigd');
});

test('review PR #39 P2: vergrendelen tijdens het inlezen van voorschrijver of instellingen laat niets in het geheugen', async () => {
  for (const which of ['readPrescriber', 'readSettings']) {
    const dev = device();
    await onboard(dev);
    const app = dev.controller();
    await app.start();
    const original = app[which].bind(app);
    app[which] = async (session) => {
      const result = await original(session);
      await app.lock();                      // naar de achtergrond tijdens het ontsleutelen
      return result;
    };
    assert.equal(await app.unlock({ password: PASSWORD }), false, which);
    assert.equal(app.state.view, 'locking', which);
    assert.deepEqual(app.state.prescriber, {}, which + ': geen voorschrijver in het geheugen');
    assert.equal(app.prescriberId, null, which);
    assert.equal(app.settingsId, null, which);
    assert.equal(app.session, null, which);
  }
});

// --- 0.5.2: handtekening -------------------------------------------------------------------

test('0.5.2: handtekening verplicht, samen met de gegevens in één transactie; logboek zonder inhoud', async () => {
  const dev = device();
  await onboard(dev);
  const app = await unlocked(dev);
  assert.equal(app.state.view, 'ready');
  assert.deepEqual(app.state.signature, Object.assign({}, TEST_SIGNATURE));
  // Wijzigen: gegevens en nieuwe handtekening samen; zonder nieuwe blijft de oude.
  const other = makeTestSignature(60, 20);
  assert.equal(await app.savePrescriber(TEST_PRESCRIBER, other), true);
  assert.equal(app.state.signature.width, 60);
  assert.equal(await app.savePrescriber(Object.assign({}, TEST_PRESCRIBER, { city: 'Andere Teststad' })), true);
  assert.equal(app.state.signature.width, 60, 'zonder nieuwe handtekening blijft de opgeslagen');
  await app.lock();
  dev.open = false;
  const again = await unlocked(dev);
  assert.equal(again.state.signature.width, 60);
  const log = await prescriberLog(dev.backend.disk);
  assert.deepEqual(log.filter((c) => c.kind === 'signature').map((c) => c.action), ['create', 'update']);
  // De onboarding schreef voorschrijver en handtekening in één transactie.
  const first = log.filter((c) => c.kind === 'prescriber' || c.kind === 'signature').slice(0, 2);
  assert.deepEqual(first.map((c) => c.kind + ':' + c.action), ['prescriber:create', 'signature:create']);
  assert.ok(!JSON.stringify(log).includes(TEST_SIGNATURE.png.slice(0, 20)), 'geen plaatje in het logboek');
});

test('0.5.2: ongeldige handtekening geweigerd, niets geschreven', async () => {
  const dev = device();
  await onboard(dev);
  const app = await unlocked(dev);
  const before = canon(dev.backend.disk);
  const bad = [
    Object.assign({}, TEST_SIGNATURE, { width: 41 }),                 // past niet bij de PNG
    Object.assign({}, TEST_SIGNATURE, { type: 'image/jpeg' }),
    Object.assign({}, TEST_SIGNATURE, { png: 'bm90IGVlbiBwbmc=' }),   // geen PNG
    Object.assign({}, TEST_SIGNATURE, { extra: 1 }),
  ];
  for (const sig of bad) {
    assert.equal(await app.savePrescriber(TEST_PRESCRIBER, sig), false);
    assert.equal(app.state.prescriberErrors.signature, 'signature.error.invalid');
  }
  assert.equal(canon(dev.backend.disk), before);
});

test('0.5.2: handtekening gaat mee in de back-up; zonder handtekening eerst de vaste stap', async () => {
  const a = device();
  await onboard(a);
  const { bytes } = await backupOf(a);
  const b = device();
  const app = b.controller();
  await app.start();
  app.goToStep('restore');
  assert.equal(await app.restoreBackup(chosen(bytes), { password: PASSWORD }), true);
  await app.lock();
  b.open = false;
  const opened = await unlocked(b);
  assert.equal(opened.state.view, 'ready');
  assert.deepEqual(opened.state.signature, Object.assign({}, TEST_SIGNATURE));
  // Een opslag met voorschrijver maar zonder handtekening (0.5.0/0.5.1): vaste stap.
  const c = device();
  await onboard(c);
  const x = await unlocked(c);
  await x.queue.run(x.session, (store, s, now) => V.destroyRecordTx(store, s, { id: x.signatureId, now }));
  await x.lock();
  c.open = false;
  const y = await unlocked(c);
  assert.equal(y.state.view, 'prescriber');
  assert.equal(y.state.signature, null);
  assert.equal(y.state.prescriber.name, TEST_PRESCRIBER.name, 'gegevens blijven');
});

test('0.5.2: vergrendelen tijdens het inlezen van de handtekening laat niets in het geheugen', async () => {
  const dev = device();
  await onboard(dev);
  const app = dev.controller();
  await app.start();
  const original = app.readSignature.bind(app);
  app.readSignature = async (session) => {
    const result = await original(session);
    await app.lock();
    return result;
  };
  assert.equal(await app.unlock({ password: PASSWORD }), false);
  assert.equal(app.state.signature, null);
  assert.equal(app.signatureId, null);
});

// --- Review PR #47: bestandskiezer voor de handtekening --------------------------------------

test('review PR #47, 3: bij "Direct" blijft de app open tijdens de bestandskiezer, hooguit 3 minuten, één keer', async () => {
  const dev = timedDevice();
  const app = await readyApp(dev);
  assert.equal(await app.saveSetting('lock.awayMinutes', 0), true);
  // Niet op het scherm van de voorschrijver: geen uitzondering.
  assert.equal(app.armPicker(), false);
  app.showScreen('settings', 'prescriber');
  assert.equal(app.armPicker(), true);
  app.hidden();
  assert.equal(app.state.view, 'ready', 'niet direct vergrendeld');
  assert.equal([...dev.timers.values()][0].ms, PICKER_AWAY_MS);
  dev.advance(PICKER_AWAY_MS - 1);
  app.visible();
  assert.equal(app.state.view, 'ready', 'terug binnen 3 minuten');
  // Eén keer: wegwisselen zonder nieuwe tik vergrendelt weer direct.
  app.hidden();
  assert.equal(app.state.view, 'locking');
});

test('review PR #47, 3: na 3 minuten weg, of te laat na de tik, gewoon vergrendelen', async () => {
  const dev = timedDevice();
  const app = await readyApp(dev);
  await app.saveSetting('lock.awayMinutes', 0);
  app.showScreen('settings', 'prescriber');
  app.armPicker();
  app.hidden();
  dev.advance(PICKER_AWAY_MS);
  app.visible();
  assert.equal(app.state.view, 'locking', 'te lang weg');

  const dev2 = timedDevice();
  const b = await readyApp(dev2);
  await b.saveSetting('lock.awayMinutes', 0);
  b.showScreen('settings', 'prescriber');
  b.armPicker();
  dev2.advance(PICKER_ARM_MS);
  b.hidden();
  assert.equal(b.state.view, 'locking', 'tik te lang geleden');
});

test('review PR #47, 3: een langere eigen wachttijd blijft gelden; ook in de vaste stap', async () => {
  const dev = timedDevice();
  const app = await readyApp(dev);
  await app.saveSetting('lock.awayMinutes', 10);
  app.showScreen('settings', 'prescriber');
  app.armPicker();
  app.hidden();
  assert.equal([...dev.timers.values()][0].ms, 10 * MIN);
  app.visible();

  // Vaste stap (opslag zonder handtekening) met "Direct".
  const c = timedDevice();
  await onboard(c);
  const x = await unlocked(c);
  await x.saveSetting('lock.awayMinutes', 0);
  await x.queue.run(x.session, (store, s, now) => V.destroyRecordTx(store, s, { id: x.signatureId, now }));
  await x.lock();
  c.open = false;
  const y = await unlocked(c);
  assert.equal(y.state.view, 'prescriber');
  assert.equal(y.armPicker(), true);
  y.hidden();
  assert.equal(y.state.view, 'prescriber');
  c.advance(60 * 1000);
  y.visible();
  assert.equal(y.state.view, 'prescriber');
});

test('review PR #47: een melding over de handtekening verdwijnt; andere fouten blijven', async () => {
  const dev = device();
  await onboard(dev);
  const app = await unlocked(dev);
  app.set({ prescriberErrors: { signature: 'signature.error.required', big: 'prescriber.error.big' } });
  app.clearSignatureError();
  assert.deepEqual(app.state.prescriberErrors, { big: 'prescriber.error.big' });
});

test('review PR #47 ronde 2: een geannuleerde of gesloten bestandskiezer trekt de uitzondering in', async () => {
  const dev = timedDevice();
  const app = await readyApp(dev);
  await app.saveSetting('lock.awayMinutes', 0);
  app.showScreen('settings', 'prescriber');
  assert.equal(app.armPicker(), true);
  app.disarmPicker();                     // kiezer geannuleerd zonder wegzijn
  app.hidden();                           // gewone appwissel daarna
  assert.equal(app.state.view, 'locking', 'direct vergrendeld, geen 3 minuten');
});

// --- Patiënten (fase 2, E1) ------------------------------------------------------------------

async function auditContents(store, secret = { password: PASSWORD }) {
  const { session } = await V.unlock(store, secret);
  const rows = store.audit.slice().sort((a, b) => a.seq - b.seq);
  const out = [];
  let hPrev = C.ZERO_HASH;
  for (const row of rows) {
    out.push(await C.openAudit((await session.subkeys(row.kid)).audit, session.epochOf(row.kid), row, hPrev));
    hPrev = row.h;
  }
  return out;
}

const SECOND_PATIENT = Object.freeze({
  family_name: 'Proef', family_prefix: 'van der', initials: 'B.', birth_date: '1975-11-02', relation: 'acquaintance',
});

test('E1: patiënten aanmaken met oplopend nummer; patiënt en teller in één transactie; logboek zonder inhoud', async () => {
  const dev = device();
  await onboard(dev);
  const app = await unlocked(dev);
  assert.deepEqual(app.state.patients, []);
  const before = (await auditContents(dev.backend.disk)).length;
  assert.equal(await app.createPatient(Object.assign({ bsn: TEST_BSN_FAILING }, TEST_PATIENT), { acceptWarnings: true }), true);
  assert.equal(app.state.message.key, 'patient.saved');
  assert.equal(app.state.message.params.number, 'DH000001');
  assert.equal(await app.createPatient(SECOND_PATIENT), true);
  assert.deepEqual(app.state.patients.map((p) => p.data.number), ['DH000002', 'DH000001'], 'op naam: Proef voor Testpersoon');
  const counters = dev.backend.disk.records.filter((r) => r.kind === PATIENT_COUNTER_KIND);
  assert.equal(new Set(counters.map((r) => r.id)).size, 1, 'één teller');
  assert.deepEqual(counters.map((r) => r.version), [1, 2]);
  const audit = await auditContents(dev.backend.disk);
  assert.deepEqual(audit.slice(before).map((c) => c.action + ':' + c.kind), [
    'create:patient', 'create:patient_counter', 'create:patient', 'update:patient_counter',
  ]);
  // Geen naam, geboortedatum of BSN in de opslag of het logboek.
  const raw = canon(dev.backend.disk);
  const log = JSON.stringify(audit);
  for (const secret of ['Testpersoon', '1980-03-12', TEST_BSN_FAILING, 'Proef', 'DH000001']) {
    assert.ok(!raw.includes(secret), 'opslag: ' + secret);
    assert.ok(!log.includes(secret), 'logboek: ' + secret);
  }
});

test('E1: fouten schrijven niets; een waarschuwing alleen met "Toch opslaan"', async () => {
  const dev = device();
  await onboard(dev);
  const app = await unlocked(dev);
  const before = canon(dev.backend.disk);
  assert.equal(await app.createPatient({ family_name: 'Testpersoon' }), false);
  assert.equal(app.state.patientErrors.birth_date, 'patient.error.required');
  assert.equal(app.state.message.key, 'patient.invalid');
  const withBsn = Object.assign({ bsn: TEST_BSN_FAILING }, TEST_PATIENT);
  assert.equal(await app.createPatient(withBsn), false);
  assert.deepEqual(app.state.patientWarnings, { bsn: 'patient.warn.bsn' });
  assert.deepEqual(app.state.patientErrors, {});
  assert.equal(app.state.message.key, 'patient.check');
  assert.equal(canon(dev.backend.disk), before, 'niets geschreven');
  assert.equal(await app.createPatient(withBsn, { acceptWarnings: true }), true);
  assert.deepEqual(app.state.patientWarnings, {});
  assert.equal(app.state.patients[0].data.bsn, TEST_BSN_FAILING);
});

test('E1: wijzigen houdt het nummer; vergrendelen wist de patiënten; na ontgrendelen terug', async () => {
  const dev = device();
  await onboard(dev);
  const app = await unlocked(dev);
  await app.createPatient(TEST_PATIENT);
  const id = app.state.patients[0].id;
  assert.equal(await app.updatePatient(id, Object.assign({}, TEST_PATIENT, { call_name: 'Anna' })), true);
  assert.equal(app.state.message.key, 'patient.updated');
  assert.equal(app.state.patients[0].data.number, 'DH000001');
  assert.equal(app.state.patients[0].data.call_name, 'Anna');
  assert.equal(await app.updatePatient('bestaat-niet', TEST_PATIENT), false);
  await app.lock();
  assert.deepEqual(app.state.patients, [], 'uit het geheugen');
  dev.open = false;
  const again = await unlocked(dev);
  assert.equal(again.state.patients.length, 1);
  assert.equal(again.state.patients[0].id, id);
  assert.equal(again.state.patients[0].data.call_name, 'Anna');
  const versions = dev.backend.disk.records.filter((r) => r.kind === PATIENT_KIND).map((r) => r.version);
  assert.deepEqual(versions, [1, 2]);
});

test('E1: de teller gaat mee in de back-up; na terugzetten telt de app verder', async () => {
  const a = device();
  await onboard(a);
  const app = await unlocked(a);
  await app.createPatient(TEST_PATIENT);
  await app.createPatient(SECOND_PATIENT);
  await app.lock();
  a.open = false;
  const { bytes } = await backupOf(a);
  const b = device();
  const r = b.controller();
  await r.start();
  r.goToStep('restore');
  assert.equal(await r.restoreBackup(chosen(bytes), { password: PASSWORD }), true);
  await r.lock();
  b.open = false;
  const opened = await unlocked(b);
  assert.equal(opened.state.patients.length, 2);
  assert.equal(await opened.createPatient(Object.assign({}, TEST_PATIENT, { initials: 'C.' })), true);
  assert.equal(opened.state.message.params.number, 'DH000003');
});

test('E1: vergrendelen tijdens het inlezen van de patiënten laat niets in het geheugen', async () => {
  const dev = device();
  await onboard(dev);
  const first = await unlocked(dev);
  await first.createPatient(TEST_PATIENT);
  await first.lock();
  dev.open = false;
  const app = dev.controller();
  await app.start();
  const original = app.readPatients.bind(app);
  app.readPatients = async (session) => {
    const result = await original(session);
    await app.lock();
    return result;
  };
  assert.equal(await app.unlock({ password: PASSWORD }), false);
  assert.deepEqual(app.state.patients, []);
});

test('E1: alleen ontgrendeld; geen nummer meer vrij geeft een melding', async () => {
  const dev = device();
  await onboard(dev);
  const locked = dev.controller();
  await locked.start();
  assert.equal(await locked.createPatient(TEST_PATIENT), false);
  dev.open = false;
  const app = await unlocked(dev);
  await app.queue.run(app.session, (store, s, now) => V.putRecordsTx(store, s, {
    items: [{ kind: PATIENT_COUNTER_KIND, data: { last: MAX_PATIENT_NUMBER } }], now,
  }));
  const before = canon(dev.backend.disk);
  assert.equal(await app.createPatient(TEST_PATIENT), false);
  assert.equal(app.state.message.key, 'patient.full');
  assert.equal(canon(dev.backend.disk), before);
});

// --- Review PR #56 ---------------------------------------------------------------------------

async function withTwoPatients() {
  const dev = device();
  await onboard(dev);
  const app = await unlocked(dev);
  assert.equal(await app.createPatient(TEST_PATIENT), true);
  assert.equal(await app.createPatient(SECOND_PATIENT), true);
  const counterId = dev.backend.disk.records.find((r) => r.kind === PATIENT_COUNTER_KIND).id;
  return { dev, app, counterId };
}

async function refusesNewNumber(dev, app) {
  const before = canon(dev.backend.disk);
  assert.equal(await app.createPatient(Object.assign({}, TEST_PATIENT, { initials: 'C.' })), false);
  assert.equal(app.state.message.key, 'patient.numberUnsafe');
  assert.equal(canon(dev.backend.disk), before, 'niets geschreven');
  assert.equal(new Set(app.state.patients.map((p) => p.data.number)).size, app.state.patients.length);
}

test('review PR #56, P2: een ongeldige teller geeft geen nummer opnieuw uit', async () => {
  const { dev, app, counterId } = await withTwoPatients();
  await app.queue.run(app.session, (store, s, now) => V.putRecordsTx(store, s, {
    items: [{ id: counterId, kind: PATIENT_COUNTER_KIND, data: { last: '2' } }], now,
  }));
  await refusesNewNumber(dev, app);
});

test('review PR #56, P2: een verwijderde of ontbrekende teller bij bestaande patiënten geeft geen nummer', async () => {
  const a = await withTwoPatients();
  await a.app.queue.run(a.app.session, (store, s, now) => V.deleteRecordTx(store, s, { id: a.counterId, now }));
  await refusesNewNumber(a.dev, a.app);
  const b = await withTwoPatients();
  await b.app.queue.run(b.app.session, (store, s, now) => V.destroyRecordTx(store, s, { id: b.counterId, now }));
  await refusesNewNumber(b.dev, b.app);
});

test('review PR #56, P2: een nummer dat al bestaat, wordt niet opnieuw uitgegeven', async () => {
  const { dev, app, counterId } = await withTwoPatients();
  await app.queue.run(app.session, (store, s, now) => V.putRecordsTx(store, s, {
    items: [{ id: counterId, kind: PATIENT_COUNTER_KIND, data: { last: 1 } }], now,
  }));
  await refusesNewNumber(dev, app);
});

test('review PR #56, P2: alles wissen haalt patiënten en voorschrijver meteen uit het geheugen, ook als het mislukt', async () => {
  const dev = device();
  await onboard(dev);
  const first = await unlocked(dev);
  await first.createPatient(TEST_PATIENT);
  await first.lock();
  dev.open = false;
  let fail;
  const app = dev.controller({
    deleteDatabase: () => new Promise((resolve, reject) => { fail = () => reject(new Error('mislukt')); }),
  });
  await app.start();
  await app.unlock({ password: PASSWORD });
  assert.equal(app.state.patients.length, 1);
  assert.equal(app.state.prescriber.name, TEST_PRESCRIBER.name);
  const erasing = app.eraseAll(ERASE_WORD);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(app.state.patients, [], 'tijdens het wissen');
  assert.deepEqual(app.state.prescriber, {});
  assert.equal(app.state.signature, null);
  assert.equal(app.prescriberId, null);
  fail();
  assert.equal(await erasing, false);
  assert.equal(app.state.view, 'error');
  assert.deepEqual(app.state.patients, [], 'na het mislukken');
  assert.deepEqual(app.state.prescriber, {});
});

test('review PR #56, P3: namen met accenten in Nederlandse volgorde, gelijke namen op nummer', async () => {
  const dev = device();
  await onboard(dev);
  const app = await unlocked(dev);
  const make = (family, initials) => Object.assign({}, TEST_PATIENT, { family_name: family, initials });
  assert.equal(await app.createPatient(make('Zzproef', 'A.')), true);
  assert.equal(await app.createPatient(make('Éénproef', 'A.')), true);
  assert.equal(await app.createPatient(make('Eenproef', 'A.')), true);
  assert.equal(await app.createPatient(make('Aaproef', 'A.')), true);
  assert.deepEqual(app.state.patients.map((p) => p.data.family_name + ' ' + p.data.number), [
    'Aaproef DH000004', 'Éénproef DH000002', 'Eenproef DH000003', 'Zzproef DH000001',
  ]);
});

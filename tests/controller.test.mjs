// Tests van app/js/controller.js met een opslag in het geheugen (taak 5).
// Alleen verzonnen gegevens. De schermen zelf: browsercontrole met
// Playwright buiten de repository.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../app/js/crypto.js';
import * as V from '../app/js/vault.js';
import { MemoryBackend, WriteQueue, AlreadyOpenError } from '../app/js/store.js';
import { AppController, ERASE_WORD, normalizeGroup } from '../app/js/controller.js';
import { SETTINGS_KIND } from '../app/js/settings.js';

const PASSWORD = 'correct paard batterij nietje';
const PASSWORD2 = 'een heel ander wachtwoord 2';
const T0 = new Date('2026-11-25T12:00:00.000Z');

function canon(store) {
  return JSON.stringify(store, (k, v) => (v instanceof Uint8Array ? 'b64:' + C.b64(v) : v));
}

// Een "toestel": opslag die herladen overleeft, en tellers voor de
// neveneffecten van de controller.
function device() {
  const dev = {
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
    requestPersist: async () => true,
    storageStatus: async () => ({ supported: true, persisted: true, usage: 1024, quota: 1e9 }),
  }, extra));
  return dev;
}

async function onboard(dev) {
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
  const row = dev.backend.disk.audit.find((r) => r.seq === 1);
  row.h = new Uint8Array(32);                 // kop van de keten klopt niet meer
  const before = canon(dev.backend.disk);
  const app = dev.controller();
  await app.start();
  await app.unlock({ password: PASSWORD });
  assert.equal(app.state.view, 'halted');
  assert.equal(typeof app.state.haltCode, 'string');
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

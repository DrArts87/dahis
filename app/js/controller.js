// Toestand en handelingen van de app, zonder DOM (taak 5).
//
// De controller koppelt de kluis (vault.js) en de opslag (store.js) aan de
// schermen. app.js tekent alleen wat hier in `state` staat en roept de
// methoden aan. Zo is het gedrag in Node te testen met MemoryBackend.
//
// Weergaven (state.view):
//   starting           opslag wordt geopend
//   already-open       Dahis is al geopend in een ander venster
//   error              opslag niet te openen (state.message)
//   onboarding         inrichten; state.step: intro, password, key, check, done
//   locked             vergrendeld; ontgrendelen met wachtwoord of herstelsleutel
//   recovery-password  na de herstelsleutel eerst een nieuw wachtwoord (§12.3)
//   ready              ontgrendeld en in orde
//   halted             afwijking gevonden (§10): alleen vergrendelen of wissen
//   locking            bezig met vergrendelen of wissen; de pagina herlaadt
//
// Meldingen staan als tekstsleutel in state.message ({key, params}); de
// teksten zelf staan in i18n/nl.js.
import {
  FormatError, WrongSecretError, RecoveryKeyTypoError, IntegrityError,
  MIN_PASSWORD_LENGTH, DEFAULT_ITERATIONS, MAX_ITERATIONS,
  isUint, normalizePassword, pbkdf2Bytes, randomBytes,
} from './crypto.js';
import * as V from './vault.js';
import {
  AlreadyOpenError, IdbBackend, openStorage, storageStatus, requestPersist,
} from './store.js';
import { SETTINGS_KIND, SETTINGS_SCHEMA, defaultSettings, normalizeSettings, withSetting } from './settings.js';

export const ERASE_WORD = 'WISSEN';
export const RECOVERY_GROUPS = 14;
export const MEASURE_ITERATIONS = Object.freeze([DEFAULT_ITERATIONS, MAX_ITERATIONS]);

// Weergaven waarin sleutels of geheimen in het geheugen kunnen staan; bij
// verbergen van de app wordt dan vergrendeld.
const SECRET_VIEWS = new Set(['recovery-password', 'ready', 'halted']);
const SECRET_STEPS = new Set(['key', 'check', 'done']);

function isEmpty(store) {
  return Object.keys(store.meta).length === 0 && store.records.length === 0 && store.audit.length === 0;
}

function passwordLength(password) {
  try {
    return Array.from(normalizePassword(password)).length;
  } catch (err) {
    return 0;
  }
}

// Herstelsleutelgroep vergelijken zoals de invoer van de herstelsleutel
// (formaat §4): hoofdletters, I en L als 1, O als 0, spaties weg.
export function normalizeGroup(text) {
  return String(text || '').toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
}

function pickGroups(random) {
  const bytes = random(8);
  const first = bytes[0] % RECOVERY_GROUPS;
  let second = bytes[1] % (RECOVERY_GROUPS - 1);
  if (second >= first) second += 1;
  return [first, second].sort((a, b) => a - b);
}

export class AppController {
  constructor(deps = {}) {
    this.deps = Object.assign({
      openStorage: () => openStorage(),
      deleteDatabase: () => IdbBackend.deleteDatabase(),
      reload: () => globalThis.location.reload(),
      clock: () => new Date(),
      timer: () => globalThis.performance.now(),
      random: (n) => randomBytes(n),
      storageStatus,
      requestPersist,
    }, deps);
    this.listeners = new Set();
    this.storage = null;
    this.session = null;
    this.pending = null;          // onboarding: {tx, recoveryKey, groups}
    this.recoverySecret = null;   // herstelsleutel tot het nieuwe wachtwoord is gezet
    this.settingsId = null;
    this.state = {
      view: 'starting',
      step: null,
      busy: false,
      message: null,
      failedUnlocks: 0,
      settings: defaultSettings(),
      recoveryKey: null,
      groups: null,
      pbkdfMs: null,
      storage: null,
      haltCode: null,
      lastFullCheckAt: null,
      measurements: {},
    };
  }

  // --- Toestand ----------------------------------------------------------------

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  set(patch) {
    Object.assign(this.state, patch);
    for (const fn of this.listeners) fn(this.state);
  }

  say(key, params) {
    this.set({ message: key ? { key, params: params || {} } : null });
  }

  get backend() { return this.storage && this.storage.backend; }
  get queue() { return this.storage && this.storage.queue; }

  shouldLockOnHide() {
    if (SECRET_VIEWS.has(this.state.view)) return true;
    return this.state.view === 'onboarding' && SECRET_STEPS.has(this.state.step);
  }

  // Voert een handeling uit met busy-vlag. Een afwijking of conflict stopt
  // de app (§10); andere fouten worden een melding.
  async guard(fn, { messages = {} } = {}) {
    if (this.state.busy || this.state.view === 'locking') return false;
    this.set({ busy: true, message: null });
    try {
      await fn();
      return true;
    } catch (err) {
      if (err instanceof IntegrityError || err instanceof V.ConflictError) {
        this.halt(err);
      } else if (messages[err.name]) {
        this.say(messages[err.name]);
      } else {
        this.say('error.unexpected', { name: err.name || 'Error' });
      }
      return false;
    } finally {
      this.set({ busy: false });
    }
  }

  halt(err) {
    const code = err instanceof IntegrityError ? err.code : 'conflict';
    this.session = null;
    this.pending = null;
    this.recoverySecret = null;
    this.set({ view: 'halted', haltCode: code, step: null, recoveryKey: null });
  }

  // --- Opstarten -----------------------------------------------------------------

  async start() {
    try {
      this.storage = await this.deps.openStorage();
    } catch (err) {
      if (err instanceof AlreadyOpenError) this.set({ view: 'already-open' });
      else this.set({ view: 'error', message: { key: 'error.storage', params: { detail: err.message || '' } } });
      return;
    }
    const store = this.backend.store;
    if (isEmpty(store)) {
      this.set({ view: 'onboarding', step: 'intro' });
      return;
    }
    const failed = store.meta.failed_unlocks;
    const count = failed && isUint(failed.count, 0, Number.MAX_SAFE_INTEGER) ? failed.count : 0;
    this.set({ view: 'locked', failedUnlocks: count });
  }

  // --- Onboarding (§12.1) ------------------------------------------------------

  goToStep(step) {
    if (this.state.view !== 'onboarding' || this.state.busy) return;
    const allowed = {
      intro: ['password'],
      password: ['intro'],
      key: ['check'],
      check: ['key'],
    };
    if (!(allowed[this.state.step] || []).includes(step)) return;
    this.set({ step, message: null });
  }

  checkPasswordPair(password, repeat) {
    if (passwordLength(password) < MIN_PASSWORD_LENGTH) {
      this.say('password.tooShort', { min: MIN_PASSWORD_LENGTH });
      return false;
    }
    if (password !== repeat) {
      this.say('password.mismatch');
      return false;
    }
    return true;
  }

  async choosePassword(password, repeat) {
    if (this.state.view !== 'onboarding' || this.state.step !== 'password') return false;
    if (!this.checkPasswordPair(password, repeat)) return false;
    return this.guard(async () => {
      const t0 = this.deps.timer();
      const { tx, recoveryKey } = await V.createInstallation({ password, now: this.deps.clock() });
      const pbkdfMs = Math.round(this.deps.timer() - t0);
      const groups = pickGroups(this.deps.random);
      this.pending = { tx, recoveryKey, groups };
      this.set({ step: 'key', recoveryKey: recoveryKey.split('-'), groups, pbkdfMs });
    });
  }

  // Controleert twee groepen van de herstelsleutel en legt pas dan alles
  // vast (één transactie, lege opslag vereist).
  async confirmRecoveryGroups(answers) {
    if (this.state.view !== 'onboarding' || this.state.step !== 'check' || !this.pending) return false;
    const parts = this.pending.recoveryKey.split('-');
    const ok = this.pending.groups.every((g, i) => normalizeGroup(answers[i]) === parts[g]);
    if (!ok) {
      this.say('onboarding.check.wrong');
      return false;
    }
    return this.guard(async () => {
      const tx = this.pending.tx;
      await this.queue.runPlain(() => tx);
      this.pending = null;
      let persisted = false;
      try { persisted = await this.deps.requestPersist(); } catch (err) { persisted = false; }
      let storage = null;
      try { storage = await this.deps.storageStatus(); } catch (err) { storage = null; }
      if (storage) storage = Object.assign({}, storage, { persisted: storage.persisted || persisted });
      this.set({ step: 'done', recoveryKey: null, groups: null, storage });
    });
  }

  // --- Ontgrendelen (§12.2, §12.3) ---------------------------------------------

  // secret: {password} of {recoveryKey} (tekst).
  async unlock(secret) {
    if (this.state.view !== 'locked') return false;
    return this.guard(async () => {
      let session;
      try {
        ({ session } = await V.unlock(this.backend.store, secret));
      } catch (err) {
        if (err instanceof WrongSecretError) {
          await this.queue.runPlain((store, now) => V.failedUnlockTx(store, now));
          const failed = this.backend.store.meta.failed_unlocks;
          this.set({ failedUnlocks: failed && isUint(failed.count, 0, Number.MAX_SAFE_INTEGER) ? failed.count : 0 });
          if (secret && typeof secret.recoveryKey === 'string') this.say('unlock.wrongRecovery');
          else this.say('unlock.wrong');
          return;
        }
        if (err instanceof RecoveryKeyTypoError) { this.say('unlock.typo'); return; }
        if (err instanceof FormatError) { this.say('unlock.unusable'); return; }
        throw err;
      }
      await this.queue.run(session, (store, s, now) => V.unlockTx(store, s, { now }));
      this.session = session;
      await this.loadSettings();
      if (session.route === 'recovery') {
        this.recoverySecret = secret.recoveryKey;
        this.set({ view: 'recovery-password', failedUnlocks: 0, lastFullCheckAt: session.lastFullCheckAt });
      } else {
        this.set({ view: 'ready', failedUnlocks: 0, lastFullCheckAt: session.lastFullCheckAt });
      }
    });
  }

  async setRecoveryPassword(password, repeat) {
    if (this.state.view !== 'recovery-password' || !this.recoverySecret) return false;
    if (!this.checkPasswordPair(password, repeat)) return false;
    return this.guard(async () => {
      const current = { recoveryKey: this.recoverySecret };
      await this.queue.run(this.session, (store, s, now) => V.changePasswordTx(store, s, {
        current, newPassword: password, detail: 'recovery', now,
      }));
      this.recoverySecret = null;
      this.set({ view: 'ready', lastFullCheckAt: this.session.lastFullCheckAt });
      this.say('recovery.done');
    });
  }

  // Wachtwoord wijzigen (§12.4) met het huidige wachtwoord of de
  // herstelsleutel.
  async changePassword(current, password, repeat) {
    if (this.state.view !== 'ready') return false;
    if (!this.checkPasswordPair(password, repeat)) return false;
    return this.guard(async () => {
      await this.queue.run(this.session, (store, s, now) => V.changePasswordTx(store, s, {
        current, newPassword: password, detail: 'user', now,
      }));
      this.say('password.changed');
    }, { messages: { WrongSecretError: 'password.wrongCurrent', RecoveryKeyTypoError: 'unlock.typo' } });
  }

  // --- Instellingen -----------------------------------------------------------------

  async loadSettings() {
    const store = this.backend.store;
    const ids = Array.from(new Set(store.records.filter((r) => r.kind === SETTINGS_KIND).map((r) => r.id))).sort();
    this.settingsId = ids.length ? ids[0] : null;
    let data = null;
    if (this.settingsId) {
      const rec = await V.readRecord(store, this.session, this.settingsId);
      if (rec && !rec.content.deleted) data = rec.content.data;
    }
    this.set({ settings: normalizeSettings(data) });
  }

  async saveSetting(key, value) {
    if (this.state.view !== 'ready') return false;
    let next;
    try {
      next = withSetting(this.state.settings, key, value);
    } catch (err) {
      this.say('settings.invalid');
      return false;
    }
    return this.guard(async () => {
      const id = this.settingsId || undefined;
      const tx = await this.queue.run(this.session, (store, s, now) => V.putRecordTx(store, s, {
        id, kind: SETTINGS_KIND, data: next, schema: SETTINGS_SCHEMA, now,
      }));
      this.settingsId = tx.putRecords[0].id;
      this.set({ settings: next, lastFullCheckAt: this.session.lastFullCheckAt });
      this.say('settings.saved');
    });
  }

  // --- Controle, opslag en meting ---------------------------------------------------

  // Volledige controle op verzoek (§9.4) op een vers ingelezen opslag.
  async runFullCheck() {
    if (this.state.view !== 'ready') return false;
    return this.guard(async () => {
      await this.queue.run(this.session, async (store, s, now) => {
        const fresh = await this.backend.reload();
        await V.fullCheck(fresh, s);
        return V.integrityCheckTx(fresh, s, { now });
      });
      this.set({ lastFullCheckAt: this.session.lastFullCheckAt });
      this.say('check.ok');
    });
  }

  async refreshStorage() {
    try {
      this.set({ storage: await this.deps.storageStatus() });
    } catch (err) {
      this.set({ storage: null });
    }
  }

  // Duur van PBKDF2 op dit toestel, met een wegwerpwachtwoord en -salt;
  // er wordt niets opgeslagen.
  async measure(iterations) {
    if (!MEASURE_ITERATIONS.includes(iterations)) return false;
    return this.guard(async () => {
      const t0 = this.deps.timer();
      await pbkdf2Bytes('meting ' + Array.from(this.deps.random(8)).join('.'), this.deps.random(16), iterations);
      const ms = Math.round(this.deps.timer() - t0);
      this.set({ measurements: Object.assign({}, this.state.measurements, { [iterations]: ms }) });
    });
  }

  // --- Vergrendelen en wissen ---------------------------------------------------------

  // Laat sessie en geheimen los, sluit opslag en slot, en herlaadt de pagina:
  // de enige betrouwbare manier om sleutels uit het geheugen te halen.
  // Er wordt niets geschreven (alleen ontgrendelingen worden gelogd).
  async lock() {
    if (this.state.view === 'locking') return;
    this.session = null;
    this.pending = null;
    this.recoverySecret = null;
    this.set({ view: 'locking', step: null, recoveryKey: null, groups: null, busy: false, message: null });
    try {
      if (this.storage) await this.storage.close();
    } catch (err) {
      // herladen geeft het slot hoe dan ook vrij
    }
    this.storage = null;
    this.deps.reload();
  }

  async eraseAll(confirmation) {
    if (String(confirmation || '').trim() !== ERASE_WORD) {
      this.say('erase.confirmWrong', { word: ERASE_WORD });
      return false;
    }
    if (this.state.view === 'locking' || this.state.busy) return false;
    this.session = null;
    this.pending = null;
    this.recoverySecret = null;
    this.set({ busy: true, message: null });
    try {
      if (this.storage) await this.storage.close();
      this.storage = null;
      await this.deps.deleteDatabase();
    } catch (err) {
      this.set({ busy: false });
      this.say('erase.failed');
      this.storage = null;
      this.set({ view: 'error', message: { key: 'erase.failed', params: {} } });
      return false;
    }
    this.set({ view: 'locking', busy: false });
    this.deps.reload();
    return true;
  }
}

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
//   onboarding         inrichten; state.step: intro, password, key, check, done,
//                      of terugzetten: restore, restored (taak 7)
//   locked             vergrendeld; ontgrendelen met wachtwoord of herstelsleutel
//   recovery-password  na de herstelsleutel eerst een nieuw wachtwoord (§12.3)
//   ready              ontgrendeld en in orde
//   halted             afwijking gevonden (§10): alleen vergrendelen of wissen
//   locking            bezig met vergrendelen of wissen; de pagina herlaadt
//
// Werkstand (state.work, stap D1): het scherm (tab, sub) en de velden van
// een formulier die daarvoor zijn aangemerkt. Bij vergrendelen gaat hij via
// deps.workStore.save() weg (nu NullWorkStore: niets bewaard) en uit het
// geheugen; na ontgrendelen probeert de controller workStore.load(). Zo kan
// "verder waar je was" later (fase 2/3, versleuteld concept) zonder grote
// wijzigingen. Wachtwoorden en de herstelsleutel komen nooit in de
// werkstand.
//
// Vergrendelen bij verbergen (stap D1): in 'ready' zonder lopende handeling
// geldt de wachttijd lock.awayMinutes; in elke andere toestand met geheimen
// vergrendelt de app direct (besluit gebruiker 2026-11-26).
//
// Meldingen staan als tekstsleutel in state.message ({key, params}); de
// teksten zelf staan in i18n/nl.js.
import {
  FormatError, WrongSecretError, RecoveryKeyTypoError, IntegrityError,
  MIN_PASSWORD_LENGTH, MIN_ITERATIONS, DEFAULT_ITERATIONS, MAX_ITERATIONS,
  MAX_BACKUP_BYTES, isUint, isTimestamp, normalizePassword, pbkdf2Bytes, randomBytes, utf8,
} from './crypto.js';
import * as V from './vault.js';
import {
  AlreadyOpenError, IdbBackend, openStorage, storageStatus, requestPersist,
} from './store.js';
import { SETTINGS_KIND, SETTINGS_SCHEMA, defaultSettings, normalizeSettings, withSetting } from './settings.js';
import { measureChecks, measureBackup } from './benchmark.js';

export const ERASE_WORD = 'WISSEN';
export const RECOVERY_GROUPS = 14;
export const MEASURE_ITERATIONS = Object.freeze([MIN_ITERATIONS, DEFAULT_ITERATIONS, MAX_ITERATIONS]);
// Meting van de controles (taak 6): 0–10 regels per dag geeft in 5 jaar
// ongeveer 18.000 regels; 100.000 is de marge.
export const MEASURE_CHECK_SIZES = Object.freeze([
  Object.freeze({ auditRows: 20000, recordVersions: 2000 }),
  Object.freeze({ auditRows: 100000, recordVersions: 10000 }),
]);
// Meting van grote back-ups (taak 7): ongeveer deze bestandsgroottes, de
// laatste net onder de grens van 256 MiB (formaat §2.4).
export const MEASURE_BACKUP_MIB = Object.freeze([64, 128, 250]);

// Herinnering aan een back-up (plan fase 1: na 7 dagen).
export const BACKUP_REMINDER_MS = 7 * 24 * 60 * 60 * 1000;

// Is een herinnering nodig? Ook als er nooit een back-up is gemaakt, of als
// het tijdstip in de toekomst ligt (klok verzet).
export function backupDue(lastBackupAt, now = Date.now()) {
  if (lastBackupAt === null || lastBackupAt === undefined) return true;
  return now - lastBackupAt >= BACKUP_REMINDER_MS || lastBackupAt > now;
}

function lastBackupOf(meta) {
  const v = meta && meta.last_backup_at;
  return typeof v === 'string' && isTimestamp(v) ? Date.parse(v) : null;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

// Bestandsnaam dahis-backup-JJJJMMDD-UUMM.dahis in lokale tijd (§11.2).
export function backupFileName(date) {
  return 'dahis-backup-' + date.getFullYear() + pad2(date.getMonth() + 1) + pad2(date.getDate())
    + '-' + pad2(date.getHours()) + pad2(date.getMinutes()) + '.dahis';
}

// Te groot bestand: geweigerd vóór het inlezen (§11.5 stap 1).
class FileTooLargeError extends Error {
  constructor() { super('Bestand groter dan 256 MiB'); this.name = 'FileTooLargeError'; }
}

// Leest een gekozen bestand ({size, arrayBuffer()}, zoals File) in, maar pas
// na de controle van de grootte.
async function readChosenFile(file) {
  if (!file || typeof file.size !== 'number' || typeof file.arrayBuffer !== 'function') {
    throw new FormatError('Geen bestand gekozen');
  }
  if (file.size > MAX_BACKUP_BYTES) throw new FileTooLargeError();
  return new Uint8Array(await file.arrayBuffer());
}

// Meldingen bij een gekozen back-upbestand (terugzetten, controleren).
const FILE_ERRORS = Object.freeze({
  FileTooLargeError: 'backup.tooBig',
  UnknownBackupFormatError: 'backup.newerFormat',
  WrongSecretError: 'file.wrongPassword',
  WrongRecoveryError: 'file.wrongRecovery',
  RecoveryKeyTypoError: 'unlock.typo',
  IntegrityError: 'file.damaged',
  FormatError: 'file.unusable',
});

// Weergaven waarin sleutels of geheimen in het geheugen kunnen staan; bij
// verbergen van de app wordt dan vergrendeld.
const SECRET_VIEWS = new Set(['recovery-password', 'ready', 'halted']);
const SECRET_STEPS = new Set(['key', 'check', 'done']);
// Subschermen in 'ready' met invoer van een wachtwoord of de herstelsleutel:
// daar geldt geen wachttijd (review PR #23 P1-1).
export const SECRET_SUBS = new Set(['password']);

// Schermen van de werkstand. Een onbekende waarde (bijvoorbeeld uit een
// latere opslag) valt terug op het hoofdscherm.
export const WORK_TABS = Object.freeze(['patients', 'recipes', 'settings', 'more']);
export const WORK_SUBS = Object.freeze(['password', 'about', 'measure', 'erase', 'audit', 'backup']);
const MAX_WORK_FIELD = 10000;

// Zo lang wacht vergrendelen of ontgrendelen hooguit op de opslag van de
// werkstand.
export const WORK_STORE_MS = 1000;

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('Werkstand: geen antwoord')), ms); }),
  ]).finally(() => clearTimeout(timer));
}

export function defaultWork() {
  return { tab: 'patients', sub: null, form: null };
}

// Werkstand strikt overnemen: alleen bekende schermen en tekstvelden.
export function normalizeWork(work) {
  const out = defaultWork();
  if (!work || typeof work !== 'object') return out;
  if (WORK_TABS.includes(work.tab)) out.tab = work.tab;
  if (work.sub === null || WORK_SUBS.includes(work.sub)) out.sub = work.sub === undefined ? null : work.sub;
  const f = work.form;
  if (f && typeof f === 'object' && f.fields && typeof f.fields === 'object' && !Array.isArray(f.fields)) {
    const fields = {};
    for (const [id, v] of Object.entries(f.fields)) {
      if (typeof v === 'string' && v.length <= MAX_WORK_FIELD) fields[id] = v;
    }
    out.form = { fields };
  }
  return out;
}

// Opslag van de werkstand. Nu bewaart hij niets; in fase 2/3 komt hier een
// versleuteld concept (eigen formaatbesluit).
export class NullWorkStore {
  async save(work, session) { return false; }     // eslint-disable-line no-unused-vars
  async load(session) { return null; }            // eslint-disable-line no-unused-vars
  async clear() { return false; }
}

// Een handeling die liep toen de app werd vergrendeld of gewist; ze mag
// niets meer schrijven of tonen (review PR #10, P1).
class StaleError extends Error {
  constructor() { super('Vergrendeld tijdens de handeling'); this.name = 'StaleError'; }
}

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
      deleteDatabase: (options) => IdbBackend.deleteDatabase(undefined, options),
      measureChecks,
      measureBackup,
      reload: () => globalThis.location.reload(),
      clock: () => new Date(),
      timer: () => globalThis.performance.now(),
      random: (n) => randomBytes(n),
      storageStatus,
      requestPersist,
      workStore: new NullWorkStore(),
      setTimer: (fn, ms) => globalThis.setTimeout(fn, ms),
      clearTimer: (id) => globalThis.clearTimeout(id),
    }, deps);
    this.listeners = new Set();
    this.storage = null;
    this.session = null;
    this.pending = null;          // onboarding: {tx, recoveryKey, groups}
    this.recoverySecret = null;   // herstelsleutel tot het nieuwe wachtwoord is gezet
    this.settingsId = null;
    this.generation = 0;          // hoger bij vergrendelen of wissen
    this.erasing = false;
    this.checkKind = null;        // lopende controle: 'quick' of 'full'
    this.auditToken = 0;          // hoger bij openen of sluiten van het logboek
    this.auditOpen = false;
    this.backupFile = null;       // gemaakte en gecontroleerde back-up: {id, text, name}
    this.backupSerial = 0;        // volgnummer van de exports in deze sessie
    this.hiddenAt = null;         // ms: verborgen met wachttijd (stap D1)
    this.awayTimer = null;
    this.lastActivity = this.now();
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
      lastCheckMs: null,          // duur van de laatste volledige controle in deze sessie
      checking: false,            // volledige controle loopt
      haltCheck: null,            // 'quick' of 'full': waarbij de afwijking werd gevonden
      audit: null,                // logboek: {entries, next}
      measurements: {},
      checkMeasurements: {},      // index in MEASURE_CHECK_SIZES -> {buildMs, fullMs, quickMs}
      backupMeasurements: {},     // MiB uit MEASURE_BACKUP_MIB -> {bytes, buildMs, writeMs, readMs} of {error}
      lastBackupAt: null,         // ms of null (meta.last_backup_at)
      backup: null,               // klaar om te delen: {id, name, bytes, createdAt, previousAt, saved, warned}
      fileCheck: null,            // uitslag van een gecontroleerd bestand (vergrendelscherm)
      work: defaultWork(),        // werkstand: scherm en formulier
      awayNotice: false,          // melding: nieuwe instelling wachttijd nog niet bewaard
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

  // Ook tijdens een lopende handeling (ontgrendelen, sleutel afleiden):
  // die kan anders verborgen alsnog een sessie openen (review PR #10, P1).
  shouldLockOnHide() {
    if (this.state.view === 'locking') return false;
    if (this.state.busy) return true;
    if (SECRET_VIEWS.has(this.state.view)) return true;
    return this.state.view === 'onboarding' && SECRET_STEPS.has(this.state.step);
  }

  now() {
    return this.deps.clock().getTime();
  }

  // --- Vergrendelen bij verbergen en inactiviteit (stap D1) ----------------------

  // Geldt de wachttijd na wisselen van app? Alleen ontgrendeld, zonder
  // lopende handeling, niet op een scherm voor geheime invoer, en met een
  // wachttijd groter dan 0 (besluit 3; review PR #23 P1-1).
  awayAllowed() {
    return this.state.view === 'ready' && !this.state.busy && !this.erasing
      && !SECRET_SUBS.has(this.state.work.sub)
      && this.state.settings['lock.awayMinutes'] > 0;
  }

  activity() {
    this.lastActivity = this.now();
  }

  clearAway() {
    if (this.awayTimer !== null) this.deps.clearTimer(this.awayTimer);
    this.awayTimer = null;
    this.hiddenAt = null;
  }

  // De app gaat naar de achtergrond (visibilitychange: hidden).
  hidden() {
    if (!this.shouldLockOnHide()) return;
    if (!this.awayAllowed()) { this.lock(); return; }
    if (this.hiddenAt !== null) return;
    const ms = this.state.settings['lock.awayMinutes'] * 60 * 1000;
    this.hiddenAt = this.now();
    // Loopt JavaScript op de achtergrond nog, dan vergrendelt de app al
    // tijdens het wegzijn. Bevriest Android de app, dan beslist visible().
    this.awayTimer = this.deps.setTimer(() => { this.awayTimer = null; this.lock(); }, ms);
  }

  // De app is weer zichtbaar. Te lang weg, of de klok liep terug: vergrendelen.
  // Anders telt terugkomen als activiteit (besluit 4).
  visible() {
    if (this.hiddenAt === null) return;
    const away = this.now() - this.hiddenAt;
    const ms = this.state.settings['lock.awayMinutes'] * 60 * 1000;
    this.clearAway();
    if (!this.shouldLockOnHide()) return;
    if (away < 0 || away >= ms || this.state.view !== 'ready') { this.lock(); return; }
    this.activity();
  }

  // De pagina wordt gesloten of in de cache gezet (pagehide): altijd
  // vergrendelen als er geheimen zijn.
  pageClosed() {
    if (this.shouldLockOnHide()) this.lock();
  }

  // Elke 10 seconden (app.js): vergrendelen na inactiviteit. De tijd weg
  // telt niet mee; daarover beslist de wachttijd.
  idleTick() {
    if (!this.shouldLockOnHide() || this.hiddenAt !== null) return;
    const minutes = this.state.settings['lock.idleMinutes'];
    if (this.now() - this.lastActivity >= minutes * 60 * 1000) this.lock();
  }

  // --- Werkstand ----------------------------------------------------------------

  // Ander scherm: het formulier van het vorige scherm vervalt.
  showScreen(tab, sub = null) {
    const next = normalizeWork({ tab, sub });
    const cur = this.state.work;
    if (next.tab === cur.tab && next.sub === cur.sub) return;
    this.set({ work: next });
  }

  showSub(sub) {
    this.showScreen(this.state.work.tab, sub);
  }

  // Alleen velden die app.js als werkveld aanmerkt (data-work); nooit een
  // wachtwoord of herstelsleutel. Geen opnieuw tekenen: de waarde staat al
  // in het invoerveld.
  setWorkField(id, value) {
    if (typeof id !== 'string' || typeof value !== 'string' || value.length > MAX_WORK_FIELD) return;
    const cur = this.state.work;
    const fields = Object.assign({}, cur.form ? cur.form.fields : {}, { [id]: value });
    this.state.work = Object.assign({}, cur, { form: { fields } });
  }

  // Geladen werkstand; de aanroeper past hem pas toe na alive(gen)
  // (review PR #23).
  async loadWork(session) {
    let saved = null;
    try { saved = await withTimeout(this.deps.workStore.load(session), WORK_STORE_MS); } catch (err) { saved = null; }
    return normalizeWork(saved);
  }

  // Gooit StaleError als de app sinds `gen` is vergrendeld of gewist.
  alive(gen) {
    if (gen !== this.generation) throw new StaleError();
  }

  // Voert een handeling uit met busy-vlag. fn(gen) controleert met
  // alive(gen) na elke wachtstap of de app intussen is vergrendeld. Een
  // afwijking of conflict stopt de app (§10); andere fouten worden een
  // melding.
  async guard(fn, { messages = {} } = {}) {
    if (this.state.busy || this.state.view === 'locking') return false;
    const gen = this.generation;
    this.set({ busy: true, message: null });
    try {
      await fn(gen);
      this.alive(gen);
      return true;
    } catch (err) {
      if (gen !== this.generation || err instanceof StaleError) {
        return false;      // vergrendeld of gewist: niets meer tonen
      }
      if (err instanceof IntegrityError || err instanceof V.ConflictError) {
        this.halt(err);
        return false;
      }
      // Geen afwijking (bijvoorbeeld inlezen mislukt): geen controle meer
      // tonen als lopend (review PR #12, P2).
      this.checkKind = null;
      if (this.state.checking) this.set({ checking: false });
      if (messages[err.name]) {
        this.say(messages[err.name]);
      } else {
        this.say('error.unexpected', { name: err.name || 'Error' });
      }
      return false;
    } finally {
      if (gen === this.generation) this.set({ busy: false });
    }
  }

  halt(err) {
    const code = err instanceof IntegrityError ? err.code : 'conflict';
    this.session = null;
    this.pending = null;
    this.recoverySecret = null;
    this.backupFile = null;
    this.set({
      view: 'halted', backup: null, haltCode: code, haltCheck: this.checkKind, checking: false,
      step: null, recoveryKey: null, audit: null,
    });
    this.checkKind = null;
    this.auditToken += 1;
    this.auditOpen = false;
  }

  // Bericht van de wachtrij over een verschuldigde volledige controle.
  onQueueCheck(event) {
    if (event.type === 'start') {
      this.checkKind = 'full';
      this.set({ checking: true });
    } else if (event.type === 'done') {
      this.checkKind = null;
      this.set({ checking: false, lastCheckMs: Math.round(event.ms) });
    } else if (event.type === 'failed') {
      // checkKind blijft staan tot guard() de fout heeft afgehandeld: bij een
      // afwijking toont het stopscherm dan de volledige controle.
      this.set({ checking: false });
    }
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
    if (this.queue) this.queue.onCheck = (event) => this.onQueueCheck(event);
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
      intro: ['password', 'restore'],
      password: ['intro'],
      restore: ['intro'],
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
    return this.guard(async (gen) => {
      const t0 = this.deps.timer();
      const { tx, recoveryKey } = await V.createInstallation({ password, now: this.deps.clock() });
      this.alive(gen);
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
    return this.guard(async (gen) => {
      const tx = this.pending.tx;
      await this.queue.runPlain(() => tx);
      this.alive(gen);
      this.pending = null;
      let persisted = false;
      try { persisted = await this.deps.requestPersist(); } catch (err) { persisted = false; }
      let storage = null;
      try { storage = await this.deps.storageStatus(); } catch (err) { storage = null; }
      this.alive(gen);
      if (storage) storage = Object.assign({}, storage, { persisted: storage.persisted || persisted });
      this.set({ step: 'done', recoveryKey: null, groups: null, storage });
    });
  }

  // --- Ontgrendelen (§12.2, §12.3) ---------------------------------------------

  // secret: {password} of {recoveryKey} (tekst).
  async unlock(secret) {
    if (this.state.view !== 'locked') return false;
    return this.guard(async (gen) => {
      let session;
      this.checkKind = 'quick';
      try {
        ({ session } = await V.unlock(this.backend.store, secret));
        this.checkKind = null;
      } catch (err) {
        if (!(err instanceof IntegrityError)) this.checkKind = null;
        this.alive(gen);
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
      // Vergrendeld tijdens het afleiden van de sleutel: geen sessie openen
      // en niets schrijven.
      this.alive(gen);
      // Met de KDF-upgrade in dezelfde transactie (§12.2 stap 6, review PR
      // #23 P1-3): mislukt het schrijven, dan staat er niets in het log en
      // kan de gebruiker het gewoon opnieuw proberen.
      await this.queue.run(session, (store, s, now) => V.unlockTx(store, s, { now, password: secret.password }));
      this.alive(gen);
      await this.loadSettings(session);
      this.alive(gen);
      const work = await this.loadWork(session);
      this.alive(gen);
      this.set({ work });
      this.session = session;
      this.activity();
      if (session.route === 'recovery') {
        this.recoverySecret = secret.recoveryKey;
        this.set({ view: 'recovery-password', failedUnlocks: 0, lastFullCheckAt: session.lastFullCheckAt });
      } else {
        this.set({ view: 'ready', failedUnlocks: 0, lastFullCheckAt: session.lastFullCheckAt });
      }
      this.set({ lastBackupAt: lastBackupOf(this.backend.store.meta), fileCheck: null });
    });
  }

  async setRecoveryPassword(password, repeat) {
    if (this.state.view !== 'recovery-password' || !this.recoverySecret) return false;
    if (!this.checkPasswordPair(password, repeat)) return false;
    return this.guard(async (gen) => {
      const current = { recoveryKey: this.recoverySecret };
      await this.queue.run(this.session, (store, s, now) => V.changePasswordTx(store, s, {
        current, newPassword: password, detail: 'recovery', now,
      }));
      this.alive(gen);
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
    return this.guard(async (gen) => {
      await this.queue.run(this.session, (store, s, now) => V.changePasswordTx(store, s, {
        current, newPassword: password, detail: 'user', now,
      }));
      this.alive(gen);
      this.say('password.changed');
    }, { messages: { WrongSecretError: 'password.wrongCurrent', RecoveryKeyTypoError: 'unlock.typo' } });
  }

  // --- Instellingen -----------------------------------------------------------------

  async loadSettings(session = this.session) {
    const store = this.backend.store;
    const ids = Array.from(new Set(store.records.filter((r) => r.kind === SETTINGS_KIND).map((r) => r.id))).sort();
    this.settingsId = ids.length ? ids[0] : null;
    let data = null;
    if (this.settingsId) {
      const rec = await V.readRecord(store, session, this.settingsId);
      if (rec && !rec.content.deleted) data = rec.content.data;
    }
    // Nieuwe instelling nog niet bewaard (opslag van vóór 0.4.0, of nooit
    // een instelling gewijzigd): één keer melden (review PR #23).
    const stored = data && typeof data === 'object' && !Array.isArray(data)
      && Object.prototype.hasOwnProperty.call(data, 'lock.awayMinutes');
    this.set({ settings: normalizeSettings(data), awayNotice: !stored });
  }

  // "Begrepen" bij de melding: de huidige waarde bewaren, dan verdwijnt de
  // melding (één regel update in het log).
  async acknowledgeAwayNotice() {
    if (this.state.view !== 'ready' || !this.state.awayNotice) return false;
    return this.saveSetting('lock.awayMinutes', this.state.settings['lock.awayMinutes']);
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
    return this.guard(async (gen) => {
      const id = this.settingsId || undefined;
      const tx = await this.queue.run(this.session, (store, s, now) => V.putRecordTx(store, s, {
        id, kind: SETTINGS_KIND, data: next, schema: SETTINGS_SCHEMA, now,
      }));
      this.alive(gen);
      this.settingsId = tx.putRecords[0].id;
      this.set({ settings: next, lastFullCheckAt: this.session.lastFullCheckAt, awayNotice: false });
      this.say('settings.saved');
    });
  }

  // --- Controle, opslag en meting ---------------------------------------------------

  // Volledige controle op verzoek (§9.4) op een vers ingelezen opslag, met
  // de duur (inlezen en controleren).
  async runFullCheck() {
    if (this.state.view !== 'ready') return false;
    return this.guard(async (gen) => {
      let ms = null;
      await this.queue.run(this.session, async (store, s, now) => {
        this.checkKind = 'full';
        this.set({ checking: true });
        const t0 = this.deps.timer();
        let fresh;
        try {
          fresh = await this.backend.reload();
          await V.fullCheck(fresh, s);
        } finally {
          // Ook bij een fout; checkKind ruimt guard() op (review PR #12, P2).
          this.set({ checking: false });
        }
        ms = Math.round(this.deps.timer() - t0);
        this.checkKind = null;
        return V.integrityCheckTx(fresh, s, { now });
      });
      this.alive(gen);
      this.set({ lastFullCheckAt: this.session.lastFullCheckAt, lastCheckMs: ms });
      this.say('check.ok');
    });
  }

  // --- Back-up (§11, taak 7) -------------------------------------------------------

  // Back-up maken (§11.3, §11.4): volledige controle op een vers ingelezen
  // opslag en de regel export; het bestand bouwen; dat bestand direct
  // controleren tegen de export (gelijk aan een export); pas dan
  // verify_backup met detail equal en last_backup_at (audit A3). Daarna staat
  // het bestand klaar om te downloaden; er wordt dan niets meer
  // geschreven. Alleen downloaden (formaat §11.3 stap 5).
  async makeBackup({ appVersion = '0.0.0' } = {}) {
    if (this.state.view !== 'ready') return false;
    this.backupFile = null;
    const previousAt = this.state.lastBackupAt;
    this.set({ backup: null });
    let ok = true;
    const done = await this.guard(async (gen) => {
      let ms = null;
      await this.queue.run(this.session, async (store, s, now) => {
        this.checkKind = 'full';
        this.set({ checking: true });
        const t0 = this.deps.timer();
        let fresh;
        try {
          fresh = await this.backend.reload();
          if (!s.fullCheckPending) await V.fullCheck(fresh, s);
        } finally {
          this.set({ checking: false });
        }
        ms = Math.round(this.deps.timer() - t0);
        this.checkKind = null;
        return V.exportTx(fresh, s, { now });
      });
      this.alive(gen);
      this.set({ lastFullCheckAt: this.session.lastFullCheckAt, lastCheckMs: ms });
      const at = this.deps.clock();
      let text;
      try {
        text = await V.buildBackupFile(this.backend.store, this.session, { now: at, appVersion });
      } catch (err) {
        if (err instanceof FormatError) { ok = false; this.say('backup.tooLarge'); return; }
        throw err;
      }
      this.alive(gen);
      const bytes = utf8(text);
      try {
        await V.verifyExportedBackup(this.backend.store, this.session, bytes);
      } catch (err) {
        if (err instanceof V.BackupMismatchError) { ok = false; this.say('backup.failed'); return; }
        throw err;
      }
      this.alive(gen);
      await this.queue.run(this.session, (store, s, now) => V.verifyBackupTx(store, s, { detail: 'equal', now }));
      this.alive(gen);
      const name = backupFileName(at);
      // Uniek volgnummer per export: twee back-ups in dezelfde minuut hebben
      // dezelfde naam (review PR #23, tweede ronde).
      this.backupSerial += 1;
      const id = this.backupSerial;
      this.backupFile = { id, text, name };
      this.set({
        backup: { id, name, bytes: bytes.length, createdAt: at.getTime(), previousAt, saved: false, warned: false },
        lastBackupAt: lastBackupOf(this.backend.store.meta),
        lastFullCheckAt: this.session.lastFullCheckAt,
      });
      this.say('backup.ready');
    });
    return done && ok;
  }

  // Het gemaakte bestand (tekst en naam) om te downloaden.
  backupForDownload() {
    return this.state.view === 'ready' ? this.backupFile : null;
  }

  // Het bestand is gedownload of gedeeld: toon de herinnering om op te
  // ruimen (#19). Er wordt niets geschreven.
  // Alleen voor de back-up waarmee de gebruiker begon (review PR #23, P2).
  backupSaved(id) {
    const b = this.state.backup;
    if (!this.backupOpen(id) || b.saved) return;
    this.set({ backup: Object.assign({}, b, { saved: true }) });
  }

  backupOpen(id) {
    const b = this.state.backup;
    return this.state.view === 'ready' && Boolean(b) && b.id === id;
  }

  // Mag het back-upscherm dicht? Een gemaakt maar nog niet gedownload of
  // gedeeld bestand geeft eerst één waarschuwing (review PR #23 P1-2):
  // last_backup_at is dan al bijgewerkt (formaat §11.3, issue #24).
  leaveBackup() {
    const b = this.state.backup;
    if (!b || b.saved || b.warned) return true;
    this.set({ backup: Object.assign({}, b, { warned: true }) });
    this.say('backup.notSaved');
    return false;
  }

  closeBackup() {
    this.backupFile = null;
    if (this.state.backup !== null) this.set({ backup: null });
  }

  // Interne integriteit van een (ouder) bestand, vanaf het vergrendelscherm
  // (§11.4, besluit gebruiker 2026-11-25): er is geen sessie, dus er wordt
  // niets geschreven, ook geen mislukte poging. Een beschadigd bestand is
  // geen afwijking van de opslag: de app stopt niet.
  async checkFile(file, secret) {
    if (this.state.view !== 'locked') return false;
    this.set({ fileCheck: null });
    let ok = true;
    const done = await this.guard(async (gen) => {
      let result;
      try {
        const bytes = await readChosenFile(file);
        result = { ok: true, summary: await V.checkBackupFile(bytes, secret) };
      } catch (err) {
        this.alive(gen);
        const key = this.fileErrorKey(err, secret);
        if (!key) throw err;
        ok = false;
        if (err instanceof IntegrityError) result = { ok: false, code: err.code };
        this.say(key);
        if (result) this.set({ fileCheck: result });
        return;
      }
      this.alive(gen);
      this.set({ fileCheck: result });
      this.say('fileCheck.ok');
    });
    return done && ok;
  }

  // Uitslag van een eerder gecontroleerd bestand weghalen: bij een ander
  // bestand of bij het verlaten van het controlescherm (review PR #14, 1).
  clearFileCheck() {
    if (this.state.fileCheck !== null || this.state.message !== null) this.set({ fileCheck: null, message: null });
  }

  // Tekstsleutel bij een fout met een gekozen bestand; null: onverwacht.
  // Volgorde telt: UnknownBackupFormatError en IntegrityError vóór
  // FormatError.
  fileErrorKey(err, secret) {
    const recovery = Boolean(secret && typeof secret.recoveryKey === 'string');
    const name = err instanceof FileTooLargeError ? 'FileTooLargeError'
      : err instanceof V.UnknownBackupFormatError ? 'UnknownBackupFormatError'
        : err instanceof WrongSecretError ? (recovery ? 'WrongRecoveryError' : 'WrongSecretError')
          : err instanceof RecoveryKeyTypoError ? 'RecoveryKeyTypoError'
            : err instanceof IntegrityError ? 'IntegrityError'
              : err instanceof FormatError ? 'FormatError' : null;
    return name ? FILE_ERRORS[name] : null;
  }

  // Terugzetten op een lege opslag (§11.5). Bij de herstelsleutel is een
  // nieuw wachtwoord verplicht (§3.7). Alles gebeurt eerst in het geheugen;
  // de opslag wordt pas in één transactie gevuld als hij nog leeg is. Een
  // fout laat de opslag leeg. Daarna vergrendelt de app: ontgrendelen met het
  // (nieuwe) wachtwoord toont meteen dat het werkt.
  async restoreBackup(file, secret, password, repeat) {
    if (this.state.view !== 'onboarding' || this.state.step !== 'restore') return false;
    const recovery = Boolean(secret && typeof secret.recoveryKey === 'string');
    if (recovery && !this.checkPasswordPair(password, repeat)) return false;
    let ok = true;
    const done = await this.guard(async (gen) => {
      let prepared;
      try {
        const bytes = await readChosenFile(file);
        prepared = await V.restoreTx(bytes, secret, { newPassword: recovery ? password : undefined, now: this.deps.clock() });
      } catch (err) {
        this.alive(gen);
        const key = this.fileErrorKey(err, secret);
        if (!key) throw err;
        ok = false;
        this.say(key);
        return;
      }
      this.alive(gen);
      await this.queue.runPlain(() => prepared.tx);
      this.alive(gen);
      prepared = null;
      this.set({ step: 'restored' });
    });
    return done && ok;
  }

  // --- Logboek ---------------------------------------------------------------------

  // Eerste bladzijde (nieuwste regels) van het auditlog. Alleen lezen; een
  // onleesbare regel is een afwijking (§10).
  // Elk openen en sluiten verhoogt auditToken; een leesactie die daarvoor
  // begon, laat haar uitslag vallen (review PR #12, P3).
  async openAuditLog() {
    if (this.state.view !== 'ready') return false;
    const token = ++this.auditToken;
    this.auditOpen = true;
    this.set({ audit: null });
    return this.loadAuditPage(token, null);
  }

  // Volgende bladzijde met oudere regels.
  async moreAuditLog() {
    const current = this.state.audit;
    if (this.state.view !== 'ready' || !this.auditOpen || !current || current.next === null) return false;
    return this.loadAuditPage(this.auditToken, current.next);
  }

  async loadAuditPage(token, before) {
    let stale = false;
    const ok = await this.guard(async (gen) => {
      const page = await V.readAuditPage(this.backend.store, this.session, before === null ? {} : { before });
      this.alive(gen);
      if (token !== this.auditToken || !this.auditOpen) { stale = true; return; }
      const earlier = before === null ? [] : this.state.audit.entries;
      this.set({ audit: { entries: earlier.concat(page.entries), next: page.next } });
    });
    // Opnieuw geopend terwijl deze (verouderde) leesactie liep: die nieuwe
    // opening kon niet starten (busy), dus nu alsnog lezen.
    if (stale && this.auditOpen && this.state.audit === null && this.state.view === 'ready') {
      return this.loadAuditPage(this.auditToken, null);
    }
    return ok && !stale;
  }

  closeAuditLog() {
    this.auditToken += 1;
    this.auditOpen = false;
    if (this.state.audit !== null) this.set({ audit: null });
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
    return this.guard(async (gen) => {
      const t0 = this.deps.timer();
      await pbkdf2Bytes('meting ' + Array.from(this.deps.random(8)).join('.'), this.deps.random(16), iterations);
      const ms = Math.round(this.deps.timer() - t0);
      this.alive(gen);
      this.set({ measurements: Object.assign({}, this.state.measurements, { [iterations]: ms }) });
    });
  }

  // Duur van de controles bij een groot nep-logboek in het geheugen
  // (benchmark.js); er wordt niets opgeslagen.
  async measureCheck(index) {
    const size = MEASURE_CHECK_SIZES[index];
    if (!size) return false;
    return this.guard(async (gen) => {
      const result = await this.deps.measureChecks(Object.assign({ timer: this.deps.timer, now: this.deps.clock() }, size));
      this.alive(gen);
      this.set({ checkMeasurements: Object.assign({}, this.state.checkMeasurements, { [index]: result }) });
    });
  }

  // Duur van een grote nep-back-up maken en weer openen, in het geheugen
  // (benchmark.js); er wordt niets opgeslagen of gedeeld.
  async measureBackup(mib) {
    if (!MEASURE_BACKUP_MIB.includes(mib)) return false;
    return this.guard(async (gen) => {
      const result = await this.deps.measureBackup({ targetBytes: mib * 1024 * 1024, timer: this.deps.timer, now: this.deps.clock() });
      this.alive(gen);
      this.set({ backupMeasurements: Object.assign({}, this.state.backupMeasurements, { [mib]: result }) });
    });
  }

  // --- Vergrendelen en wissen ---------------------------------------------------------

  // Laat sessie en geheimen los, sluit opslag en slot, en herlaadt de pagina:
  // de enige betrouwbare manier om sleutels uit het geheugen te halen.
  // Er wordt niets geschreven (alleen ontgrendelingen worden gelogd).
  async lock() {
    if (this.state.view === 'locking' || this.erasing) return;
    this.generation += 1;
    this.clearAway();
    const session = this.session;
    const work = this.state.view === 'ready' ? normalizeWork(this.state.work) : null;
    this.session = null;
    this.pending = null;
    this.recoverySecret = null;
    this.backupFile = null;
    this.auditToken += 1;
    this.auditOpen = false;
    this.set({
      view: 'locking', step: null, recoveryKey: null, groups: null, busy: false, message: null,
      audit: null, checking: false, backup: null, fileCheck: null, work: defaultWork(),
    });
    try {
      // Nu NullWorkStore: er wordt niets bewaard. Vergrendelen wacht hooguit
      // WORK_STORE_MS op de opslag van de werkstand (review PR #23).
      if (work && session) await withTimeout(this.deps.workStore.save(work, session), WORK_STORE_MS);
    } catch (err) {
      // de werkstand is nooit een reden om niet te vergrendelen
    }
    try {
      if (this.storage) await this.storage.close();
    } catch (err) {
      // herladen geeft het slot hoe dan ook vrij
    }
    this.storage = null;
    this.deps.reload();
  }

  // Volgorde (review PR #10, P2): eerst de eigen IndexedDB-verbinding
  // sluiten, dan de database verwijderen, en pas daarna het Web Lock
  // vrijgeven. Zo kan geen ander tabblad de opslag openen terwijl die
  // gewist wordt.
  async eraseAll(confirmation) {
    if (String(confirmation || '').trim() !== ERASE_WORD) {
      this.say('erase.confirmWrong', { word: ERASE_WORD });
      return false;
    }
    if (this.state.view === 'locking' || this.state.busy || this.erasing) return false;
    this.erasing = true;
    this.generation += 1;
    this.clearAway();
    this.session = null;
    this.pending = null;
    this.recoverySecret = null;
    this.backupFile = null;
    this.set({ busy: true, message: null });
    const storage = this.storage;
    let ok = true;
    try {
      if (storage) storage.backend.close();
      // Het slot blijft vast tot IndexedDB succes of een definitieve fout
      // meldt; een geblokkeerd verzoek kan later nog slagen.
      await this.deps.deleteDatabase({ onBlocked: () => this.say('erase.waiting') });
    } catch (err) {
      ok = false;
    }
    try {
      if (storage) await storage.close();
    } catch (err) {
      // herladen geeft het slot hoe dan ook vrij
    }
    this.storage = null;
    this.erasing = false;
    try { await this.deps.workStore.clear(); } catch (err) { /* nu niets bewaard */ }
    if (!ok) {
      this.set({ busy: false, view: 'error', message: { key: 'erase.failed', params: {} } });
      return false;
    }
    this.set({ view: 'locking', busy: false });
    this.deps.reload();
    return true;
  }
}

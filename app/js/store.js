// Opslag van formaat 1 in IndexedDB (docs/formaat.md §5 en §9.1).
//
// - IdbBackend: database 'dahis' versie 1; leest alles in het geheugen in
//   (dezelfde vorm als in vault.js) en legt een transactie uit vault.js vast in
//   één readwrite-transactie met durability 'strict'.
// - MemoryBackend: hetzelfde in het geheugen, voor tests in Node.
// - WriteQueue: alle schrijfacties van één tabblad achter elkaar, met eerst
//   wat de kluis vooraf nodig heeft (volledige controle, nieuwe schrijfsleutel,
//   reservering).
// - acquireLock: het exclusieve Web Lock 'dahis' voor de hele sessie.
import { IntegrityError } from './crypto.js';
import {
  ConflictError, ReservationNeededError, applyTx, emptyStore, sameCheckpoint,
  fullCheck, fullCheckDue, nextPrelude, prepareReservation,
} from './vault.js';

export const DB_NAME = 'dahis';
export const DB_VERSION = 1;
export const LOCK_NAME = 'dahis';
const STORES = ['meta', 'records', 'audit'];

export class StoreError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'StoreError';
    if (cause) this.cause = cause;
  }
}

export class AlreadyOpenError extends Error {
  constructor() { super('Dahis is al geopend'); this.name = 'AlreadyOpenError'; }
}

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// --- IndexedDB -----------------------------------------------------------------

export class IdbBackend {
  constructor(db, name) {
    this.db = db;
    this.name = name;
    this.store = emptyStore();
    // Alleen voor tests: {afterWrite(transaction)} wordt aangeroepen nadat alle
    // schrijfverzoeken zijn gedaan, vóór de transactie sluit.
    this.testHooks = null;
    db.onversionchange = () => db.close();
  }

  static open(name = DB_NAME, { indexedDB = globalThis.indexedDB } = {}) {
    if (!indexedDB) return Promise.reject(new StoreError('Deze browser ondersteunt geen IndexedDB'));
    return new Promise((resolve, reject) => {
      let req;
      try {
        req = indexedDB.open(name, DB_VERSION);
      } catch (err) {
        reject(new StoreError('Opslag niet te openen', err));
        return;
      }
      req.onupgradeneeded = (event) => {
        if (event.oldVersion !== 0) return;
        const db = req.result;
        db.createObjectStore('meta');
        db.createObjectStore('records', { keyPath: ['id', 'version'] }).createIndex('kind', 'kind');
        db.createObjectStore('audit', { keyPath: 'seq' });
      };
      req.onblocked = () => reject(new StoreError('De opslag is nog geopend in een ander venster'));
      req.onerror = () => {
        const err = req.error;
        reject(err && err.name === 'VersionError'
          ? new StoreError('De opslag hoort bij een nieuwere versie van Dahis', err)
          : new StoreError('Opslag niet te openen', err));
      };
      req.onsuccess = async () => {
        const backend = new IdbBackend(req.result, name);
        try {
          await backend.reload();
          resolve(backend);
        } catch (err) {
          backend.close();
          reject(err);
        }
      };
    });
  }

  // Een geblokkeerd wisverzoek (een andere verbinding is nog open) loopt
  // door zodra die verbinding sluit; het is dus geen fout. onBlocked meldt
  // het wachten; de promise wacht op succes of een definitieve fout (review
  // codebase PR #12, 1).
  static deleteDatabase(name = DB_NAME, { indexedDB = globalThis.indexedDB, onBlocked = null } = {}) {
    return new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(new StoreError('Opslag niet te wissen', req.error));
      req.onblocked = () => { if (onBlocked) onBlocked(); };
    });
  }

  // Leest de hele opslag opnieuw in (één readonly-transactie).
  async reload() {
    const t = this.db.transaction(STORES, 'readonly');
    const done = new Promise((resolve, reject) => {
      t.oncomplete = resolve;
      t.onabort = () => reject(new StoreError('Inlezen afgebroken', t.error));
    });
    const meta = {};
    const cursorDone = new Promise((resolve, reject) => {
      const req = t.objectStore('meta').openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) { resolve(); return; }
        meta[cursor.key] = cursor.value;
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
    const [records, audit] = await Promise.all([
      request(t.objectStore('records').getAll()),
      request(t.objectStore('audit').getAll()),
      cursorDone,
    ]);
    await done;
    this.store = { meta, records, audit };
    return this.store;
  }

  // Legt een transactie uit vault.js vast (§9.1 stap 2). Gooit ConflictError
  // als het controlepunt afwijkt of de opslag niet leeg is terwijl dat moet;
  // bij elke fout is niets geschreven. Pas na 'complete' wordt de kopie in het
  // geheugen bijgewerkt en draait tx.onCommit.
  commit(tx) {
    return new Promise((resolve, reject) => {
      let t;
      try {
        t = this.db.transaction(STORES, 'readwrite', { durability: 'strict' });
      } catch (err) {
        reject(new StoreError('Opslaan niet mogelijk', err));
        return;
      }
      let conflict = false;
      t.oncomplete = () => {
        try {
          applyTx(this.store, tx);
          resolve();
        } catch (err) {
          reject(err);
        }
      };
      t.onabort = () => reject(conflict ? new ConflictError() : new StoreError('Opslaan afgebroken; er is niets vastgelegd', t.error));
      const meta = t.objectStore('meta');
      const records = t.objectStore('records');
      const audit = t.objectStore('audit');

      const write = () => {
        for (const id of tx.deleteRecordIds || []) {
          records.delete(IDBKeyRange.bound([id, -Infinity], [id, Infinity]));
        }
        for (const [k, v] of Object.entries(tx.putMeta || {})) meta.put(v, k);
        // add in plaats van put: een bestaande sleutel breekt de transactie af.
        for (const r of tx.putRecords || []) records.add(r);
        for (const a of tx.putAudit || []) audit.add(a);
        if (this.testHooks && this.testHooks.afterWrite) this.testHooks.afterWrite(t);
      };
      const refuse = () => { conflict = true; t.abort(); };

      if (tx.requireEmpty) {
        let pending = STORES.length;
        let total = 0;
        for (const s of [meta, records, audit]) {
          const req = s.count();
          req.onsuccess = () => {
            total += req.result;
            pending -= 1;
            if (pending === 0) { if (total > 0) refuse(); else write(); }
          };
        }
      } else {
        const req = meta.get('checkpoint');
        // Synchroon in de callback vergelijken: de transactie blijft open.
        req.onsuccess = () => { if (sameCheckpoint(req.result, tx.expectCheckpoint)) write(); else refuse(); };
      }
    });
  }

  close() {
    this.db.close();
  }
}

// --- In het geheugen (tests) -----------------------------------------------------

// 'disk' speelt de opslag, 'store' de ingelezen kopie; reload() leest opnieuw.
export class MemoryBackend {
  constructor(disk = emptyStore()) {
    this.disk = disk;
    this.store = structuredClone(disk);
  }

  async reload() {
    this.store = structuredClone(this.disk);
    return this.store;
  }

  async commit(tx) {
    applyTx(this.disk, Object.assign({}, tx, { onCommit: null }));
    applyTx(this.store, tx);
  }

  close() {}
}

// --- Schrijfwachtrij ------------------------------------------------------------------

// Alle schrijfacties van een tabblad lopen hierdoor, één tegelijk (audit A1).
// Per schrijfactie:
// 1. Is de volledige controle verschuldigd (§9.4), dan de opslag opnieuw
//    inlezen en controleren; niets wordt geschreven tot die is geslaagd.
// 2. Voorafgaande transacties uit de kluis (nieuwe schrijfsleutel,
//    reservering) vastleggen.
// 3. De schrijfactie voorbereiden (build) en vastleggen.
// Een afwijking (IntegrityError) of een conflict stopt de wachtrij: daarna
// weigert hij alles. Bij een conflict kan een andere schrijver met dezelfde
// schrijfsleutel hebben versleuteld; opnieuw ontgrendelen is dan nodig.
//
// onCheck(event) (optioneel) hoort van een verschuldigde volledige controle:
// {type: 'start'} vooraf, {type: 'done', ms} na een geslaagde controle en
// {type: 'failed'} als inlezen of controleren mislukt (vóór de fout
// doorgaat). Zo kan de app tonen dat de opslag wordt gecontroleerd en hoe
// lang dat duurde (review PR #12, P2).
export class WriteQueue {
  constructor(backend, { clock = () => new Date(), timer = () => globalThis.performance.now() } = {}) {
    this.backend = backend;
    this.clock = clock;
    this.timer = timer;
    this.onCheck = null;
    this.tail = Promise.resolve();
    this.halted = null;
  }

  notify(event) {
    if (!this.onCheck) return;
    try { this.onCheck(event); } catch (err) { /* weergave mag de wachtrij niet storen */ }
  }

  // build(store, session, now) geeft een transactie uit vault.js.
  run(session, build) {
    return this.enqueue(() => this.write(session, build));
  }

  // Transactie zonder sessie: onboarding, terugzetten, mislukte ontgrendeling.
  // build(store, now) geeft de transactie.
  runPlain(build) {
    return this.enqueue(async () => {
      if (this.halted) throw this.halted;
      const tx = await build(this.backend.store, this.clock());
      await this.commit(tx);
      return tx;
    });
  }

  enqueue(job) {
    const result = this.tail.then(job);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }

  async commit(tx) {
    try {
      await this.backend.commit(tx);
    } catch (err) {
      if (err instanceof ConflictError) {
        this.halted = err;
        await this.backend.reload().catch(() => undefined);
      }
      throw err;
    }
  }

  async write(session, build) {
    if (this.halted) throw this.halted;
    try {
      const now = this.clock();
      if (fullCheckDue(session, now)) {
        this.notify({ type: 'start' });
        const t0 = this.timer();
        try {
          await this.backend.reload();
          await fullCheck(this.backend.store, session);
        } catch (err) {
          this.notify({ type: 'failed' });
          throw err;
        }
        this.notify({ type: 'done', ms: this.timer() - t0 });
      }
      for (let i = 0; i < 3; i++) {
        const pre = await nextPrelude(this.backend.store, session, { now });
        if (!pre) break;
        await this.commit(pre);
      }
      let tx;
      try {
        tx = await build(this.backend.store, session, now);
      } catch (err) {
        if (!(err instanceof ReservationNeededError)) throw err;
        // Grote schrijfactie: reservering op maat, dan opnieuw voorbereiden.
        await this.commit(await prepareReservation(this.backend.store, session, err.needed));
        tx = await build(this.backend.store, session, now);
      }
      await this.commit(tx);
      return tx;
    } catch (err) {
      if (err instanceof IntegrityError) this.halted = err;
      throw err;
    }
  }
}

// --- Web Lock en opslagstatus --------------------------------------------------------

// Exclusief slot voor de hele sessie (§9.1). Geeft {release()} of null als
// een ander tabblad of venster het slot heeft. release() geeft een promise die
// afloopt zodra het slot echt vrij is.
export function acquireLock(name = LOCK_NAME) {
  const locks = globalThis.navigator && globalThis.navigator.locks;
  if (!locks) return Promise.reject(new StoreError('Deze browser ondersteunt geen Web Locks'));
  return new Promise((resolve, reject) => {
    const held = locks.request(name, { mode: 'exclusive', ifAvailable: true }, (lock) => {
      if (!lock) {
        resolve(null);
        return undefined;
      }
      return new Promise((release) => resolve({
        release: () => { release(); return held.then(() => undefined); },
      }));
    });
    held.catch(reject);
  });
}

// Slot nemen, opslag openen en een schrijfwachtrij maken. Gooit
// AlreadyOpenError als Dahis elders al open is.
export async function openStorage({ name = DB_NAME, lockName = LOCK_NAME, clock } = {}) {
  const lock = await acquireLock(lockName);
  if (!lock) throw new AlreadyOpenError();
  try {
    const backend = await IdbBackend.open(name);
    const queue = new WriteQueue(backend, { clock });
    return {
      backend,
      queue,
      close() {
        backend.close();
        return lock.release();
      },
    };
  } catch (err) {
    await lock.release();
    throw err;
  }
}

export async function storageStatus() {
  const s = globalThis.navigator && globalThis.navigator.storage;
  if (!s) return { supported: false, persisted: false, usage: null, quota: null };
  const persisted = s.persisted ? await s.persisted() : false;
  const estimate = s.estimate ? await s.estimate() : null;
  return {
    supported: true,
    persisted,
    usage: estimate ? estimate.usage : null,
    quota: estimate ? estimate.quota : null,
  };
}

// Vraagt de browser de opslag niet op te ruimen bij ruimtegebrek. Geeft of
// dat is toegestaan.
export async function requestPersist() {
  const s = globalThis.navigator && globalThis.navigator.storage;
  if (!s || !s.persist) return false;
  return s.persist();
}

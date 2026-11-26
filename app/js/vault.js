// Bewerkingen van formaat 1 op een opslag in het geheugen (docs/formaat.md).
//
// Een opslag is { meta, records, audit }, met dezelfde objecten als in
// IndexedDB (§5). Schrijfacties worden eerst volledig voorbereid
// (versleuteld en gehasht) en dan als *transactie* teruggegeven; applyTx past
// zo'n transactie atomair toe op een opslag in het geheugen. store.js
// doet hetzelfde in één IndexedDB-transactie (§9.1).
//
// De kluis bewaakt zelf de voorwaarden voor schrijven: een verschuldigde
// volledige controle (§9.4), een vastgelegde reservering (§3.8 geval 2) en een
// nieuwe schrijfsleutel na een ongeldige reservering (§3.8). Een schrijfactie
// die daar niet aan voldoet, gooit een fout; nextPrelude() geeft de transactie
// die eerst nodig is.
import {
  FORMAT, DEFAULT_ITERATIONS, BUDGET_LIMIT, RESERVATION_BLOCK, MAX_KID, MAX_EPOCH, ZERO_HASH,
  FormatError, WrongSecretError, IntegrityError,
  b64, fromB64, equalBytes, randomBytes, wipe, isBytes, isUint, isTimestamp, UUID_RE,
  validateKdf, validateWrap, validateRecoveryMeta, validateWriteKeys, validateKeyring,
  validateCheckpointWrapper, validateRecordRow, validateAuditRow, hasExactKeys,
  checkNewPassword, passwordKek, recoveryKek, importDataKey, deriveSubkeys,
  aadWrapPassword, aadWrapRecovery, wrapDataKey, unwrapDataKey,
  wrapKeyringEntry, unwrapKeyringEntry,
  generateRecoveryKey, formatRecoveryKey, parseRecoveryKey,
  sealRecord, openRecord, versionHash, stateDigest,
  auditContent, sealAudit, openAudit, auditHash,
  writeKeysDigest, keyringDigest, sealCheckpoint, openCheckpoint, validateCheckpointContent,
  makeReservation, reservationValid, budgetStart,
  BACKUP_MAGIC, splitBackupFile, parseHeader, encodeBackupFile, decodeBackupPayload,
} from './crypto.js';

export class ConflictError extends Error {
  constructor() { super('De opslag is intussen gewijzigd'); this.name = 'ConflictError'; }
}

export class ReservationNeededError extends Error {
  constructor(needed) {
    super('Eerst een nieuwe reservering vastleggen');
    this.name = 'ReservationNeededError';
    this.needed = needed;
  }
}

export class FullCheckDueError extends Error {
  constructor() { super('Eerst de volledige controle uitvoeren (termijn verstreken)'); this.name = 'FullCheckDueError'; }
}

export class WriteKeyNeededError extends Error {
  constructor() { super('Eerst een nieuwe schrijfsleutel (reservering ongeldig of ontbrekend)'); this.name = 'WriteKeyNeededError'; }
}

export class PasswordReuseError extends FormatError {
  constructor() { super('Kies een nieuw wachtwoord dat nu niet in gebruik is.'); this.name = 'PasswordReuseError'; }
}

// Termijn van de volledige controle (§9.4).
export const FULL_CHECK_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

// Minimale ruimte in de reservering vóór een schrijfactie; een gewone
// schrijfactie heeft er hooguit enkele nodig.
export const PRELUDE_HEADROOM = 64;

function iso(now) {
  return (now || new Date()).toISOString();
}

function uuid() {
  return globalThis.crypto.randomUUID();
}

function lastAudit(audit) {
  let last = null;
  for (const row of audit) if (!last || row.seq > last.seq) last = row;
  return last;
}

// --- Sessie: sleutels in het geheugen ----------------------------------------------

export class Session {
  constructor({ epoch, deviceId, writeKeys }) {
    this.epoch = epoch;
    this.deviceId = deviceId;
    this.dataKeys = new Map();        // epoch -> HKDF CryptoKey
    this.writeKeys = new Map();       // kid -> {epoch, salt}
    this.subkeyCache = new Map();     // kid -> subsleutels
    this.kid = null;                  // actuele schrijfsleutel
    this.counter = 0;                 // gebruikte tellerplaatsen (§3.8)
    this.until = 0;                   // vastgelegde reservering
    this.checkpointContent = null;
    this.lastFullCheckAt = null;      // ms van de laatste gelogde volledige controle
    this.fullCheckPending = false;    // geslaagd in deze sessie, nog niet gelogd
    this.needsNewWriteKey = false;    // reservering ongeldig of ontbrekend (§3.8)
    this.setWriteKeys(writeKeys || []);
  }

  setWriteKeys(list) {
    this.writeKeys = new Map(list.map((w) => [w.kid, { epoch: w.epoch, salt: w.salt }]));
  }

  epochOf(kid) {
    const w = this.writeKeys.get(kid);
    if (!w) throw new IntegrityError('keys', 'Onbekende schrijfsleutel ' + kid);
    return w.epoch;
  }

  async subkeys(kid) {
    if (this.subkeyCache.has(kid)) return this.subkeyCache.get(kid);
    const w = this.writeKeys.get(kid);
    if (!w) throw new IntegrityError('keys', 'Onbekende schrijfsleutel ' + kid);
    const dk = this.dataKeys.get(w.epoch);
    if (!dk) throw new IntegrityError('keys', 'Geen datasleutel voor epoch ' + w.epoch);
    const keys = await deriveSubkeys(dk, w.salt);
    this.subkeyCache.set(kid, keys);
    return keys;
  }

  // Neemt tellerplaatsen in gebruik; ze blijven verbruikt, ook als de
  // transactie daarna mislukt (§3.8).
  take(n) {
    if (this.counter + n > this.until) throw new ReservationNeededError(n);
    const start = this.counter;
    this.counter += n;
    return start;
  }
}

// --- Transacties ------------------------------------------------------------------

export function sameCheckpoint(a, b) {
  if (!a || !b) return a === b;
  return a.kid === b.kid && equalBytes(a.iv, b.iv) && equalBytes(a.ct, b.ct);
}

// Past een transactie atomair toe op een opslag in het geheugen.
export function applyTx(store, tx) {
  if (tx.requireEmpty) {
    if (Object.keys(store.meta).length || store.records.length || store.audit.length) throw new ConflictError();
  } else if (!sameCheckpoint(store.meta.checkpoint, tx.expectCheckpoint)) {
    throw new ConflictError();
  }
  const destroyed = new Set(tx.deleteRecordIds || []);
  store.records = store.records.filter((r) => !destroyed.has(r.id));
  for (const [k, v] of Object.entries(tx.putMeta || {})) store.meta[k] = v;
  for (const r of tx.putRecords || []) store.records.push(r);
  for (const a of tx.putAudit || []) store.audit.push(a);
  if (tx.onCommit) tx.onCommit();
}

export function emptyStore() {
  return { meta: {}, records: [], audit: [] };
}

// Kern van elke schrijfactie (§9.1): versleutelt records, auditregels en het
// nieuwe controlepunt met de actuele schrijfsleutel.
// auditItems: inhoud of functie (versiehashes) -> inhoud.
// prelude: een voorafgaande transactie (nieuwe schrijfsleutel); de regel
// integrity_check komt dan in de eigenlijke schrijfactie.
// fullCheckAction: de regel zelf telt als volledige controle (create, export,
// import).
async function buildTx(store, session, {
  records = [], auditItems = [], putMeta = {}, deleteRecordIds = [], now, prelude = false, fullCheckAction = false,
}) {
  const at = now || new Date();
  if (session.needsNewWriteKey) throw new WriteKeyNeededError();
  if (!fullCheckAction && fullCheckDue(session, at)) throw new FullCheckDueError();
  putMeta = Object.assign({}, putMeta);
  const items = [];
  const failed = store.meta.failed_unlocks;
  if (failed && isUint(failed.count, 1, Number.MAX_SAFE_INTEGER) && !('failed_unlocks' in putMeta)) {
    // §9.1: openstaande mislukte pogingen in de eerste schrijvende transactie.
    items.push({ action: 'unlock_failed', detail: failed.count });
    putMeta.failed_unlocks = { count: 0, last_at: null };
  }
  items.push(...auditItems);
  const logCheck = session.fullCheckPending && !prelude && !fullCheckAction;
  if (logCheck) items.push({ action: 'integrity_check' });
  auditItems = items;
  const needed = records.length + auditItems.length + 1;
  session.take(needed);
  const kid = session.kid;
  const epoch = session.epochOf(kid);
  const keys = await session.subkeys(kid);
  const ts = iso(at);

  const rows = [];
  const hashes = [];
  for (const r of records) {
    const row = await sealRecord(keys.record, epoch,
      { id: r.id, version: r.version, kid, kind: r.kind, updated_at: ts }, r.content);
    rows.push(row);
    hashes.push(b64(await versionHash(row, epoch)));
  }

  let previous = lastAudit(store.audit);
  let hPrev = previous ? previous.h : ZERO_HASH;
  let seq = previous ? previous.seq : 0;
  const auditRows = [];
  for (const item of auditItems) {
    const fields = typeof item === 'function' ? item(hashes) : item;
    const content = auditContent(Object.assign({ ts, device_id: session.deviceId }, fields));
    seq += 1;
    const row = await sealAudit(keys.audit, epoch, { seq, kid, hPrev }, content);
    auditRows.push(row);
    hPrev = row.h;
  }

  const destroyed = new Set(deleteRecordIds);
  const allRecords = store.records.filter((r) => !destroyed.has(r.id)).concat(rows);
  const writeKeys = putMeta.write_keys || store.meta.write_keys;
  const keyring = putMeta.keyring || store.meta.keyring;
  const content = {
    seq,
    h: b64(hPrev),
    state: b64(await stateDigest(allRecords, (k) => session.epochOf(k))),
    records: allRecords.length,
    counter: session.counter,
    write_keys_digest: b64(await writeKeysDigest(writeKeys)),
    keyring_digest: b64(await keyringDigest(keyring)),
  };
  const checkpoint = await sealCheckpoint(keys.checkpoint, kid, epoch, content);
  return {
    expectCheckpoint: store.meta.checkpoint,
    putMeta: Object.assign({}, putMeta, { checkpoint }),
    putRecords: rows,
    putAudit: auditRows,
    deleteRecordIds,
    checkpointContent: content,
    onCommit: () => {
      session.checkpointContent = content;
      if (logCheck || fullCheckAction) {
        session.lastFullCheckAt = at.getTime();
        session.fullCheckPending = false;
      }
    },
  };
}

// Is de volledige controle verschuldigd (§9.4)? Ook als de laatste controle
// in de toekomst ligt (klok verzet).
export function fullCheckDue(session, now = new Date()) {
  if (session.fullCheckPending) return false;
  const last = session.lastFullCheckAt;
  const t = now.getTime();
  return last === null || t < last || t - last >= FULL_CHECK_INTERVAL_MS;
}

// De transactie die vóór een schrijfactie nodig is, of null. De aanroeper
// past ze toe en vraagt daarna opnieuw. Een verschuldigde volledige controle
// (fullCheckDue) voert de aanroeper vooraf zelf uit; zonder die controle
// weigert elke schrijfactie.
export async function nextPrelude(store, session, { now } = {}) {
  if (session.needsNewWriteKey || session.counter + PRELUDE_HEADROOM + 2 > BUDGET_LIMIT) {
    return rollWriteKey(store, session, { now });
  }
  if (session.until - session.counter < PRELUDE_HEADROOM) {
    return prepareReservation(store, session, PRELUDE_HEADROOM);
  }
  return null;
}

// Reservering voor een bestaande schrijfsleutel (§3.8 geval 2). Geeft null
// als de huidige reservering volstaat.
// Weigert zolang een nieuwe schrijfsleutel nodig is (§3.8, ongeldige
// reservering): de tellerstand van de huidige sleutel is dan niet te
// vertrouwen.
export async function prepareReservation(store, session, needed) {
  if (session.needsNewWriteKey) throw new WriteKeyNeededError();
  if (session.counter + needed <= session.until) return null;
  if (session.counter + needed + 2 > BUDGET_LIMIT) {
    throw new FormatError('Budget van de schrijfsleutel op: eerst rollWriteKey');
  }
  const until = Math.min(BUDGET_LIMIT, session.counter + needed + RESERVATION_BLOCK);
  const keys = await session.subkeys(session.kid);
  const reservation = await makeReservation(keys.reserve, session.kid, until);
  return {
    expectCheckpoint: store.meta.checkpoint,
    putMeta: { reservation },
    onCommit: () => { session.until = until; },
  };
}

// Nieuwe schrijfsleutel in dezelfde transactie als alles wat ermee wordt
// versleuteld (§3.8 geval 1). Wordt de transactie niet toegepast, dan blijft
// de sessie ongewijzigd en wordt de salt nooit meer gebruikt.
async function withNewWriteKey(store, session, epoch, build) {
  const writeKeys = store.meta.write_keys || [];
  const kid = writeKeys.reduce((m, w) => Math.max(m, w.kid), 0) + 1;
  if (kid > MAX_KID) throw new FormatError('Geen schrijfsleutels meer beschikbaar (nieuw formaat nodig)');
  const entry = { kid, epoch, salt: randomBytes(16) };
  const newList = writeKeys.concat([entry]);

  const saved = {
    kid: session.kid, counter: session.counter, until: session.until, writeKeys: session.writeKeys,
    needsNewWriteKey: session.needsNewWriteKey,
  };
  session.setWriteKeys(newList);
  session.needsNewWriteKey = false;   // alleen binnen deze transactie, met de nieuwe sleutel
  session.kid = kid;
  session.counter = 0;
  session.until = BUDGET_LIMIT;   // binnen deze transactie; de echte reservering volgt hieronder
  try {
    const tx = await build(newList, kid);
    const until = Math.min(BUDGET_LIMIT, session.counter + RESERVATION_BLOCK);
    const keys = await session.subkeys(kid);
    tx.putMeta.reservation = await makeReservation(keys.reserve, kid, until);
    tx.putMeta.write_keys = newList;
    const used = session.counter;
    const inner = tx.onCommit;
    tx.onCommit = () => {
      session.setWriteKeys(newList);
      session.kid = kid;
      session.counter = used;
      session.until = until;
      session.needsNewWriteKey = false;
      inner();
    };
    return tx;
  } finally {
    // Tot de transactie is toegepast, bestaat deze schrijfsleutel niet: geen
    // subsleutels in de cache laten staan, zodat een nieuwe poging met
    // hetzelfde kid-nummer nooit deze salt hergebruikt.
    session.subkeyCache.delete(kid);
    session.kid = saved.kid;
    session.counter = saved.counter;
    session.until = saved.until;
    session.writeKeys = saved.writeKeys;
    session.needsNewWriteKey = saved.needsNewWriteKey;
  }
}

// Wissel naar een nieuwe schrijfsleutel als het budget op raakt (§3.8).
// Ook na een ongeldige of ontbrekende reservering (session.needsNewWriteKey).
export async function rollWriteKey(store, session, { now } = {}) {
  return withNewWriteKey(store, session, session.epoch, (newList, kid) => buildTx(store, session, {
    auditItems: [{ action: 'write_key', detail: kid }],
    putMeta: { write_keys: newList },
    now,
    prelude: true,
  }));
}

// --- Geheimen -------------------------------------------------------------------

// secret: {password} of {recoveryKey: tekst}. Geeft de ruwe datasleutel van
// de actuele epoch; de aanroeper overschrijft hem na gebruik (§3.7).
async function unwrapCurrent(src, secret) {
  if (secret && typeof secret.password === 'string') {
    const kek = await passwordKek(secret.password, src.kdf);
    return { raw: await unwrapDataKey(kek, src.wrapped_password, aadWrapPassword(src.kdf, src.epoch)), route: 'password' };
  }
  if (secret && typeof secret.recoveryKey === 'string') {
    const rk = await parseRecoveryKey(secret.recoveryKey);
    try {
      const kek = await recoveryKek(rk, src.recovery.salt);
      return { raw: await unwrapDataKey(kek, src.recovery, aadWrapRecovery(src.recovery, src.epoch)), route: 'recovery' };
    } finally {
      wipe(rk);
    }
  }
  throw new FormatError('Geen wachtwoord of herstelsleutel opgegeven');
}

function validateRoute(meta, secret) {
  if (!isUint(meta.epoch, 1, MAX_EPOCH)) throw new FormatError('epoch ongeldig');
  if (secret && typeof secret.password === 'string') {
    validateKdf(meta.kdf);
    validateWrap(meta.wrapped_password);
  } else {
    validateRecoveryMeta(meta.recovery);
  }
}

async function newPasswordWrap(raw, newPassword, epoch) {
  checkNewPassword(newPassword);
  const kdf = { alg: 'PBKDF2-SHA256', iterations: DEFAULT_ITERATIONS, salt: randomBytes(16) };
  const kek = await passwordKek(newPassword, kdf);
  return { kdf, wrapped_password: await wrapDataKey(kek, raw, aadWrapPassword(kdf, epoch)) };
}

async function newRecoveryWrap(raw, epoch) {
  const rk = generateRecoveryKey();
  try {
    const recovery = { alg: 'HKDF-SHA256', salt: randomBytes(16) };
    const kek = await recoveryKek(rk, recovery.salt);
    Object.assign(recovery, await wrapDataKey(kek, raw, aadWrapRecovery(recovery, epoch)));
    const ordered = { alg: recovery.alg, salt: recovery.salt, iv: recovery.iv, ct: recovery.ct };
    return { recovery: ordered, recoveryKeyText: await formatRecoveryKey(rk) };
  } finally {
    wipe(rk);
  }
}

// --- Onboarding (§12.1) ---------------------------------------------------------------

export async function createInstallation({ password, now, deviceId = uuid() }) {
  checkNewPassword(password);
  const raw = randomBytes(32);
  try {
    const { kdf, wrapped_password } = await newPasswordWrap(raw, password, 1);
    const { recovery, recoveryKeyText } = await newRecoveryWrap(raw, 1);
    const session = new Session({ epoch: 1, deviceId });
    session.dataKeys.set(1, await importDataKey(raw.slice()));
    const store = emptyStore();
    store.meta.keyring = [];
    const tx = await withNewWriteKey(store, session, 1, (newList) => buildTx(
      { meta: { write_keys: newList, keyring: [] }, records: [], audit: [] }, session, {
        auditItems: [{ action: 'create', detail: 'install' }],
        putMeta: { write_keys: newList },
        now,
        fullCheckAction: true,
      }));
    Object.assign(tx.putMeta, {
      format: FORMAT,
      created_at: iso(now),
      device_id: deviceId,
      epoch: 1,
      kdf,
      wrapped_password,
      recovery,
      keyring: [],
      last_backup_at: null,
      failed_unlocks: { count: 0, last_at: null },
    });
    tx.requireEmpty = true;
    return { tx, session, recoveryKey: recoveryKeyText };
  } finally {
    wipe(raw);
  }
}

// --- Ontgrendelen (§12.2) ----------------------------------------------------------------

// Mislukt de ontgrendeling, dan alleen deze transactie (§12.2 stap 3).
export function failedUnlockTx(store, now) {
  const prev = store.meta.failed_unlocks;
  const count = prev && isUint(prev.count, 0, Number.MAX_SAFE_INTEGER) ? prev.count + 1 : 1;
  return { expectCheckpoint: store.meta.checkpoint, putMeta: { failed_unlocks: { count, last_at: iso(now) } } };
}

// Samenhang van sleutelverwijzingen (§3.2) en registerdigests.
async function checkCoherence(meta, checkpointKid, checkpointContent, records, audit) {
  try {
    validateWriteKeys(meta.write_keys);
    validateKeyring(meta.keyring);
  } catch (err) {
    throw new IntegrityError('keys', err.message);
  }
  const byKid = new Map(meta.write_keys.map((w) => [w.kid, w]));
  const current = byKid.get(checkpointKid);
  if (!current || current.epoch !== meta.epoch) throw new IntegrityError('keys', 'Controlepunt hoort niet bij de actuele epoch');
  const epochs = meta.keyring.map((k) => k.epoch).sort((a, b) => a - b);
  if (epochs.length !== meta.epoch - 1 || epochs.some((e, i) => e !== i + 1)) {
    throw new IntegrityError('keys', 'Sleutelring onvolledig');
  }
  for (const k of meta.keyring) {
    const w = byKid.get(k.kid);
    if (!w || w.epoch !== meta.epoch) throw new IntegrityError('keys', 'Sleutelring onder verkeerde schrijfsleutel');
  }
  for (const row of records.concat(audit)) {
    if (!byKid.has(row.kid)) throw new IntegrityError('keys', 'Verwijzing naar onbekende schrijfsleutel');
  }
  if (meta.reservation && !byKid.has(meta.reservation.kid)) throw new IntegrityError('keys', 'Reservering verwijst naar onbekende schrijfsleutel');
  if (b64(await writeKeysDigest(meta.write_keys)) !== checkpointContent.write_keys_digest
    || b64(await keyringDigest(meta.keyring)) !== checkpointContent.keyring_digest) {
    throw new IntegrityError('keys', 'Registerdigest klopt niet');
  }
}

// Zet een sessie op uit meta en een ontsleutelde datasleutel; ontsleutelt het
// controlepunt en de sleutelring.
async function openSession(meta, records, audit, dataKey) {
  const session = new Session({ epoch: meta.epoch, deviceId: meta.device_id });
  session.dataKeys.set(meta.epoch, dataKey);
  try {
    validateWriteKeys(meta.write_keys);
    validateCheckpointWrapper(meta.checkpoint);
  } catch (err) {
    throw new IntegrityError(meta.checkpoint ? 'keys' : 'checkpoint', err.message);
  }
  session.setWriteKeys(meta.write_keys);
  const cpKid = meta.checkpoint.kid;
  if (!session.writeKeys.has(cpKid) || session.epochOf(cpKid) !== meta.epoch) {
    throw new IntegrityError('keys', 'Controlepunt hoort niet bij de actuele epoch');
  }
  const content = await openCheckpoint((await session.subkeys(cpKid)).checkpoint, meta.epoch, meta.checkpoint);
  await checkCoherence(meta, cpKid, content, records, audit);
  for (const entry of meta.keyring) {
    const raw = await unwrapKeyringEntry((await session.subkeys(entry.kid)).keyring, meta.epoch, entry);
    session.dataKeys.set(entry.epoch, await importDataKey(raw));
  }
  session.kid = cpKid;
  session.checkpointContent = content;
  return session;
}

// Geeft {session} bij succes. Gooit WrongSecretError bij een onjuist geheim
// (gebruik dan failedUnlockTx), FormatError als de route onbruikbaar is, en
// IntegrityError bij een afwijking (§10). Is de volledige controle
// verschuldigd (fullCheckDue), dan weigert elke schrijfactie tot fullCheck is
// geslaagd; de regel integrity_check volgt dan vanzelf.
export async function unlock(store, secret) {
  const meta = store.meta;
  validateRoute(meta, secret);
  const { raw, route } = await unwrapCurrent(meta, secret);
  const dataKey = await importDataKey(raw);
  if (!isUint(meta.format, FORMAT, FORMAT) || !isTimestamp(meta.created_at)
    || typeof meta.device_id !== 'string' || !UUID_RE.test(meta.device_id)) {
    throw new IntegrityError('keys', 'meta ongeldig');
  }
  try { validateKdf(meta.kdf); validateWrap(meta.wrapped_password); validateRecoveryMeta(meta.recovery); } catch (err) {
    throw new IntegrityError('keys', err.message);
  }
  const session = await openSession(meta, store.records, store.audit, dataKey);
  await quickCheck(store, session);
  // §3.8: alleen een geldige reservering voor de actuele schrijfsleutel telt.
  // Ontbreekt ze, hoort ze bij een oudere sleutel of klopt ze niet, dan is de
  // tellerstand niet te vertrouwen: eerst een nieuwe schrijfsleutel.
  let reserved = 0;
  const r = meta.reservation;
  const keys = await session.subkeys(session.kid);
  if (r && r.kid === session.kid && await reservationValid(keys.reserve, r, session.kid)) {
    reserved = r.until;
  } else {
    session.needsNewWriteKey = true;
  }
  session.counter = budgetStart(session.checkpointContent.counter, reserved);
  session.until = session.counter;
  session.route = route;
  session.lastFullCheckAt = await findLastFullCheck(store, session);
  return { session };
}

// Tijdstip (ms) van de laatste regel die als volledige controle telt, van
// achter naar voren gezocht. Lukt dat niet (ontbrekende of onleesbare regel),
// dan null: de controle is dan verschuldigd en vindt de oorzaak zelf.
const FULL_CHECK_ACTIONS = new Set(['integrity_check', 'export', 'import']);

async function findLastFullCheck(store, session) {
  const rows = sortedAudit(store.audit);
  try {
    for (let i = rows.length - 1; i >= 0; i--) {
      const row = rows[i];
      if (row.seq !== i + 1) return null;
      const hPrev = i > 0 ? rows[i - 1].h : ZERO_HASH;
      const c = await openAudit((await session.subkeys(row.kid)).audit, session.epochOf(row.kid), row, hPrev);
      if (FULL_CHECK_ACTIONS.has(c.action) || (c.action === 'create' && c.detail === 'install')) {
        const t = Date.parse(c.ts);
        return Number.isFinite(t) ? t : null;
      }
    }
  } catch (err) {
    return null;
  }
  return null;
}

// Regels na een geslaagde ontgrendeling (§12.2 stap 5). unlock_failed en
// integrity_check voegt buildTx zelf toe als ze openstaan.
export async function unlockTx(store, session, { now } = {}) {
  return buildTx(store, session, { auditItems: [{ action: 'unlock', detail: session.route }], now });
}

// --- Controles (§9.2, §9.3) -------------------------------------------------------------

function sortedAudit(audit) {
  return audit.slice().sort((a, b) => a.seq - b.seq);
}

// Ontsleutelt het opgeslagen controlepunt en eist dat het dezelfde toestand
// beschrijft als het controlepunt waarop de sessie voortbouwt. Zo valt een
// controlepunt op dat na het ontgrendelen in de opslag is vervangen, ook met
// dezelfde kid (review PR #9).
const CHECKPOINT_KEYS = ['seq', 'h', 'state', 'records', 'counter', 'write_keys_digest', 'keyring_digest'];

async function checkStoredCheckpoint(store, session) {
  const wrapper = store.meta.checkpoint;
  try { validateCheckpointWrapper(wrapper); } catch (err) { throw new IntegrityError('checkpoint', err.message); }
  if (!session.writeKeys.has(wrapper.kid) || session.epochOf(wrapper.kid) !== store.meta.epoch) {
    throw new IntegrityError('keys', 'Controlepunt hoort niet bij de actuele epoch');
  }
  if (wrapper.kid !== session.kid) {
    throw new IntegrityError('checkpoint', 'Controlepunt onder een andere schrijfsleutel dan de sessie');
  }
  const stored = await openCheckpoint((await session.subkeys(wrapper.kid)).checkpoint, store.meta.epoch, wrapper);
  const cp = session.checkpointContent;
  if (CHECKPOINT_KEYS.some((k) => stored[k] !== cp[k])) {
    throw new IntegrityError('checkpoint', 'Controlepunt in de opslag wijkt af van het geauthenticeerde controlepunt');
  }
}

export async function quickCheck(store, session) {
  return quickCheckInner(store, session, false);
}

// backup = true alleen vanuit inspectBackup(): daar is de opslag de inhoud van
// een back-up waarvan het bestand al is geauthenticeerd, en staat het
// controlepunt onversleuteld in die inhoud. Bewust niet geëxporteerd, zodat
// geen aanroeper dit pad voor de echte opslag kan gebruiken (review PR #9).
async function quickCheckInner(store, session, backup) {
  const cp = session.checkpointContent;
  if (!backup) await checkStoredCheckpoint(store, session);
  await checkCoherence(store.meta, store.meta.checkpoint.kid, cp, store.records, store.audit);
  const rows = sortedAudit(store.audit);
  const last = rows[rows.length - 1];
  if (!last) throw new IntegrityError('head', 'Auditlog leeg');
  try { validateAuditRow(last); } catch (err) { throw new IntegrityError('chain', err.message); }
  if (last.seq !== cp.seq || b64(last.h) !== cp.h) throw new IntegrityError('head', 'Laatste auditregel wijkt af van het controlepunt');
  const before = rows.length > 1 ? rows[rows.length - 2] : null;
  const hPrev = last.seq === 1 ? ZERO_HASH : (before && before.seq === last.seq - 1 && isBytes(before.h, 32) ? before.h : null);
  if (!hPrev || !equalBytes(await auditHash(hPrev, last.seq, last.kid, last.iv, last.ct), last.h)) {
    throw new IntegrityError('head', 'Hash van de laatste auditregel klopt niet');
  }
  for (const row of store.records) {
    try { validateRecordRow(row); } catch (err) { throw new IntegrityError('record', err.message); }
  }
  const state = b64(await stateDigest(store.records, (k) => session.epochOf(k)));
  if (state !== cp.state || store.records.length !== cp.records) throw new IntegrityError('state', 'Recordtoestand wijkt af van het controlepunt');
}

export async function fullCheck(store, session) {
  return fullCheckInner(store, session, false);
}

// Een fout bij het inlezen van een regel of versie is altijd een afwijking
// met de code van die soort, ook als de inhoud wel ontsleutelt maar niet aan
// het formaat voldoet (FormatError).
async function asIntegrity(code, fn) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof IntegrityError) throw err;
    throw new IntegrityError(code, err.message);
  }
}

async function fullCheckInner(store, session, backup) {
  const rows = sortedAudit(store.audit);
  let hPrev = ZERO_HASH;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try { validateAuditRow(row); } catch (err) { throw new IntegrityError('chain', err.message); }
    if (row.seq !== i + 1) throw new IntegrityError('chain', 'Gat in de volgnummers');
    if (!equalBytes(await auditHash(hPrev, row.seq, row.kid, row.iv, row.ct), row.h)) {
      throw new IntegrityError('chain', 'Hash van auditregel ' + row.seq + ' klopt niet');
    }
    const prev = hPrev;
    await asIntegrity('chain', async () => openAudit((await session.subkeys(row.kid)).audit, session.epochOf(row.kid), row, prev));
    hPrev = row.h;
  }
  for (const row of store.records) {
    await asIntegrity('record', async () => openRecord((await session.subkeys(row.kid)).record, session.epochOf(row.kid), row));
  }
  await quickCheckInner(store, session, backup);
  session.fullCheckPending = true;
}

// Volledige controle op verzoek (§9.4): controleren en de regel
// integrity_check schrijven.
export async function integrityCheckTx(store, session, { now } = {}) {
  if (!session.fullCheckPending) await fullCheck(store, session);
  return buildTx(store, session, { now });
}

// --- Logboek lezen ---------------------------------------------------------------------

export const AUDIT_PAGE_SIZE = 50;

// Ontsleutelt een bladzijde van het auditlog, nieuwste eerst: hooguit `limit`
// regels met seq < before (zonder before: vanaf de laatste regel). Een pure
// leesfunctie; er wordt niets geschreven en het lezen wordt niet gelogd
// (besluit gebruiker 2026-11-25). Elke regel ontsleutelt met de h van de
// regel ervoor in de AAD; lukt dat niet, of ontbreekt een volgnummer, dan is
// dat een afwijking `chain` (§10). De hashketen zelf controleert fullCheck.
// Geeft {entries, next}: next is de before voor de volgende bladzijde, of
// null als er geen oudere regels zijn.
export async function readAuditPage(store, session, { before = null, limit = AUDIT_PAGE_SIZE } = {}) {
  const rows = sortedAudit(store.audit);
  const n = rows.length;
  const end = before === null ? n : Math.min(n, Math.max(0, before - 1));
  const start = Math.max(0, end - Math.max(1, limit));
  const entries = [];
  for (let i = end - 1; i >= start; i--) {
    const row = rows[i];
    try { validateAuditRow(row); } catch (err) { throw new IntegrityError('chain', err.message); }
    if (row.seq !== i + 1) throw new IntegrityError('chain', 'Gat in de volgnummers');
    let hPrev = ZERO_HASH;
    if (i > 0) {
      const p = rows[i - 1];
      if (!p || p.seq !== i || !isBytes(p.h, 32)) throw new IntegrityError('chain', 'Gat in de volgnummers');
      hPrev = p.h;
    }
    const c = await asIntegrity('chain', async () => openAudit((await session.subkeys(row.kid)).audit, session.epochOf(row.kid), row, hPrev));
    entries.push({
      seq: row.seq, kid: row.kid, ts: c.ts, action: c.action, kind: c.kind, record_id: c.record_id,
      version: c.version, result: c.result, detail: c.detail,
    });
  }
  return { entries, next: start > 0 ? start + 1 : null };
}

// --- Records ----------------------------------------------------------------------------

function versionsOf(store, id) {
  return store.records.filter((r) => r.id === id).sort((a, b) => a.version - b.version);
}

export async function readRecord(store, session, id) {
  const versions = versionsOf(store, id);
  if (!versions.length) return null;
  const row = versions[versions.length - 1];
  return { row, content: await openRecord((await session.subkeys(row.kid)).record, session.epochOf(row.kid), row) };
}

export async function putRecordTx(store, session, { id = uuid(), kind, data, schema = 1, now }) {
  const versions = versionsOf(store, id);
  const version = versions.length ? versions[versions.length - 1].version + 1 : 1;
  return buildTx(store, session, {
    records: [{ id, version, kind, content: { schema, data } }],
    auditItems: [(h) => ({ action: version === 1 ? 'create' : 'update', kind, record_id: id, version, vh: h[0] })],
    now,
  });
}

export async function deleteRecordTx(store, session, { id, schema = 1, now }) {
  const versions = versionsOf(store, id);
  if (!versions.length) throw new FormatError('Record bestaat niet');
  const last = versions[versions.length - 1];
  return buildTx(store, session, {
    records: [{ id, version: last.version + 1, kind: last.kind, content: { schema, deleted: true } }],
    auditItems: [(h) => ({ action: 'delete', kind: last.kind, record_id: id, version: last.version + 1, vh: h[0] })],
    now,
  });
}

export async function destroyRecordTx(store, session, { id, now }) {
  const versions = versionsOf(store, id);
  if (!versions.length) throw new FormatError('Record bestaat niet');
  return buildTx(store, session, {
    auditItems: [{ action: 'destroy', kind: versions[0].kind, record_id: id }],
    deleteRecordIds: [id],
    now,
  });
}

export async function auditTx(store, session, items, { now } = {}) {
  return buildTx(store, session, { auditItems: items, now });
}

// --- Wachtwoord en herstel (§12.3, §12.4) ---------------------------------------------------

export async function changePasswordTx(store, session, { current, newPassword, detail = 'user', now }) {
  const { raw, route } = await unwrapCurrent(store.meta, current);
  try {
    const wrap = await newPasswordWrap(raw, newPassword, store.meta.epoch);
    const items = route === 'recovery' && detail === 'recovery' ? [{ action: 'recovery_used' }] : [];
    items.push({ action: 'password_change', detail });
    return buildTx(store, session, { auditItems: items, putMeta: wrap, now });
  } finally {
    wipe(raw);
  }
}

// KDF-upgrade bij ontgrendelen (§12.2 stap 6): de wachtwoordwrap heeft
// minder rondes dan de standaard. Zelfde wachtwoord, nieuwe salt_w en
// DEFAULT_ITERATIONS; de ruwe DK wordt binnen deze handeling opnieuw
// ontsleuteld met een KEK uit het net ingevoerde wachtwoord (§3.7).
export async function kdfUpgradeTx(store, session, { password, now }) {
  if (!store.meta.kdf || store.meta.kdf.iterations >= DEFAULT_ITERATIONS) {
    throw new FormatError('Geen KDF-upgrade nodig');
  }
  const { raw } = await unwrapCurrent(store.meta, { password });
  try {
    const wrap = await newPasswordWrap(raw, password, store.meta.epoch);
    return buildTx(store, session, {
      auditItems: [{ action: 'password_change', detail: 'kdf_upgrade' }], putMeta: wrap, now,
    });
  } finally {
    wipe(raw);
  }
}

// --- Sleutels vernieuwen (§12.5) ------------------------------------------------------------

// Opent dit wachtwoord de huidige wachtwoordwrap? (audit A4)
async function opensCurrentWrap(meta, password) {
  try {
    const { raw } = await unwrapCurrent(meta, { password });
    wipe(raw);
    return true;
  } catch (err) {
    if (err instanceof WrongSecretError) return false;
    throw err;
  }
}

// Weigert een nieuw wachtwoord dat de huidige wrap opent: na een mogelijk lek
// moet het nieuwe wachtwoord onbekend zijn bij wie het oude kent (audit A4).
export async function rotateKeysTx(store, session, { current, newPassword, now }) {
  const meta = store.meta;
  checkNewPassword(newPassword);
  if (await opensCurrentWrap(meta, newPassword)) throw new PasswordReuseError();
  const { raw } = await unwrapCurrent(meta, current);
  const olds = [{ epoch: meta.epoch, raw }];
  const fresh = randomBytes(32);
  try {
    for (const entry of meta.keyring) {
      olds.push({ epoch: entry.epoch, raw: await unwrapKeyringEntry((await session.subkeys(entry.kid)).keyring, meta.epoch, entry) });
    }
    const epoch = meta.epoch + 1;
    if (epoch > MAX_EPOCH) throw new FormatError('Geen epochs meer beschikbaar (nieuw formaat nodig)');
    const wrap = await newPasswordWrap(fresh, newPassword, epoch);
    const { recovery, recoveryKeyText } = await newRecoveryWrap(fresh, epoch);
    const saved = { epoch: session.epoch, dataKeys: new Map(session.dataKeys) };
    session.dataKeys.set(epoch, await importDataKey(fresh.slice()));
    session.epoch = epoch;
    try {
      const tx = await withNewWriteKey(store, session, epoch, async (newList, kid) => {
        session.take(olds.length);
        const keyringKey = (await session.subkeys(kid)).keyring;
        const keyring = [];
        for (const o of olds.sort((a, b) => a.epoch - b.epoch)) {
          keyring.push(await wrapKeyringEntry(keyringKey, kid, epoch, o.epoch, o.raw));
        }
        return buildTx(store, session, {
          auditItems: [{ action: 'key_rotation', detail: epoch }, { action: 'write_key', detail: kid }],
          putMeta: Object.assign({ epoch, keyring, write_keys: newList, recovery }, wrap),
          now,
        });
      });
      const commit = tx.onCommit;
      const newKey = session.dataKeys.get(epoch);
      tx.onCommit = () => { session.epoch = epoch; session.dataKeys.set(epoch, newKey); commit(); };
      return { tx, recoveryKey: recoveryKeyText };
    } finally {
      session.epoch = saved.epoch;
      session.dataKeys = saved.dataKeys;
    }
  } finally {
    for (const o of olds) wipe(o.raw);
    wipe(fresh);
  }
}

// --- Back-up (§11) ---------------------------------------------------------------------

function writeKeyToJson(w) { return { kid: w.kid, epoch: w.epoch, salt: b64(w.salt) }; }
function keyringToJson(k) { return { epoch: k.epoch, kid: k.kid, iv: b64(k.iv), ct: b64(k.ct) }; }
function recordToJson(r) {
  return { id: r.id, version: r.version, kid: r.kid, kind: r.kind, updated_at: r.updated_at, iv: b64(r.iv), ct: b64(r.ct) };
}
function auditToJson(a) { return { seq: a.seq, kid: a.kid, iv: b64(a.iv), ct: b64(a.ct), h: b64(a.h) }; }

function bytesFields(obj, fields, keys) {
  if (!hasExactKeys(obj, keys)) throw new FormatError('inhoud: ongeldige velden');
  const out = {};
  for (const k of keys) out[k] = fields.includes(k) ? fromB64(obj[k]) : obj[k];
  return out;
}

function payloadToStore(payload) {
  if (!hasExactKeys(payload, ['format', 'created_at', 'app_version', 'source_device_id',
    'write_keys', 'keyring', 'records', 'audit', 'checkpoint'])) throw new FormatError('inhoud: ongeldige velden');
  if (payload.format !== FORMAT || !isTimestamp(payload.created_at) || typeof payload.app_version !== 'string'
    || typeof payload.source_device_id !== 'string' || !UUID_RE.test(payload.source_device_id)) {
    throw new FormatError('inhoud: ongeldige waarden');
  }
  for (const k of ['write_keys', 'keyring', 'records', 'audit']) {
    if (!Array.isArray(payload[k])) throw new FormatError('inhoud: ' + k);
  }
  const writeKeys = payload.write_keys.map((w) => bytesFields(w, ['salt'], ['kid', 'epoch', 'salt']));
  const keyring = payload.keyring.map((k) => bytesFields(k, ['iv', 'ct'], ['epoch', 'kid', 'iv', 'ct']));
  const records = payload.records.map((r) => bytesFields(r, ['iv', 'ct'], ['id', 'version', 'kid', 'kind', 'updated_at', 'iv', 'ct']));
  const audit = payload.audit.map((a) => bytesFields(a, ['iv', 'ct', 'h'], ['seq', 'kid', 'iv', 'ct', 'h']));
  for (const r of records) validateRecordRow(r);
  for (const a of audit) validateAuditRow(a);
  if (!hasExactKeys(payload.checkpoint, ['kid', 'content'])) throw new FormatError('inhoud: checkpoint');
  return {
    writeKeys, keyring, records, audit, checkpoint: payload.checkpoint,
    createdAt: payload.created_at, appVersion: payload.app_version,
  };
}

// Back-up maken (§11.3): eerst volledige controle, dan de regel export.
// Geeft de transactie; na toepassen bouwt buildFile het bestand.
export async function exportTx(store, session, { now } = {}) {
  if (!session.fullCheckPending) await fullCheck(store, session);
  const state = session.checkpointContent.state;
  return buildTx(store, session, { auditItems: [{ action: 'export', state }], now, fullCheckAction: true });
}

export async function buildBackupFile(store, session, { now, appVersion = '0.0.0', maxBytes } = {}) {
  const meta = store.meta;
  const header = {
    magic: BACKUP_MAGIC,
    format: FORMAT,
    epoch: meta.epoch,
    salt: randomBytes(16),
    kdf: meta.kdf,
    wrapped_password: meta.wrapped_password,
    recovery: meta.recovery,
  };
  const payload = {
    format: FORMAT,
    created_at: iso(now),
    app_version: appVersion,
    source_device_id: meta.device_id,
    write_keys: meta.write_keys.map(writeKeyToJson),
    keyring: meta.keyring.map(keyringToJson),
    records: store.records.map(recordToJson),
    audit: sortedAudit(store.audit).map(auditToJson),
    checkpoint: { kid: meta.checkpoint.kid, content: session.checkpointContent },
  };
  return encodeBackupFile(session.dataKeys.get(meta.epoch), header, payload, undefined, { maxBytes });
}

// Back-up van een formaat dat deze app niet kent (nieuwer dan de app): de
// app moet worden bijgewerkt (§14).
export class UnknownBackupFormatError extends FormatError {
  constructor(format) {
    super('Back-up van een onbekend formaat: ' + format);
    this.name = 'UnknownBackupFormatError';
    this.format = format;
  }
}

// Het bestand komt niet overeen met de export van deze opslag (§11.4, gelijk
// aan een export). Geen afwijking van de opslag zelf: de app stopt niet.
export class BackupMismatchError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'BackupMismatchError';
    this.cause = cause;
  }
}

// Lezers per formaatnummer van het bestand (§14): een lezer wordt nooit
// verwijderd. Formaat 1 is het enige.
const BACKUP_READERS = new Map([
  [1, { header: parseHeader, body: checkBackupBodyV1 }],
]);

function backupReader(line1) {
  let format;
  try {
    const raw = JSON.parse(line1);
    format = raw && typeof raw === 'object' ? raw.format : undefined;
  } catch (err) {
    format = undefined;
  }
  // Geen bruikbaar nummer: de strikte lezer van het huidige formaat geeft de
  // juiste foutmelding.
  if (!Number.isSafeInteger(format) || format < 1) return BACKUP_READERS.get(FORMAT);
  const reader = BACKUP_READERS.get(format);
  if (!reader) throw new UnknownBackupFormatError(format);
  return reader;
}

// §11.5 stap 4–5 met de datasleutel van de epoch uit de header: inhoud
// ontsleutelen en strikt inlezen, samenhang, sleutelring, volledige controle.
// Geeft {data, session}; session is een sessie op de inhoud van het bestand.
async function checkBackupBodyV1(header, line1, line2, dataKey) {
  const data = payloadToStore(await decodeBackupPayload(dataKey, header, line1, line2));
  const meta = { epoch: header.epoch, write_keys: data.writeKeys, keyring: data.keyring, reservation: undefined };
  const session = new Session({ epoch: header.epoch, deviceId: null });
  session.dataKeys.set(header.epoch, dataKey);
  try { validateWriteKeys(data.writeKeys); validateKeyring(data.keyring); } catch (err) { throw new IntegrityError('keys', err.message); }
  session.setWriteKeys(data.writeKeys);
  const cpKid = data.checkpoint.kid;
  if (!session.writeKeys.has(cpKid) || session.epochOf(cpKid) !== header.epoch) {
    throw new IntegrityError('keys', 'Controlepunt hoort niet bij de epoch van de back-up');
  }
  const content = data.checkpoint.content;
  try {
    validateCheckpointContent(content);
  } catch (err) {
    throw new IntegrityError('checkpoint', err.message);
  }
  await checkCoherence(meta, cpKid, content, data.records, data.audit);
  for (const entry of data.keyring) {
    const k = await unwrapKeyringEntry((await session.subkeys(entry.kid)).keyring, header.epoch, entry);
    session.dataKeys.set(entry.epoch, await importDataKey(k));
  }
  session.kid = cpKid;
  session.checkpointContent = content;
  const fake = { meta: Object.assign({}, meta, { checkpoint: { kid: cpKid } }), records: data.records, audit: data.audit };
  await fullCheckInner(fake, session, true);
  return { data, session };
}

// Leest en controleert een back-up volledig in het geheugen (§11.5 stap 1–5).
// Geeft {header, data, session, raw, route}; de aanroeper wist raw.
export async function inspectBackup(bytes, secret) {
  const { line1, line2 } = splitBackupFile(bytes);
  const reader = backupReader(line1);
  const header = reader.header(line1);
  const { raw, route } = await unwrapCurrent(header, secret);
  let dataKey;
  try {
    dataKey = await importDataKey(raw.slice());
  } catch (err) {
    wipe(raw);
    throw err;
  }
  try {
    const { data, session } = await reader.body(header, line1, line2, dataKey);
    return { header, data, session, raw, route };
  } catch (err) {
    wipe(raw);
    throw err;
  }
}

// Interne integriteit van een (ouder) bestand (§11.4), zonder iets te
// schrijven. Geeft een samenvatting; de sleutels gaan niet mee terug.
export async function checkBackupFile(bytes, secret) {
  const { data, raw, route } = await inspectBackup(bytes, secret);
  wipe(raw);
  return {
    route,
    createdAt: data.createdAt,
    appVersion: data.appVersion,
    records: data.records.length,
    audit: data.audit.length,
  };
}

function sameWraps(header, meta) {
  const k = meta.kdf;
  const w = meta.wrapped_password;
  const r = meta.recovery;
  return Boolean(k && w && r)
    && header.epoch === meta.epoch
    && header.kdf.alg === k.alg && header.kdf.iterations === k.iterations && equalBytes(header.kdf.salt, k.salt)
    && equalBytes(header.wrapped_password.iv, w.iv) && equalBytes(header.wrapped_password.ct, w.ct)
    && header.recovery.alg === r.alg && equalBytes(header.recovery.salt, r.salt)
    && equalBytes(header.recovery.iv, r.iv) && equalBytes(header.recovery.ct, r.ct);
}

// "Gelijk aan een export" (§11.4), direct na het bouwen, met de datasleutel
// van de sessie: de header bevat byte voor byte de wraps uit meta (dus opent
// met dezelfde geheimen), het bestand is intern integer, en checkpoint.seq,
// .h en .state zijn gelijk aan die van de export-regel met die seq in de
// eigen opslag. Elke fout is BackupMismatchError: het bestand is niet
// bruikbaar, de opslag zelf is niet aangetast.
export async function verifyExportedBackup(store, session, bytes) {
  let result;
  try {
    const { line1, line2 } = splitBackupFile(bytes);
    const reader = backupReader(line1);
    const header = reader.header(line1);
    if (header.format !== FORMAT) throw new FormatError('header: niet het huidige formaat');
    if (!sameWraps(header, store.meta)) throw new FormatError('header: andere wraps dan de opslag');
    const dataKey = session.dataKeys.get(header.epoch);
    if (!dataKey) throw new FormatError('header: onbekende epoch');
    const { data } = await reader.body(header, line1, line2, dataKey);
    const content = data.checkpoint.content;
    const rows = sortedAudit(store.audit);
    const index = rows.findIndex((a) => a.seq === content.seq);
    if (index < 0) throw new FormatError('geen regel met deze seq in de opslag');
    const row = rows[index];
    if (b64(row.h) !== content.h) throw new FormatError('h verschilt van de export-regel');
    const hPrev = index > 0 ? rows[index - 1].h : ZERO_HASH;
    const c = await openAudit((await session.subkeys(row.kid)).audit, session.epochOf(row.kid), row, hPrev);
    if (c.action !== 'export') throw new FormatError('regel is geen export');
    if (c.state !== content.state) throw new FormatError('state verschilt van de export-regel');
    result = { seq: content.seq, records: data.records.length, audit: data.audit.length };
  } catch (err) {
    throw new BackupMismatchError(err.message || 'Back-up niet gelijk aan de export', err);
  }
  return result;
}

// Regel verify_backup (§11.4) en, bij detail equal, last_backup_at (§11.3,
// besluit gebruiker 2026-11-25: vóór het delen, omdat het deelmenu de app
// vergrendelt).
export async function verifyBackupTx(store, session, { detail = 'equal', now } = {}) {
  const at = now || new Date();
  const putMeta = detail === 'equal' ? { last_backup_at: iso(at) } : {};
  return buildTx(store, session, { auditItems: [{ action: 'verify_backup', detail }], putMeta, now: at });
}

// Terugzetten op een lege opslag (§11.5). Bij de herstelsleutel is
// newPassword verplicht. Geeft {tx, session}; tx vereist een lege opslag.
export async function restoreTx(bytes, secret, { newPassword, now, deviceId = uuid() } = {}) {
  const { header, data, session, raw, route } = await inspectBackup(bytes, secret);
  try {
    let wrap = { kdf: header.kdf, wrapped_password: header.wrapped_password };
    if (route === 'recovery' || newPassword) {
      if (!newPassword) throw new FormatError('Kies een nieuw wachtwoord');
      wrap = await newPasswordWrap(raw, newPassword, header.epoch);
    }
    session.deviceId = deviceId;
    const base = {
      meta: { write_keys: data.writeKeys, keyring: data.keyring, checkpoint: undefined },
      records: data.records,
      audit: data.audit,
    };
    const tx = await withNewWriteKey(base, session, header.epoch, (newList, kid) => {
      const items = [{ action: 'write_key', detail: kid }];
      if (route === 'recovery') items.push({ action: 'recovery_used' }, { action: 'password_change', detail: 'recovery' });
      items.push({ action: 'import' });
      return buildTx(base, session, { auditItems: items, putMeta: { write_keys: newList }, now, fullCheckAction: true });
    });
    Object.assign(tx.putMeta, {
      format: FORMAT,
      created_at: iso(now),
      device_id: deviceId,
      epoch: header.epoch,
      kdf: wrap.kdf,
      wrapped_password: wrap.wrapped_password,
      recovery: header.recovery,
      keyring: data.keyring,
      last_backup_at: null,
      failed_unlocks: { count: 0, last_at: null },
    });
    tx.putRecords = data.records.concat(tx.putRecords);
    tx.putAudit = data.audit.concat(tx.putAudit);
    tx.requireEmpty = true;
    return { tx, session };
  } finally {
    wipe(raw);
  }
}

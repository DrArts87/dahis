// Cryptografische bouwstenen van formaat 1 (docs/formaat.md).
//
// Alleen Web Crypto; draait ongewijzigd in de browser en in Node. Deze module
// kent geen opslag: ze versleutelt, ontsleutelt, hasht en controleert
// structuren. De verwijzingen (§…) gaan naar docs/formaat.md.

const subtle = globalThis.crypto.subtle;

export const FORMAT = 1;
export const DEFAULT_ITERATIONS = 600000;
export const MIN_ITERATIONS = 600000;
export const MAX_ITERATIONS = 10000000;
export const MIN_PASSWORD_LENGTH = 14;
export const MAX_EPOCH = 65535;
export const MAX_KID = 65535;
export const BUDGET_LIMIT = 2 ** 31;
export const RESERVATION_BLOCK = 2 ** 16;
export const MAX_BACKUP_BYTES = 256 * 1024 * 1024;
export const MAX_HEADER_BYTES = 4096;
export const RECORD_BLOCK = 512;
export const RECORD_MAX_BLOCKS = 2048;
export const AUDIT_BLOCK = 128;
export const AUDIT_MAX_BLOCKS = 32;
export const BACKUP_BLOCK = 4096;
export const ZERO_HASH = new Uint8Array(32);

// --- Fouten ------------------------------------------------------------------

export class FormatError extends Error {
  constructor(message) { super(message); this.name = 'FormatError'; }
}

export class WrongSecretError extends Error {
  constructor() {
    super('Wachtwoord (of herstelsleutel) onjuist, of de gegevens zijn beschadigd of gewijzigd.');
    this.name = 'WrongSecretError';
  }
}

export class RecoveryKeyTypoError extends Error {
  constructor() { super('Tikfout in de herstelsleutel.'); this.name = 'RecoveryKeyTypoError'; }
}

// Codes volgens §10: checkpoint, chain, head, state, record, keys.
export class IntegrityError extends Error {
  constructor(code, message) {
    super(message || 'Integriteitscontrole mislukt: ' + code);
    this.name = 'IntegrityError';
    this.code = code;
  }
}

class DecryptError extends Error {
  constructor() { super('Ontsleutelen mislukt'); this.name = 'DecryptError'; }
}

// --- Bytes -------------------------------------------------------------------

export function concat(...parts) {
  let length = 0;
  for (const p of parts) length += p.length;
  const out = new Uint8Array(length);
  let offset = 0;
  for (const p of parts) { out.set(p, offset); offset += p.length; }
  return out;
}

export function be32(n) {
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) throw new FormatError('Ongeldig getal voor be32');
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n);
  return b;
}

export function be64(n) {
  if (!Number.isSafeInteger(n) || n < 0) throw new FormatError('Ongeldig getal voor be64');
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(n));
  return b;
}

export function equalBytes(a, b) {
  if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array) || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function randomBytes(n) {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}

export function wipe(bytes) {
  if (bytes instanceof Uint8Array) bytes.fill(0);
}

export function hex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256(...parts) {
  return new Uint8Array(await subtle.digest('SHA-256', concat(...parts)));
}

// --- UTF-8 (§2.3) --------------------------------------------------------------

const encoder = new TextEncoder();
const strictDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

export function utf8(text) {
  return encoder.encode(text);
}

export function decodeUtf8Strict(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new FormatError('BOM niet toegestaan');
  }
  let text;
  try {
    text = strictDecoder.decode(bytes);
  } catch (err) {
    throw new FormatError('Ongeldige UTF-8');
  }
  if (text.includes('\r')) throw new FormatError('\\r niet toegestaan');
  return text;
}

// --- base64url zonder opvulling (§2.3) ------------------------------------------

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64_INDEX = new Int8Array(128).fill(-1);
for (let i = 0; i < B64_ALPHABET.length; i++) B64_INDEX[B64_ALPHABET.charCodeAt(i)] = i;

export function b64(bytes) {
  const parts = [];
  const chunk = 3 * 4096;
  for (let start = 0; start < bytes.length; start += chunk) {
    const end = Math.min(start + chunk, bytes.length);
    let s = '';
    for (let i = start; i < end; i += 3) {
      const n = (bytes[i] << 16) | ((i + 1 < end ? bytes[i + 1] : 0) << 8) | (i + 2 < end ? bytes[i + 2] : 0);
      s += B64_ALPHABET[(n >> 18) & 63] + B64_ALPHABET[(n >> 12) & 63];
      if (i + 1 < end) s += B64_ALPHABET[(n >> 6) & 63];
      if (i + 2 < end) s += B64_ALPHABET[n & 63];
    }
    parts.push(s);
  }
  return parts.join('');
}

export function fromB64(text) {
  if (typeof text !== 'string' || text.length % 4 === 1) throw new FormatError('Ongeldige base64url');
  const out = new Uint8Array(Math.floor((text.length * 6) / 8));
  let acc = 0;
  let bits = 0;
  let o = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    const v = c < 128 ? B64_INDEX[c] : -1;
    if (v < 0) throw new FormatError('Ongeldig teken in base64url');
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
      acc &= (1 << bits) - 1;
    }
  }
  if (acc !== 0) throw new FormatError('Niet-canonieke base64url (restbits)');
  return out;
}

// --- AAD (§2.1) ----------------------------------------------------------------

const AAD_TEXT = /^[A-Za-z0-9._:/-]*$/;

export function aadBytes(parts) {
  if (!Array.isArray(parts) || parts.length === 0) throw new FormatError('Lege AAD');
  const items = parts.map((p) => {
    if (typeof p === 'number') {
      if (!Number.isSafeInteger(p) || p < 0) throw new FormatError('Ongeldig getal in AAD');
      return String(p);
    }
    if (typeof p === 'string' && AAD_TEXT.test(p)) return p;
    throw new FormatError('Ongeldig element in AAD');
  });
  return utf8(JSON.stringify(items));
}

// --- JSON en opvulling (§2.2) -----------------------------------------------------

export function padJson(value, block, maxBlocks) {
  const raw = utf8(JSON.stringify(value));
  const blocks = Math.max(1, Math.ceil(raw.length / block));
  if (maxBlocks && blocks > maxBlocks) throw new FormatError('Inhoud te groot');
  const out = new Uint8Array(blocks * block).fill(0x20);
  out.set(raw);
  return out;
}

// Leest JSON zoals deze module hem schrijft: geen andere witruimte, en
// opnieuw serialiseren geeft dezelfde tekst.
export function parseJsonStrict(bytes, block = 0, maxBlocks = 0) {
  if (block) {
    if (bytes.length === 0 || bytes.length % block !== 0) throw new FormatError('Ongeldige opvulling');
    if (maxBlocks && bytes.length / block > maxBlocks) throw new FormatError('Inhoud te groot');
  }
  const text = decodeUtf8Strict(bytes);
  const trimmed = block ? text.replace(/ +$/, '') : text;
  let value;
  try {
    value = JSON.parse(trimmed);
  } catch (err) {
    throw new FormatError('Ongeldige JSON');
  }
  if (JSON.stringify(value) !== trimmed) throw new FormatError('Niet-canonieke JSON');
  return value;
}

// --- Controles op vorm (§2.4) --------------------------------------------------------

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const KIND_RE = /^[a-z][a-z_]{0,31}$/;
const TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function isUint(n, min, max) {
  return Number.isSafeInteger(n) && n >= min && n <= max;
}

export function isBytes(b, length) {
  return b instanceof Uint8Array && (length === undefined || b.length === length);
}

export function isTimestamp(ts) {
  if (typeof ts !== 'string' || !TS_RE.test(ts)) return false;
  const d = new Date(ts);
  return !Number.isNaN(d.getTime()) && d.toISOString() === ts;
}

export function isPlainObject(o) {
  if (o === null || typeof o !== 'object' || Array.isArray(o)) return false;
  const proto = Object.getPrototypeOf(o);
  return proto === Object.prototype || proto === null;
}

export function hasExactKeys(o, keys) {
  if (!isPlainObject(o)) return false;
  const actual = Object.keys(o);
  return actual.length === keys.length && keys.every((k) => Object.prototype.hasOwnProperty.call(o, k));
}

function require(condition, message) {
  if (!condition) throw new FormatError(message);
}

export function validateKdf(kdf) {
  require(hasExactKeys(kdf, ['alg', 'iterations', 'salt']), 'kdf: ongeldige velden');
  require(kdf.alg === 'PBKDF2-SHA256', 'kdf: onbekend algoritme');
  require(isUint(kdf.iterations, MIN_ITERATIONS, MAX_ITERATIONS), 'kdf: iterations buiten de grenzen');
  require(isBytes(kdf.salt, 16), 'kdf: salt');
}

export function validateWrap(w) {
  require(hasExactKeys(w, ['iv', 'ct']), 'wrap: ongeldige velden');
  require(isBytes(w.iv, 12) && isBytes(w.ct, 48), 'wrap: lengtes');
}

export function validateRecoveryMeta(r) {
  require(hasExactKeys(r, ['alg', 'salt', 'iv', 'ct']), 'recovery: ongeldige velden');
  require(r.alg === 'HKDF-SHA256', 'recovery: onbekend algoritme');
  require(isBytes(r.salt, 16) && isBytes(r.iv, 12) && isBytes(r.ct, 48), 'recovery: lengtes');
}

export function validateWriteKeys(list) {
  require(Array.isArray(list) && list.length >= 1, 'write_keys: geen lijst');
  let previous = 0;
  for (const w of list) {
    require(hasExactKeys(w, ['kid', 'epoch', 'salt']), 'write_keys: ongeldige velden');
    require(isUint(w.kid, 1, MAX_KID) && w.kid > previous, 'write_keys: kid niet uniek en oplopend');
    require(isUint(w.epoch, 1, MAX_EPOCH) && isBytes(w.salt, 16), 'write_keys: waarden');
    previous = w.kid;
  }
}

export function validateKeyring(list) {
  require(Array.isArray(list), 'keyring: geen lijst');
  for (const k of list) {
    require(hasExactKeys(k, ['epoch', 'kid', 'iv', 'ct']), 'keyring: ongeldige velden');
    require(isUint(k.epoch, 1, MAX_EPOCH) && isUint(k.kid, 1, MAX_KID), 'keyring: waarden');
    require(isBytes(k.iv, 12) && isBytes(k.ct, 48), 'keyring: lengtes');
  }
}

export function validateCheckpointWrapper(c) {
  require(hasExactKeys(c, ['kid', 'iv', 'ct']), 'checkpoint: ongeldige velden');
  require(isUint(c.kid, 1, MAX_KID) && isBytes(c.iv, 12) && isBytes(c.ct) && c.ct.length > 16, 'checkpoint: waarden');
}

export function validateReservation(r) {
  require(hasExactKeys(r, ['kid', 'until', 'mac']), 'reservation: ongeldige velden');
  require(isUint(r.kid, 1, MAX_KID) && isUint(r.until, 0, BUDGET_LIMIT) && isBytes(r.mac, 32), 'reservation: waarden');
}

function validateCiphertextBlocks(ct, block, maxBlocks) {
  if (!isBytes(ct) || ct.length < block + 16) return false;
  const body = ct.length - 16;
  return body % block === 0 && body / block <= maxBlocks;
}

export function validateRecordRow(row) {
  require(hasExactKeys(row, ['id', 'version', 'kid', 'kind', 'updated_at', 'iv', 'ct']), 'record: ongeldige velden');
  require(typeof row.id === 'string' && UUID_RE.test(row.id), 'record: id');
  require(isUint(row.version, 1, 2 ** 31 - 1), 'record: version');
  require(isUint(row.kid, 1, MAX_KID), 'record: kid');
  require(typeof row.kind === 'string' && KIND_RE.test(row.kind), 'record: kind');
  require(isTimestamp(row.updated_at), 'record: updated_at');
  require(isBytes(row.iv, 12), 'record: iv');
  require(validateCiphertextBlocks(row.ct, RECORD_BLOCK, RECORD_MAX_BLOCKS), 'record: ct');
}

export function validateAuditRow(row) {
  require(hasExactKeys(row, ['seq', 'kid', 'iv', 'ct', 'h']), 'audit: ongeldige velden');
  require(isUint(row.seq, 1, Number.MAX_SAFE_INTEGER), 'audit: seq');
  require(isUint(row.kid, 1, MAX_KID), 'audit: kid');
  require(isBytes(row.iv, 12) && isBytes(row.h, 32), 'audit: iv of h');
  require(validateCiphertextBlocks(row.ct, AUDIT_BLOCK, AUDIT_MAX_BLOCKS), 'audit: ct');
}

// --- AES-GCM ------------------------------------------------------------------------

export async function importAesKey(bytes) {
  return subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function importHmacKey(bytes) {
  return subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function encrypt(key, plaintext, aad, iv = randomBytes(12)) {
  const ct = new Uint8Array(await subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 }, key, plaintext));
  return { iv, ct };
}

async function decrypt(key, iv, ct, aad) {
  try {
    return new Uint8Array(await subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 }, key, ct));
  } catch (err) {
    throw new DecryptError();
  }
}

// --- Sleutelafleiding (§3.2–3.5) ---------------------------------------------------

export function normalizePassword(password) {
  if (typeof password !== 'string') throw new FormatError('Wachtwoord ontbreekt');
  return password.normalize('NFC');
}

// Eis van het formaat; aanvullend advies en controles horen bij de app.
export function checkNewPassword(password) {
  if (Array.from(normalizePassword(password)).length < MIN_PASSWORD_LENGTH) {
    throw new FormatError('Het wachtwoord moet minstens ' + MIN_PASSWORD_LENGTH + ' tekens hebben.');
  }
}

export async function pbkdf2Bytes(password, salt, iterations) {
  const base = await subtle.importKey('raw', utf8(normalizePassword(password)), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, 256));
}

export async function hkdfBytes(ikm, salt, info, length = 32) {
  const base = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: utf8(info) }, base, length * 8));
}

async function aesKeyAndWipe(bytes) {
  try {
    return await importAesKey(bytes);
  } finally {
    wipe(bytes);
  }
}

export async function passwordKek(password, kdf) {
  validateKdf(kdf);
  return aesKeyAndWipe(await pbkdf2Bytes(password, kdf.salt, kdf.iterations));
}

export async function recoveryKek(recoveryKey, salt) {
  if (!isBytes(recoveryKey, 32) || !isBytes(salt, 16)) throw new FormatError('Herstelsleutel of salt');
  return aesKeyAndWipe(await hkdfBytes(recoveryKey, salt, 'dahis/1/kek/herstel'));
}

// Importeert de ruwe datasleutel als niet-exporteerbare HKDF-sleutel en
// overschrijft daarna de ruwe bytes (§3.7).
export async function importDataKey(raw) {
  if (!isBytes(raw, 32)) throw new FormatError('Datasleutel moet 32 bytes zijn');
  try {
    return await subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey']);
  } finally {
    wipe(raw);
  }
}

const AES_DOMAINS = ['record', 'audit', 'checkpoint', 'keyring'];

export async function deriveSubkeys(dataKey, salt) {
  if (!isBytes(salt, 16)) throw new FormatError('Salt van schrijfsleutel');
  const keys = {};
  for (const d of AES_DOMAINS) {
    keys[d] = await subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt, info: utf8('dahis/1/sub/' + d) },
      dataKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  keys.reserve = await subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: utf8('dahis/1/sub/reserve') },
    dataKey, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign', 'verify']);
  return keys;
}

export async function deriveFileKey(dataKey, salt, kind = 'backup') {
  if (!isBytes(salt, 16)) throw new FormatError('Bestandssalt');
  if (kind !== 'backup' && kind !== 'forensic') throw new FormatError('Onbekende bestandssoort');
  return subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: utf8('dahis/1/sub/' + kind) },
    dataKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

// --- Wraps en sleutelring (§3.6) ------------------------------------------------------

export function aadWrapPassword(kdf, epoch) {
  return aadBytes(['dahis/1/wrap', 'password', 'PBKDF2-SHA256', kdf.iterations, b64(kdf.salt), epoch]);
}

export function aadWrapRecovery(recovery, epoch) {
  return aadBytes(['dahis/1/wrap', 'recovery', 'HKDF-SHA256', b64(recovery.salt), epoch]);
}

export async function wrapDataKey(kek, raw, aad, iv) {
  if (!isBytes(raw, 32)) throw new FormatError('Datasleutel moet 32 bytes zijn');
  return encrypt(kek, raw, aad, iv);
}

// Geeft de ruwe datasleutel; de aanroeper overschrijft hem na gebruik.
export async function unwrapDataKey(kek, wrapped, aad) {
  let raw;
  try {
    raw = await decrypt(kek, wrapped.iv, wrapped.ct, aad);
  } catch (err) {
    throw new WrongSecretError();
  }
  if (raw.length !== 32) { wipe(raw); throw new WrongSecretError(); }
  return raw;
}

export function aadKeyring(kid, oldEpoch, epochOfKid) {
  return aadBytes(['dahis/1/keyring', kid, oldEpoch, epochOfKid]);
}

export async function wrapKeyringEntry(keyringKey, kid, epochOfKid, oldEpoch, raw, iv) {
  const { iv: i, ct } = await encrypt(keyringKey, raw, aadKeyring(kid, oldEpoch, epochOfKid), iv);
  return { epoch: oldEpoch, kid, iv: i, ct };
}

export async function unwrapKeyringEntry(keyringKey, epochOfKid, entry) {
  try {
    const raw = await decrypt(keyringKey, entry.iv, entry.ct, aadKeyring(entry.kid, entry.epoch, epochOfKid));
    if (raw.length !== 32) throw new DecryptError();
    return raw;
  } catch (err) {
    throw new IntegrityError('keys', 'Sleutelring niet te ontsleutelen');
  }
}

// --- Herstelsleutel (§4) ------------------------------------------------------------

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function base32Encode(bytes) {
  let out = '';
  let acc = 0;
  let bits = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += CROCKFORD[(acc >> bits) & 31];
      acc &= (1 << bits) - 1;
    }
  }
  if (bits > 0) out += CROCKFORD[(acc << (5 - bits)) & 31];
  return out;
}

async function recoveryCheckGroup(recoveryKey) {
  const h = await sha256(utf8('dahis/1/herstelcontrole'), recoveryKey);
  const twenty = (h[0] << 12) | (h[1] << 4) | (h[2] >> 4);
  let out = '';
  for (let shift = 15; shift >= 0; shift -= 5) out += CROCKFORD[(twenty >> shift) & 31];
  return out;
}

export function generateRecoveryKey() {
  return randomBytes(32);
}

export async function formatRecoveryKey(recoveryKey) {
  if (!isBytes(recoveryKey, 32)) throw new FormatError('Herstelsleutel moet 32 bytes zijn');
  const text = base32Encode(recoveryKey) + await recoveryCheckGroup(recoveryKey);
  return text.match(/.{4}/g).join('-');
}

export async function parseRecoveryKey(input) {
  if (typeof input !== 'string') throw new RecoveryKeyTypoError();
  const text = input.toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
  if (text.length !== 56) throw new RecoveryKeyTypoError();
  const values = [];
  for (const ch of text) {
    const v = CROCKFORD.indexOf(ch);
    if (v < 0) throw new RecoveryKeyTypoError();
    values.push(v);
  }
  const out = new Uint8Array(32);
  let acc = 0;
  let bits = 0;
  let o = 0;
  for (const v of values.slice(0, 52)) {
    acc = (acc << 5) | v;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
      acc &= (1 << bits) - 1;
    }
  }
  if (o !== 32 || bits !== 4 || acc !== 0) throw new RecoveryKeyTypoError();
  if (await recoveryCheckGroup(out) !== text.slice(52)) throw new RecoveryKeyTypoError();
  return out;
}

// --- Records (§6, §7) --------------------------------------------------------------

export function recordAad(row, epoch) {
  return aadBytes(['dahis/1/record', row.kid, epoch, row.id, row.version, row.kind, row.updated_at]);
}

export function validateRecordContent(content) {
  if (hasExactKeys(content, ['schema', 'data'])) {
    require(isUint(content.schema, 1, 2 ** 31 - 1) && isPlainObject(content.data), 'record: inhoud');
  } else {
    require(hasExactKeys(content, ['schema', 'deleted']) && isUint(content.schema, 1, 2 ** 31 - 1)
      && content.deleted === true, 'record: inhoud');
  }
}

export async function sealRecord(key, epoch, meta, content, iv) {
  validateRecordContent(content);
  const row = { id: meta.id, version: meta.version, kid: meta.kid, kind: meta.kind, updated_at: meta.updated_at };
  const plaintext = padJson(content, RECORD_BLOCK, RECORD_MAX_BLOCKS);
  const { iv: i, ct } = await encrypt(key, plaintext, recordAad(row, epoch), iv);
  const sealed = Object.assign(row, { iv: i, ct });
  validateRecordRow(sealed);
  return sealed;
}

export async function openRecord(key, epoch, row) {
  validateRecordRow(row);
  let plaintext;
  try {
    plaintext = await decrypt(key, row.iv, row.ct, recordAad(row, epoch));
  } catch (err) {
    throw new IntegrityError('record', 'Recordversie niet te ontsleutelen');
  }
  const content = parseJsonStrict(plaintext, RECORD_BLOCK, RECORD_MAX_BLOCKS);
  validateRecordContent(content);
  return content;
}

export async function versionHash(row, epoch) {
  return sha256(recordAad(row, epoch), row.iv, row.ct);
}

function compareRecordKeys(a, b) {
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return a.version - b.version;
}

// epochOf(kid) geeft de epoch van een schrijfsleutel.
export async function stateDigest(rows, epochOf) {
  const sorted = rows.slice().sort(compareRecordKeys);
  const hashes = [];
  for (const row of sorted) hashes.push(await versionHash(row, epochOf(row.kid)));
  return sha256(utf8('dahis/1/state'), ...hashes);
}

// --- Auditlog (§8) ---------------------------------------------------------------------

export const AUDIT_ACTIONS = [
  'create', 'view', 'update', 'delete', 'destroy', 'unlock', 'unlock_failed', 'lock',
  'password_change', 'recovery_used', 'key_rotation', 'write_key', 'export', 'import',
  'verify_backup', 'integrity_check', 'print', 'app_update',
];
const AUDIT_FIELDS = ['ts', 'action', 'kind', 'record_id', 'version', 'vh', 'state', 'result', 'device_id', 'detail'];
const DETAIL_RE = /^[a-z0-9_.]{1,32}$/;

function isHash64(v) {
  try {
    return typeof v === 'string' && fromB64(v).length === 32;
  } catch (err) {
    return false;
  }
}

export function validateAuditContent(c) {
  require(hasExactKeys(c, AUDIT_FIELDS), 'auditregel: ongeldige velden');
  require(isTimestamp(c.ts), 'auditregel: ts');
  require(AUDIT_ACTIONS.includes(c.action), 'auditregel: onbekende actie');
  require(c.kind === null || (typeof c.kind === 'string' && KIND_RE.test(c.kind)), 'auditregel: kind');
  require(c.record_id === null || (typeof c.record_id === 'string' && UUID_RE.test(c.record_id)), 'auditregel: record_id');
  require(c.version === null || isUint(c.version, 1, 2 ** 31 - 1), 'auditregel: version');
  require(c.vh === null || isHash64(c.vh), 'auditregel: vh');
  require(c.state === null || isHash64(c.state), 'auditregel: state');
  require(['ok', 'error', 'denied'].includes(c.result), 'auditregel: result');
  require(typeof c.device_id === 'string' && UUID_RE.test(c.device_id), 'auditregel: device_id');
  require(c.detail === null || (typeof c.detail === 'string' && DETAIL_RE.test(c.detail))
    || isUint(c.detail, 0, Number.MAX_SAFE_INTEGER), 'auditregel: detail');
}

// Bouwt de inhoud van een auditregel in de vaste veldvolgorde.
export function auditContent(fields) {
  const c = {};
  for (const f of AUDIT_FIELDS) c[f] = fields[f] === undefined ? null : fields[f];
  if (fields.result === undefined) c.result = 'ok';
  validateAuditContent(c);
  return c;
}

export function auditAad(kid, epoch, seq, hPrev) {
  return aadBytes(['dahis/1/audit', kid, epoch, seq, b64(hPrev)]);
}

export async function auditHash(hPrev, seq, kid, iv, ct) {
  return sha256(hPrev, be64(seq), be32(kid), iv, ct);
}

export async function sealAudit(key, epoch, { seq, kid, hPrev }, content, iv) {
  validateAuditContent(content);
  const plaintext = padJson(content, AUDIT_BLOCK, AUDIT_MAX_BLOCKS);
  const { iv: i, ct } = await encrypt(key, plaintext, auditAad(kid, epoch, seq, hPrev), iv);
  return { seq, kid, iv: i, ct, h: await auditHash(hPrev, seq, kid, i, ct) };
}

export async function openAudit(key, epoch, row, hPrev) {
  validateAuditRow(row);
  let plaintext;
  try {
    plaintext = await decrypt(key, row.iv, row.ct, auditAad(row.kid, epoch, row.seq, hPrev));
  } catch (err) {
    throw new IntegrityError('chain', 'Auditregel ' + row.seq + ' niet te ontsleutelen');
  }
  const content = parseJsonStrict(plaintext, AUDIT_BLOCK, AUDIT_MAX_BLOCKS);
  validateAuditContent(content);
  return content;
}

// --- Registers en controlepunt (§3.2, §9) ---------------------------------------------

export async function writeKeysDigest(list) {
  const sorted = list.slice().sort((a, b) => a.kid - b.kid);
  const parts = [];
  for (const w of sorted) parts.push(be32(w.kid), be32(w.epoch), w.salt);
  return sha256(utf8('dahis/1/write_keys'), be32(sorted.length), ...parts);
}

export async function keyringDigest(list) {
  const sorted = list.slice().sort((a, b) => a.epoch - b.epoch);
  const parts = [];
  for (const k of sorted) parts.push(be32(k.epoch), be32(k.kid), k.iv, k.ct);
  return sha256(utf8('dahis/1/keyring'), be32(sorted.length), ...parts);
}

const CHECKPOINT_FIELDS = ['seq', 'h', 'state', 'records', 'counter', 'write_keys_digest', 'keyring_digest'];

export function validateCheckpointContent(c) {
  require(hasExactKeys(c, CHECKPOINT_FIELDS), 'controlepunt: ongeldige velden');
  require(isUint(c.seq, 1, Number.MAX_SAFE_INTEGER) && isUint(c.records, 0, Number.MAX_SAFE_INTEGER), 'controlepunt: getallen');
  require(isUint(c.counter, 1, BUDGET_LIMIT), 'controlepunt: counter');
  for (const f of ['h', 'state', 'write_keys_digest', 'keyring_digest']) require(isHash64(c[f]), 'controlepunt: ' + f);
}

export function checkpointAad(kid, epoch) {
  return aadBytes(['dahis/1/checkpoint', kid, epoch]);
}

export async function sealCheckpoint(key, kid, epoch, content, iv) {
  validateCheckpointContent(content);
  const ordered = {};
  for (const f of CHECKPOINT_FIELDS) ordered[f] = content[f];
  const { iv: i, ct } = await encrypt(key, utf8(JSON.stringify(ordered)), checkpointAad(kid, epoch), iv);
  return { kid, iv: i, ct };
}

export async function openCheckpoint(key, epoch, wrapper) {
  validateCheckpointWrapper(wrapper);
  let plaintext;
  try {
    plaintext = await decrypt(key, wrapper.iv, wrapper.ct, checkpointAad(wrapper.kid, epoch));
  } catch (err) {
    throw new IntegrityError('checkpoint', 'Controlepunt niet te ontsleutelen');
  }
  let content;
  try {
    content = parseJsonStrict(plaintext);
    validateCheckpointContent(content);
  } catch (err) {
    throw new IntegrityError('checkpoint', 'Controlepunt ongeldig');
  }
  return content;
}

// --- Reservering van het IV-budget (§3.8) ----------------------------------------------

export function reservationData(kid, until) {
  return aadBytes(['dahis/1/reserve', kid, until]);
}

export async function makeReservation(reserveKey, kid, until) {
  if (!isUint(until, 0, BUDGET_LIMIT)) throw new FormatError('Reservering buiten het budget');
  const mac = new Uint8Array(await subtle.sign('HMAC', reserveKey, reservationData(kid, until)));
  return { kid, until, mac };
}

// True als de reservering geldig is voor deze schrijfsleutel.
export async function reservationValid(reserveKey, reservation, kid) {
  try {
    validateReservation(reservation);
  } catch (err) {
    return false;
  }
  if (reservation.kid !== kid) return false;
  return subtle.verify('HMAC', reserveKey, reservation.mac, reservationData(reservation.kid, reservation.until));
}

// Startstand van de teller na ontgrendelen (§3.8 geval 2).
export function budgetStart(checkpointCounter, reservationUntil) {
  return Math.max(checkpointCounter, reservationUntil || 0);
}

// --- Back-upbestand (§11) ------------------------------------------------------------------

export const BACKUP_MAGIC = 'dahis-backup';

export function serializeHeader(h) {
  return JSON.stringify({
    magic: h.magic,
    format: h.format,
    epoch: h.epoch,
    salt: b64(h.salt),
    kdf: { alg: h.kdf.alg, iterations: h.kdf.iterations, salt: b64(h.kdf.salt) },
    wrapped_password: { iv: b64(h.wrapped_password.iv), ct: b64(h.wrapped_password.ct) },
    recovery: { alg: h.recovery.alg, salt: b64(h.recovery.salt), iv: b64(h.recovery.iv), ct: b64(h.recovery.ct) },
  });
}

function headerBytesField(value, length, name) {
  require(typeof value === 'string', 'header: ' + name);
  const bytes = fromB64(value);
  require(bytes.length === length, 'header: lengte van ' + name);
  return bytes;
}

// Leest regel 1 strikt en canoniek (§2.3, §11.1).
export function parseHeader(line) {
  let raw;
  try {
    raw = JSON.parse(line);
  } catch (err) {
    throw new FormatError('header: geen JSON');
  }
  require(hasExactKeys(raw, ['magic', 'format', 'epoch', 'salt', 'kdf', 'wrapped_password', 'recovery']), 'header: velden');
  require(raw.magic === BACKUP_MAGIC, 'header: geen back-upbestand van Dahis');
  require(raw.format === FORMAT, 'header: onbekend formaat');
  require(isUint(raw.epoch, 1, MAX_EPOCH), 'header: epoch');
  require(hasExactKeys(raw.kdf, ['alg', 'iterations', 'salt'])
    && hasExactKeys(raw.wrapped_password, ['iv', 'ct'])
    && hasExactKeys(raw.recovery, ['alg', 'salt', 'iv', 'ct']), 'header: velden');
  const h = {
    magic: raw.magic,
    format: raw.format,
    epoch: raw.epoch,
    salt: headerBytesField(raw.salt, 16, 'salt'),
    kdf: { alg: raw.kdf.alg, iterations: raw.kdf.iterations, salt: headerBytesField(raw.kdf.salt, 16, 'kdf.salt') },
    wrapped_password: {
      iv: headerBytesField(raw.wrapped_password.iv, 12, 'wrapped_password.iv'),
      ct: headerBytesField(raw.wrapped_password.ct, 48, 'wrapped_password.ct'),
    },
    recovery: {
      alg: raw.recovery.alg,
      salt: headerBytesField(raw.recovery.salt, 16, 'recovery.salt'),
      iv: headerBytesField(raw.recovery.iv, 12, 'recovery.iv'),
      ct: headerBytesField(raw.recovery.ct, 48, 'recovery.ct'),
    },
  };
  validateKdf(h.kdf);
  validateRecoveryMeta(h.recovery);
  require(serializeHeader(h) === line, 'header: niet canoniek');
  return h;
}

// Splitst een bestand in de twee regels (§11, §11.5 stap 1).
export function splitBackupFile(bytes) {
  require(bytes instanceof Uint8Array, 'bestand: geen bytes');
  require(bytes.length <= MAX_BACKUP_BYTES, 'bestand: groter dan 256 MiB');
  const text = decodeUtf8Strict(bytes);
  require(text.endsWith('\n'), 'bestand: laatste regel niet afgesloten');
  const lines = text.slice(0, -1).split('\n');
  require(lines.length === 2, 'bestand: niet precies twee regels');
  require(utf8(lines[0]).length <= MAX_HEADER_BYTES, 'bestand: header te lang');
  return { line1: lines[0], line2: lines[1] };
}

export async function backupAad(epoch, line1) {
  return aadBytes(['dahis/1/backup', epoch, b64(await sha256(utf8(line1)))]);
}

// Bouwt het bestand uit een header (met bytes) en een JSON-inhoud.
export async function encodeBackupFile(dataKey, header, payload, iv) {
  const line1 = serializeHeader(header);
  const fileKey = await deriveFileKey(dataKey, header.salt, 'backup');
  const plaintext = padJson(payload, BACKUP_BLOCK);
  const { iv: i, ct } = await encrypt(fileKey, plaintext, await backupAad(header.epoch, line1), iv);
  return line1 + '\n' + b64(concat(i, ct)) + '\n';
}

export async function decodeBackupPayload(dataKey, header, line1, line2) {
  const body = fromB64(line2);
  require(body.length >= 12 + BACKUP_BLOCK + 16 && (body.length - 12 - 16) % BACKUP_BLOCK === 0, 'bestand: inhoud');
  const iv = body.slice(0, 12);
  const ct = body.slice(12);
  const fileKey = await deriveFileKey(dataKey, header.salt, 'backup');
  let plaintext;
  try {
    plaintext = await decrypt(fileKey, iv, ct, await backupAad(header.epoch, line1));
  } catch (err) {
    throw new FormatError('bestand: inhoud niet te ontsleutelen (beschadigd of gewijzigd)');
  }
  return parseJsonStrict(plaintext, BACKUP_BLOCK);
}

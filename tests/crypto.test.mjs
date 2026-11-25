// Tests van de bouwstenen in app/js/crypto.js. Alleen verzonnen gegevens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../app/js/crypto.js';

test('base64url: heen en terug voor alle lengtes', () => {
  for (let n = 0; n < 40; n++) {
    const bytes = C.randomBytes(n);
    assert.deepEqual(C.fromB64(C.b64(bytes)), bytes);
  }
});

test('UTF-8: BOM, ongeldige bytes en \\r worden geweigerd', () => {
  assert.throws(() => C.decodeUtf8Strict(Uint8Array.of(0xef, 0xbb, 0xbf, 0x41)), C.FormatError);
  assert.throws(() => C.decodeUtf8Strict(Uint8Array.of(0xc3, 0x28)), C.FormatError);
  assert.throws(() => C.decodeUtf8Strict(C.utf8('a\r\nb')), C.FormatError);
  assert.equal(C.decodeUtf8Strict(C.utf8('café')), 'café');
});

test('opvulling: veelvouden van het blok, strikt teruglezen', () => {
  const padded = C.padJson({ a: 1 }, 128);
  assert.equal(padded.length, 128);
  assert.deepEqual(C.parseJsonStrict(padded, 128), { a: 1 });
  assert.throws(() => C.parseJsonStrict(padded.slice(0, 127), 128), C.FormatError);
  const tab = padded.slice();
  tab[10] = 0x09;
  assert.throws(() => C.parseJsonStrict(tab, 128), C.FormatError);
  assert.throws(() => C.padJson({ x: 'y'.repeat(300) }, 128, 2), C.FormatError);
});

test('wachtwoord: minimaal 14 tekens na NFC', () => {
  assert.throws(() => C.checkNewPassword('dertien tekens'.slice(0, 13)), C.FormatError);
  C.checkNewPassword('veertien teken');
  assert.throws(() => C.checkNewPassword('é'.repeat(13)), C.FormatError); // 13 tekens na NFC
});

test('kdf-grenzen worden vóór afleiding gecontroleerd', async () => {
  const salt = C.randomBytes(16);
  for (const iterations of [599999, 10000001, 1.5]) {
    await assert.rejects(C.passwordKek('een lang genoeg wachtwoord', { alg: 'PBKDF2-SHA256', iterations, salt }), C.FormatError);
  }
  await assert.rejects(C.passwordKek('een lang genoeg wachtwoord', { alg: 'PBKDF2-SHA512', iterations: 600000, salt }), C.FormatError);
});

test('herstelsleutel: willekeurige sleutels gaan heen en terug', async () => {
  for (let i = 0; i < 20; i++) {
    const rk = C.generateRecoveryKey();
    const text = await C.formatRecoveryKey(rk);
    assert.equal(text.length, 14 * 4 + 13);
    assert.deepEqual(await C.parseRecoveryKey(text), rk);
  }
});

test('herstelsleutel: niet-nul vulbits worden geweigerd', async () => {
  const text = await C.formatRecoveryKey(new Uint8Array(32));
  const compact = text.replace(/-/g, '');
  // Teken 52 bevat 1 databit en 4 vulbits; zet een vulbit.
  const bad = compact.slice(0, 51) + '1' + compact.slice(52);
  await assert.rejects(C.parseRecoveryKey(bad), C.RecoveryKeyTypoError);
});

test('records: inhoud moet {schema, data} of {schema, deleted: true} zijn', async () => {
  const key = await C.importAesKey(C.randomBytes(32));
  const meta = { id: globalThis.crypto.randomUUID(), version: 1, kid: 1, kind: 'test_x', updated_at: '2026-11-25T12:00:00.000Z' };
  await assert.rejects(C.sealRecord(key, 1, meta, { schema: 1, data: [] }), C.FormatError);
  await assert.rejects(C.sealRecord(key, 1, meta, { schema: 1, deleted: false }), C.FormatError);
  await assert.rejects(C.sealRecord(key, 1, Object.assign({}, meta, { kind: 'Test' }), { schema: 1, data: {} }), C.FormatError);
  await assert.rejects(C.sealRecord(key, 1, Object.assign({}, meta, { updated_at: '2026-11-25T12:00:00Z' }), { schema: 1, data: {} }), C.FormatError);
  const row = await C.sealRecord(key, 1, meta, { schema: 1, data: { a: 'b' } });
  assert.equal((row.ct.length - 16) % 512, 0);
});

test('record met extra veld wordt geweigerd', async () => {
  const key = await C.importAesKey(C.randomBytes(32));
  const meta = { id: globalThis.crypto.randomUUID(), version: 1, kid: 1, kind: 'test_x', updated_at: '2026-11-25T12:00:00.000Z' };
  const row = await C.sealRecord(key, 1, meta, { schema: 1, data: {} });
  await assert.rejects(C.openRecord(key, 1, Object.assign({ extra: 1 }, row)), C.FormatError);
});

test('auditregel: alleen bekende acties en geen vrije tekst in detail', () => {
  const base = { ts: '2026-11-25T12:00:00.000Z', device_id: globalThis.crypto.randomUUID() };
  assert.throws(() => C.auditContent(Object.assign({ action: 'onbekend' }, base)), C.FormatError);
  assert.throws(() => C.auditContent(Object.assign({ action: 'view', detail: 'Naam Persoon' }, base)), C.FormatError);
  assert.equal(C.auditContent(Object.assign({ action: 'unlock_failed', detail: 3 }, base)).detail, 3);
});

test('budget: start na herstart ligt voorbij de reservering', () => {
  assert.equal(C.budgetStart(10, 65546), 65546);
  assert.equal(C.budgetStart(70000, 65546), 70000);
  assert.equal(C.budgetStart(10, null), 10);
});

test('back-upbestand: grootte en regelstructuur', () => {
  assert.throws(() => C.splitBackupFile(C.utf8('een regel\n')), C.FormatError);
  assert.throws(() => C.splitBackupFile(C.utf8('a\nb')), C.FormatError);
  assert.throws(() => C.splitBackupFile(C.utf8('x'.repeat(4097) + '\nb\n')), C.FormatError);
  assert.deepEqual(C.splitBackupFile(C.utf8('a\nb\n')), { line1: 'a', line2: 'b' });
});

test('de datasleutel is na importeren niet exporteerbaar en de ruwe bytes zijn gewist', async () => {
  const raw = C.randomBytes(32);
  const key = await C.importDataKey(raw);
  assert.equal(key.extractable, false);
  assert.deepEqual(raw, new Uint8Array(32));
});

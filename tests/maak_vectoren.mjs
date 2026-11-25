// Maakt tests/fixtures/vectoren.json: testvectoren voor formaat 1, met vaste
// invoer. Alleen opnieuw draaien als het formaat bewust verandert; de
// vectoren zijn het contract en worden daarna door Node (crypto.js), de
// browser en Python (tests/test_vectoren.py) gecontroleerd.
//
// Gebruik:  node tests/maak_vectoren.mjs
import { writeFileSync } from 'node:fs';
import * as C from '../app/js/crypto.js';

const h = C.hex;
const seq = (start, n) => Uint8Array.from({ length: n }, (_, i) => (start + i) & 0xff);
const fromHex = (s) => Uint8Array.from(s.match(/../g).map((x) => parseInt(x, 16)));

const DK = seq(0x00, 32);
const DK_OLD = seq(0x80, 32);
const SALT_W = seq(0x10, 16);
const SALT_H = seq(0x20, 16);
const SALT_K = seq(0x30, 16);
const SALT_FILE = seq(0x40, 16);
const RK = seq(0xa0, 32);
const IV = (b) => seq(b, 12);

const PASSWORD = 'correct paard batterij café';   // é als één teken (NFC)
const PASSWORD_NFD = PASSWORD.normalize('NFD');

async function hkdfCase(ikm, salt, info) {
  return { ikm: h(ikm), salt: h(salt), info, okm: h(await C.hkdfBytes(ikm, salt, info)) };
}

const v = {
  formaat: 1,
  beschrijving: 'Testvectoren voor docs/formaat.md. Bytes als hex. Alleen verzonnen waarden.',
};

// PBKDF2 (§3.4)
v.pbkdf2 = [];
for (const iterations of [600000, 1000000]) {
  v.pbkdf2.push({ password: PASSWORD, password_nfd: PASSWORD_NFD, salt: h(SALT_W), iterations,
    kek: h(await C.pbkdf2Bytes(PASSWORD, SALT_W, iterations)) });
}

// HKDF: herstelsleutel-KEK, subsleutels, bestandssleutel (§3.2, §3.3, §3.5)
v.hkdf = [await hkdfCase(RK, SALT_H, 'dahis/1/kek/herstel')];
for (const d of ['record', 'audit', 'checkpoint', 'keyring', 'reserve']) v.hkdf.push(await hkdfCase(DK, SALT_K, 'dahis/1/sub/' + d));
v.hkdf.push(await hkdfCase(DK, SALT_FILE, 'dahis/1/sub/backup'));
const sub = Object.fromEntries(v.hkdf.slice(1, 6).map((c) => [c.info.split('/').pop(), fromHex(c.okm)]));

// Wraps (§3.6)
const kdf = { alg: 'PBKDF2-SHA256', iterations: 600000, salt: SALT_W };
const kekW = fromHex(v.pbkdf2[0].kek);
const aadW = C.aadWrapPassword(kdf, 1);
v.wrap_password = { kek: h(kekW), dk: h(DK), iv: h(IV(0x50)), iterations: 600000, salt: h(SALT_W), epoch: 1,
  aad: h(aadW), ct: h((await C.encrypt(await C.importAesKey(kekW), DK, aadW, IV(0x50))).ct) };
const kekH = fromHex(v.hkdf[0].okm);
const aadH = C.aadWrapRecovery({ salt: SALT_H }, 1);
v.wrap_recovery = { kek: h(kekH), dk: h(DK), iv: h(IV(0x51)), salt: h(SALT_H), epoch: 1,
  aad: h(aadH), ct: h((await C.encrypt(await C.importAesKey(kekH), DK, aadH, IV(0x51))).ct) };

// Herstelsleutel (§4)
const rkText = await C.formatRecoveryKey(RK);
const alt = rkText.toLowerCase().replace(/-/g, ' ').replace(/1/g, 'l').replace(/0/g, 'o');
const wrongCheck = rkText.slice(0, -1) + (rkText.slice(-1) === '0' ? '1' : '0');
v.recovery_key = {
  bytes: h(RK),
  text: rkText,
  geldige_invoer: [rkText, rkText.toLowerCase(), alt, rkText.replace(/-/g, '')],
  ongeldige_invoer: [wrongCheck, rkText.slice(0, -5), rkText.replace(/^./, 'U'), rkText + '-0000'],
};

// Record (§6)
const recMeta = { id: '3f2b8c1e-5d4a-4b6c-9e8f-0a1b2c3d4e5f', version: 2, kid: 1, kind: 'test_persoon', updated_at: '2026-11-25T12:00:00.000Z' };
const recContent = { schema: 1, data: { naam: 'Verzonnen Testpersoon', bsn: '123456780' } };
const recKey = await C.importAesKey(sub.record);
const recRow = await C.sealRecord(recKey, 1, recMeta, recContent, IV(0x60));
v.record = { key: h(sub.record), epoch: 1, meta: recMeta, content: recContent, iv: h(recRow.iv),
  aad_parts: ['dahis/1/record', 1, 1, recMeta.id, 2, recMeta.kind, recMeta.updated_at],
  aad: h(C.recordAad(recRow, 1)), plaintext_length: recRow.ct.length - 16, ct: h(recRow.ct), vh: h(await C.versionHash(recRow, 1)) };

// Auditregel (§8)
const audContent = C.auditContent({ ts: '2026-11-25T12:00:00.000Z', action: 'create', kind: 'test_persoon',
  record_id: recMeta.id, version: 2, vh: C.b64(fromHex(v.record.vh)), device_id: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d' });
const audKey = await C.importAesKey(sub.audit);
const hPrev = seq(0xc0, 32);
const audRow = await C.sealAudit(audKey, 1, { seq: 7, kid: 1, hPrev }, audContent, IV(0x61));
v.audit = { key: h(sub.audit), epoch: 1, seq: 7, kid: 1, h_prev: h(hPrev), content: audContent, iv: h(audRow.iv),
  aad: h(C.auditAad(1, 1, 7, hPrev)), ct: h(audRow.ct), h: h(audRow.h) };

// Toestandsdigest en registers (§3.2, §7)
const vhs = [seq(0x01, 32), seq(0x02, 32)];
v.state_digest = { vhs: vhs.map(h), digest: h(await C.sha256(C.utf8('dahis/1/state'), ...vhs)),
  leeg: h(await C.sha256(C.utf8('dahis/1/state'))) };
const writeKeys = [{ kid: 2, epoch: 2, salt: seq(0x31, 16) }, { kid: 1, epoch: 1, salt: SALT_K }];
v.write_keys_digest = { list: writeKeys.map((w) => ({ kid: w.kid, epoch: w.epoch, salt: h(w.salt) })),
  digest: h(await C.writeKeysDigest(writeKeys)) };

// Sleutelring (§3.6)
const krKey = await C.importAesKey(sub.keyring);
const kr = await C.wrapKeyringEntry(krKey, 3, 2, 1, DK_OLD, IV(0x62));
v.keyring = { key: h(sub.keyring), kid: 3, epoch_of_kid: 2, old_epoch: 1, dk: h(DK_OLD), iv: h(kr.iv),
  aad: h(C.aadKeyring(3, 1, 2)), ct: h(kr.ct) };
v.keyring_digest = { list: [{ epoch: 1, kid: 3, iv: h(kr.iv), ct: h(kr.ct) }], digest: h(await C.keyringDigest([kr])) };

// Controlepunt (§9)
const cpContent = { seq: 7, h: C.b64(audRow.h), state: C.b64(fromHex(v.state_digest.digest)), records: 2, counter: 9,
  write_keys_digest: C.b64(fromHex(v.write_keys_digest.digest)), keyring_digest: C.b64(fromHex(v.keyring_digest.digest)) };
const cp = await C.sealCheckpoint(await C.importAesKey(sub.checkpoint), 1, 1, cpContent, IV(0x63));
v.checkpoint = { key: h(sub.checkpoint), kid: 1, epoch: 1, content: cpContent, iv: h(cp.iv),
  aad: h(C.checkpointAad(1, 1)), ct: h(cp.ct) };

// Reservering (§3.8)
v.reservation = { key: h(sub.reserve), kid: 1, until: 65545, data: h(C.reservationData(1, 65545)),
  mac: h((await C.makeReservation(await C.importHmacKey(sub.reserve), 1, 65545)).mac) };

// Back-upbestand (§11): alleen de bestandsopbouw, met een kleine inhoud.
const header = {
  magic: 'dahis-backup', format: 1, epoch: 1, salt: SALT_FILE, kdf,
  wrapped_password: { iv: IV(0x50), ct: fromHex(v.wrap_password.ct) },
  recovery: { alg: 'HKDF-SHA256', salt: SALT_H, iv: IV(0x51), ct: fromHex(v.wrap_recovery.ct) },
};
const payload = { format: 1, created_at: '2026-11-25T12:00:00.000Z', app_version: '0.1.0',
  source_device_id: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', write_keys: [], keyring: [], records: [], audit: [],
  checkpoint: { kid: 1, content: cpContent } };
const file = await C.encodeBackupFile(await C.importDataKey(DK.slice()), header, payload, IV(0x70));
const line1 = file.split('\n')[0];
v.backup = { dk: h(DK), file_salt: h(SALT_FILE), iv: h(IV(0x70)), payload, line1,
  line1_sha256: h(await C.sha256(C.utf8(line1))), aad: h(await C.backupAad(1, line1)), file };

// Negatieve gevallen
v.ongeldig = {
  base64url: ['A', 'AB=', 'A+B/', 'AB', 'ABC', 'A B'].filter((s) => { try { C.fromB64(s); return false; } catch (e) { return true; } }),
  base64url_geldig: ['', 'AA', 'AAA', 'AQID', '-_-_'],
  aad: [['dahis/1/x', 'met spatie'], ['dahis/1/x', -1], ['dahis/1/x', 1.5], ['dahis/1/x', 'é']],
  header: [
    line1.replace('{"magic"', '{ "magic"'),
    line1.replace('"format":1,', '"format":1,"format":1,'),
    line1.replace(/"epoch":1,("salt":"[^"]*"),/, '$1,"epoch":1,'),
    line1.replace('"iterations":600000', '"iterations":599999'),
    line1.replace('"magic":"dahis-backup"', '"magic":"dahis-forensic"'),
    line1 + ' ',
  ],
};

writeFileSync(new URL('./fixtures/vectoren.json', import.meta.url), JSON.stringify(v, null, 2) + '\n');
console.log('tests/fixtures/vectoren.json geschreven');

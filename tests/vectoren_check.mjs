// Controleert crypto.js tegen tests/fixtures/vectoren.json. Gedeeld door de
// Node-test (vectoren.test.mjs) en de controle in de browser. Geeft een lijst
// met fouten; leeg betekent alles klopt.
export async function checkVectors(C, v) {
  const errors = [];
  const fromHex = (s) => Uint8Array.from((s.match(/../g) || []).map((x) => parseInt(x, 16)));
  const eq = (name, actual, expected) => { if (actual !== expected) errors.push(name + ': ' + actual + ' ≠ ' + expected); };
  const fails = async (name, fn) => {
    try { await fn(); errors.push(name + ': had moeten falen'); } catch (e) { /* verwacht */ }
  };

  for (const c of v.pbkdf2) {
    eq('pbkdf2 ' + c.iterations, C.hex(await C.pbkdf2Bytes(c.password, fromHex(c.salt), c.iterations)), c.kek);
    eq('pbkdf2 NFD ' + c.iterations, C.hex(await C.pbkdf2Bytes(c.password_nfd, fromHex(c.salt), c.iterations)), c.kek);
  }
  for (const c of v.hkdf) eq('hkdf ' + c.info, C.hex(await C.hkdfBytes(fromHex(c.ikm), fromHex(c.salt), c.info)), c.okm);

  // Subsleutels via de echte afleiding (niet-exporteerbaar) moeten gelijk zijn
  // aan de HKDF-bytes: zelfde ciphertext bij zelfde invoer.
  const dk = await C.importDataKey(fromHex(v.wrap_password.dk));
  const subs = await C.deriveSubkeys(dk, fromHex(v.hkdf[1].salt));
  const probe = C.utf8('probe');
  for (const c of v.hkdf.slice(1, 5)) {
    const domain = c.info.split('/').pop();
    const viaBytes = await C.encrypt(await C.importAesKey(fromHex(c.okm)), probe, probe, new Uint8Array(12));
    const viaDerive = await C.encrypt(subs[domain], probe, probe, new Uint8Array(12));
    eq('subsleutel ' + domain, C.hex(viaDerive.ct), C.hex(viaBytes.ct));
  }

  const wp = v.wrap_password;
  const kdf = { alg: 'PBKDF2-SHA256', iterations: wp.iterations, salt: fromHex(wp.salt) };
  eq('wrap password aad', C.hex(C.aadWrapPassword(kdf, wp.epoch)), wp.aad);
  eq('wrap password ct', C.hex((await C.wrapDataKey(await C.importAesKey(fromHex(wp.kek)), fromHex(wp.dk), fromHex(wp.aad), fromHex(wp.iv))).ct), wp.ct);
  const kek = await C.passwordKek(v.pbkdf2[0].password, kdf);
  eq('unwrap password', C.hex(await C.unwrapDataKey(kek, { iv: fromHex(wp.iv), ct: fromHex(wp.ct) }, fromHex(wp.aad))), wp.dk);
  await fails('unwrap met verkeerde epoch', () => C.unwrapDataKey(kek, { iv: fromHex(wp.iv), ct: fromHex(wp.ct) }, C.aadWrapPassword(kdf, 2)));
  const wr = v.wrap_recovery;
  eq('wrap recovery aad', C.hex(C.aadWrapRecovery({ salt: fromHex(wr.salt) }, wr.epoch)), wr.aad);
  const rkek = await C.recoveryKek(fromHex(v.recovery_key.bytes), fromHex(wr.salt));
  eq('unwrap recovery', C.hex(await C.unwrapDataKey(rkek, { iv: fromHex(wr.iv), ct: fromHex(wr.ct) }, fromHex(wr.aad))), wr.dk);

  const rk = v.recovery_key;
  eq('herstelsleutel tekst', await C.formatRecoveryKey(fromHex(rk.bytes)), rk.text);
  for (const input of rk.geldige_invoer) eq('herstelsleutel invoer ' + input, C.hex(await C.parseRecoveryKey(input)), rk.bytes);
  for (const input of rk.ongeldige_invoer) await fails('herstelsleutel ongeldig ' + input, () => C.parseRecoveryKey(input));

  const r = v.record;
  const recKey = await C.importAesKey(fromHex(r.key));
  const row = await C.sealRecord(recKey, r.epoch, r.meta, r.content, fromHex(r.iv));
  eq('record aad', C.hex(C.recordAad(row, r.epoch)), r.aad);
  eq('record aad uit delen', C.hex(C.aadBytes(r.aad_parts)), r.aad);
  eq('record ct', C.hex(row.ct), r.ct);
  eq('record lengte', row.ct.length - 16, r.plaintext_length);
  eq('record vh', C.hex(await C.versionHash(row, r.epoch)), r.vh);
  eq('record terug', JSON.stringify(await C.openRecord(recKey, r.epoch, row)), JSON.stringify(r.content));
  for (const [field, value] of [['kind', 'test_ander'], ['version', 3], ['updated_at', '2026-11-25T12:00:00.001Z'], ['kid', 2]]) {
    await fails('record met gewijzigd ' + field, () => C.openRecord(recKey, r.epoch, Object.assign({}, row, { [field]: value })));
  }
  await fails('record met andere epoch', () => C.openRecord(recKey, r.epoch + 1, row));

  const a = v.audit;
  const audKey = await C.importAesKey(fromHex(a.key));
  const aud = await C.sealAudit(audKey, a.epoch, { seq: a.seq, kid: a.kid, hPrev: fromHex(a.h_prev) }, a.content, fromHex(a.iv));
  eq('audit aad', C.hex(C.auditAad(a.kid, a.epoch, a.seq, fromHex(a.h_prev))), a.aad);
  eq('audit ct', C.hex(aud.ct), a.ct);
  eq('audit h', C.hex(aud.h), a.h);
  await fails('audit met andere h_vorige', () => C.openAudit(audKey, a.epoch, aud, new Uint8Array(32)));

  const sd = v.state_digest;
  eq('state leeg', C.hex(await C.sha256(C.utf8('dahis/1/state'))), sd.leeg);
  eq('state', C.hex(await C.sha256(C.utf8('dahis/1/state'), ...sd.vhs.map(fromHex))), sd.digest);
  const wk = v.write_keys_digest.list.map((w) => ({ kid: w.kid, epoch: w.epoch, salt: fromHex(w.salt) }));
  eq('write_keys_digest', C.hex(await C.writeKeysDigest(wk)), v.write_keys_digest.digest);
  const kr = v.keyring;
  const krEntry = await C.wrapKeyringEntry(await C.importAesKey(fromHex(kr.key)), kr.kid, kr.epoch_of_kid, kr.old_epoch, fromHex(kr.dk), fromHex(kr.iv));
  eq('keyring aad', C.hex(C.aadKeyring(kr.kid, kr.old_epoch, kr.epoch_of_kid)), kr.aad);
  eq('keyring ct', C.hex(krEntry.ct), kr.ct);
  eq('keyring_digest', C.hex(await C.keyringDigest([krEntry])), v.keyring_digest.digest);

  const cp = v.checkpoint;
  const cpKey = await C.importAesKey(fromHex(cp.key));
  const sealed = await C.sealCheckpoint(cpKey, cp.kid, cp.epoch, cp.content, fromHex(cp.iv));
  eq('checkpoint aad', C.hex(C.checkpointAad(cp.kid, cp.epoch)), cp.aad);
  eq('checkpoint ct', C.hex(sealed.ct), cp.ct);
  eq('checkpoint terug', JSON.stringify(await C.openCheckpoint(cpKey, cp.epoch, sealed)), JSON.stringify(cp.content));

  const rs = v.reservation;
  const rsKey = await C.importHmacKey(fromHex(rs.key));
  eq('reservering data', C.hex(C.reservationData(rs.kid, rs.until)), rs.data);
  const res = await C.makeReservation(rsKey, rs.kid, rs.until);
  eq('reservering mac', C.hex(res.mac), rs.mac);
  eq('reservering geldig', await C.reservationValid(rsKey, res, rs.kid), true);
  eq('reservering ander kid', await C.reservationValid(rsKey, res, rs.kid + 1), false);
  eq('reservering gewijzigd', await C.reservationValid(rsKey, Object.assign({}, res, { until: rs.until + 1 }), rs.kid), false);

  const b = v.backup;
  const bdk = await C.importDataKey(fromHex(b.dk));
  const parts = C.splitBackupFile(C.utf8(b.file));
  eq('backup regel 1', parts.line1, b.line1);
  const header = C.parseHeader(parts.line1);
  eq('backup header canoniek', C.serializeHeader(header), b.line1);
  eq('backup aad', C.hex(await C.backupAad(header.epoch, parts.line1)), b.aad);
  eq('backup opnieuw', await C.encodeBackupFile(bdk, header, b.payload, fromHex(b.iv)), b.file);
  eq('backup inhoud', JSON.stringify(await C.decodeBackupPayload(bdk, header, parts.line1, parts.line2)), JSON.stringify(b.payload));
  await fails('backup header als regel 2 gewijzigd', () => C.decodeBackupPayload(bdk, header, parts.line1 + ' ', parts.line2));

  for (const s of v.ongeldig.base64url) await fails('base64url ' + JSON.stringify(s), () => C.fromB64(s));
  for (const s of v.ongeldig.base64url_geldig) eq('base64url terug ' + s, C.b64(C.fromB64(s)), s);
  for (const p of v.ongeldig.aad) await fails('aad ' + JSON.stringify(p), () => C.aadBytes(p));
  for (const line of v.ongeldig.header) await fails('header ' + line.slice(0, 40), () => C.parseHeader(line));
  return errors;
}

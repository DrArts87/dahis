// Meting van de controles bij een groot logboek (taak 6, formaat §9.4) en
// van grote back-ups (taak 7, formaat §2.4).
//
// Bouwt in het geheugen een opslag van formaat 1 met een wegwerpwachtwoord
// en wegwerpsleutels, met `auditRows` auditregels en `recordVersions`
// recordversies van nepinhoud (vaste opvulling, geen tekst). Daarop draaien
// de echte fullCheck() en quickCheck() uit vault.js. Er komt niets in
// IndexedDB en de sleutels verdwijnen met de functie.
//
// Verschil met de echte opslag: het inlezen uit IndexedDB telt niet mee.
// Daarvoor toont Meer → Controle opslag de duur op de eigen opslag.
//
// De regels worden direct versleuteld, buiten buildTx om (anders zou elke
// regel de toestandsdigest opnieuw berekenen). De reservering van het
// IV-budget (§3.8) is hier niet nodig: de sleutels worden nooit opgeslagen.
import {
  randomBytes, b64, sealRecord, versionHash, stateDigest, auditContent, sealAudit,
  writeKeysDigest, keyringDigest, sealCheckpoint,
} from './crypto.js';
import {
  applyTx, createInstallation, emptyStore, fullCheck, quickCheck, buildBackupFile, inspectBackup,
} from './vault.js';

export const BENCH_KIND = 'meting';

// Volgorde van acties in het nep-logboek: vooral ontgrendelen en inzien.
const PATTERN = ['unlock', 'view', 'view', 'update', 'unlock', 'view'];

function throwawayPassword() {
  return 'meting ' + b64(randomBytes(24));
}

// Geeft {store, session, password}. now: tijdstip van alle regels.
// padBytes: opvulling per recordversie (standaard ongeveer 1 KiB per versie).
export async function buildBenchStore({ auditRows, recordVersions, now = new Date(), padBytes = 800 }) {
  const password = throwawayPassword();
  const { tx, session } = await createInstallation({ password, now });
  const store = emptyStore();
  applyTx(store, tx);
  const kid = session.kid;
  const epoch = session.epochOf(kid);
  const keys = await session.subkeys(kid);
  const ts = now.toISOString();
  const ids = [];

  const recordRows = [];
  for (let i = 0; i < recordVersions; i++) {
    const id = globalThis.crypto.randomUUID();
    ids.push(id);
    // Standaard ongeveer 1 KiB per versie, zoals een kort dossierstuk.
    const content = { schema: 1, data: { n: i, pad: '0'.repeat(padBytes) } };
    const row = await sealRecord(keys.record, epoch, { id, version: 1, kid, kind: BENCH_KIND, updated_at: ts }, content);
    store.records.push(row);
    recordRows.push(row);
  }

  const last = store.audit[store.audit.length - 1];
  let hPrev = last.h;
  let seq = last.seq;
  for (let i = 0; i < auditRows - 1; i++) {
    const action = PATTERN[i % PATTERN.length];
    const fields = { ts, device_id: session.deviceId, action };
    if (action === 'unlock') fields.detail = 'password';
    else if (ids.length) {
      const j = i % ids.length;
      fields.kind = BENCH_KIND;
      fields.record_id = ids[j];
      fields.version = 1;
      if (action === 'update') fields.vh = b64(await versionHash(recordRows[j], epoch));
    }
    seq += 1;
    const row = await sealAudit(keys.audit, epoch, { seq, kid, hPrev }, auditContent(fields));
    store.audit.push(row);
    hPrev = row.h;
  }

  const content = {
    seq,
    h: b64(hPrev),
    state: b64(await stateDigest(store.records, (k) => session.epochOf(k))),
    records: store.records.length,
    counter: session.counter,
    write_keys_digest: b64(await writeKeysDigest(store.meta.write_keys)),
    keyring_digest: b64(await keyringDigest(store.meta.keyring)),
  };
  store.meta.checkpoint = await sealCheckpoint(keys.checkpoint, kid, epoch, content);
  session.checkpointContent = content;
  return { store, session, password };
}

// Geeft {buildMs, fullMs, quickMs} (afgerond op hele ms).
export async function measureChecks({ auditRows, recordVersions, timer = () => globalThis.performance.now(), now }) {
  const t0 = timer();
  const { store, session } = await buildBenchStore({ auditRows, recordVersions, now });
  const t1 = timer();
  await fullCheck(store, session);
  const t2 = timer();
  await quickCheck(store, session);
  const t3 = timer();
  return { buildMs: Math.round(t1 - t0), fullMs: Math.round(t2 - t1), quickMs: Math.round(t3 - t2) };
}

// Opvulling per recordversie bij de meting van grote back-ups: 64 KiB.
export const BACKUP_PAD_BYTES = 64 * 1024;

// Een recordversie van BACKUP_PAD_BYTES neemt in het bestand ongeveer zoveel
// bytes in: versleuteld, base64 in de inhoud, en de inhoud nog eens base64
// (§11.2): 4/3 · 4/3 ≈ 1,78, plus wat JSON.
const BYTES_PER_VERSION = Math.ceil(BACKUP_PAD_BYTES * 16 / 9) + 256;

// Maakt en opent een nep-back-up van ongeveer targetBytes, in het geheugen,
// met de echte buildBackupFile() en inspectBackup() (wachtwoordroute). Geeft
// {bytes, buildMs, writeMs, readMs}, of {error} als het niet lukt (te groot,
// te weinig geheugen). Piekgeheugen is vanuit de pagina niet betrouwbaar te
// meten in Chrome op Android.
export async function measureBackup({ targetBytes, timer = () => globalThis.performance.now(), now = new Date() }) {
  const recordVersions = Math.max(1, Math.floor(targetBytes / BYTES_PER_VERSION));
  try {
    const t0 = timer();
    let bench = await buildBenchStore({ auditRows: recordVersions, recordVersions, now, padBytes: BACKUP_PAD_BYTES });
    const t1 = timer();
    let text = await buildBackupFile(bench.store, bench.session, { now });
    const t2 = timer();
    let file = new TextEncoder().encode(text);
    text = null;
    const size = file.length;
    const opened = await inspectBackup(file, { password: bench.password });
    opened.raw.fill(0);
    const t3 = timer();
    file = null;
    bench = null;
    return { bytes: size, buildMs: Math.round(t1 - t0), writeMs: Math.round(t2 - t1), readMs: Math.round(t3 - t2) };
  } catch (err) {
    return { error: (err && err.name) || 'Error' };
  }
}

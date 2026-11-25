// Meting van de controles bij een groot logboek (taak 6, formaat §9.4).
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
import { applyTx, createInstallation, emptyStore, fullCheck, quickCheck } from './vault.js';

export const BENCH_KIND = 'meting';

// Volgorde van acties in het nep-logboek: vooral ontgrendelen en inzien.
const PATTERN = ['unlock', 'view', 'view', 'update', 'unlock', 'view'];

function throwawayPassword() {
  return 'meting ' + b64(randomBytes(24));
}

// Geeft {store, session}. now: tijdstip van alle regels.
export async function buildBenchStore({ auditRows, recordVersions, now = new Date() }) {
  const { tx, session } = await createInstallation({ password: throwawayPassword(), now });
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
    // Ongeveer 1 KiB per versie, zoals een kort dossierstuk.
    const content = { schema: 1, data: { n: i, pad: '0'.repeat(800) } };
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
  return { store, session };
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

// Tests van app/js/benchmark.js (meting van de controles, taak 6), met
// kleine aantallen. Alleen nepinhoud.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../app/js/crypto.js';
import * as V from '../app/js/vault.js';
import { buildBenchStore, measureChecks, BENCH_KIND } from '../app/js/benchmark.js';

test('nep-opslag doorstaat beide controles en heeft de gevraagde omvang', async () => {
  const { store, session } = await buildBenchStore({ auditRows: 40, recordVersions: 7 });
  assert.equal(store.audit.length, 40);
  assert.equal(store.records.length, 7);
  assert.ok(store.records.every((r) => r.kind === BENCH_KIND));
  await V.fullCheck(store, session);
  await V.quickCheck(store, session);
  const page = await V.readAuditPage(store, session, { limit: 6 });
  assert.deepEqual([...new Set(page.entries.map((e) => e.action))].sort(), ['unlock', 'update', 'view']);
});

test('nep-opslag: een gewijzigde oudere regel valt alleen bij de volledige controle op', async () => {
  const { store, session } = await buildBenchStore({ auditRows: 20, recordVersions: 3 });
  const row = store.audit.find((r) => r.seq === 5);
  row.ct = row.ct.slice();
  row.ct[0] ^= 1;
  await V.quickCheck(store, session);
  await assert.rejects(V.fullCheck(store, session), (e) => e instanceof C.IntegrityError && e.code === 'chain');
});

test('measureChecks geeft drie duren in ms', async () => {
  let t = 0;
  const r = await measureChecks({ auditRows: 10, recordVersions: 2, timer: () => (t += 5) });
  assert.deepEqual(r, { buildMs: 5, fullMs: 5, quickMs: 5 });
});

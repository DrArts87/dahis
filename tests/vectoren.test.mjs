// crypto.js tegen de vaste testvectoren van formaat 1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as C from '../app/js/crypto.js';
import { checkVectors } from './vectoren_check.mjs';

test('crypto.js klopt met tests/fixtures/vectoren.json', async () => {
  const vectors = JSON.parse(readFileSync(new URL('./fixtures/vectoren.json', import.meta.url), 'utf8'));
  assert.equal(vectors.formaat, C.FORMAT);
  assert.deepEqual(await checkVectors(C, vectors), []);
});

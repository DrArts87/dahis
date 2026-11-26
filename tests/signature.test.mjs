// Tests van app/js/signature.js (0.5.2): controle van de opgeslagen inhoud en
// het opschonen van pixels. Het verwerken via canvas: tests/browser.mjs.
// Alleen kunstmatige plaatjes, nooit een echte handtekening.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidSignature, readSignature, cleanPixels, fitSize, bytesToBase64, base64ToBytes,
  MAX_WIDTH, MAX_HEIGHT, MAX_PNG_BYTES, WHITE_LEVEL,
} from '../app/js/signature.js';
import { makeTestSignature, makeTestPng } from './helpers/kluis.mjs';

test('geldige handtekening: PNG met kloppende maat binnen de grenzen', () => {
  const sig = makeTestSignature(40, 16);
  assert.equal(isValidSignature(sig), true);
  assert.deepEqual(readSignature(sig), Object.assign({}, sig));
  assert.equal(isValidSignature(makeTestSignature(MAX_WIDTH, MAX_HEIGHT)), true);
});

test('ongeldig: maat, type, geen PNG, extra veld, te groot, geen base64', () => {
  const sig = makeTestSignature(40, 16);
  const bad = [
    null, [], 'x',
    Object.assign({}, sig, { width: 41 }),
    Object.assign({}, sig, { height: 0 }),
    Object.assign({}, sig, { type: 'image/jpeg' }),
    Object.assign({}, sig, { png: 'bm90IGVlbiBwbmc=' }),
    Object.assign({}, sig, { png: 'geen base64!' }),
    Object.assign({}, sig, { extra: true }),
    makeTestSignature(MAX_WIDTH + 1, 10),
    makeTestSignature(10, MAX_HEIGHT + 1),
    Object.assign({}, sig, { png: 'A'.repeat(Math.ceil(MAX_PNG_BYTES / 3) * 4 + 4) }),
  ];
  for (const b of bad) assert.equal(isValidSignature(b), false, JSON.stringify(b && b.width));
  assert.equal(readSignature({ type: 'image/png' }), null);
});

test('base64 heen en terug, ook groter dan één blok', () => {
  const bytes = new Uint8Array(70000).map((_, i) => i % 251);
  assert.deepEqual(base64ToBytes(bytesToBase64(bytes)), bytes);
  assert.deepEqual(base64ToBytes(bytesToBase64(makeTestPng(5, 5))), makeTestPng(5, 5));
});

function image(width, height, fill) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(fill(i % width, Math.floor(i / width)), i * 4);
  return { width, height, data };
}

test('opschonen: wit en lichtgrijs worden transparant, inkt wordt zwart; kader van de inkt', () => {
  // Wit papier met een donkere streep van (3,2) tot (6,4) en wat lichte ruis.
  const img = image(10, 8, (x, y) => {
    if (x >= 3 && x <= 6 && y >= 2 && y <= 4) return [30, 30, 40, 255];
    if (x === 9 && y === 7) return [WHITE_LEVEL + 10, WHITE_LEVEL + 10, WHITE_LEVEL + 10, 255];
    return [255, 255, 255, 255];
  });
  const box = cleanPixels(img);
  assert.deepEqual(box, { x: 3, y: 2, width: 4, height: 3 });
  const at = (x, y) => Array.from(img.data.slice((y * 10 + x) * 4, (y * 10 + x) * 4 + 4));
  assert.deepEqual(at(0, 0), [0, 0, 0, 0], 'wit transparant');
  assert.deepEqual(at(9, 7), [0, 0, 0, 0], 'lichte ruis transparant');
  assert.deepEqual(at(4, 3).slice(0, 3), [0, 0, 0], 'inkt zwart');
  assert.ok(at(4, 3)[3] > 200, 'inkt goed dekkend');
});

test('opschonen: een getekende lijn op transparant telt als inkt; leeg geeft null', () => {
  const drawn = image(6, 6, (x, y) => (x === y ? [0, 0, 0, 255] : [0, 0, 0, 0]));
  assert.deepEqual(cleanPixels(drawn), { x: 0, y: 0, width: 6, height: 6 });
  assert.equal(cleanPixels(image(6, 6, () => [255, 255, 255, 255])), null);
  assert.equal(cleanPixels(image(6, 6, () => [0, 0, 0, 0])), null);
});

test('doelmaat: binnen de grenzen, verhouding gelijk, nooit vergroot', () => {
  const big = fitSize(3000, 500);
  assert.ok(big.width <= MAX_WIDTH && big.height <= MAX_HEIGHT);
  assert.ok(Math.abs((big.width - 16) / (big.height - 16) - 6) < 0.1);
  const small = fitSize(50, 20);
  assert.deepEqual([small.width, small.height, small.scale], [66, 36, 1]);
});

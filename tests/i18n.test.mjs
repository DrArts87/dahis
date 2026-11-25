// Teksten los van de code: elke gebruikte sleutel bestaat in i18n/nl.js, er
// zijn geen ongebruikte sleutels, en t() vult plaatshouders in.
//
// Gebruikte sleutels worden gevonden als t('…'), k('…'), say('…'),
// key: '…' en Error: '…' (meldingen per fouttype) in app/js/*.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import nl from '../app/js/i18n/nl.js';
import { t, hasText } from '../app/js/i18n.js';

const dir = new URL('../app/js/', import.meta.url);
const sources = readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => readFileSync(new URL(f, dir), 'utf8'));
const PATTERNS = [/\bt\('([^']+)'/g, /\bk\('([^']+)'/g, /\bsay\('([^']+)'/g, /\bkey: '([^']+)'/g, /Error: '([^']+)'/g];

function usedKeys() {
  const used = new Set();
  for (const src of sources) {
    for (const re of PATTERNS) for (const m of src.matchAll(re)) used.add(m[1]);
  }
  return used;
}

test('elke gebruikte tekstsleutel bestaat', () => {
  const missing = [...usedKeys()].filter((key) => !hasText(key));
  assert.deepEqual(missing, []);
});

test('geen ongebruikte tekstsleutels', () => {
  const used = usedKeys();
  const unused = Object.keys(nl).filter((key) => !used.has(key));
  assert.deepEqual(unused, []);
});

test('plaatshouders en ontbrekende sleutels', () => {
  assert.equal(t('onboarding.step', { n: 2, total: 5 }), 'Stap 2 van 5');
  assert.equal(t('onboarding.step', { n: 2 }), 'Stap 2 van {total}');
  assert.equal(t('bestaat.niet'), '[bestaat.niet]');
});

test('teksten zijn platte tekst zonder HTML', () => {
  for (const [key, value] of Object.entries(nl)) {
    assert.equal(typeof value, 'string', key);
    assert.ok(!/[<>]/.test(value), key);
  }
});

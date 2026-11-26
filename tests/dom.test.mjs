// Tests van de invoerhulpen in app/js/dom.js (review PR #23 P1-1): geheime
// velden wissen bij verbergen, en waarden alleen terugzetten in een veld van
// hetzelfde type en dezelfde geheimmarkering. Nagebootste invoervelden met
// {id, type, value, dataset}, zoals in de browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSecretInput, collectInputs, restoreInputs, clearSecretInputs } from '../app/js/dom.js';

function input(id, type, value = '', secret = false) {
  return { id, type, value, dataset: secret ? { secret: '' } : {} };
}

test('geheim: wachtwoordveld of data-secret', () => {
  assert.equal(isSecretInput(input('a', 'password')), true);
  assert.equal(isSecretInput(input('b', 'text', '', true)), true);
  assert.equal(isSecretInput(input('c', 'text')), false);
});

test('wisselen van wachtwoord naar herstelsleutel: het wachtwoord komt niet in het tekstveld', () => {
  const saved = collectInputs([input('secret', 'password', 'verzonnen wachtwoord')]);
  const recoveryField = input('secret', 'text', '', true);
  restoreInputs(saved, [recoveryField]);
  assert.equal(recoveryField.value, '');
  // En terug: een herstelsleutel komt niet in het wachtwoordveld.
  const saved2 = collectInputs([input('secret', 'text', 'ABCD-EFGH', true)]);
  const pwField = input('secret', 'password');
  restoreInputs(saved2, [pwField]);
  assert.equal(pwField.value, '');
});

test('opnieuw tekenen van hetzelfde formulier: waarden blijven', () => {
  const saved = collectInputs([input('pw1', 'password', 'een'), input('erase', 'text', 'WIS'), input('f', 'file', 'x')]);
  const fields = [input('pw1', 'password'), input('erase', 'text'), input('f', 'file')];
  restoreInputs(saved, fields);
  assert.deepEqual(fields.map((f) => f.value), ['een', 'WIS', '']);
});

test('verbergen: alleen geheime velden gewist', () => {
  const fields = [input('pw1', 'password', 'geheim'), input('g1', 'text', 'ABCD', true), input('erase', 'text', 'WIS')];
  assert.equal(clearSecretInputs(fields), 2);
  assert.deepEqual(fields.map((f) => f.value), ['', '', 'WIS']);
});

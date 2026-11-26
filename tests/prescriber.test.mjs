// Tests van app/js/prescriber.js (stap D2): velden, regels en inlezen.
// Alleen verzonnen gegevens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PRESCRIBER_KEYS, PRESCRIBER_INPUT, checkField, validatePrescriber, readPrescriber, isComplete, formValues,
} from '../app/js/prescriber.js';
import { TEST_PRESCRIBER } from './helpers/kluis.mjs';

test('vaste lijst velden, alle verplicht', () => {
  assert.deepEqual(PRESCRIBER_KEYS, ['name', 'profession', 'big', 'agb', 'practice', 'address', 'postcode', 'city', 'phone', 'email']);
  assert.deepEqual(validatePrescriber(TEST_PRESCRIBER), { data: Object.assign({}, TEST_PRESCRIBER) });
  for (const key of PRESCRIBER_KEYS) {
    const input = Object.assign({}, TEST_PRESCRIBER, { [key]: '  ' });
    assert.deepEqual(validatePrescriber(input).errors, { [key]: 'prescriber.error.required' }, key);
  }
  assert.deepEqual(Object.keys(validatePrescriber({}).errors), PRESCRIBER_KEYS);
});

test('BIG 11 cijfers, AGB 8 cijfers', () => {
  assert.deepEqual(checkField('big', ' 00000000000 '), { value: '00000000000' });
  for (const bad of ['0000000000', '000000000000', '0000000000a', '000 0000 0000']) {
    assert.equal(checkField('big', bad).error, 'prescriber.error.big', bad);
  }
  assert.deepEqual(checkField('agb', '00000000'), { value: '00000000' });
  for (const bad of ['0000000', '000000000', 'abcdefgh']) assert.equal(checkField('agb', bad).error, 'prescriber.error.agb', bad);
});

test('postcode wordt 1234 AB; ongeldige postcodes geweigerd', () => {
  assert.deepEqual(checkField('postcode', '9999zz'), { value: '9999 ZZ' });
  assert.deepEqual(checkField('postcode', '9999   zz'), { value: '9999 ZZ' });
  for (const bad of ['0999 ZZ', '999 ZZ', '9999 Z', '9999 SS', 'ZZ 9999']) {
    assert.equal(checkField('postcode', bad).error, 'prescriber.error.postcode', bad);
  }
});

test('telefoon, e-mail, tekstvelden en stuurtekens', () => {
  assert.deepEqual(checkField('phone', '+31 00 000 0000'), { value: '+31 00 000 0000' });
  for (const bad of ['000 000', 'bel mij', '000-000-0000-0000-00000']) assert.equal(checkField('phone', bad).error, 'prescriber.error.phone', bad);
  assert.deepEqual(checkField('email', 'test@example.invalid'), { value: 'test@example.invalid' });
  for (const bad of ['geen-email', 'a@b', 'a @b.c']) assert.equal(checkField('email', bad).error, 'prescriber.error.email', bad);
  assert.equal(checkField('name', 'x'.repeat(101)).error, 'prescriber.error.text');
  assert.equal(checkField('name', 'regel\nregel').error, 'prescriber.error.text');
  assert.deepEqual(checkField('name', 'Dr.  T.   Testpersoon'), { value: 'Dr. T. Testpersoon' });
  assert.equal(checkField('onbekend', 'x').error, 'prescriber.error.unknown');
  assert.equal(checkField('name', 12).error, 'prescriber.error.required');
});

test('inlezen: onbekende en ongeldige velden vallen weg, dan niet compleet', () => {
  assert.deepEqual(readPrescriber(null), {});
  assert.deepEqual(readPrescriber([1]), {});
  assert.equal(isComplete(readPrescriber(TEST_PRESCRIBER)), true);
  const stored = Object.assign({}, TEST_PRESCRIBER, { big: '123', extra: 'x' });
  const read = readPrescriber(stored);
  assert.equal(read.big, undefined);
  assert.equal(read.extra, undefined);
  assert.equal(isComplete(read), false);
  assert.equal(isComplete({}), false);
});

test('formulier: bewaarde waarden, anders "vrij gevestigd" als praktijknaam', () => {
  const empty = formValues({});
  assert.equal(empty.practice, 'vrij gevestigd');
  assert.equal(empty.name, '');
  assert.equal(formValues(TEST_PRESCRIBER).name, TEST_PRESCRIBER.name);
  assert.equal(formValues({ practice: 'Testpraktijk' }).practice, 'Testpraktijk');
});

test('review PR #39 P1: geen invoerveld met maxlength (de controle ziet de volledige invoer)', () => {
  assert.deepEqual(Object.keys(PRESCRIBER_INPUT).sort(), PRESCRIBER_KEYS.slice().sort());
  for (const [key, attrs] of Object.entries(PRESCRIBER_INPUT)) {
    assert.equal(Object.prototype.hasOwnProperty.call(attrs, 'maxlength'), false, key);
  }
  // Een geplakt nummer van 12 cijfers wordt geweigerd, niet ingekort tot 11.
  assert.equal(checkField('big', '000000000000').error, 'prescriber.error.big');
  assert.equal(checkField('agb', '000000000').error, 'prescriber.error.agb');
});

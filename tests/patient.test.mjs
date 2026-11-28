// Persoonsgegevens van een patiënt (fase 2, E1): velden, naamgebruik en
// geslacht volgens de NHG-Tabellen 42 en 4, het BSN met de 11-proef als
// waarschuwing, en het patiëntnummer. Alleen verzonnen gegevens; een BSN haalt
// de 11-proef nooit (CLAUDE.md §5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PATIENT_FIELDS, PATIENT_KEYS, NAME_USAGES, SEXES, RELATIONS, MAX_PATIENT_NUMBER,
  validatePatient, checkField, readPatient, formValues, passesElevenTest, elevenTestSum,
  formatNumber, isPatientNumber, readCounter, displayName, surname, sortKey,
} from '../app/js/patient.js';
import { TEST_PATIENT, TEST_BSN_FAILING } from './helpers/kluis.mjs';

const TODAY = '2026-11-28';

function valid(extra = {}) {
  return validatePatient(Object.assign({}, TEST_PATIENT, extra), { today: TODAY });
}

test('codes volgens het NHG: naamgebruik (tabel 42), geslacht (tabel 4), relatie', () => {
  assert.deepEqual([...NAME_USAGES], ['N', 'E', 'EN', 'NE', 'P']);
  assert.deepEqual([...SEXES], ['O', 'M', 'V', 'N']);
  assert.deepEqual([...RELATIONS], ['self', 'household', 'family', 'acquaintance', 'business', 'other']);
  assert.deepEqual(PATIENT_KEYS, PATIENT_FIELDS.map((f) => f.field));
  assert.ok(!PATIENT_KEYS.includes('number'), 'het nummer zet de controller');
});

test('minimale invoer: alleen ingevulde velden, naamgebruik standaard N', () => {
  const r = valid();
  assert.equal(r.errors, undefined);
  assert.deepEqual(r.data, Object.assign({ name_usage: 'N' }, TEST_PATIENT));
  assert.deepEqual(r.warnings, {});
  assert.equal(formValues(null).name_usage, 'N');
  assert.equal(formValues(r.data).family_name, 'Testpersoon');
});

test('verplichte velden', () => {
  const r = validatePatient({}, { today: TODAY });
  assert.deepEqual(r.errors, {
    family_name: 'patient.error.required',
    birth_date: 'patient.error.required',
    relation: 'patient.error.required',
    initials: 'patient.error.nameOrInitials',
  });
  assert.equal(r.data, undefined);
  // Voornamen in plaats van voorletters is ook goed.
  const g = valid({ initials: '', given_names: 'Anna Berta' });
  assert.equal(g.errors, undefined);
  assert.equal(g.data.initials, undefined);
});

test('naam van de echtgenoot en pseudoniem zijn verplicht bij dat naamgebruik', () => {
  for (const usage of ['E', 'EN', 'NE']) {
    assert.equal(valid({ name_usage: usage }).errors.partner_name, 'patient.error.required', usage);
    assert.equal(valid({ name_usage: usage, partner_name: 'Voorbeeld' }).errors, undefined, usage);
  }
  assert.equal(valid({ name_usage: 'P' }).errors.pseudonym, 'patient.error.required');
  assert.equal(valid({ name_usage: 'P', pseudonym: 'Proefnaam' }).errors, undefined);
  assert.equal(valid({ name_usage: 'n' }).data.name_usage, 'N');
  assert.equal(valid({ name_usage: 'X' }).errors.name_usage, 'patient.error.choice');
});

test('voorletters worden genormaliseerd', () => {
  assert.equal(checkField('initials', 'a b').value, 'A.B.');
  assert.equal(checkField('initials', 'a.b.').value, 'A.B.');
  assert.equal(checkField('initials', 'th. j').value, 'Th.J.');
  assert.equal(checkField('initials', '1.2.').error, 'patient.error.initials');
});

test('geboortedatum: jjjj-mm-dd of dd-mm-jjjj, bestaande dag, niet in de toekomst, niet vóór 1900', () => {
  assert.equal(valid({ birth_date: '12-3-1980' }).data.birth_date, '1980-03-12');
  for (const bad of ['1980-02-30', '1899-12-31', '2026-11-29', '1980/03/12', '80-03-12']) {
    assert.equal(valid({ birth_date: bad }).errors.birth_date, 'patient.error.date', bad);
  }
  assert.equal(valid({ birth_date: TODAY }).errors, undefined);
});

test('geslacht en relatie: alleen de vaste codes', () => {
  for (const s of SEXES) assert.equal(valid({ sex: s.toLowerCase() }).data.sex, s);
  assert.equal(valid({ sex: 'X' }).errors.sex, 'patient.error.choice');
  for (const rel of RELATIONS) assert.equal(valid({ relation: rel }).data.relation, rel);
  assert.equal(valid({ relation: 'buurman' }).errors.relation, 'patient.error.choice');
});

test('BSN: 9 cijfers; haalt het de 11-proef niet, dan een waarschuwing en geen fout', () => {
  assert.equal(elevenTestSum(TEST_BSN_FAILING), 147);
  assert.equal(passesElevenTest(TEST_BSN_FAILING), false);
  assert.equal(passesElevenTest('000000000'), false, 'alleen nullen telt nooit');
  const r = valid({ bsn: '1234.56 789' });
  assert.equal(r.errors, undefined);
  assert.equal(r.data.bsn, TEST_BSN_FAILING);
  assert.deepEqual(r.warnings, { bsn: 'patient.warn.bsn' });
  assert.equal(valid({ bsn: '12345678' }).errors.bsn, 'patient.error.bsn');
  assert.equal(valid({ bsn: '12345678a' }).errors.bsn, 'patient.error.bsn');
});

test('andere velden: postcode, telefoon, e-mail, geen stuurtekens', () => {
  assert.equal(valid({ postcode: '9999zz' }).data.postcode, '9999 ZZ');
  assert.equal(valid({ postcode: '9999 SS' }).errors.postcode, 'patient.error.postcode');
  assert.equal(valid({ phone: '000 000 0000' }).data.phone, '000 000 0000');
  assert.equal(valid({ phone: '12' }).errors.phone, 'patient.error.phone');
  assert.equal(valid({ email: 'geen-adres' }).errors.email, 'patient.error.email');
  assert.equal(valid({ family_name: 'Test\npersoon' }).errors.family_name, 'patient.error.text');
  assert.equal(valid({ family_name: '1234' }).errors.family_name, 'patient.error.text');
  assert.equal(valid({ gp: 'x'.repeat(101) }).errors.gp, 'patient.error.text');
  assert.equal(valid({ onbekend: 'x' }).data.onbekend, undefined);
});

test('strikt inlezen: ongeldige velden en een ongeldig nummer vallen weg', () => {
  const data = Object.assign({ number: 'DH000007', sex: 'X', extra: 'x', bsn: TEST_BSN_FAILING }, TEST_PATIENT);
  const r = readPatient(data);
  assert.equal(r.number, 'DH000007');
  assert.equal(r.sex, undefined);
  assert.equal(r.extra, undefined);
  assert.equal(r.bsn, TEST_BSN_FAILING, 'een waarschuwing maakt een veld niet ongeldig');
  assert.equal(readPatient(Object.assign({}, data, { number: 'DH7' })).number, undefined);
  assert.deepEqual(readPatient(null), {});
  assert.deepEqual(readPatient([1]), {});
});

test('patiëntnummer en teller', () => {
  assert.equal(formatNumber(1), 'DH000001');
  assert.equal(formatNumber(MAX_PATIENT_NUMBER), 'DH999999');
  assert.throws(() => formatNumber(0), RangeError);
  assert.throws(() => formatNumber(MAX_PATIENT_NUMBER + 1), RangeError);
  assert.equal(isPatientNumber('DH000001'), true);
  assert.equal(isPatientNumber('DH00001'), false);
  assert.equal(readCounter({ last: 4 }), 4);
  for (const bad of [null, {}, { last: -1 }, { last: 1.5 }, { last: '4' }, { last: MAX_PATIENT_NUMBER + 1 }]) {
    assert.equal(readCounter(bad), 0);
  }
});

test('naam in de lijst volgens het naamgebruik', () => {
  const base = { family_name: 'Proef', family_prefix: 'van der', initials: 'B.', partner_name: 'Voorbeeld', partner_prefix: 'de' };
  assert.equal(displayName(Object.assign({ name_usage: 'N' }, base)), 'Proef, B. van der');
  assert.equal(displayName(Object.assign({ name_usage: 'E' }, base)), 'Voorbeeld, B. de');
  assert.equal(displayName(Object.assign({ name_usage: 'EN' }, base)), 'Voorbeeld-van der Proef, B. de');
  assert.equal(displayName(Object.assign({ name_usage: 'NE' }, base)), 'Proef-de Voorbeeld, B. van der');
  assert.equal(displayName(Object.assign({ name_usage: 'P', pseudonym: 'Proefnaam' }, base)), 'Proefnaam');
  assert.equal(surname(Object.assign({ name_usage: 'N' }, base)), 'van der Proef');
  assert.equal(displayName({ family_name: 'Testpersoon', given_names: 'anna berta', name_usage: 'N' }), 'Testpersoon, A.B.');
  assert.ok(sortKey(Object.assign({ name_usage: 'N' }, base)) < sortKey({ family_name: 'Testpersoon', initials: 'A.', name_usage: 'N' }));
});

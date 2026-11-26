// Gegevens van de voorschrijver (stap D2, docs/plans/2026-11-26-d2-voorschrijver.md).
//
// Eén record van kind 'prescriber' in de versleutelde kluis, met inhoud
// {schema: 1, data: {veld: tekst}}. Het gaat mee in de back-up; een wijziging
// staat in het auditlog als create of update, zonder de waarden. Alle velden
// zijn verplicht (besluit gebruiker 2026-11-26). De wettelijke eisen aan een
// recept worden in fase 3 nagelopen; schema 1 kan dan met een versie groeien.
//
// Alleen verzonnen voorbeelden in code, tests en documentatie (CLAUDE.md §1).

export const PRESCRIBER_KIND = 'prescriber';
export const PRESCRIBER_SCHEMA = 1;

// Geen stuurtekens of regeleinden in een veld.
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

function text(max) {
  return (v) => v.length <= max;
}

// Velden in de volgorde van het formulier (`field` = sleutel in data). `check` krijgt de getrimde
// tekst (na `normalize`); `error` is de tekstsleutel bij een fout.
export const PRESCRIBER_FIELDS = Object.freeze([
  Object.freeze({ field: 'name', max: 100, check: text(100), error: 'prescriber.error.text' }),
  Object.freeze({ field: 'profession', max: 60, check: text(60), error: 'prescriber.error.text' }),
  // BIG-nummer: 11 cijfers; er is geen openbare controle met een rekenregel.
  Object.freeze({ field: 'big', max: 11, check: (v) => /^\d{11}$/.test(v), error: 'prescriber.error.big' }),
  Object.freeze({ field: 'agb', max: 8, check: (v) => /^\d{8}$/.test(v), error: 'prescriber.error.agb' }),
  Object.freeze({ field: 'practice', max: 100, check: text(100), error: 'prescriber.error.text', default: 'vrij gevestigd' }),
  Object.freeze({ field: 'address', max: 100, check: text(100), error: 'prescriber.error.text' }),
  Object.freeze({
    field: 'postcode', max: 7, error: 'prescriber.error.postcode',
    normalize: (v) => {
      const m = /^([1-9]\d{3})\s*([a-zA-Z]{2})$/.exec(v);
      return m ? m[1] + ' ' + m[2].toUpperCase() : v;
    },
    check: (v) => /^[1-9]\d{3} [A-Z]{2}$/.test(v) && !/^\d{4} (SA|SD|SS)$/.test(v),
  }),
  Object.freeze({ field: 'city', max: 60, check: text(60), error: 'prescriber.error.text' }),
  Object.freeze({
    field: 'phone', max: 20, error: 'prescriber.error.phone',
    check: (v) => /^\+?[0-9][0-9 -]*$/.test(v) && v.replace(/\D/g, '').length >= 10 && v.length <= 20,
  }),
  Object.freeze({
    field: 'email', max: 100, error: 'prescriber.error.email',
    check: (v) => v.length <= 100 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
  }),
]);

// Kenmerken van de invoervelden. Bewust zonder maxlength: de browser zou
// een te lange (geplakte) waarde stil afkappen, waarna de controle een
// afgekort BIG-nummer kon goedkeuren (review PR #39, P1). De controle ziet
// altijd de volledige invoer en weigert wat te lang is.
export const PRESCRIBER_INPUT = Object.freeze({
  name: Object.freeze({ autocomplete: 'name', autocapitalize: 'words' }),
  profession: Object.freeze({ autocapitalize: 'none' }),
  big: Object.freeze({ inputmode: 'numeric' }),
  agb: Object.freeze({ inputmode: 'numeric' }),
  practice: Object.freeze({ autocapitalize: 'none' }),
  address: Object.freeze({ autocomplete: 'street-address', autocapitalize: 'words' }),
  postcode: Object.freeze({ autocomplete: 'postal-code', autocapitalize: 'characters' }),
  city: Object.freeze({ autocomplete: 'address-level2', autocapitalize: 'words' }),
  phone: Object.freeze({ type: 'tel', autocomplete: 'tel', inputmode: 'tel' }),
  email: Object.freeze({ type: 'email', autocomplete: 'email', autocapitalize: 'none' }),
});

export const PRESCRIBER_KEYS = Object.freeze(PRESCRIBER_FIELDS.map((f) => f.field));

function fieldOf(key) {
  return PRESCRIBER_FIELDS.find((f) => f.field === key);
}

// Eén veld: getrimd en genormaliseerd, of een fout. Leeg is een fout: alle
// velden zijn verplicht.
export function checkField(key, raw) {
  const f = fieldOf(key);
  if (!f) return { error: 'prescriber.error.unknown' };
  if (typeof raw !== 'string') return { error: 'prescriber.error.required' };
  let v = raw.normalize('NFC').trim().replace(/ {2,}/g, ' ');
  if (v === '') return { error: 'prescriber.error.required' };
  if (CONTROL.test(v)) return { error: f.error };
  if (f.normalize) v = f.normalize(v);
  if (v.length > f.max || !f.check(v)) return { error: f.error };
  return { value: v };
}

// Invoer van het formulier: {data} als alles klopt, anders {errors} per veld.
// Onbekende velden doen niet mee.
export function validatePrescriber(input) {
  const data = {};
  const errors = {};
  const src = input && typeof input === 'object' ? input : {};
  for (const key of PRESCRIBER_KEYS) {
    const r = checkField(key, Object.prototype.hasOwnProperty.call(src, key) ? src[key] : undefined);
    if (r.error) errors[key] = r.error;
    else data[key] = r.value;
  }
  return Object.keys(errors).length ? { errors } : { data };
}

// Opgeslagen data strikt inlezen: alleen geldige velden blijven. Een veld dat
// niet (meer) klopt, ontbreekt; dan is de registratie niet compleet.
export function readPrescriber(data) {
  const out = {};
  if (!data || typeof data !== 'object' || Array.isArray(data)) return out;
  for (const key of PRESCRIBER_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(data, key)) continue;
    const r = checkField(key, data[key]);
    if (!r.error) out[key] = r.value;
  }
  return out;
}

export function isComplete(data) {
  return Boolean(data) && PRESCRIBER_KEYS.every((key) => typeof data[key] === 'string' && data[key] !== '');
}

// Beginwaarden voor het formulier: de bewaarde waarden, anders de standaard
// (praktijknaam "vrij gevestigd"), anders leeg.
export function formValues(data) {
  const out = {};
  for (const f of PRESCRIBER_FIELDS) {
    out[f.field] = data && typeof data[f.field] === 'string' ? data[f.field] : (f.default || '');
  }
  return out;
}

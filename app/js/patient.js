// Persoonsgegevens van een patiënt (fase 2, taak E1:
// docs/plans/2026-11-28-e1-patient.md).
//
// Eén record van kind 'patient' per patiënt in de versleutelde kluis, met
// inhoud {schema: 1, data: {veld: tekst}}. Andere dossiergegevens (episodes,
// overgevoeligheden; E3) worden eigen records met `patient_id` (raakpunt R1,
// optie B). Het patiëntnummer (DH000001, …) komt uit een teller, record
// 'patient_counter', die in dezelfde transactie wordt bijgewerkt.
//
// Aansluiting op het NHG HIS-Referentiemodel (dossierdeel Persoonsgegevens):
// geslachtsnaam en voorvoegsels apart, naamgebruik volgens NHG-Tabel 42 en
// geslacht volgens NHG-Tabel 4, zonder afwijking (besluit 2026-11-28;
// fair use voor eigen gebruik, CLAUDE.md §4).
//
// Alleen verzonnen voorbeelden in code, tests en documentatie (CLAUDE.md §1);
// een BSN in tests haalt de 11-proef niet (CLAUDE.md §5).

export const PATIENT_KIND = 'patient';
export const PATIENT_SCHEMA = 1;
export const PATIENT_COUNTER_KIND = 'patient_counter';
export const PATIENT_COUNTER_SCHEMA = 1;

export const NUMBER_PREFIX = 'DH';
export const MAX_PATIENT_NUMBER = 999999;
const NUMBER_RE = /^DH\d{6}$/;

// NHG-Tabel 42 (aanduiding naamgebruik), alle codes.
export const NAME_USAGES = Object.freeze(['N', 'E', 'EN', 'NE', 'P']);
// NHG-Tabel 4 (geslacht), alle codes.
export const SEXES = Object.freeze(['O', 'M', 'V', 'N']);
// Relatie tot de voorschrijver (besluit 2 van het plan fase 2).
export const RELATIONS = Object.freeze(['self', 'household', 'family', 'acquaintance', 'business', 'other']);

const PARTNER_USAGES = Object.freeze(['E', 'EN', 'NE']);
const EARLIEST_BIRTH = '1900-01-01';

// Geen stuurtekens of regeleinden in een veld.
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const HAS_LETTER = /\p{L}/u;

function text(max) {
  return (v) => v.length <= max;
}

function name(max) {
  return (v) => v.length <= max && HAS_LETTER.test(v);
}

function isCalendarDate(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

// Velden in de volgorde van het formulier. `required`: true, of een functie
// van de andere (genormaliseerde) invoer. `check` krijgt de getrimde tekst na
// `normalize`; `error` is de tekstsleutel bij een fout.
export const PATIENT_FIELDS = Object.freeze([
  Object.freeze({ field: 'family_name', max: 100, required: true, check: name(100), error: 'patient.error.text' }),
  Object.freeze({ field: 'family_prefix', max: 20, check: text(20), error: 'patient.error.text' }),
  Object.freeze({
    field: 'partner_name', max: 100, check: name(100), error: 'patient.error.text',
    required: (src) => PARTNER_USAGES.includes(src.name_usage),
  }),
  Object.freeze({ field: 'partner_prefix', max: 20, check: text(20), error: 'patient.error.text' }),
  Object.freeze({
    field: 'name_usage', max: 2, required: true, error: 'patient.error.choice', default: 'N',
    normalize: (v) => v.toUpperCase(),
    check: (v) => NAME_USAGES.includes(v),
  }),
  Object.freeze({
    field: 'pseudonym', max: 100, check: name(100), error: 'patient.error.text',
    required: (src) => src.name_usage === 'P',
  }),
  Object.freeze({ field: 'given_names', max: 100, check: name(100), error: 'patient.error.text' }),
  Object.freeze({
    field: 'initials', max: 30, error: 'patient.error.initials',
    // "a b" en "a.b" worden "A.B."; twee letters per voorletter (bijv. "Th.", "IJ.") mag.
    normalize: (v) => {
      const parts = v.replace(/\./g, ' ').split(' ').filter(Boolean);
      return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1) + '.').join('');
    },
    check: (v) => v.length <= 30 && /^(?:\p{L}\p{L}?\.){1,10}$/u.test(v),
  }),
  Object.freeze({ field: 'call_name', max: 60, check: name(60), error: 'patient.error.text' }),
  Object.freeze({
    field: 'sex', max: 1, error: 'patient.error.choice',
    normalize: (v) => v.toUpperCase(),
    check: (v) => SEXES.includes(v),
  }),
  Object.freeze({
    field: 'birth_date', max: 10, required: true, error: 'patient.error.date',
    // Ook dd-mm-jjjj; opgeslagen als jjjj-mm-dd.
    normalize: (v) => {
      const m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(v);
      return m ? m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0') : v;
    },
    check: (v, ctx) => isCalendarDate(v) && v >= EARLIEST_BIRTH && (!ctx.today || v <= ctx.today),
  }),
  Object.freeze({
    field: 'relation', max: 20, required: true, error: 'patient.error.choice',
    check: (v) => RELATIONS.includes(v),
  }),
  Object.freeze({
    field: 'bsn', max: 9, error: 'patient.error.bsn',
    normalize: (v) => v.replace(/[\s.]/g, ''),
    check: (v) => /^\d{9}$/.test(v),
    // Haalt het nummer de 11-proef niet, dan een waarschuwing (besluit 3).
    warn: (v) => (passesElevenTest(v) ? null : 'patient.warn.bsn'),
  }),
  Object.freeze({ field: 'address', max: 100, check: text(100), error: 'patient.error.text' }),
  Object.freeze({
    field: 'postcode', max: 7, error: 'patient.error.postcode',
    normalize: (v) => {
      const m = /^([1-9]\d{3})\s*([a-zA-Z]{2})$/.exec(v);
      return m ? m[1] + ' ' + m[2].toUpperCase() : v;
    },
    check: (v) => /^[1-9]\d{3} [A-Z]{2}$/.test(v) && !/^\d{4} (SA|SD|SS)$/.test(v),
  }),
  Object.freeze({ field: 'city', max: 60, check: text(60), error: 'patient.error.text' }),
  Object.freeze({
    field: 'phone', max: 20, error: 'patient.error.phone',
    check: (v) => /^\+?[0-9][0-9 -]*$/.test(v) && v.replace(/\D/g, '').length >= 10 && v.length <= 20,
  }),
  Object.freeze({
    field: 'email', max: 100, error: 'patient.error.email',
    check: (v) => v.length <= 100 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
  }),
  Object.freeze({ field: 'gp', max: 100, check: text(100), error: 'patient.error.text' }),
  Object.freeze({ field: 'pharmacy', max: 100, check: text(100), error: 'patient.error.text' }),
  Object.freeze({ field: 'insurer', max: 100, check: text(100), error: 'patient.error.text' }),
  Object.freeze({ field: 'policy_number', max: 30, check: text(30), error: 'patient.error.text' }),
]);

export const PATIENT_KEYS = Object.freeze(PATIENT_FIELDS.map((f) => f.field));

function fieldOf(key) {
  return PATIENT_FIELDS.find((f) => f.field === key);
}

function own(src, key) {
  return Object.prototype.hasOwnProperty.call(src, key) ? src[key] : undefined;
}

// 11-proef voor een BSN: 9×d1 + 8×d2 + … + 2×d8 − 1×d9 is deelbaar door 11.
// Een nummer met alleen nullen geldt als niet geldig.
export function passesElevenTest(bsn) {
  if (!/^\d{9}$/.test(bsn) || /^0{9}$/.test(bsn)) return false;
  return elevenTestSum(bsn) % 11 === 0;
}

export function elevenTestSum(digits) {
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += Number(digits[i]) * (9 - i);
  return sum - Number(digits[8]);
}

// Eén veld: getrimd en genormaliseerd ({value}, leeg = ''), of een fout.
// `ctx.today` (jjjj-mm-dd) begrenst de geboortedatum.
export function checkField(key, raw, ctx = {}) {
  const f = fieldOf(key);
  if (!f) return { error: 'patient.error.unknown' };
  if (raw === undefined || raw === null) raw = '';
  if (typeof raw !== 'string') return { error: f.error };
  let v = raw.normalize('NFC').trim().replace(/ {2,}/g, ' ');
  if (v === '') return { value: '' };
  if (CONTROL.test(v)) return { error: f.error };
  if (f.normalize) v = f.normalize(v);
  if (v.length > f.max || !f.check(v, ctx)) return { error: f.error };
  const warning = f.warn ? f.warn(v) : null;
  return warning ? { value: v, warning } : { value: v };
}

function isRequired(f, values) {
  return typeof f.required === 'function' ? f.required(values) : Boolean(f.required);
}

// Invoer van het formulier. Uitkomst: {data, warnings} als er geen fouten
// zijn, anders {errors, warnings}. `data` bevat alleen ingevulde velden;
// het patiëntnummer zet de controller. Onbekende velden doen niet mee.
export function validatePatient(input, ctx = {}) {
  const src = input && typeof input === 'object' ? input : {};
  const values = {};
  const errors = {};
  const warnings = {};
  for (const f of PATIENT_FIELDS) {
    const r = checkField(f.field, own(src, f.field), ctx);
    if (r.error) errors[f.field] = r.error;
    else values[f.field] = r.value === '' && f.default ? f.default : r.value;
    if (r.warning) warnings[f.field] = r.warning;
  }
  for (const f of PATIENT_FIELDS) {
    if (!errors[f.field] && values[f.field] === '' && isRequired(f, values)) errors[f.field] = 'patient.error.required';
  }
  // Voornamen of voorletters is verplicht.
  if (!errors.given_names && !errors.initials && !values.given_names && !values.initials) {
    errors.initials = 'patient.error.nameOrInitials';
  }
  if (Object.keys(errors).length) return { errors, warnings };
  const data = {};
  for (const key of PATIENT_KEYS) if (values[key] !== '') data[key] = values[key];
  return { data, warnings };
}

// Opgeslagen data strikt inlezen: alleen geldige velden blijven (een veld
// dat niet meer klopt, ontbreekt), plus het patiëntnummer als het klopt.
export function readPatient(data) {
  const out = {};
  if (!data || typeof data !== 'object' || Array.isArray(data)) return out;
  if (typeof data.number === 'string' && NUMBER_RE.test(data.number)) out.number = data.number;
  for (const key of PATIENT_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(data, key)) continue;
    const r = checkField(key, data[key]);
    if (!r.error && r.value !== '') out[key] = r.value;
  }
  return out;
}

// Beginwaarden voor het formulier: de bewaarde waarden, anders de standaard
// (naamgebruik "N"), anders leeg.
export function formValues(data) {
  const out = {};
  for (const f of PATIENT_FIELDS) {
    out[f.field] = data && typeof data[f.field] === 'string' ? data[f.field] : (f.default || '');
  }
  return out;
}

// --- Patiëntnummer -------------------------------------------------------------------------

export function formatNumber(n) {
  if (!Number.isSafeInteger(n) || n < 1 || n > MAX_PATIENT_NUMBER) throw new RangeError('Patiëntnummer buiten bereik');
  return NUMBER_PREFIX + String(n).padStart(6, '0');
}

export function isPatientNumber(v) {
  return typeof v === 'string' && NUMBER_RE.test(v);
}

// Inhoud van de teller strikt inlezen: het hoogste uitgegeven nummer, 0 als
// er nog niets is uitgegeven of de inhoud niet klopt.
export function readCounter(data) {
  const last = data && typeof data === 'object' ? data.last : undefined;
  return Number.isSafeInteger(last) && last >= 0 && last <= MAX_PATIENT_NUMBER ? last : 0;
}

// --- Weergave ------------------------------------------------------------------------------

function joinName(prefix, family) {
  return [prefix, family].filter(Boolean).join(' ');
}

function initialsOf(data) {
  if (data.initials) return data.initials;
  if (!data.given_names) return '';
  return data.given_names.split(' ').filter(Boolean).map((p) => p.charAt(0).toUpperCase() + '.').join('');
}

// Achternaam volgens het naamgebruik (NHG-Tabel 42), met de voorvoegsels
// vooraan, bijvoorbeeld "van der Proef" of "Voorbeeld-van der Proef".
export function surname(data) {
  const ownName = joinName(data.family_prefix, data.family_name);
  const partner = joinName(data.partner_prefix, data.partner_name);
  switch (data.name_usage) {
    case 'E': return partner || ownName;
    case 'EN': return partner ? partner + '-' + ownName : ownName;
    case 'NE': return partner ? ownName + '-' + partner : ownName;
    case 'P': return data.pseudonym || ownName;
    default: return ownName;
  }
}

// Naam in de lijst: "Proef, B. van der"; bij een pseudoniem alleen dat.
// Gesorteerd wordt op de achternaam zonder de voorvoegsels vooraan.
export function displayName(data) {
  if (!data) return '';
  if (data.name_usage === 'P' && data.pseudonym) return data.pseudonym;
  const first = firstPrefix(data);
  const full = surname(data);
  const core = first && full.startsWith(first + ' ') ? full.slice(first.length + 1) : full;
  const tail = [initialsOf(data), first].filter(Boolean).join(' ');
  return tail ? core + ', ' + tail : core;
}

function firstPrefix(data) {
  switch (data.name_usage) {
    case 'E': case 'EN': return data.partner_name ? (data.partner_prefix || '') : (data.family_prefix || '');
    default: return data.family_prefix || '';
  }
}

export function sortKey(data) {
  return displayName(data).toLocaleLowerCase('nl');
}

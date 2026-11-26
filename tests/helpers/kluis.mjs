// Gedeelde testhulp (issue #26): minder PBKDF2-rondes in tests.
//
// De app gebruikt altijd DEFAULT_ITERATIONS (2.000.000). Tests die niet over
// de sleutelafleiding zelf gaan, maken hun wraps met het minimum van het
// formaat (600.000, formaat §2.4): dezelfde code, minder rekenwerk. Tests
// over de standaard, de KDF-upgrade en de volledige route gebruiken de echte
// standaard (C.DEFAULT_ITERATIONS) en staan als zodanig gemarkeerd.
//
// Geen *.test.mjs: node --test draait dit bestand niet zelf.
import * as C from '../../app/js/crypto.js';

export const TEST_ITERATIONS = C.MIN_ITERATIONS;
export const REAL_ITERATIONS = C.DEFAULT_ITERATIONS;

// Verzonnen voorschrijver voor tests: geen echte persoon, nummers met alleen
// nullen, een gereserveerd e-maildomein. Het gaat alleen om het formaat.
export const TEST_PRESCRIBER = Object.freeze({
  name: 'Dr. T. Testpersoon',
  profession: 'arts',
  big: '00000000000',
  agb: '00000000',
  practice: 'vrij gevestigd',
  address: 'Teststraat 1',
  postcode: '9999 ZZ',
  city: 'Teststad',
  phone: '000 000 0000',
  email: 'test@example.invalid',
});

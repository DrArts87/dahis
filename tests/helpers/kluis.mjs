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

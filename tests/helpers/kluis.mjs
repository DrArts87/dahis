// Gedeelde testhulp (issue #26): minder PBKDF2-rondes in tests.
//
// De app gebruikt altijd DEFAULT_ITERATIONS (2.000.000). Tests die niet over
// de sleutelafleiding zelf gaan, maken hun wraps met het minimum van het
// formaat (600.000, formaat §2.4): dezelfde code, minder rekenwerk. Tests
// over de standaard, de KDF-upgrade en de volledige route gebruiken de echte
// standaard (C.DEFAULT_ITERATIONS) en staan als zodanig gemarkeerd.
//
// Geen *.test.mjs: node --test draait dit bestand niet zelf.
import { deflateSync } from 'node:zlib';
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

// --- Handtekening voor tests (0.5.2) -------------------------------------------------------
// Een kunstmatig PNG-plaatje: een schuine zwarte streep op transparant. Geen
// echte handtekening. Gemaakt met node:zlib (alleen Node-standaardmodules).

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

export function makeTestPng(width = 40, height = 16) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;   // 8 bits, RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1);
    const x = Math.round((y / (height - 1)) * (width - 1));
    raw[row + 1 + x * 4 + 3] = 255;   // zwart, dekkend
  }
  return new Uint8Array(Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]));
}

export function makeTestSignature(width = 40, height = 16) {
  return Object.freeze({
    type: 'image/png', width, height, png: Buffer.from(makeTestPng(width, height)).toString('base64'),
  });
}

export const TEST_SIGNATURE = makeTestSignature();

// --- Patiënt voor tests (fase 2, E1) -------------------------------------------------------
// Verzonnen persoonsgegevens; geen echte persoon. Een BSN in tests haalt de
// 11-proef nooit (CLAUDE.md §5): TEST_BSN_FAILING geeft 147 (rest 4 bij delen door 11).
export const TEST_PATIENT = Object.freeze({
  family_name: 'Testpersoon',
  initials: 'A.B.',
  birth_date: '1980-03-12',
  relation: 'self',
});

export const TEST_BSN_FAILING = '123456789';

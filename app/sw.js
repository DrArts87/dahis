// Service worker van Dahis.
//
// - Installeert alle app-bestanden in een cache per versie en controleert van
//   elk bestand de SHA-256. Klopt er één niet, dan mislukt de installatie en
//   blijft de huidige versie draaien.
// - Een nieuwe versie wacht tot de gebruiker op "Bijwerken" drukt (geen
//   automatische skipWaiting).
// - Beantwoordt verzoeken alleen uit de cache en gaat nooit zelf het netwerk
//   op; wat niet in de cache staat, krijgt een 404.
// - Zet de beveiligingsheaders op elk antwoord, omdat GitHub Pages dat niet
//   kan.
'use strict';

// BEGIN RELEASE (geschreven door tools/release.py, niet met de hand wijzigen)
const VERSION = '0.1.0';
const CODE_HASH = '6f9634749823a55c8d107de9dfab9eb66b5fbf010e9eaa1a533e4684c1dabe92';
const FILES = {
  'css/app.css': 'd84a72e00d2c7c97e4d0c5a90ee92441b68e574c7335cb93e5d880d6a46284a7',
  'icons/icon-192.png': 'b090d418288b6b804fe6ca2d7e44af19e4fb20d5cacc0e781954a1b7238a6017',
  'icons/icon-512.png': '40ef0099a8e58ac1d28cde5df123b67ba1b71729980a493ad4f34c8c75253d7d',
  'icons/maskable-512.png': 'd11fff1268156e7e52b718bf8de38ddb1b05bd4518961488d3046d1e411b2569',
  'index.html': '948afd6ab56f87748e77bf957534640ed6de5993d6ff906c5ecb4a2d8dbfcd6f',
  'js/app.js': 'be2999aae6d08145525de3f3b46a27ae0d8033b549e9167ead0f86e016321cb5',
  'js/crypto.js': 'e54e1ece7e34e33c4c2d55036b2e3a168a5a7a798cb23d5be80f96f2d764ac11',
  'js/dom.js': 'b9fbcca62aed7bc58191f03b8c4e5e1ab4bb33047711ef9b7e2bd7703de88610',
  'js/store.js': 'd2cbb60a03b49bb74ad1eb5bb11bc73d3e684c1549e4b242d086050ca3f330cf',
  'js/vault.js': '08f2c035d4334d191ab7b182526430d5286b038cab3410a0967f4b94debe97d7',
  'manifest.webmanifest': '5289e78f294f931c6d8aecc3eb19ebd2d26023d25cc41d25ef8af6f8beaaad80',
};
// EINDE RELEASE

const CACHE = 'dahis-' + VERSION + '-' + CODE_HASH.slice(0, 16);
const CACHE_PREFIX = 'dahis-';

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "require-trusted-types-for 'script'",
  'trusted-types dahis-sw',
].join('; ');

const SECURITY_HEADERS = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': [
    'accelerometer=()', 'camera=()', 'display-capture=()', 'geolocation=()',
    'gyroscope=()', 'magnetometer=()', 'microphone=()', 'payment=()', 'usb=()',
  ].join(', '),
  'Cache-Control': 'no-store',
};

const CONTENT_TYPES = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  webmanifest: 'application/manifest+json; charset=utf-8',
  json: 'application/json; charset=utf-8',
  png: 'image/png',
};

function contentType(path) {
  const ext = path.slice(path.lastIndexOf('.') + 1);
  return CONTENT_TYPES[ext] || 'application/octet-stream';
}

function hex(buffer) {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('');
}

function scopeUrl() {
  return new URL(self.registration.scope);
}

// Pad binnen de scope, of null als de URL erbuiten valt.
function relativePath(url) {
  const scope = scopeUrl();
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return null;
  const rel = url.pathname.slice(scope.pathname.length);
  return rel === '' ? 'index.html' : rel;
}

async function installFiles() {
  const cache = await caches.open(CACHE);
  try {
    for (const [path, expected] of Object.entries(FILES)) {
      const url = new URL(path, scopeUrl()).href;
      const response = await fetch(url, { cache: 'no-store', credentials: 'omit', redirect: 'error' });
      if (!response.ok) throw new Error('Ophalen mislukt: ' + path + ' (' + response.status + ')');
      const body = await response.arrayBuffer();
      const actual = hex(await crypto.subtle.digest('SHA-256', body));
      if (actual !== expected) throw new Error('Hash klopt niet: ' + path);
      await cache.put(url, new Response(body, { headers: { 'Content-Type': contentType(path) } }));
    }
  } catch (err) {
    await caches.delete(CACHE);
    throw err;
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(installFiles());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith(CACHE_PREFIX) && name !== CACHE) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

function notFound() {
  return new Response('Niet gevonden in de app.', {
    status: 404,
    headers: Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, SECURITY_HEADERS),
  });
}

async function fromCache(request) {
  const path = relativePath(new URL(request.url));
  if (request.method !== 'GET' || path === null || !Object.prototype.hasOwnProperty.call(FILES, path)) {
    return notFound();
  }
  const cache = await caches.open(CACHE);
  const cached = await cache.match(new URL(path, scopeUrl()).href);
  if (!cached) return notFound();
  return new Response(cached.body, {
    status: 200,
    headers: Object.assign({ 'Content-Type': contentType(path) }, SECURITY_HEADERS),
  });
}

self.addEventListener('fetch', (event) => {
  event.respondWith(fromCache(event.request));
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'info' && event.ports[0]) {
    event.ports[0].postMessage({ version: VERSION, codeHash: CODE_HASH });
  } else if (data.type === 'activate') {
    self.skipWaiting();
  }
});

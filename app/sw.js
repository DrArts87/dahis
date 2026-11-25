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
const CODE_HASH = 'e0f16bd039053842c967ba482ba78062dfdf4843d68d7ca30c7d49c7bd6d6fb9';
const FILES = {
  'css/app.css': '4f4d7cf3ba136df5212fcb2c4a8848992a061b6c725133c8465cec46e2a1bf39',
  'icons/icon-192.png': 'd2edc03ddf6f76b8a7da2c6551a92503dd72252fddcc9036d1d19c021630d3f9',
  'icons/icon-512.png': 'b343af987b68af8170afc33f05cd4d7df9b0ef2b0743a4839fac4d2719767889',
  'icons/maskable-512.png': '2f31ea3c158ef2f6be8d0db386f4f7ddb3e77b35598c7c861ed169f7a18c6949',
  'img/galago-open.svg': '202e138fdd3ea7629316b2f87586d2bb9729655000bd53011bd659f994eed8d5',
  'img/rand-boven.svg': '56c77cadfa290551a3f716f8ed22e1770ed6e507bd89e397684dc4d85d8791a0',
  'img/rand-onder.svg': 'f75a8bc82a75f09d636a48b82a5cf0c0d409a18ab28175e6e32984811a8be26e',
  'img/varen-mos.png': '78513f78acfa8a13bb62ff74f5dd030ce6b34f4034f24d120ffbcfc254011f84',
  'index.html': '7af7f7da05e2d52ca7d5b49de2adda06f2aaefbeaa43d21dfaab06cbfa41a5b5',
  'js/app.js': '08cd532b5d601d605074a42e781bc21e747f8db8b3c5edaf73f348f22fd36a96',
  'js/benchmark.js': '9b4a9ebd60d3bf84023ffdcb38043fcbbe2d203bb70d9021f4f199219cc3eae6',
  'js/controller.js': '9698e98e1840606f773bd3b5a66fcb43c243bfc77902acddd5de758eea3dc4b0',
  'js/crypto.js': 'e54e1ece7e34e33c4c2d55036b2e3a168a5a7a798cb23d5be80f96f2d764ac11',
  'js/dom.js': '2f27e24228dbb71b902f77741db744f214663e4f00df0fc81412323766c599cf',
  'js/i18n.js': '0558e4cae1a98c22e993077d8d53a67407dc970c2eaa792e28d402a9012acc97',
  'js/i18n/nl.js': 'f4c216668b51d3ac72040f8088e4d4b130f6516322c9de18c8ed37150a24b520',
  'js/settings.js': '66752e3878cfdef67a91f3349063d688b31a8f33b67f21a232180a85f3435745',
  'js/store.js': 'df470e9330ada519d1d699bb1d6c734a2c2b59527b1acc7d452620f250e3327e',
  'js/vault.js': 'b2486496d45207e5653b8ae07e7d27f6558f21b167ef33f8cf36667d9a155711',
  'manifest.webmanifest': 'f40056063d21cbfdf42cbf89d93f8d737f421ca41d3b789f34eab206e8e9a606',
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
  svg: 'image/svg+xml',
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

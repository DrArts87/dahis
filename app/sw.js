// Service worker van Dahis.
//
// - Installeert alle app-bestanden in een cache per versie en controleert van
//   elk bestand de SHA-256. Klopt er één niet, dan mislukt de installatie en
//   blijft de huidige versie draaien.
// - Een nieuwe versie wordt pas gebruikt na een tik op "Bijwerken". Chrome
//   kan een wachtende worker ook zelf activeren zodra alle vensters dicht
//   zijn; daarom onthoudt de worker in een eigen cache welke versie is
//   goedgekeurd en serveert hij die, tot de gebruiker de nieuwe goedkeurt
//   (review codebase PR #12, 3).
// - Beantwoordt verzoeken alleen uit de cache en gaat nooit zelf het netwerk
//   op; wat niet in de cache staat, krijgt een 404.
// - Zet de beveiligingsheaders op elk antwoord, omdat GitHub Pages dat niet
//   kan.
'use strict';

// BEGIN RELEASE (geschreven door tools/release.py, niet met de hand wijzigen)
const VERSION = '0.4.3';
const CODE_HASH = '5198eb132a7340f5378f6b68814e003e1616f2649e1e4c46cf1010370b4226cd';
const FILES = {
  'css/app.css': '632ed982db4ecdd79ef514aefc33e74d74d5ba1bd940b1619bb08edc51db6c48',
  'icons/icon-192.png': 'd2edc03ddf6f76b8a7da2c6551a92503dd72252fddcc9036d1d19c021630d3f9',
  'icons/icon-512.png': 'b343af987b68af8170afc33f05cd4d7df9b0ef2b0743a4839fac4d2719767889',
  'icons/maskable-512.png': '2f31ea3c158ef2f6be8d0db386f4f7ddb3e77b35598c7c861ed169f7a18c6949',
  'img/galago-open.svg': '202e138fdd3ea7629316b2f87586d2bb9729655000bd53011bd659f994eed8d5',
  'img/rand-boven.svg': '56c77cadfa290551a3f716f8ed22e1770ed6e507bd89e397684dc4d85d8791a0',
  'img/rand-onder.svg': 'f75a8bc82a75f09d636a48b82a5cf0c0d409a18ab28175e6e32984811a8be26e',
  'img/varen-mos.png': '78513f78acfa8a13bb62ff74f5dd030ce6b34f4034f24d120ffbcfc254011f84',
  'index.html': '7af7f7da05e2d52ca7d5b49de2adda06f2aaefbeaa43d21dfaab06cbfa41a5b5',
  'js/app.js': '267427181d4e0ceafcdba53252e136e0e685383c3baaff2c19d62ed385214e43',
  'js/benchmark.js': '49f092c2cf461279979bfd5e68fe03eb110cf2307abcc4be689680361add6d52',
  'js/controller.js': '8a69b50af525b93d4159b571d6728f2ae08b993ad6210b45a20ecc211c43cae5',
  'js/crypto.js': '662322ad374fda7688fb72115f981d586e3961b072faf3508abc6ea1374ecb5f',
  'js/dom.js': 'd01992736527ffc6a30e9c6654d04494c1ca68c6f3af4685d6448c07633415b9',
  'js/i18n.js': '0558e4cae1a98c22e993077d8d53a67407dc970c2eaa792e28d402a9012acc97',
  'js/i18n/nl.js': '74aa1320f77584cec4eac4cd6ff3e8173a8b55e14ed0078cad553de078a134fa',
  'js/settings.js': 'c1c47f737b38658d4c62963c0de21b69605d51947846fb3154394fa4dc741ed8',
  'js/store.js': '8a4b56bc67e108a7201b879a623dea1b86cd147c68cb8e036352a1d472aebfe9',
  'js/vault.js': '6c82f9f8c68e451591b2795e6a849bc35c66e04b24168c8e2ed24c31d06f1119',
  'manifest.webmanifest': 'f40056063d21cbfdf42cbf89d93f8d737f421ca41d3b789f34eab206e8e9a606',
};
// EINDE RELEASE

const CACHE = 'dahis-' + VERSION + '-' + CODE_HASH.slice(0, 16);
const CACHE_PREFIX = 'dahis-';
// Goedgekeurde versie: {cache, version, codeHash}. Geen versienummer in de
// naam, zodat elke versie hem leest.
const APPROVAL_CACHE = 'dahis-akkoord';
const OWN = Object.freeze({ cache: CACHE, version: VERSION, codeHash: CODE_HASH });

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
  await register();
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

function approvalUrl() {
  return new URL('__akkoord', scopeUrl()).href;
}

async function readApproval() {
  try {
    const response = await (await caches.open(APPROVAL_CACHE)).match(approvalUrl());
    if (!response) return null;
    const a = await response.json();
    const ok = a && typeof a.cache === 'string' && a.cache.startsWith(CACHE_PREFIX) && a.cache !== APPROVAL_CACHE
      && typeof a.version === 'string' && typeof a.codeHash === 'string';
    return ok ? a : null;
  } catch (err) {
    return null;
  }
}

async function writeApproval(a) {
  const cache = await caches.open(APPROVAL_CACHE);
  await cache.put(approvalUrl(), new Response(JSON.stringify(a), { headers: { 'Content-Type': 'application/json' } }));
}

// De versie waarvan de bestanden worden geserveerd: de goedgekeurde, zolang
// haar cache bestaat; anders deze versie.
async function serving() {
  const a = await readApproval();
  if (a && a.cache !== CACHE && await caches.has(a.cache)) return a;
  return OWN;
}

// Volgorde van installaties (oud → nieuw), in de cache dahis-akkoord. Een
// installatie schrijft zich in vóór ze haar cache aanmaakt; installaties
// lopen één voor één, dus alleen register() schrijft deze lijst.
function registryUrl() {
  return new URL('__installaties', scopeUrl()).href;
}

async function readRegistry() {
  try {
    const response = await (await caches.open(APPROVAL_CACHE)).match(registryUrl());
    const list = response ? await response.json() : [];
    return Array.isArray(list) ? list.filter((n) => typeof n === 'string') : [];
  } catch (err) {
    return [];
  }
}

async function register() {
  const existing = await caches.keys();
  const list = (await readRegistry()).filter((n) => n !== CACHE && existing.includes(n));
  list.push(CACHE);
  const cache = await caches.open(APPROVAL_CACHE);
  await cache.put(registryUrl(), new Response(JSON.stringify(list), { headers: { 'Content-Type': 'application/json' } }));
}

// Ruimt alleen caches op van installaties van vóór deze versie (en van
// versies zonder registratie, zoals 0.1.0), behalve de goedgekeurde. Een
// nieuwere versie die nog wordt geïnstalleerd of wacht, blijft dus staan
// (review PR #12, ronde 3).
//
// Volgorde van lezen: eerst de caches, dan het register. Een installatie
// registreert zich vóór ze haar cache aanmaakt; elke cache in de eerste lijst
// staat dus ook in het daarna gelezen register. Andersom kon een installatie
// die tussen de twee leesacties begon, als onbekend worden verwijderd (review
// PR #12, ronde 4).
async function removeOlderCaches(approvedCache) {
  const names = await caches.keys();
  const list = await readRegistry();
  const me = list.indexOf(CACHE);
  for (const name of names) {
    if (!name.startsWith(CACHE_PREFIX) || name === APPROVAL_CACHE || name === CACHE || name === approvedCache) continue;
    const i = list.indexOf(name);
    if (i === -1 || (me !== -1 && i < me)) await caches.delete(name);
  }
}

// Activeren, door een tik op Bijwerken (skipWaiting) of door Chrome zelf.
// Zonder geldige goedkeuring (eerste installatie, of een vorige versie
// zonder deze registratie) geldt deze versie als goedgekeurd.
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const a = await readApproval();
    let keep = CACHE;
    if (a && a.cache !== CACHE && await caches.has(a.cache)) keep = a.cache;
    else await writeApproval(OWN);
    await removeOlderCaches(keep);
    await self.clients.claim();
  })());
});

// Goedkeuring van deze versie (tik op Bijwerken): eerst vastleggen, dan
// activeren. Een wachtende worker ruimt de oudere bestanden op bij 'activate';
// een worker die al actief was (door Chrome geactiveerd) doet dat hier.
// Zonder self.serviceWorker (oudere browsers) volgt het opruimen bij de
// volgende versie.
async function approve() {
  await writeApproval(OWN);
  const me = self.serviceWorker;
  if (me && me.state === 'activated') await removeOlderCaches(CACHE);
  await self.skipWaiting();
}

function notFound() {
  return new Response('Niet gevonden in de app.', {
    status: 404,
    headers: Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, SECURITY_HEADERS),
  });
}

// Alleen bestanden uit de cache van de geserveerde versie; die bevat alleen
// bestanden waarvan de hash bij installatie is gecontroleerd.
async function fromCache(request) {
  const path = relativePath(new URL(request.url));
  if (request.method !== 'GET' || path === null) return notFound();
  const current = await serving();
  if (current.cache === CACHE && !Object.prototype.hasOwnProperty.call(FILES, path)) return notFound();
  const cache = await caches.open(current.cache);
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

// info: geserveerde versie, en de versie die op goedkeuring wacht als deze
// worker al actief is maar nog een oudere versie serveert.
self.addEventListener('message', (event) => {
  const data = event.data || {};
  const port = event.ports[0];
  if (data.type === 'info' && port) {
    event.waitUntil(serving().then((s) => port.postMessage({
      version: s.version,
      codeHash: s.codeHash,
      pending: s.cache === CACHE ? null : { version: VERSION, codeHash: CODE_HASH },
    })));
  } else if (data.type === 'activate') {
    event.waitUntil(approve().then(
      () => { if (port) port.postMessage({ ok: true }); },
      () => { if (port) port.postMessage({ ok: false }); }));
  }
});

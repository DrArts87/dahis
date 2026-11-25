// Tests van het opruimen van caches in app/sw.js (review PR #12), met een
// nagebootste Cache-API. sw.js wordt als gewoon script in een eigen context
// geladen; de functies staan daarna in die context.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SOURCE = readFileSync(new URL('../app/sw.js', import.meta.url), 'utf8');

// Cache-API in het geheugen. hook() wordt aangeroepen na elke leesactie
// (keys of match), nadat het resultaat al vastligt.
function fakeCaches() {
  const store = new Map();
  const api = {
    store,
    hook: () => {},
    async keys() { const r = [...store.keys()]; await api.hook(); return r; },
    async has(name) { return store.has(name); },
    async delete(name) { return store.delete(name); },
    async open(name) {
      if (!store.has(name)) store.set(name, new Map());
      const entries = store.get(name);
      return {
        async put(url, response) { entries.set(url, await response.text()); },
        async match(url) {
          const text = entries.get(url);
          const r = text === undefined ? undefined : new Response(text);
          await api.hook();
          return r;
        },
      };
    },
  };
  return api;
}

function loadWorker() {
  const caches = fakeCaches();
  const self = {
    addEventListener() {},
    registration: { scope: 'https://voorbeeld.test/dahis/' },
    clients: { claim: async () => {} },
    skipWaiting: async () => {},
  };
  const context = vm.createContext({ self, caches, URL, Response, console });
  vm.runInContext(SOURCE, context);
  return { caches, context, run: (code) => vm.runInContext(code, context) };
}

async function setRegistry(w, list) {
  const cache = await w.caches.open('dahis-akkoord');
  await cache.put(new URL('__installaties', 'https://voorbeeld.test/dahis/').href, new Response(JSON.stringify(list)));
}

test('opruimen verwijdert oudere caches en houdt de goedgekeurde, de eigen en nieuwere', async () => {
  const w = loadWorker();
  const own = w.run('CACHE');
  for (const n of ['dahis-0.0.1-a', 'dahis-0.0.2-b', own, 'dahis-9.9.9-z', 'dahis-0.1.0-oud']) w.caches.store.set(n, new Map());
  await setRegistry(w, ['dahis-0.0.1-a', 'dahis-0.0.2-b', own, 'dahis-9.9.9-z']);
  await w.run('removeOlderCaches')('dahis-0.0.1-a');
  assert.deepEqual([...w.caches.store.keys()].sort(), ['dahis-0.0.1-a', own, 'dahis-9.9.9-z', 'dahis-akkoord'].sort());
});

test('een installatie die tijdens het opruimen start, blijft staan (review PR #12, ronde 4)', async () => {
  const w = loadWorker();
  const own = w.run('CACHE');
  w.caches.store.set('dahis-0.0.1-a', new Map());
  w.caches.store.set(own, new Map());
  await setRegistry(w, ['dahis-0.0.1-a', own]);
  // Na de eerste leesactie van het opruimen start een nieuwe installatie:
  // eerst registreren, dan de cache aanmaken (zoals installFiles doet).
  let armed = true;
  w.caches.hook = async () => {
    if (!armed) return;
    armed = false;
    await setRegistry(w, ['dahis-0.0.1-a', own, 'dahis-9.9.9-nieuw']);
    w.caches.store.set('dahis-9.9.9-nieuw', new Map());
  };
  await w.run('removeOlderCaches')(own);
  assert.ok(w.caches.store.has('dahis-9.9.9-nieuw'), 'nieuwe installatie behouden');
  assert.ok(!w.caches.store.has('dahis-0.0.1-a'), 'oudere opgeruimd');
});

test('register zet de eigen cache achteraan en vergeet verdwenen caches', async () => {
  const w = loadWorker();
  const own = w.run('CACHE');
  w.caches.store.set('dahis-0.0.2-b', new Map());
  await setRegistry(w, ['dahis-0.0.1-weg', own, 'dahis-0.0.2-b']);
  await w.run('register')();
  assert.deepEqual(await w.run('readRegistry')(), ['dahis-0.0.2-b', own]);
});

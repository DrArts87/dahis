// Start van de app: schermen, service worker en bijwerken.
import { el, replace } from './dom.js';

// Nooit in een frame draaien (de header frame-ancestors werkt pas zodra de
// service worker de pagina serveert).
if (window.top !== window.self) {
  document.documentElement.replaceChildren();
  throw new Error('Dahis draait niet in een frame.');
}

const state = {
  screen: 'start',
  sw: 'installing',        // installing | ready | unsupported | error
  info: null,              // {version, codeHash} van de actieve versie
  waiting: null,           // {version, codeHash} van een wachtende versie
  updateStatus: '',
  installPrompt: null,
  standalone: window.matchMedia('(display-mode: standalone)').matches,
};

let registration = null;
let updateRequested = false;
const root = document.getElementById('app');

// --- Service worker -------------------------------------------------------

// De CSP staat alleen de trusted-types-policy 'dahis-sw' toe, en die laat
// uitsluitend 'sw.js' door.
function serviceWorkerUrl() {
  if (!window.trustedTypes) return 'sw.js';
  const policy = window.trustedTypes.createPolicy('dahis-sw', {
    createScriptURL(url) {
      if (url !== 'sw.js') throw new TypeError('Onverwacht script: ' + url);
      return url;
    },
  });
  return policy.createScriptURL('sw.js');
}

function askInfo(worker) {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => reject(new Error('Geen antwoord van de service worker')), 3000);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      resolve(event.data);
    };
    worker.postMessage({ type: 'info' }, [channel.port2]);
  });
}

async function refreshInfo() {
  const controller = navigator.serviceWorker.controller;
  if (!controller) return;
  try {
    state.info = await askInfo(controller);
    state.sw = 'ready';
  } catch (err) {
    state.sw = 'error';
  }
  render();
}

async function showWaiting(worker) {
  try {
    state.waiting = await askInfo(worker);
    state.updateStatus = '';
  } catch (err) {
    state.waiting = { version: '?', codeHash: '' };
  }
  render();
}

function watchInstalling(worker) {
  worker.addEventListener('statechange', () => {
    if (worker.state === 'installed' && navigator.serviceWorker.controller) {
      showWaiting(worker);
    } else if (worker.state === 'redundant' && !registration.waiting) {
      if (navigator.serviceWorker.controller) {
        state.updateStatus = 'De nieuwe versie kon niet worden geïnstalleerd; de huidige versie blijft actief.';
      } else {
        state.sw = 'error';   // eerste installatie mislukt
      }
      render();
    }
  });
}

async function initServiceWorker() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) {
    state.sw = 'unsupported';
    render();
    return;
  }
  try {
    registration = await navigator.serviceWorker.register(serviceWorkerUrl(), {
      scope: './',
      updateViaCache: 'none',
    });
  } catch (err) {
    state.sw = 'error';
    render();
    return;
  }
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (updateRequested) window.location.reload();
    else refreshInfo();
  });
  registration.addEventListener('updatefound', () => {
    if (registration.installing) watchInstalling(registration.installing);
  });
  if (registration.installing) watchInstalling(registration.installing);
  if (registration.waiting && navigator.serviceWorker.controller) showWaiting(registration.waiting);
  await refreshInfo();
}

function activateUpdate() {
  if (!registration || !registration.waiting) return;
  updateRequested = true;
  registration.waiting.postMessage({ type: 'activate' });
}

async function checkForUpdate() {
  if (!registration) return;
  state.updateStatus = 'Bezig met controleren…';
  render();
  try {
    await registration.update();
    if (registration.waiting) state.updateStatus = '';
    else if (registration.installing) state.updateStatus = 'Nieuwe versie gevonden, bezig met controleren van de bestanden…';
    else state.updateStatus = 'Je hebt de nieuwste versie.';
  } catch (err) {
    state.updateStatus = 'Controleren lukte niet. Is er een internetverbinding?';
  }
  render();
}

// --- Installeren ------------------------------------------------------------

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  state.installPrompt = event;
  render();
});

window.addEventListener('appinstalled', () => {
  state.installPrompt = null;
  state.standalone = true;
  render();
});

async function install() {
  const prompt = state.installPrompt;
  if (!prompt) return;
  state.installPrompt = null;
  await prompt.prompt();
  render();
}

// --- Schermen ---------------------------------------------------------------

function shortHash(hash) {
  return hash ? hash.slice(0, 8) : '';
}

function groupedHash(hash) {
  return hash ? hash.match(/.{1,8}/g).join(' ') : '—';
}

function updateBanner() {
  if (!state.waiting) return null;
  const { version, codeHash } = state.waiting;
  return el('section', { class: 'banner', role: 'status' },
    el('p', {}, 'Nieuwe versie ', el('strong', {}, version), ' (', shortHash(codeHash), ') staat klaar.'),
    el('button', { class: 'primary', type: 'button', onclick: activateUpdate }, 'Bijwerken naar ' + version));
}

function statusText() {
  switch (state.sw) {
    case 'installing': return 'De app wordt geïnstalleerd voor offline gebruik…';
    case 'ready': return 'Klaar voor offline gebruik.';
    case 'unsupported': return 'Deze browser ondersteunt geen offline gebruik. Gebruik Chrome via https of localhost.';
    default: return 'Offline gebruik kon niet worden ingericht. Herlaad de pagina met internetverbinding; lukt het dan nog niet, dan is de app op de server niet in orde.';
  }
}

function startScreen() {
  const installHint = state.standalone ? null : el('section', { class: 'card' },
    el('h2', {}, 'Installeren'),
    state.installPrompt
      ? el('button', { class: 'primary', type: 'button', onclick: install }, 'App installeren')
      : el('p', {}, 'Open in Chrome het menu ⋮ en kies “App installeren” of “Toevoegen aan startscherm”.'));

  return [
    el('section', { class: 'card' },
      el('h2', {}, 'Nog niet ingericht'),
      el('p', {}, 'Het versleutelde patiëntenbestand komt in een volgende versie. ' +
        'Deze versie test alleen installeren, offline werken en bijwerken.'),
      el('p', { class: 'muted' }, statusText())),
    installHint,
  ];
}

function aboutScreen() {
  const info = state.info || { version: '—', codeHash: '' };
  return [
    el('section', { class: 'card' },
      el('h2', {}, 'Over deze versie'),
      el('dl', {},
        el('dt', {}, 'Versie'), el('dd', {}, info.version + ' (ontwikkelversie)'),
        el('dt', {}, 'Codehash'), el('dd', { class: 'hash' }, groupedHash(info.codeHash)),
        el('dt', {}, 'Status'), el('dd', {}, statusText())),
      el('p', { class: 'muted' }, 'Vergelijk de codehash met die in de release op GitHub.'),
      el('button', { type: 'button', onclick: checkForUpdate, disabled: !registration }, 'Controleren op updates'),
      state.updateStatus ? el('p', { class: 'muted', role: 'status' }, state.updateStatus) : null),
  ];
}

function navButton(screen, label) {
  return el('button', {
    type: 'button',
    class: state.screen === screen ? 'tab active' : 'tab',
    'aria-current': state.screen === screen ? 'page' : null,
    onclick: () => { state.screen = screen; render(); },
  }, label);
}

function render() {
  replace(root,
    el('header', { class: 'top' },
      el('h1', {}, 'Dahis'),
      el('span', { class: 'badge' }, 'ontwikkelversie')),
    updateBanner(),
    el('nav', { class: 'tabs' }, navButton('start', 'Start'), navButton('about', 'Over')),
    el('main', {}, state.screen === 'about' ? aboutScreen() : startScreen()));
}

render();
initServiceWorker();

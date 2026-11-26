// Start van de app: schermen, vergrendelen, service worker en bijwerken.
// De toestand van kluis en opslag staat in controller.js; dit bestand tekent
// alleen schermen. Teksten: i18n/nl.js.
import {
  el, replace, symbol, collectInputs, restoreInputs, clearSecretInputs, isSecretInput,
  collectScroll, restoreScroll,
} from './dom.js';
import { t } from './i18n.js';
import {
  AppController, ERASE_WORD, MEASURE_ITERATIONS, MEASURE_CHECK_SIZES, MEASURE_BACKUP_MIB, backupDue,
} from './controller.js';
import { SETTINGS } from './settings.js';

// Nooit in een frame draaien (de header frame-ancestors werkt pas zodra de
// service worker de pagina serveert).
if (window.top !== window.self) {
  document.documentElement.replaceChildren();
  throw new Error('Dahis draait niet in een frame.');
}

// Tekstsleutel die elders wordt gebruikt (voor de test op ontbrekende teksten).
const k = (key) => key;

const app = new AppController();

// Scherm (tab, sub) staat in de werkstand van de controller (app.state.work).
const ui = {
  unlockMode: 'password',   // password | recovery
  lockedMode: 'unlock',     // unlock | file (back-up controleren op het vergrendelscherm)
  file: null,               // gekozen back-upbestand (File); overleeft opnieuw tekenen
  clearInputs: false,
};

const sw = {
  status: 'installing',     // installing | ready | unsupported | error
  info: null,               // {version, codeHash} van de actieve versie
  waiting: null,            // {version, codeHash} van een versie die op akkoord wacht
  pendingActive: false,     // die versie is al actief maar serveert nog de oude (Chrome activeerde zelf)
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

function ask(worker, type, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => reject(new Error('Geen antwoord van de service worker')), timeout);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      resolve(event.data);
    };
    worker.postMessage({ type }, [channel.port2]);
  });
}

function askInfo(worker) {
  return ask(worker, 'info');
}

// De actieve worker meldt welke versie hij serveert, en of een nieuwere
// versie (die Chrome zelf heeft geactiveerd) nog op akkoord wacht.
async function refreshInfo() {
  const controller = navigator.serviceWorker.controller;
  if (!controller) return;
  try {
    const info = await askInfo(controller);
    sw.info = { version: info.version, codeHash: info.codeHash };
    sw.status = 'ready';
    if (info.pending && !(registration && registration.waiting)) {
      sw.waiting = info.pending;
      sw.pendingActive = true;
    } else if (!info.pending) {
      sw.pendingActive = false;
    }
  } catch (err) {
    sw.status = 'error';
  }
  render();
}

async function showWaiting(worker) {
  try {
    // Een wachtende worker meldt de goedgekeurde versie als geserveerd en
    // zichzelf als 'pending'.
    const info = await askInfo(worker);
    sw.waiting = info.pending || { version: info.version, codeHash: info.codeHash };
    sw.updateStatus = '';
  } catch (err) {
    sw.waiting = { version: '?', codeHash: '' };
  }
  render();
}

function watchInstalling(worker) {
  worker.addEventListener('statechange', () => {
    if (worker.state === 'installed' && navigator.serviceWorker.controller) {
      showWaiting(worker);
    } else if (worker.state === 'redundant' && !registration.waiting) {
      if (navigator.serviceWorker.controller) {
        sw.updateStatus = t('update.failed');
      } else {
        sw.status = 'error';   // eerste installatie mislukt
      }
      render();
    }
  });
}

async function initServiceWorker() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) {
    sw.status = 'unsupported';
    render();
    return;
  }
  try {
    registration = await navigator.serviceWorker.register(serviceWorkerUrl(), {
      scope: './',
      updateViaCache: 'none',
    });
  } catch (err) {
    sw.status = 'error';
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

async function activateUpdate() {
  if (!registration) return;
  if (registration.waiting) {
    updateRequested = true;
    registration.waiting.postMessage({ type: 'activate' });
    return;
  }
  const controller = navigator.serviceWorker.controller;
  if (!sw.pendingActive || !controller) return;
  try {
    const reply = await ask(controller, 'activate', 10000);
    if (reply && reply.ok) {
      window.location.reload();
      return;
    }
  } catch (err) {
    // valt door naar de melding
  }
  sw.updateStatus = t('update.failed');
  render();
}

async function checkForUpdate() {
  if (!registration) return;
  sw.updateStatus = t('update.checking');
  render();
  try {
    await registration.update();
    if (registration.waiting) sw.updateStatus = '';
    else if (registration.installing) sw.updateStatus = t('update.found');
    else sw.updateStatus = t('update.latest');
  } catch (err) {
    sw.updateStatus = t('update.checkFailed');
  }
  render();
}

// --- Installeren ------------------------------------------------------------

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  sw.installPrompt = event;
  render();
});

window.addEventListener('appinstalled', () => {
  sw.installPrompt = null;
  sw.standalone = true;
  render();
});

async function install() {
  const prompt = sw.installPrompt;
  if (!prompt) return;
  sw.installPrompt = null;
  await prompt.prompt();
  render();
}

// --- Vergrendelen bij verbergen en inactiviteit ---------------------------------------

// De beslissingen staan in de controller (stap D1): wachttijd na wisselen
// van app in 'ready', anders direct; inactiviteit; pagehide altijd.
for (const type of ['pointerdown', 'keydown', 'input', 'touchstart', 'wheel']) {
  window.addEventListener(type, () => app.activity(), { capture: true, passive: true });
}

// Bij verbergen eerst geheime invoer wissen, in elke toestand (review PR
// #23 P1-1); daarna beslist de controller over vergrendelen.
//
// Afdekken (0.4.2): Android maakt het voorbeeld in Recente apps zodra de app
// naar de achtergrond gaat, vóór vergrendelen of herladen (proef D1, stap
// 10). Daarom eerst de inhoud verbergen; bij terugkomen binnen de wachttijd
// weer tonen. Een web-app kan het voorbeeld niet blokkeren; of Android de
// afgedekte pagina vastlegt, blijkt uit de proef.
function cover(on) {
  document.body.classList.toggle('covered', on);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    cover(true);
    clearSecretInputs(root.querySelectorAll('input'));
    app.hidden();
  } else {
    app.visible();
    cover(false);
  }
});
window.addEventListener('pagehide', () => { cover(true); app.pageClosed(); });
window.addEventListener('pageshow', () => cover(false));

setInterval(() => app.idleTick(), 10 * 1000);

// --- Hulpmiddelen voor schermen ---------------------------------------------------------

const SUCCESS = new Set([
  k('recovery.done'), k('password.changed'), k('settings.saved'), k('check.ok'), k('backup.ready'), k('fileCheck.ok'),
]);

const HALT_TEXT = {
  checkpoint: k('halt.code.checkpoint'),
  chain: k('halt.code.chain'),
  head: k('halt.code.head'),
  state: k('halt.code.state'),
  record: k('halt.code.record'),
  keys: k('halt.code.keys'),
  conflict: k('halt.code.conflict'),
};

const HALT_CHECK = {
  quick: k('halt.check.quick'),
  full: k('halt.check.full'),
};

// Acties uit formaat §8.2 in gewone taal.
const AUDIT_TEXT = {
  create: k('audit.action.create'),
  view: k('audit.action.view'),
  update: k('audit.action.update'),
  delete: k('audit.action.delete'),
  destroy: k('audit.action.destroy'),
  unlock: k('audit.action.unlock'),
  unlock_failed: k('audit.action.unlock_failed'),
  lock: k('audit.action.lock'),
  password_change: k('audit.action.password_change'),
  recovery_used: k('audit.action.recovery_used'),
  key_rotation: k('audit.action.key_rotation'),
  write_key: k('audit.action.write_key'),
  export: k('audit.action.export'),
  import: k('audit.action.import'),
  verify_backup: k('audit.action.verify_backup'),
  integrity_check: k('audit.action.integrity_check'),
  print: k('audit.action.print'),
  app_update: k('audit.action.app_update'),
};

// Bijzondere combinaties van actie en detail.
const AUDIT_DETAIL_TEXT = {
  'create:install': k('audit.detail.install'),
  'unlock:password': k('audit.detail.unlockPassword'),
  'unlock:recovery': k('audit.detail.unlockRecovery'),
  'password_change:user': k('audit.detail.passwordUser'),
  'password_change:recovery': k('audit.detail.passwordRecovery'),
  'password_change:kdf_upgrade': k('audit.detail.passwordKdf'),
  'verify_backup:equal': k('audit.detail.verifyEqual'),
};

const AUDIT_RESULT = {
  error: k('audit.result.error'),
  denied: k('audit.result.denied'),
};

const NAV = [
  { tab: 'patients', icon: 'i-people', label: k('nav.patients') },
  { tab: 'recipes', icon: 'i-rx', label: k('nav.recipes') },
  { tab: 'settings', icon: 'i-gear', label: k('nav.settings') },
  { tab: 'more', icon: 'i-more', label: k('nav.more') },
];

function number(value, digits = 1) {
  return new Intl.NumberFormat('nl-NL', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value);
}

function seconds(ms, digits = 1) {
  return number(ms / 1000, digits);
}

function dateTime(ms) {
  if (ms === null || ms === undefined) return t('check.never');
  return new Intl.DateTimeFormat('nl-NL', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms));
}

function checkValue() {
  const when = dateTime(app.state.lastFullCheckAt);
  const ms = app.state.lastCheckMs;
  return ms === null || ms === undefined ? when : t('check.withDuration', { when, s: seconds(ms, 2) });
}

function checkingNote() {
  if (!app.state.checking) return null;
  return el('p', { class: 'note', role: 'status' }, t('check.running'));
}

function megabytes(bytes) {
  return number(bytes / (1024 * 1024), 1);
}

function messageBox() {
  const m = app.state.message;
  if (!m) return null;
  const ok = SUCCESS.has(m.key);
  return el('p', { class: ok ? 'note ok' : 'note warn', role: ok ? 'status' : 'alert' }, t(m.key, m.params));
}

function button(label, onclick, cls = '', extra = {}) {
  return el('button', Object.assign({ type: 'button', class: 'btn ' + cls, onclick, disabled: app.state.busy }, extra), label);
}

function submit(label, cls = 'primary') {
  return el('button', { type: 'submit', class: 'btn ' + cls, disabled: app.state.busy }, app.state.busy ? t('common.busy') : label);
}

function field(id, label, input, hint) {
  return [
    el('label', { for: id }, label),
    input,
    hint ? el('p', { class: 'hint', id: id + '-hint' }, hint) : null,
  ];
}

function passwordInput(id, autocomplete) {
  return el('input', {
    id, name: id, type: 'password', autocomplete, required: true, 'data-secret': '',
    autocapitalize: 'off', spellcheck: 'false', 'aria-describedby': id + '-hint',
  });
}

// Tekstveld; standaard geheim (herstelsleutel, groepen): gewist bij
// verbergen en nooit in de werkstand (review PR #23 P1-1).
function textInput(id, extra = {}, secret = true) {
  return el('input', Object.assign({
    id, name: id, type: 'text', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false',
    'data-secret': secret ? '' : null,
  }, extra));
}

// Bestandskiezer. De gekozen File staat in ui.file, want opnieuw tekenen
// maakt een nieuw invoerveld. Geen accept-filter: Android kent het type
// .dahis niet en zou het bestand dan grijs tonen.
// Het knopje van Chrome zelf is verborgen (wel bereikbaar met het
// toetsenbord): na opnieuw tekenen zei het weer "Geen bestand gekozen"
// terwijl er wel een bestand was gekozen (proef op de OnePlus, 0.3.0).
function fileInput() {
  const f = ui.file;
  return [
    el('p', { class: 'field-label' }, t('file.choose')),
    el('input', {
      id: 'file', name: 'file', type: 'file', class: 'file-hidden', disabled: app.state.busy,
      onchange: (event) => {
        ui.file = (event.target.files && event.target.files[0]) || null;
        app.clearFileCheck();   // geen uitslag van een ander bestand tonen (review PR #14, 1)
        render();
      },
    }),
    el('label', { for: 'file', class: app.state.busy ? 'btn file-btn disabled' : 'btn file-btn' },
      f ? t('file.other') : t('file.pick')),
    el('p', { class: f ? 'card file-chosen' : 'card file-chosen none', role: 'status' },
      f ? t('file.chosen', { name: f.name, size: fileSize(f.size) }) : t('file.notChosen')),
  ];
}

function fileSize(bytes) {
  return bytes < 1024 * 1024 ? t('file.kb', { kb: number(bytes / 1024, 0) }) : t('file.mb', { mb: megabytes(bytes) });
}

function chooseFileFirst() {
  if (ui.file) return true;
  app.say('file.none');
  return false;
}

// Wachtwoord of herstelsleutel, met wisselknop (ui.unlockMode).
function secretField(id) {
  const recovery = ui.unlockMode === 'recovery';
  return [
    field(id, recovery ? t('unlock.recoveryLabel') : t('unlock.passwordLabel'),
      recovery ? textInput(id, { 'aria-describedby': id + '-hint' }) : passwordInput(id, 'off'),
      recovery ? t('unlock.recoveryHint') : null),
    button(recovery ? t('unlock.usePassword') : t('unlock.useRecovery'), () => {
      ui.unlockMode = recovery ? 'password' : 'recovery';
      app.say(null);
      render();
    }, 'link'),
  ];
}

function secretValue(id) {
  return ui.unlockMode === 'recovery' ? { recoveryKey: value(id) } : { password: value(id) };
}

function value(id) {
  const node = document.getElementById(id);
  return node ? node.value : '';
}

// Formulier: Enter verstuurt, de pagina navigeert nooit.
function form(onsubmit, ...children) {
  return el('form', {
    novalidate: true,
    onsubmit: (event) => {
      event.preventDefault();
      ui.clearInputs = true;
      onsubmit();
    },
  }, ...children);
}

function lockButton() {
  return el('button', { type: 'button', class: 'lock', onclick: () => app.lock() }, symbol('i-lock'), t('common.lock'));
}

function backLink(label, onclick) {
  return el('button', { type: 'button', class: 'back', onclick }, symbol('i-back'), label);
}

function header({ title, sub, back, chip, lock }) {
  return el('header', { class: 'top' },
    el('img', { class: 'fern', src: 'img/varen-mos.png', alt: '' }),
    el('div', { class: 'row' },
      back || null,
      chip ? el('span', { class: 'chip' }, chip) : null,
      el('span', { class: 'spacer' }),
      lock ? lockButton() : null),
    el('h1', {}, title),
    sub ? el('p', { class: 'sub' }, sub) : null);
}

function updateBanner() {
  if (!sw.waiting) return null;
  const { version } = sw.waiting;
  return el('div', { class: 'banner', role: 'status' },
    el('span', {}, t('update.ready', { version })),
    el('button', { type: 'button', onclick: activateUpdate }, t('update.activate')));
}

function nav() {
  return el('nav', { class: 'navbar', 'aria-label': t('nav.label') },
    NAV.map((item) => el('button', {
      type: 'button',
      'aria-current': app.state.work.tab === item.tab ? 'page' : null,
      onclick: () => leaveBackup(() => {
        app.showScreen(item.tab, null); app.closeAuditLog(); app.closeBackup(); app.say(null); onTab(); render();
      }),
    }, symbol(item.icon), t(item.label))));
}

function onTab() {
  if (app.state.work.tab === 'settings') app.refreshStorage();
}

function listItem(iconId, label, { value: val, onclick, danger, chevron = true, control } = {}) {
  const content = [
    iconId ? symbol(iconId, 'lead') : null,
    el('span', { class: danger ? 'label danger-text' : 'label' }, label),
    val ? el('span', { class: 'value' }, val) : null,
    control || null,
    onclick && chevron ? symbol('i-chev', 'chev') : null,
  ];
  if (onclick) {
    return el('li', {}, el('button', { type: 'button', class: 'row-btn', onclick, disabled: app.state.busy }, content));
  }
  return el('li', {}, content);
}

// Een "pagina": kopregel, inhoud met randen, en zo nodig het lint.
function page({ head, body, navbar = false, green = false }) {
  return el('div', { class: green ? 'shell green' : 'shell' },
    head || null,
    el('main', { class: 'content' },
      el('img', { class: 'rand rand-boven', src: 'img/rand-boven.svg', alt: '' }),
      el('div', { class: 'inner' }, updateBanner(), checkingNote(), messageBox(), body),
      el('img', { class: 'rand rand-onder', src: 'img/rand-onder.svg', alt: '' })),
    navbar ? nav() : null);
}

function heroPage(title, ...children) {
  return el('div', { class: 'shell green' },
    el('img', { class: 'fern fern-hero', src: 'img/varen-mos.png', alt: '' }),
    el('main', { class: 'content' },
      el('div', { class: 'inner' },
        el('div', { class: 'hero' }, symbol('logo-w', 'mark'), el('h1', {}, title)),
        updateBanner(), children, checkingNote(), messageBox())));
}

// --- Schermen: opstarten -------------------------------------------------------------------

function startingScreen() {
  return heroPage(t('app.name'), el('p', { class: 'center' }, t('start.opening')));
}

function alreadyOpenScreen() {
  return heroPage(t('open.title'),
    el('p', { class: 'center' }, t('open.text')),
    button(t('open.retry'), () => window.location.reload(), 'primary'));
}

function errorScreen() {
  return page({
    head: header({ title: t('error.title') }),
    body: [
      el('p', {}, t('error.text')),
      button(t('open.retry'), () => window.location.reload(), 'primary'),
    ],
  });
}

function lockingScreen() {
  return heroPage(t('app.name'), el('p', { class: 'center' }, t('lock.busy')));
}

// --- Schermen: onboarding --------------------------------------------------------------------

function step(n) {
  return t('onboarding.step', { n, total: 5 });
}

function installCard() {
  if (sw.standalone) return null;
  return el('section', { class: 'card' },
    el('h3', {}, t('install.title')),
    sw.installPrompt
      ? button(t('install.button'), install, 'primary')
      : el('p', { class: 'muted' }, t('install.hint')));
}

function onboardingIntro() {
  return page({
    head: header({ title: t('onboarding.intro.title'), sub: step(1) }),
    body: [
      el('p', {}, t('onboarding.intro.text')),
      el('section', { class: 'card' },
        el('h3', {}, t('onboarding.intro.choose')),
        el('ol', { class: 'steps' },
          el('li', {}, t('onboarding.intro.password')),
          el('li', {}, t('onboarding.intro.recovery'))),
        el('p', { class: 'muted' }, t('onboarding.intro.warning'))),
      el('p', { class: 'muted' }, t('onboarding.intro.testOnly')),
      button(t('onboarding.intro.start'), () => app.goToStep('password'), 'primary'),
      button(t('onboarding.intro.restore'), () => {
        ui.file = null;
        ui.unlockMode = 'password';
        app.goToStep('restore');
      }),
      installCard(),
    ],
  });
}

function onboardingRestore() {
  const recovery = ui.unlockMode === 'recovery';
  return page({
    head: header({
      title: t('restore.title'),
      back: backLink(t('common.back'), () => { ui.file = null; app.say(null); app.goToStep('intro'); }),
    }),
    body: form(() => {
      if (!chooseFileFirst()) return;
      app.restoreBackup(ui.file, secretValue('secret'), value('pw1'), value('pw2'));
    },
    el('p', {}, t('restore.text')),
    fileInput(),
    secretField('secret'),
    recovery ? [
      el('p', { class: 'muted' }, t('restore.newPassword')),
      field('pw1', t('password.new'), passwordInput('pw1', 'new-password'), t('password.minimum', { min: 14 })),
      field('pw2', t('password.repeat'), passwordInput('pw2', 'new-password')),
    ] : null,
    el('p', { class: 'muted' }, t('restore.empty')),
    submit(t('restore.submit'))),
  });
}

function onboardingRestored() {
  return page({
    head: header({ title: t('restore.doneTitle') }),
    body: [
      el('p', {}, t('restore.doneText')),
      el('p', { class: 'note warn' }, t('restore.doneBackup')),
      button(t('onboarding.done.button'), () => app.lock(), 'primary'),
    ],
  });
}

function onboardingPassword() {
  return page({
    head: header({
      title: t('onboarding.password.title'), sub: step(2),
      back: backLink(t('common.back'), () => app.goToStep('intro')),
    }),
    body: form(() => app.choosePassword(value('pw1'), value('pw2')),
      el('p', { class: 'muted' }, t('onboarding.password.advice')),
      field('pw1', t('password.new'), passwordInput('pw1', 'new-password'), t('password.minimum', { min: 14 })),
      field('pw2', t('password.repeat'), passwordInput('pw2', 'new-password')),
      el('p', { class: 'muted' }, t('onboarding.password.slow')),
      submit(t('common.next'))),
  });
}

function onboardingKey() {
  const groups = app.state.recoveryKey || [];
  return page({
    head: header({ title: t('onboarding.key.title'), sub: step(3) }),
    body: [
      el('p', {}, t('onboarding.key.text')),
      el('div', { class: 'key', 'aria-label': t('onboarding.key.label') },
        groups.map((g, i) => el('span', { title: t('onboarding.check.group', { n: i + 1 }) }, g))),
      el('p', { class: 'hint' }, t('onboarding.key.format')),
      el('p', { class: 'note warn' }, t('onboarding.key.noPhoto')),
      button(t('onboarding.key.done'), () => app.goToStep('check'), 'primary'),
    ],
  });
}

function onboardingCheck() {
  const [a, b] = app.state.groups || [0, 1];
  return page({
    head: header({ title: t('onboarding.check.title'), sub: step(4) }),
    body: form(() => app.confirmRecoveryGroups([value('g1'), value('g2')]),
      el('p', {}, t('onboarding.check.text')),
      field('g1', t('onboarding.check.group', { n: a + 1 }), textInput('g1', { maxlength: 8, inputmode: 'text' })),
      field('g2', t('onboarding.check.group', { n: b + 1 }), textInput('g2', { maxlength: 8, inputmode: 'text' }),
        t('onboarding.check.hint')),
      submit(t('onboarding.check.submit')),
      button(t('onboarding.check.showAgain'), () => app.goToStep('key'), 'link')),
  });
}

function onboardingDone() {
  const s = app.state.storage;
  const protectedText = s && s.persisted ? t('storage.protected') : t('storage.notProtected');
  return page({
    head: header({ title: t('onboarding.done.title'), sub: step(5) }),
    body: [
      el('section', { class: 'card' },
        el('dl', {},
          el('dt', {}, t('onboarding.done.storage')), el('dd', {}, protectedText),
          el('dt', {}, t('onboarding.done.unlock')),
          el('dd', {}, t('onboarding.done.unlockTime', { s: seconds(app.state.pbkdfMs || 0) })),
          el('dt', {}, t('onboarding.done.lock')),
          el('dd', {}, t('onboarding.done.lockText', {
            min: SETTINGS['lock.idleMinutes'].default, away: SETTINGS['lock.awayMinutes'].default,
          })))),
      el('p', { class: 'note warn' }, t('onboarding.done.noBackup')),
      el('p', {}, t('onboarding.done.next')),
      button(t('onboarding.done.button'), () => app.lock(), 'primary'),
    ],
  });
}

// --- Schermen: ontgrendelen en herstel ------------------------------------------------------

function lockedScreen() {
  if (ui.lockedMode === 'file') return fileCheckScreen();
  const recovery = ui.unlockMode === 'recovery';
  const failed = app.state.failedUnlocks;
  const input = recovery
    ? textInput('secret', { autocomplete: 'off', 'aria-describedby': 'secret-hint' })
    : passwordInput('secret', 'current-password');
  return heroPage(t('app.name'),
    el('p', { class: 'center muted' }, t('unlock.locked')),
    form(() => app.unlock(recovery ? { recoveryKey: value('secret') } : { password: value('secret') }),
      field('secret', recovery ? t('unlock.recoveryLabel') : t('unlock.passwordLabel'), input,
        recovery ? t('unlock.recoveryHint') : (failed > 0 ? t('unlock.failedCount', { n: failed }) : null)),
      submit(t('unlock.submit'))),
    button(recovery ? t('unlock.usePassword') : t('unlock.useRecovery'), () => {
      ui.unlockMode = recovery ? 'password' : 'recovery';
      app.say(null);
      render();
    }, 'link'),
    button(t('fileCheck.link'), () => {
      ui.lockedMode = 'file';
      ui.file = null;
      ui.unlockMode = 'password';
      app.clearFileCheck();
      render();
    }, 'link'));
}

// Een (ouder) back-upbestand controleren, zonder sessie: er wordt niets
// opgeslagen (formaat §11.4, besluit gebruiker 2026-11-25).
function fileCheckScreen() {
  const r = app.state.fileCheck;
  const fmt = new Intl.NumberFormat('nl-NL');
  return page({
    head: header({
      title: t('fileCheck.title'),
      back: backLink(t('common.back'), () => {
        ui.lockedMode = 'unlock';
        ui.file = null;
        ui.unlockMode = 'password';
        app.clearFileCheck();
        render();
      }),
    }),
    body: [
      form(() => {
        if (!chooseFileFirst()) return;
        app.checkFile(ui.file, secretValue('secret'));
      },
      el('p', {}, t('fileCheck.text')),
      fileInput(),
      secretField('secret'),
      submit(t('fileCheck.submit'))),
      r && r.ok ? el('section', { class: 'card' }, el('dl', {},
        el('dt', {}, t('fileCheck.created')), el('dd', {}, dateTime(Date.parse(r.summary.createdAt))),
        el('dt', {}, t('fileCheck.version')), el('dd', {}, r.summary.appVersion),
        el('dt', {}, t('fileCheck.contents')),
        el('dd', {}, t('fileCheck.contentsValue', { records: fmt.format(r.summary.records), audit: fmt.format(r.summary.audit) })))) : null,
      r && !r.ok ? el('p', { class: 'muted' }, t('fileCheck.code', { code: r.code })) : null,
    ],
  });
}

function recoveryPasswordScreen() {
  return page({
    head: header({ title: t('recovery.title'), chip: t('recovery.chip') }),
    body: form(() => app.setRecoveryPassword(value('pw1'), value('pw2')),
      el('p', {}, t('recovery.text')),
      field('pw1', t('password.new'), passwordInput('pw1', 'new-password'), t('password.minimum', { min: 14 })),
      field('pw2', t('password.repeat'), passwordInput('pw2', 'new-password'), t('recovery.oldBackups')),
      submit(t('common.save'))),
  });
}

// --- Schermen: ontgrendeld ---------------------------------------------------------------------

function emptyState(text) {
  return el('div', { class: 'empty' }, symbol('logo-g', 'empty-mark'), el('p', {}, text));
}

function backupReminder() {
  const last = app.state.lastBackupAt;
  if (!backupDue(last)) return null;
  return el('div', { class: 'note warn reminder', role: 'status' },
    el('span', {}, last === null ? t('backup.reminderNever') : t('backup.reminderOld', { when: dateTime(last) })),
    button(t('backup.reminderButton'), () => { app.showScreen('more', 'backup'); app.say(null); render(); }, 'small'));
}

// Bestaande kluis zonder de instelling van 0.4.0: één keer melden.
function awayNotice() {
  if (!app.state.awayNotice) return null;
  return el('div', { class: 'note reminder', role: 'status' },
    el('span', {}, t('settings.awayNew', { n: app.state.settings['lock.awayMinutes'] })),
    button(t('settings.awayNewOk'), () => app.acknowledgeAwayNotice(), 'small'),
    button(t('settings.awayNewChange'), () => { app.showScreen('settings', null); app.say(null); onTab(); render(); }, 'small'));
}

function patientsTab() {
  return [
    awayNotice(),
    backupReminder(),
    el('div', { class: 'search' }, symbol('i-search'),
      el('input', { type: 'search', placeholder: t('patients.search'), disabled: true, 'aria-label': t('patients.search') })),
    emptyState(t('patients.empty')),
  ];
}

function recipesTab() {
  return [el('h3', {}, t('recipes.recent')), emptyState(t('recipes.empty'))];
}

// Keuzelijst in minuten voor een instelling; 0 heet "Direct".
function minutesSelect(id, key, label) {
  const def = SETTINGS[key];
  const current = app.state.settings[key];
  const options = [];
  for (let m = def.min; m <= def.max; m++) {
    options.push(el('option', { value: String(m), selected: m === current },
      m === 0 ? t('settings.immediately') : t('settings.minutes', { n: m })));
  }
  return el('select', {
    id, 'aria-label': label, disabled: app.state.busy,
    onchange: (event) => app.saveSetting(key, Number(event.target.value)),
  }, options);
}

function storageText() {
  const s = app.state.storage;
  if (!s || !s.supported) return t('storage.unknown');
  const status = s.persisted ? t('storage.protected') : t('storage.notProtected');
  return s.usage === null || s.usage === undefined ? status : t('storage.usage', { status, mb: megabytes(s.usage) });
}

function settingsTab() {
  return [
    el('h3', {}, t('settings.security')),
    el('section', { class: 'card' }, el('ul', { class: 'list' },
      listItem('i-clock', t('settings.idle'), { control: minutesSelect('idle', 'lock.idleMinutes', t('settings.idle')) }),
      listItem('i-clock', t('settings.away'), { control: minutesSelect('away', 'lock.awayMinutes', t('settings.away')) }),
      listItem('i-key', t('settings.password'), { onclick: () => { app.showSub('password'); app.say(null); render(); } }))),
    el('h3', {}, t('settings.device')),
    el('section', { class: 'card' }, el('ul', { class: 'list' },
      listItem('i-db', t('settings.storage'), { value: storageText() }))),
    el('p', { class: 'muted' }, t('settings.awayNote')),
    el('p', { class: 'muted' }, t('settings.encrypted')),
  ];
}

function moreTab() {
  return [
    el('h3', {}, t('more.data')),
    el('section', { class: 'card' }, el('ul', { class: 'list' },
      listItem('i-archive', t('more.backup'), {
        value: dateTime(app.state.lastBackupAt), onclick: () => { app.showSub('backup'); app.say(null); render(); },
      }),
      listItem('i-shield', t('more.check'), {
        value: checkValue(), onclick: () => app.runFullCheck(),
      }),
      listItem('i-clock', t('more.audit'), {
        onclick: async () => { app.showSub('audit'); app.say(null); render(); await app.openAuditLog(); },
      }))),
    el('h3', {}, t('more.support')),
    el('section', { class: 'card' }, el('ul', { class: 'list' },
      listItem('i-gauge', t('more.measure'), { onclick: () => { app.showSub('measure'); app.say(null); render(); } }),
      listItem('i-info', t('more.about'), { onclick: () => { app.showSub('about'); app.say(null); render(); } }),
      listItem('i-trash', t('more.erase'), { danger: true, onclick: () => { app.showSub('erase'); app.say(null); render(); } }))),
  ];
}

function appVersion() {
  return (sw.info && sw.info.version) || '0.0.0';
}

// Alleen downloaden (0.4.2): Delen via het deelmenu mislukte op de OnePlus
// in de proef van D1 (0.4.0); uitzoeken in issue #30. Onder 0.3.0 vergrendelde
// het deelmenu de app (proef taak 7).
function downloadBackup() {
  const b = app.backupForDownload();
  if (!b) return;
  app.backupSaved(b.id);
  const url = URL.createObjectURL(new Blob([b.text], { type: 'application/octet-stream' }));
  const a = el('a', { href: url, download: b.name, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60 * 1000);
}

// Het back-upscherm verlaten (terug, of een tab). Is het bestand nog niet
// gedownload, dan eerst één waarschuwing (review PR #23 P1-2).
function leaveBackup(then) {
  if (!app.leaveBackup()) { render(); return; }
  then();
}

// Na downloaden: alleen de laatste vier bewaren (#19), met de datum
// van de vorige back-up zodat zichtbaar is welke bestanden weg kunnen.
function cleanupNote(b) {
  if (!b.saved) return null;
  const text = b.previousAt === null
    ? t('backup.cleanupFirst')
    : t('backup.cleanup', { when: dateTime(b.previousAt) });
  return el('p', { class: 'note', role: 'status' }, text);
}

function backupScreen() {
  const b = app.state.backup;
  return page({
    head: header({
      title: t('backup.title'), lock: true,
      back: backLink(t('nav.more'), () => leaveBackup(() => { app.showSub(null); app.closeBackup(); app.say(null); render(); })),
    }),
    body: [
      el('p', {}, t('backup.text')),
      el('section', { class: 'card' }, el('dl', {},
        el('dt', {}, t('backup.last')), el('dd', {}, dateTime(app.state.lastBackupAt)))),
      el('p', { class: 'muted' }, t('backup.policy')),
      b ? [
        el('section', { class: 'card' }, el('p', { class: 'hash' }, t('backup.file', { name: b.name, size: fileSize(b.bytes) }))),
        button(t('backup.download'), downloadBackup, 'primary'),
        el('p', { class: 'muted' }, t('backup.afterDownload')),
        b.saved ? null : el('p', { class: 'muted' }, t('backup.notSavedYet')),
        cleanupNote(b),
      ] : button(t('backup.make'), () => app.makeBackup({ appVersion: appVersion() }), 'primary'),
    ],
    navbar: true,
  });
}

function changePasswordScreen() {
  const recovery = ui.unlockMode === 'recovery';
  return page({
    head: header({
      title: t('settings.password'), lock: true,
      back: backLink(t('nav.settings'), () => { app.showSub(null); app.say(null); render(); }),
    }),
    body: form(() => {
      const current = recovery ? { recoveryKey: value('cur') } : { password: value('cur') };
      app.changePassword(current, value('pw1'), value('pw2'));
    },
    field('cur', recovery ? t('unlock.recoveryLabel') : t('password.current'),
      recovery ? textInput('cur') : passwordInput('cur', 'current-password')),
    button(recovery ? t('unlock.usePassword') : t('unlock.useRecovery'), () => {
      ui.unlockMode = recovery ? 'password' : 'recovery';
      render();
    }, 'link'),
    field('pw1', t('password.new'), passwordInput('pw1', 'new-password'), t('password.minimum', { min: 14 })),
    field('pw2', t('password.repeat'), passwordInput('pw2', 'new-password'), t('password.oldBackups')),
    submit(t('common.save'))),
    navbar: true,
  });
}

function shortHash(hash) {
  return hash ? hash.slice(0, 8) : '';
}

function groupedHash(hash) {
  return hash ? hash.match(/.{1,8}/g).join(' ') : '—';
}

function swStatusText() {
  switch (sw.status) {
    case 'installing': return t('sw.installing');
    case 'ready': return t('sw.ready');
    case 'unsupported': return t('sw.unsupported');
    default: return t('sw.error');
  }
}

function aboutScreen() {
  const info = sw.info || { version: '—', codeHash: '' };
  return page({
    head: header({
      title: t('more.about'), lock: true,
      back: backLink(t('nav.more'), () => { app.showSub(null); render(); }),
    }),
    body: [
      el('section', { class: 'card' },
        el('dl', {},
          el('dt', {}, t('about.version')), el('dd', {}, t('about.devVersion', { version: info.version })),
          el('dt', {}, t('about.codeHash')), el('dd', { class: 'hash', title: shortHash(info.codeHash) }, groupedHash(info.codeHash)),
          el('dt', {}, t('about.status')), el('dd', {}, swStatusText()))),
      el('p', { class: 'muted' }, t('about.compare')),
      button(t('update.check'), checkForUpdate, '', { disabled: !registration }),
      sw.updateStatus ? el('p', { class: 'muted', role: 'status' }, sw.updateStatus) : null,
      installCard(),
    ],
    navbar: true,
  });
}

function auditLabel(e) {
  if (e.action === 'unlock_failed') return t('audit.detail.failedCount', { n: e.detail });
  const special = AUDIT_DETAIL_TEXT[e.action + ':' + e.detail];
  return special ? t(special) : t(AUDIT_TEXT[e.action] || k('audit.action.unknown'));
}

// Technische regel voor debugging en forensisch onderzoek: volgnummer,
// schrijfsleutel, soort en versie, het begin van het record-id en de detailcode.
function auditTech(e) {
  const parts = ['#' + e.seq, 'kid ' + e.kid];
  if (e.kind) parts.push(e.kind + (e.version ? ' v' + e.version : ''));
  if (e.record_id) parts.push(e.record_id.slice(0, 8));
  if (e.detail !== null && e.detail !== undefined) parts.push(e.action + ':' + e.detail);
  return parts.join(' · ');
}

function auditScreen() {
  const log = app.state.audit;
  const entries = log ? log.entries : [];
  return page({
    head: header({
      title: t('more.audit'), lock: true,
      back: backLink(t('nav.more'), () => { app.showSub(null); app.closeAuditLog(); app.say(null); render(); }),
    }),
    body: [
      el('p', { class: 'muted' }, t('audit.text')),
      !log ? el('p', { role: 'status' }, t('common.busy')) : el('section', { class: 'card' }, el('ol', { class: 'list log' },
        entries.map((e) => el('li', {},
          el('span', { class: 'when' }, dateTime(Date.parse(e.ts))),
          el('span', { class: e.result === 'ok' ? 'label' : 'label danger-text' },
            auditLabel(e), e.result !== 'ok' ? ' (' + t(AUDIT_RESULT[e.result]) + ')' : ''),
          el('span', { class: 'tech hash' }, auditTech(e)))))),
      log && log.next !== null ? button(t('audit.more'), () => app.moreAuditLog()) : null,
      log && log.next === null ? el('p', { class: 'muted' }, t('audit.end', { n: entries.length })) : null,
    ],
    navbar: true,
  });
}

function checkMeasureItem(size, i) {
  const r = app.state.checkMeasurements[i];
  const fmt = new Intl.NumberFormat('nl-NL');
  return listItem(null, t('measure.checkSize', { audit: fmt.format(size.auditRows), records: fmt.format(size.recordVersions) }), {
    value: r ? t('measure.checkResult', { full: seconds(r.fullMs, 2), quick: seconds(r.quickMs, 2), build: seconds(r.buildMs) })
      : t('measure.notYet'),
    onclick: () => app.measureCheck(i),
  });
}

function backupMeasureItem(mib) {
  const r = app.state.backupMeasurements[mib];
  let val = t('measure.notYet');
  if (r && r.error) val = t('measure.backupFailed', { name: r.error });
  else if (r) val = t('measure.backupResult', { write: seconds(r.writeMs), read: seconds(r.readMs), mb: megabytes(r.bytes) });
  return listItem(null, t('measure.backupSize', { mb: mib }), { value: val, onclick: () => app.measureBackup(mib) });
}

function measureScreen() {
  const m = app.state.measurements;
  return page({
    head: header({
      title: t('more.measure'), lock: true,
      back: backLink(t('nav.more'), () => { app.showSub(null); render(); }),
    }),
    body: [
      el('p', {}, t('measure.text')),
      el('section', { class: 'card' }, el('ul', { class: 'list' },
        MEASURE_ITERATIONS.map((n) => listItem(null, t('measure.rounds', { n: new Intl.NumberFormat('nl-NL').format(n) }), {
          value: m[n] !== undefined ? t('measure.result', { s: seconds(m[n]) }) : t('measure.notYet'),
          onclick: () => app.measure(n),
        })))),
      el('p', { class: 'muted' }, t('measure.note')),
      el('h3', {}, t('measure.checkTitle')),
      el('p', {}, t('measure.checkText')),
      el('section', { class: 'card' }, el('ul', { class: 'list' }, MEASURE_CHECK_SIZES.map(checkMeasureItem))),
      el('p', { class: 'muted' }, t('measure.checkNote')),
      el('h3', {}, t('measure.backupTitle')),
      el('p', {}, t('measure.backupText')),
      el('section', { class: 'card' }, el('ul', { class: 'list' }, MEASURE_BACKUP_MIB.map(backupMeasureItem))),
      el('p', { class: 'muted' }, t('measure.backupNote')),
    ],
    navbar: true,
  });
}

function eraseScreen(halted) {
  return page({
    head: header({
      title: t('erase.title'),
      back: backLink(halted ? t('halt.back') : t('nav.more'), () => { app.showSub(null); app.say(null); render(); }),
    }),
    body: form(() => app.eraseAll(value('erase')),
      el('p', { class: 'note warn' }, t('erase.warning')),
      field('erase', t('erase.label', { word: ERASE_WORD }), textInput('erase', {}, false)),
      submit(t('erase.submit'), 'danger'),
      button(t('common.cancel'), () => { app.showSub(null); app.say(null); render(); }, 'link')),
  });
}

function haltedScreen() {
  if (app.state.work.sub === 'erase') return eraseScreen(true);
  const code = app.state.haltCode;
  return page({
    head: header({ title: t('halt.title'), chip: t('halt.chip') }),
    body: [
      el('p', { class: 'note warn' }, t('halt.found', { code }), ' ', t(HALT_TEXT[code] || k('halt.code.unknown'))),
      HALT_CHECK[app.state.haltCheck] ? el('p', { class: 'muted' }, t(HALT_CHECK[app.state.haltCheck])) : null,
      el('p', {}, t('halt.text')),
      el('p', { class: 'muted' }, t('halt.options')),
      button(t('common.lock'), () => app.lock(), 'primary'),
      button(t('halt.erase'), () => { app.showSub('erase'); app.say(null); render(); }),
    ],
  });
}

function readyScreen() {
  const { tab, sub } = app.state.work;
  if (sub === 'password') return changePasswordScreen();
  if (sub === 'about') return aboutScreen();
  if (sub === 'measure') return measureScreen();
  if (sub === 'audit') return auditScreen();
  if (sub === 'erase') return eraseScreen(false);
  if (sub === 'backup') return backupScreen();
  const titles = {
    patients: t('nav.patients'), recipes: t('nav.recipes'), settings: t('nav.settings'), more: t('nav.more'),
  };
  const bodies = { patients: patientsTab, recipes: recipesTab, settings: settingsTab, more: moreTab };
  return page({
    head: header({ title: titles[tab], lock: true }),
    body: bodies[tab](),
    navbar: true,
  });
}

// --- Tekenen ----------------------------------------------------------------------------

function view() {
  const s = app.state;
  switch (s.view) {
    case 'starting': return startingScreen();
    case 'already-open': return alreadyOpenScreen();
    case 'error': return errorScreen();
    case 'locking': return lockingScreen();
    case 'locked': return lockedScreen();
    case 'recovery-password': return recoveryPasswordScreen();
    case 'halted': return haltedScreen();
    case 'ready': return readyScreen();
    case 'onboarding':
      switch (s.step) {
        case 'password': return onboardingPassword();
        case 'key': return onboardingKey();
        case 'check': return onboardingCheck();
        case 'done': return onboardingDone();
        case 'restore': return onboardingRestore();
        case 'restored': return onboardingRestored();
        default: return onboardingIntro();
      }
    default: return startingScreen();
  }
}

// Welk formulier staat er? Ander formulier: geen invoer terugzetten (review
// PR #23, tweede ronde: Ontgrendelen en Back-up controleren delen veld-id's).
let lastFormKey = null;

function formKey() {
  const s = app.state;
  return [s.view, s.step, s.work.tab, s.work.sub, ui.lockedMode, ui.unlockMode].join('|');
}

// Invoer bewaren bij opnieuw tekenen (bijvoorbeeld een melding van de
// service worker tijdens het typen), behalve direct na versturen.
function render() {
  const focused = document.activeElement && document.activeElement.id;
  const saved = ui.clearInputs ? new Map() : collectInputs(root.querySelectorAll('input[id]'), lastFormKey);
  const scroll = collectScroll(root.querySelector('.inner'), lastFormKey);
  replace(root, view());
  // Werkvelden uit de werkstand (stap D1); de invoer van dit moment gaat voor.
  const form = app.state.work.form;
  if (form) {
    for (const input of root.querySelectorAll('input[data-work]')) {
      if (isWorkField(input) && Object.prototype.hasOwnProperty.call(form.fields, input.id)) input.value = form.fields[input.id];
    }
  }
  lastFormKey = formKey();
  restoreInputs(saved, root.querySelectorAll('input[id]'), lastFormKey);
  // Vóór de focus: een veld met focus schuift zo nodig daarna in beeld.
  restoreScroll(scroll, root.querySelector('.inner'), lastFormKey);
  if (!app.state.busy) ui.clearInputs = false;
  const target = (focused && document.getElementById(focused)) || root.querySelector('[role="alert"]');
  if (target && typeof target.focus === 'function' && target.tagName !== 'P') target.focus();
  document.title = t('app.name');
}

// Alleen velden met data-work gaan in de werkstand, en nooit een
// wachtwoordveld; passwordInput en textInput (herstelsleutel) zetten
// data-work niet.
function isWorkField(input) {
  return input.dataset.work !== undefined && !isSecretInput(input) && input.type !== 'file' && Boolean(input.id);
}

root.addEventListener('input', (event) => {
  const input = event.target;
  if (input instanceof HTMLInputElement && isWorkField(input)) app.setWorkField(input.id, input.value);
});

app.subscribe(() => render());
render();
app.start();
initServiceWorker();

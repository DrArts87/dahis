// Start van de app: schermen, vergrendelen, service worker en bijwerken.
// De toestand van kluis en opslag staat in controller.js; dit bestand tekent
// alleen schermen. Teksten: i18n/nl.js.
import { el, replace, symbol } from './dom.js';
import { t } from './i18n.js';
import { AppController, ERASE_WORD, MEASURE_ITERATIONS, MEASURE_CHECK_SIZES } from './controller.js';
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

const ui = {
  tab: 'patients',          // patients | recipes | settings | more
  sub: null,                // password | about | measure | erase | audit
  unlockMode: 'password',   // password | recovery
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

let lastActivity = Date.now();

function markActivity() {
  lastActivity = Date.now();
}

for (const type of ['pointerdown', 'keydown', 'input', 'touchstart', 'wheel']) {
  window.addEventListener(type, markActivity, { capture: true, passive: true });
}

function lockIfSecrets() {
  if (app.shouldLockOnHide()) app.lock();
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') lockIfSecrets();
});
window.addEventListener('pagehide', lockIfSecrets);

setInterval(() => {
  if (!app.shouldLockOnHide()) return;
  const minutes = app.state.settings['lock.idleMinutes'];
  if (Date.now() - lastActivity >= minutes * 60 * 1000) app.lock();
}, 10 * 1000);

// --- Hulpmiddelen voor schermen ---------------------------------------------------------

const SUCCESS = new Set([k('recovery.done'), k('password.changed'), k('settings.saved'), k('check.ok')]);

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
    id, name: id, type: 'password', autocomplete, required: true,
    autocapitalize: 'off', spellcheck: 'false', 'aria-describedby': id + '-hint',
  });
}

function textInput(id, extra = {}) {
  return el('input', Object.assign({
    id, name: id, type: 'text', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false',
  }, extra));
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
      'aria-current': ui.tab === item.tab ? 'page' : null,
      onclick: () => { ui.tab = item.tab; ui.sub = null; app.closeAuditLog(); app.say(null); onTab(); render(); },
    }, symbol(item.icon), t(item.label))));
}

function onTab() {
  if (ui.tab === 'settings') app.refreshStorage();
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
      installCard(),
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
          el('dd', {}, t('onboarding.done.lockText', { min: SETTINGS['lock.idleMinutes'].default })))),
      el('p', { class: 'note warn' }, t('onboarding.done.noBackup')),
      el('p', {}, t('onboarding.done.next')),
      button(t('onboarding.done.button'), () => app.lock(), 'primary'),
    ],
  });
}

// --- Schermen: ontgrendelen en herstel ------------------------------------------------------

function lockedScreen() {
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
    }, 'link'));
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

function patientsTab() {
  return [
    el('div', { class: 'search' }, symbol('i-search'),
      el('input', { type: 'search', placeholder: t('patients.search'), disabled: true, 'aria-label': t('patients.search') })),
    emptyState(t('patients.empty')),
  ];
}

function recipesTab() {
  return [el('h3', {}, t('recipes.recent')), emptyState(t('recipes.empty'))];
}

function idleSelect() {
  const def = SETTINGS['lock.idleMinutes'];
  const current = app.state.settings['lock.idleMinutes'];
  const options = [];
  for (let m = def.min; m <= def.max; m++) {
    options.push(el('option', { value: String(m), selected: m === current }, t('settings.minutes', { n: m })));
  }
  return el('select', {
    id: 'idle', 'aria-label': t('settings.idle'), disabled: app.state.busy,
    onchange: (event) => app.saveSetting('lock.idleMinutes', Number(event.target.value)),
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
      listItem('i-clock', t('settings.idle'), { control: idleSelect() }),
      listItem('i-key', t('settings.password'), { onclick: () => { ui.sub = 'password'; app.say(null); render(); } }))),
    el('h3', {}, t('settings.device')),
    el('section', { class: 'card' }, el('ul', { class: 'list' },
      listItem('i-db', t('settings.storage'), { value: storageText() }))),
    el('p', { class: 'muted' }, t('settings.encrypted')),
  ];
}

function moreTab() {
  return [
    el('h3', {}, t('more.data')),
    el('section', { class: 'card' }, el('ul', { class: 'list' },
      listItem('i-archive', t('more.backup'), { value: t('more.backupLater') }),
      listItem('i-shield', t('more.check'), {
        value: checkValue(), onclick: () => app.runFullCheck(),
      }),
      listItem('i-clock', t('more.audit'), {
        onclick: async () => { ui.sub = 'audit'; app.say(null); render(); await app.openAuditLog(); },
      }))),
    el('h3', {}, t('more.support')),
    el('section', { class: 'card' }, el('ul', { class: 'list' },
      listItem('i-gauge', t('more.measure'), { onclick: () => { ui.sub = 'measure'; app.say(null); render(); } }),
      listItem('i-info', t('more.about'), { onclick: () => { ui.sub = 'about'; app.say(null); render(); } }),
      listItem('i-trash', t('more.erase'), { danger: true, onclick: () => { ui.sub = 'erase'; app.say(null); render(); } }))),
  ];
}

function changePasswordScreen() {
  const recovery = ui.unlockMode === 'recovery';
  return page({
    head: header({
      title: t('settings.password'), lock: true,
      back: backLink(t('nav.settings'), () => { ui.sub = null; app.say(null); render(); }),
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
      back: backLink(t('nav.more'), () => { ui.sub = null; render(); }),
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
      back: backLink(t('nav.more'), () => { ui.sub = null; app.closeAuditLog(); app.say(null); render(); }),
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

function measureScreen() {
  const m = app.state.measurements;
  return page({
    head: header({
      title: t('more.measure'), lock: true,
      back: backLink(t('nav.more'), () => { ui.sub = null; render(); }),
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
    ],
    navbar: true,
  });
}

function eraseScreen(halted) {
  return page({
    head: header({
      title: t('erase.title'),
      back: backLink(halted ? t('halt.back') : t('nav.more'), () => { ui.sub = null; app.say(null); render(); }),
    }),
    body: form(() => app.eraseAll(value('erase')),
      el('p', { class: 'note warn' }, t('erase.warning')),
      field('erase', t('erase.label', { word: ERASE_WORD }), textInput('erase')),
      submit(t('erase.submit'), 'danger'),
      button(t('common.cancel'), () => { ui.sub = null; app.say(null); render(); }, 'link')),
  });
}

function haltedScreen() {
  if (ui.sub === 'erase') return eraseScreen(true);
  const code = app.state.haltCode;
  return page({
    head: header({ title: t('halt.title'), chip: t('halt.chip') }),
    body: [
      el('p', { class: 'note warn' }, t('halt.found', { code }), ' ', t(HALT_TEXT[code] || k('halt.code.unknown'))),
      HALT_CHECK[app.state.haltCheck] ? el('p', { class: 'muted' }, t(HALT_CHECK[app.state.haltCheck])) : null,
      el('p', {}, t('halt.text')),
      el('p', { class: 'muted' }, t('halt.options')),
      button(t('common.lock'), () => app.lock(), 'primary'),
      button(t('halt.erase'), () => { ui.sub = 'erase'; app.say(null); render(); }),
    ],
  });
}

function readyScreen() {
  if (ui.sub === 'password') return changePasswordScreen();
  if (ui.sub === 'about') return aboutScreen();
  if (ui.sub === 'measure') return measureScreen();
  if (ui.sub === 'audit') return auditScreen();
  if (ui.sub === 'erase') return eraseScreen(false);
  const titles = {
    patients: t('nav.patients'), recipes: t('nav.recipes'), settings: t('nav.settings'), more: t('nav.more'),
  };
  const bodies = { patients: patientsTab, recipes: recipesTab, settings: settingsTab, more: moreTab };
  return page({
    head: header({ title: titles[ui.tab], lock: true }),
    body: bodies[ui.tab](),
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
        default: return onboardingIntro();
      }
    default: return startingScreen();
  }
}

// Invoer bewaren bij opnieuw tekenen (bijvoorbeeld een melding van de
// service worker tijdens het typen), behalve direct na versturen.
function render() {
  const saved = new Map();
  const focused = document.activeElement && document.activeElement.id;
  if (!ui.clearInputs) {
    for (const input of root.querySelectorAll('input[id]')) saved.set(input.id, input.value);
  }
  replace(root, view());
  for (const [id, val] of saved) {
    const input = document.getElementById(id);
    if (input && input.type !== 'search') input.value = val;
  }
  if (!app.state.busy) ui.clearInputs = false;
  const target = (focused && document.getElementById(focused)) || root.querySelector('[role="alert"]');
  if (target && typeof target.focus === 'function' && target.tagName !== 'P') target.focus();
  document.title = t('app.name');
}

app.subscribe(() => render());
render();
app.start();
initServiceWorker();

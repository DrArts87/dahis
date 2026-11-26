// Draait de browsertests (tests/browser.html) in Chrome zonder scherm en
// meldt de uitslag; voor CI (controle.yml) en lokaal.
//
//   node tests/run_browser.mjs
//
// Chrome: de omgevingsvariabele CHROME, anders google-chrome of chromium uit
// het pad (op Windows ook de standaardmap van Chrome). Elke run gebruikt een
// wegwerpprofiel in een tijdelijke map. Alleen Node-standaardmodules.
// DAHIS_TIMEOUT_S: maximale duur in seconden (standaard 180).
// DAHIS_NO_SANDBOX of CI: Chrome met --no-sandbox (nodig op de CI-runner en
// als root).
//
// Werking: een kleine webserver op 127.0.0.1 serveert de repository en een
// startpagina (/__ci). Die laadt tests/browser.html in een frame, wacht op
// window.dahisResults en stuurt de uitslag terug. Geen DevTools-protocol.

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const TIMEOUT_MS = (Number(process.env.DAHIS_TIMEOUT_S) || 180) * 1000;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

// Startpagina: geen gegevens, alleen de uitslag van de testpagina.
const START_PAGE = `<!doctype html>
<meta charset="utf-8">
<title>Dahis: browsertests (CI)</title>
<iframe id="t" src="/tests/browser.html" style="width:100%;height:90vh"></iframe>
<script>
const f = document.getElementById('t');
function text(id) {
  try { const el = f.contentDocument.getElementById(id); return el ? el.innerText : ''; } catch (e) { return ''; }
}
function send(path, body) {
  return fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
let done = false;
setInterval(() => {
  if (done) return;
  const results = f.contentWindow && f.contentWindow.dahisResults;
  if (Array.isArray(results)) {
    done = true;
    send('/__result', { results, status: text('status'), agent: navigator.userAgent });
  }
}, 250);
setInterval(() => { if (!done) send('/__progress', { status: text('status'), list: text('uitslag'), agent: navigator.userAgent }); }, 2000);
</script>
`;

function findChrome() {
  if (process.env.CHROME) {
    if (!existsSync(process.env.CHROME)) throw new Error('CHROME wijst naar een bestand dat niet bestaat: ' + process.env.CHROME);
    return process.env.CHROME;
  }
  const names = process.platform === 'win32'
    ? ['chrome.exe']
    : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome'];
  const dirs = (process.env.PATH || '').split(delimiter).filter(Boolean);
  if (process.platform === 'win32') {
    for (const base of [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]) {
      if (base) dirs.push(join(base, 'Google', 'Chrome', 'Application'));
    }
  }
  for (const dir of dirs) {
    for (const name of names) {
      const p = join(dir, name);
      if (existsSync(p)) return p;
    }
  }
  throw new Error('Geen Chrome gevonden. Zet de omgevingsvariabele CHROME op het pad van chrome(.exe).');
}

function readBody(req) {
  return new Promise((ok, fail) => {
    const parts = [];
    req.on('data', (c) => parts.push(c));
    req.on('end', () => {
      try { ok(JSON.parse(Buffer.concat(parts).toString('utf8'))); } catch (e) { fail(e); }
    });
    req.on('error', fail);
  });
}

function serveFile(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  const file = resolve(ROOT, '.' + decodeURIComponent(url.pathname));
  if (file !== ROOT && !file.startsWith(ROOT + sep)) { res.writeHead(403).end(); return; }
  let st;
  try { st = statSync(file); } catch { res.writeHead(404).end(); return; }
  if (!st.isFile()) { res.writeHead(404).end(); return; }
  res.writeHead(200, {
    'content-type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
    'cache-control': 'no-store',
  });
  res.end(readFileSync(file));
}

function report(body) {
  const results = Array.isArray(body.results) ? body.results : [];
  console.log('Browser: ' + (body.agent || 'onbekend'));
  for (const r of results) {
    console.log((r.ok ? 'geslaagd  ' : 'MISLUKT   ') + r.name + (r.ok ? '' : '\n          ' + r.error));
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(body.status || '');
  if (results.length === 0) { console.log('Geen tests uitgevoerd.'); return 1; }
  console.log(failed ? failed + ' van ' + results.length + ' tests mislukt.' : 'Alle ' + results.length + ' tests geslaagd.');
  return failed ? 1 : 0;
}

async function main() {
  const chromePath = findChrome();
  const profile = mkdtempSync(join(tmpdir(), 'dahis-browsertest-'));
  let chrome = null;
  let progress = null;
  let finish;
  const finished = new Promise((ok) => { finish = ok; });

  const server = createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/__ci') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end(START_PAGE);
      } else if (req.method === 'POST' && req.url === '/__progress') {
        progress = await readBody(req);
        res.writeHead(204).end();
      } else if (req.method === 'POST' && req.url === '/__result') {
        const body = await readBody(req);
        res.writeHead(204).end();
        finish(report(body));
      } else if (req.method === 'GET') {
        serveFile(req, res);
      } else {
        res.writeHead(405).end();
      }
    } catch (e) {
      res.writeHead(500).end();
    }
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const port = server.address().port;

  const args = [
    '--headless=new',
    '--user-data-dir=' + profile,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--mute-audio',
  ];
  // De Ubuntu-runners van GitHub blokkeren de sandbox van Chrome; de
  // testpagina laadt alleen eigen code van 127.0.0.1.
  if (process.env.CI || process.env.DAHIS_NO_SANDBOX) args.push('--no-sandbox');
  args.push('http://127.0.0.1:' + port + '/__ci');

  console.log('Chrome: ' + chromePath);
  chrome = spawn(chromePath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let chromeErr = '';
  chrome.stderr.on('data', (c) => { chromeErr = (chromeErr + c).slice(-4000); });
  chrome.on('exit', (code) => {
    finish(fail('Chrome is gestopt (code ' + code + ') voordat er een uitslag was.\n' + chromeErr));
  });

  const timer = setTimeout(() => {
    finish(fail('Geen uitslag na ' + TIMEOUT_MS / 1000 + ' s.' + (progress
      ? '\nBrowser: ' + progress.agent + '\nStatus: ' + progress.status + '\n' + progress.list
      : '\nDe testpagina heeft niets teruggemeld.')));
  }, TIMEOUT_MS);

  const code = await finished;
  clearTimeout(timer);
  chrome.removeAllListeners('exit');
  if (chrome.exitCode === null) {
    const exited = new Promise((ok) => chrome.once('exit', ok));
    chrome.kill();
    await Promise.race([exited, new Promise((ok) => setTimeout(ok, 5000))]);
  }
  server.closeAllConnections();
  server.close();
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* tijdelijke map */ }
  process.exitCode = code;
}

function fail(message) {
  console.error(message);
  return 1;
}

main().catch((e) => {
  console.error(e && e.message ? e.message : e);
  process.exitCode = 1;
});

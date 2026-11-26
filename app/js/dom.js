// DOM opbouwen zonder innerHTML. De CSP dwingt trusted types af, dus
// innerHTML en vergelijkbare constructies zijn geblokkeerd; tekst komt altijd
// als tekst in de pagina, nooit als HTML.

// el('p', {class: 'x', onclick: fn}, 'tekst', kindElement)
// Kinderen mogen (geneste) lijsten zijn; null, undefined en false vallen weg.
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'hidden') node.hidden = true;
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2), value);
    } else if (key.startsWith('on') || key === 'style') {
      throw new Error('Niet toegestaan attribuut: ' + key);
    } else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child !== null && child !== undefined && child !== false) node.append(child);
  }
  return node;
}

// Vervangt de inhoud van een element.
export function replace(node, ...children) {
  node.replaceChildren(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
}

const SVG_NS = 'http://www.w3.org/2000/svg';

// Verwijzing naar een SVG-symbool uit index.html (logo, iconen).
export function symbol(id, cls = 'icon') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', '#' + id);
  svg.append(use);
  return svg;
}

// --- Invoer bewaren bij opnieuw tekenen (review PR #23 P1-1) -------------------
//
// Een veld is geheim als het een wachtwoordveld is of data-secret heeft
// (herstelsleutel, groepen). Waarden gaan alleen terug binnen hetzelfde
// formulier (zelfde formuliersleutel; review PR #23, tweede ronde) en in een
// veld met hetzelfde id, hetzelfde type en dezelfde geheimmarkering: een
// wachtwoord komt zo nooit in een gewoon tekstveld of in een ander formulier
// met hetzelfde veld-id terecht. Werkt op alles met {id, type, value, dataset}, zodat het
// ook in Node te testen is.

export function isSecretInput(input) {
  return input.type === 'password' || (input.dataset && input.dataset.secret !== undefined);
}

export function collectInputs(inputs, formKey = null) {
  const saved = new Map();
  saved.formKey = formKey;
  for (const input of inputs) {
    if (!input.id || input.type === 'file') continue;
    saved.set(input.id, { value: input.value, type: input.type, secret: isSecretInput(input) });
  }
  return saved;
}

export function restoreInputs(saved, inputs, formKey = null) {
  if (saved.formKey !== formKey) return;
  for (const input of inputs) {
    const s = saved.get(input.id);
    if (!s || input.type === 'search' || input.type === 'file') continue;
    if (s.type !== input.type || s.secret !== isSecretInput(input)) continue;
    input.value = s.value;
  }
}

// --- Scrollpositie bewaren bij opnieuw tekenen (#32) ---------------------------
//
// Alleen het middendeel (.inner) scrolt. Omdat elk tekenen het scherm opnieuw
// opbouwt, gaat de positie terug op hetzelfde scherm (zelfde sleutel); op een
// ander scherm begint het bovenaan. Werkt op alles met {scrollTop}.

export function collectScroll(node, key = null) {
  return { key, top: node ? node.scrollTop : 0 };
}

export function restoreScroll(saved, node, key = null) {
  if (!node) return;
  node.scrollTop = saved && saved.key === key ? saved.top : 0;
}

// Bij verbergen van de app: geheime invoer wissen, ook als de app open
// blijft (wachttijd) of vergrendeld is en dus niet herlaadt.
export function clearSecretInputs(inputs) {
  let n = 0;
  for (const input of inputs) {
    if (isSecretInput(input) && input.value !== '') { input.value = ''; n += 1; }
  }
  return n;
}

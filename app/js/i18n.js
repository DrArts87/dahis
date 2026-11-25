// Teksten van de app, los van de code (docs/plans/2026-11-25-ui-opbouw.md).
//
// Alle gebruikersteksten staan in i18n/<taal>.js als plat object met vaste
// sleutels. Plaatshouders: {naam}. Teksten komen altijd als tekst in de
// pagina (textContent), nooit als HTML. Een JS-module en geen JSON: de CSP
// (connect-src 'none') staat fetch niet toe.
import nl from './i18n/nl.js';

const LANGUAGES = { nl };
let current = nl;

export function setLanguage(code) {
  current = LANGUAGES[code] || nl;
}

export function hasText(key) {
  return Object.prototype.hasOwnProperty.call(current, key);
}

// Ontbreekt een sleutel, dan de sleutel zelf tussen haken (zichtbaar in
// tests en bij het testen in de browser).
export function t(key, params = {}) {
  if (!hasText(key)) return '[' + key + ']';
  return current[key].replace(/\{([a-zA-Z]+)\}/g, (m, name) => (
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : m));
}

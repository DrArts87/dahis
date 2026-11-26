// Instellingen van Dahis (docs/plans/2026-11-25-ui-opbouw.md).
//
// Alle instellingen staan versleuteld in de kluis, in één record van kind
// 'settings' met inhoud {schema: 1, data: {sleutel: waarde}}. Ze gaan
// daarmee mee in de back-up. Alleen sleutels uit SETTINGS zijn toegestaan;
// een onbekende sleutel of een ongeldige waarde valt terug op de standaard.

export const SETTINGS_KIND = 'settings';
export const SETTINGS_SCHEMA = 1;

// type 'int': geheel getal tussen min en max (grenzen zijn hard: ook een
// gewijzigde opslag kan de app er niet buiten zetten).
export const SETTINGS = Object.freeze({
  'lock.idleMinutes': Object.freeze({ type: 'int', min: 1, max: 15, default: 3 }),
  // Wachttijd na wisselen van app (stap D1); 0 = direct vergrendelen.
  'lock.awayMinutes': Object.freeze({ type: 'int', min: 0, max: 15, default: 5 }),
});

export class SettingError extends Error {
  constructor(key) {
    super('Ongeldige instelling: ' + key);
    this.name = 'SettingError';
    this.key = key;
  }
}

export function isValidSetting(key, value) {
  if (!Object.prototype.hasOwnProperty.call(SETTINGS, key)) return false;
  const def = SETTINGS[key];
  if (def.type === 'int') return Number.isInteger(value) && value >= def.min && value <= def.max;
  return false;
}

export function defaultSettings() {
  const out = {};
  for (const [key, def] of Object.entries(SETTINGS)) out[key] = def.default;
  return out;
}

// Volledige, geldige set uit opgeslagen data (of null). Onbekende sleutels
// vallen weg, ongeldige waarden worden de standaard.
export function normalizeSettings(data) {
  const out = defaultSettings();
  if (!data || typeof data !== 'object' || Array.isArray(data)) return out;
  for (const key of Object.keys(SETTINGS)) {
    if (Object.prototype.hasOwnProperty.call(data, key) && isValidSetting(key, data[key])) out[key] = data[key];
  }
  return out;
}

// Nieuwe set met één gewijzigde instelling; gooit SettingError als de
// sleutel of waarde niet is toegestaan.
export function withSetting(current, key, value) {
  if (!isValidSetting(key, value)) throw new SettingError(key);
  const out = normalizeSettings(current);
  out[key] = value;
  return out;
}

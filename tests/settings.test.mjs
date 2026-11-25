// Tests van app/js/settings.js: vaste lijst, grenzen en standaardwaarden.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SETTINGS, defaultSettings, normalizeSettings, withSetting, isValidSetting, SettingError,
} from '../app/js/settings.js';

test('standaardwaarden voor alle sleutels', () => {
  assert.deepEqual(Object.keys(defaultSettings()), Object.keys(SETTINGS));
  assert.equal(defaultSettings()['lock.idleMinutes'], 3);
});

test('vergrendelen na: alleen gehele minuten van 1 tot 15', () => {
  for (const ok of [1, 3, 15]) assert.equal(isValidSetting('lock.idleMinutes', ok), true);
  for (const bad of [0, 16, 2.5, '3', null, -1, 1e9]) assert.equal(isValidSetting('lock.idleMinutes', bad), false);
});

test('normaliseren: onbekend valt weg, ongeldig wordt standaard', () => {
  assert.deepEqual(normalizeSettings(null), defaultSettings());
  assert.deepEqual(normalizeSettings([1, 2]), defaultSettings());
  assert.deepEqual(normalizeSettings({ 'lock.idleMinutes': 60, extra: 'x' }), defaultSettings());
  assert.deepEqual(normalizeSettings({ 'lock.idleMinutes': 7 }), { 'lock.idleMinutes': 7 });
});

test('withSetting weigert onbekende sleutels en waarden buiten de grenzen', () => {
  assert.deepEqual(withSetting({}, 'lock.idleMinutes', 10), { 'lock.idleMinutes': 10 });
  assert.throws(() => withSetting({}, 'lock.idleMinutes', 30), SettingError);
  assert.throws(() => withSetting({}, '__proto__', 1), SettingError);
});

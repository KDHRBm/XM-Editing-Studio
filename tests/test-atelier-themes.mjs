import test from 'node:test';
import assert from 'node:assert/strict';
import { ATELIER_THEMES, SOLID_THEMES, paletteVars, isLightColor } from '../app/src/AtelierThemes.mjs';

function luminance(hex) {
  const channels = hex.match(/[\da-f]{2}/gi).map(value => parseInt(value, 16) / 255);
  return channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
}

test('all 50 style themes have unique IDs and readable accent colors', () => {
  assert.equal(ATELIER_THEMES.length, 50);
  assert.equal(new Set(ATELIER_THEMES.map(theme => theme.id)).size, 50);
  for (const theme of ATELIER_THEMES) {
    const tokens = paletteVars(theme);
    assert.equal(tokens['--ui-bg'], theme.bg);
    assert.equal(tokens['--ui-scheme'], theme.mode);
    const ratio = (Math.max(luminance(theme.accent), luminance(theme.surface)) + 0.05)
      / (Math.min(luminance(theme.accent), luminance(theme.surface)) + 0.05);
    assert.ok(ratio >= 4.5, `${theme.label}: accent contrast ${ratio.toFixed(2)}`);
  }
});

test('solid color choices include dark, light and adaptive custom color', () => {
  assert.deepEqual(SOLID_THEMES.map(theme => theme.id), ['solid-dark', 'solid-light', 'solid-custom']);
  const custom = SOLID_THEMES[2];
  assert.equal(paletteVars(custom, '#d9e8f2')['--ui-scheme'], 'light');
  assert.equal(paletteVars(custom, '#23313c')['--ui-scheme'], 'dark');
  assert.equal(isLightColor('#999999'), paletteVars(custom, '#999999')['--ui-scheme'] === 'light');
});

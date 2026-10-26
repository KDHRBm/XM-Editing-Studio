import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSubtitlePunctuation } from '../app/shared/period-text.mjs';
import { splitScript, materialTexts } from '../app/shared/script-score.mjs';
import { createPunctuationClipboard } from '../app/electron/period-clipboard.mjs';

test('ellipsis variants normalize to three ASCII dots without changing decimals or single periods', () => {
  for (const dots of ['..', '...', '......', '…', '……', '‥', '. . .', '․․․', '．．．']) {
    const actual = normalizeSubtitlePunctuation(`Wait${dots} 3.5. Done.`);
    assert.equal(actual, 'Wait... 3.5. Done.');
    assert.equal(normalizeSubtitlePunctuation(actual), actual);
  }
});

test('English and Spanish retain three-dot ellipses while Chinese removes punctuation', async () => {
  for (const [script, language, expected] of [
    ['[EN] JACK: Wait… Come back.', 'en', 'Wait...\nCome back.'],
    ['[ES] JOSÉ: Espera…… Vuelve.', 'es', 'Espera...\nVuelve.'],
    ['小明：等等……回来。', 'zh', '等等\n回来'],
  ]) {
    const lines = splitScript(script, language);
    const actual = lines.map(line => line.text).join('\n');
    assert.equal(actual, expected);
    const files = materialTexts({ script, lines, source: 'library', localTrack: { title: 'fixture' }, analysis: { summary: '', keywords: [] } });
    assert.equal(files['逐行台词.txt'], expected);
    for (const mode of ['standard', 'compatible']) {
      let text = '';
      const guard = createPunctuationClipboard({ clipboard: { readText: () => text, writeText: value => { text = value; } }, schedule: () => 1, cancel: () => {} });
      await guard.configure(true, mode);
      const result = await guard.copy(actual);
      assert.equal(result.copyVerified, true);
      assert.equal(text, (mode === 'compatible' ? expected.replace(/\./g, '․') : expected).replace(/\n/g, '\r\n'));
      await guard.dispose();
    }
  }
});

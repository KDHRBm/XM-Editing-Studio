import test from 'node:test';
import assert from 'node:assert/strict';
import { splitScript, materialTexts } from '../app/shared/script-score.mjs';
import { batchSubtitleLines } from '../app/shared/batch-analysis.mjs';
import { createPunctuationClipboard, restoreProtectedPunctuation } from '../app/electron/period-clipboard.mjs';

const texts = lines => lines.map(line => line.text);

test('honorific periods stay attached to names without creating subtitle boundaries', () => {
  const dialogue = [
    'Mr. Harris, Ms. Foster and Mrs. Wynn are here.',
    'Dr. Åsa, Prof. Émile and Mx. Lee will join us.',
    'MR. HARRIS paid 3.5 dollars... Wait.',
  ];
  assert.deepEqual(texts(splitScript(dialogue.map(text => '[EN] VIVIAN: ' + text).join('\n'))), [
    ...dialogue.slice(0, 2), 'MR. HARRIS paid 3.5 dollars...', 'Wait.',
  ]);
  assert.deepEqual(texts(splitScript('[ES] ANA: Sr. Pérez, la Sra. López y la Dra. Díaz están aquí.', 'es')),
    ['Sr. Pérez, la Sra. López y la Dra. Díaz están aquí.']);
});

test('long dialogue never wraps immediately between a title and its following name', () => {
  const prefix = 'I was waiting at the entrance to the building for ';
  for (const [marker, title] of [['EN', 'Mr.'], ['ES', 'Sra.']]) {
    const sentence = `${prefix}${title} Harris to return with the documents we needed.`;
    const lines = texts(splitScript(`[${marker}] VIVIAN: ${sentence}`));
    assert(lines.length > 1);
    assert.equal(lines.join(' '), sentence);
    assert(lines.some(line => line.includes(`${title} Harris`)));
    assert(lines.every(line => !line.endsWith(title)));
  }
});

test('interrupted dialogue keeps hyphens at either end and within words', () => {
  const script = [
    '[EN] VIVIAN: You—',
    '[EN] VIVIAN: You-',
    '[EN] VIVIAN: —You did this?',
    '[EN] VIVIAN: I-I thought it was a well-known fact.',
    '[ES] ANA: Tú–',
    '[ES] ANA: -No puedo-',
  ].join('\n');
  assert.deepEqual(texts(splitScript(script)), ['You -', 'You-', '- You did this?', 'I-I thought it was a well-known fact.', 'Tú -', '-No puedo-']);
});

test('list formatting and speaker names are removed while continuation dashes remain', () => {
  const script = [
    '- [EN] MARY-JANE: Mr. Harris,',
    '- you promised—',
    '△ She leaves.',
    '* [ES] ANA-MARÍA: Sra. López—',
    '[EN] VIVIAN: - You-',
  ].join('\n');
  assert.deepEqual(texts(splitScript(script)), ['Mr. Harris, - you promised -', 'Sra. López -', '- You-']);
});

test('workspace, batch and TXT export keep the same titles and interrupted speech', () => {
  const script = '第1集\n[EN] VIVIAN: Mr. Harris, wait...\n[EN] VIVIAN: You—\n[ES] ANA: Sra. López, no-';
  const lines = splitScript(script);
  const expected = ['Mr. Harris, wait...', 'You -', 'Sra. López, no-'];
  assert.deepEqual(texts(lines), expected);
  for (const preserve of [true, false]) {
    assert.deepEqual(texts(batchSubtitleLines({ script, settings: { subtitleLanguage: 'auto' } }, preserve)), expected);
  }
  const exported = materialTexts({ script, lines, source: 'library', localTrack: { title: 'Fixture' }, analysis: { summary: '', keywords: [] } });
  assert.equal(exported['逐行台词.txt'], expected.join('\n'));
  assert.equal(exported['角色台词.txt'], expected.join('\n'));
});

test('Jianying copy protects title dots without losing dashes, names or line endings', async () => {
  const plain = texts(splitScript('[EN] VIVIAN: Mr. Harris, wait...\n[EN] VIVIAN: You—\n[ES] ANA: Sra. López, no-')).join('\n');
  for (const mode of ['standard', 'compatible']) {
    let value = '', tick;
    const guard = createPunctuationClipboard({ clipboard: { readText: async () => value, writeText: async text => { value = text; } }, schedule: fn => { tick = fn; return 1; }, cancel: () => {} });
    try {
      await guard.configure(true, mode);
      const result = await guard.copy(plain);
      await tick?.();
      assert.equal(result.copyVerified, true);
      assert.equal(result.copiedLines, 3);
      const actual = value.replace(/\r\n/g, '\n');
      assert.equal(restoreProtectedPunctuation(actual), plain);
      assert.equal(actual, mode === 'compatible' ? 'Mr․ Harris‚ wait․․․\nYou -\nSra․ López‚ no-' : plain);
      assert.deepEqual(texts(splitScript(value.split('\r\n').map((line, index) => `${index === 2 ? '[ES]' : '[EN]'} VIVIAN: ${line}`).join('\n'))), plain.split('\n'));
    } finally { await guard.dispose(); }
  }
});

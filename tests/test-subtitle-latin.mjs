import test from 'node:test';
import assert from 'node:assert/strict';
import { splitScript, materialTexts, validateLines } from '../app/shared/script-score.mjs';
import { normalizeEnglish } from '../app/shared/english-subtitles.mjs';
import { createPunctuationClipboard, restoreProtectedPunctuation } from '../app/electron/period-clipboard.mjs';

test('screenshot fiancée retains its accented letter in automatic and English extraction', () => {
  const script = "艾拉：（忍着眼泪）我是你的未婚妻，不是你养的狗！\n[EN] ELLA: I'm your fiancée. Not your dog!";
  for (const language of ['auto', 'en']) {
    const lines = splitScript(script, language);
    assert.deepEqual(lines.map(line => line.text), ["I'm your fiancée.", 'Not your dog!']);
    assert(lines.every(line => line.speaker === '' && line.language === 'en'));
  }
});

test('English loanwords and names keep Latin letters, including decomposed accents', () => {
  const sentence = 'José, Zoë and Søren enjoy crème brûlée at the café.';
  for (const text of [sentence, sentence.normalize('NFD')]) assert.deepEqual(splitScript('[EN] ELLA: ' + text).map(line => line.text), [sentence]);
  assert.equal(normalizeEnglish('My fiancée is naïve about résumés and the façade.'), 'My fiancée is naïve about résumés and the façade.');
  assert.equal(normalizeEnglish('Łukasz, François, Ægir and Weiß.'), 'Łukasz, François, Ægir and Weiß.');
  assert.deepEqual(splitScript('[EN] ELLA: Mr. Émile, Dr. Åsa and Ms. Özlem are here.').map(line => line.text), ['Mr Émile, Dr Åsa and Ms Özlem are here.']);
});

test('Latin support retains filtering, standard punctuation, ellipses and Spanish behavior', () => {
  const lines = splitScript('[EN] ÉLLA-艾拉（低声）: “My fiancée…”（流泪）\n△ 她走开。\nUnmarked speech.\n[ES] JOSÉ: ¿Dónde está mi prometida? ¡Aquí!');
  assert.deepEqual(lines.map(line => line.text), ['"My fiancée..."', '¿Dónde está mi prometida?', '¡Aquí!']);
  assert.deepEqual(lines.map(line => line.language), ['en', 'es', 'es']);
  assert.equal(normalizeEnglish('fiancée (whispering) 中文 😀.'), 'fiancée.');
});

test('wrapping and TXT export preserve full accented words without adding spaces inside them', () => {
  const sentence = 'My fiancée José brought a résumé to the café, but Zoë and François asked us to wait until they could read every detail carefully.';
  const script = '[EN] ELLA: ' + sentence, lines = splitScript(script);
  assert(lines.length > 1); assert.equal(lines.map(line => line.text).join(' '), sentence);
  assert.deepEqual(validateLines(lines).map(line => line.text), lines.map(line => line.text));
  const exports = materialTexts({ script, lines, source: 'library', localTrack: { title: 'Fixture' }, analysis: { summary: '', keywords: [] } });
  assert.equal(exports['逐行台词.txt'], lines.map(line => line.text).join('\n'));
  assert.equal(exports['角色台词.txt'], exports['逐行台词.txt']);
  for (const word of ['fiancée', 'José', 'résumé', 'café', 'Zoë', 'François']) assert(exports['台词清单.csv'].includes(word));
});

test('standard and compatibility clipboard copies preserve accented letters end to end', async () => {
  const lines = splitScript("[EN] ELLA: I'm your fiancée. Not your dog!\n[EN] ELLA: José, wait..."), text = lines.map(line => line.text).join('\n');
  for (const mode of ['standard', 'compatible']) {
    let copied = '', poll;
    const guard = createPunctuationClipboard({ clipboard: { readText: () => copied, writeText: value => { copied = value; } }, schedule: fn => { poll = fn; return 1; }, cancel: () => {} });
    await guard.configure(true, mode);
    const result = await guard.copy(text); poll?.();
    assert.equal(result.copyVerified, true); assert.equal(result.copiedLines, 3);
    assert.equal(restoreProtectedPunctuation(copied).replace(/\r\n/g, '\n'), "I'm your fiancée.\nNot your dog!\nJosé, wait...");
    if (mode === 'compatible') assert.match(copied, /fiancée․/);
    else assert.match(copied, /fiancée\./);
    await guard.dispose();
  }
});

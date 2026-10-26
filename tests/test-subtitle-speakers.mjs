import test from 'node:test';
import assert from 'node:assert/strict';
import { splitScript, materialTexts } from '../app/shared/script-score.mjs';

test('screenshot bilingual speaker is removed before Chinese normalization', () => {
  const script = `[EN] CARL VIKTOR-卡尔维克托: Unacceptable! Elliott Grey has a bastard son nobody knew about — and the man's a killer.
[EN] CARL VIKTOR-卡尔维克托: Summit Casino. Biggest money pit in New York.`;
  const lines = splitScript(script, 'en');
  assert.deepEqual(lines.map(line => line.text), ['Unacceptable!', "Elliott Grey has a bastard son nobody knew about - and the man's a killer.", 'Summit Casino.', 'Biggest money pit in New York.']);
  assert.ok(lines.every(line => !line.speaker));
  const exported = materialTexts({ script, lines, source: 'library', localTrack: { title: 'song' }, analysis: { summary: '', keywords: [] } });
  assert.equal(exported['逐行台词.txt'], lines.map(line => line.text).join('\n'));
  assert.doesNotMatch(exported['逐行台词.txt'], /CARL|VIKTOR|卡尔/);
});

test('Chinese, bilingual, lowercase and accented speaker labels are omitted', () => {
  for (const label of ['CARL VIKTOR-卡尔维克托', 'CARL VIKTOR（卡尔维克托）', '卡尔维克托', 'carl viktor', "María de la Cruz / 玛丽亚", "O’NEILL-奥尼尔", '角色 1 / GUARD A']) {
    for (const separator of [':', '：']) assert.deepEqual(splitScript(`[EN] ${label}${separator} Stay here...`).map(line => line.text), ['Stay here...']);
  }
  assert.deepEqual(splitScript('[ES] JOSÉ-何塞：¿Dónde está María? ¡Ven aquí!', 'es').map(line => line.text), ['¿Dónde está María?', '¡Ven aquí!']);
});

test('only the first speaker separator is removed, preserving dialogue colons and times', () => {
  assert.deepEqual(splitScript('[EN] CARL VIKTOR-卡尔维克托: My rule: leave at 10:30.').map(line => line.text), ['My rule: leave at 10:30.']);
  assert.deepEqual(splitScript('[EN] JACK (VO: whispering): Mr. Harris... wait.').map(line => line.text), ['Mr Harris...', 'wait.']);
  assert.deepEqual(splitScript('[EN] JACK（语气：低沉）：Wait.').map(line => line.text), ['Wait.']);
  assert.deepEqual(splitScript('[EN] It is 10:30.\n[EN] Hello.').map(line => line.text), ['It is 10:30.', 'Hello.']);
});

test('wrapped marked dialogue keeps its content, language and original line number', () => {
  const lines = splitScript('卡尔：中文台词。\n[EN] CARL VIKTOR-卡尔维克托:\nUnacceptable!\nCome back.\n△ 中文动作。\nJOE: Unmarked speech.\n[ES] JOSÉ-何塞：Sí.', 'en');
  assert.deepEqual(lines.map(line => line.text), ['Unacceptable!', 'Come back.']);
  assert.ok(lines.every(line => line.sourceLine === 2 && line.language === 'en'));
});

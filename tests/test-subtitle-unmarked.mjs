import test from 'node:test';
import assert from 'node:assert/strict';
import { splitScript } from '../app/shared/script-score.mjs';
import { batchSubtitleLines } from '../app/shared/batch-analysis.mjs';

const bilingual = `第一集
1-1 机场跑道 夜 外
人物：乌娜、司机
△ 暴雨，汽车灯光照亮跑道。
司机：小姐！托林先生还在工作，要不您先回家等他！
DRIVER: Miss Oona! Your father's still working. Why don't you wait for him at home?
△ 乌娜冲向飞机。
乌娜：不！爸爸才刚回来！
OONA: No! Dad just got back from his overseas flight. I can't wait to show him my straight A's!
伊索尔德（尖利）：谁放你上飞机的？！
ISOLDE: Who let you on this plane? Can't you see it's being serviced?`;
const batch = (script, subtitleLanguage = 'auto') => batchSubtitleLines({script, settings: {subtitleLanguage}});
const texts = lines => lines.map(line => line.text);

test('unmarked bilingual screenshot produces the same English dialogue in workspace and batch', () => {
  const expected = ["Miss Oona!", "Your father's still working.", "Why don't you wait for him at home?", 'No!',
    'Dad just got back from his overseas flight.', "I can't wait to show him my straight A's!",
    'Who let you on this plane?', "Can't you see it's being serviced?"];
  for (const language of ['auto', 'en']) {
    const lines = splitScript(bilingual, language);
    assert.deepEqual(texts(lines), expected);
    assert.deepEqual(batch(bilingual, language), lines);
    assert(lines.every(line => line.language === 'en' && line.speaker === '' && !/[\p{Script=Han}]/u.test(line.text)));
    assert.deepEqual([...new Set(lines.map(line => line.sourceLine))], [6, 9, 11]);
  }
});

test('unmarked speaker annotations and wrapped dialogue are retained without scene metadata', () => {
  const script = `第一集
Oona / 乌娜（低声：带笑）：I told you:
"Please wait for me."
Location: A dark airport.
This is a description.
人物：乌娜
DRIVER: Yes, Miss Oona. △ 司机低头。`;
  assert.deepEqual(texts(splitScript(script)), ['I told you: "Please wait for me."', 'Yes, Miss Oona.']);
});

test('unmarked Spanish keeps accents and inverted punctuation, ignoring Chinese translations', () => {
  const script = `第2集
何塞：您好，女士！
JOSÉ: ¡Hola, señora! ¿Dónde está Lucía?
露西娅：我就在这里。
Lucía: Estoy aquí. Gracias, José.`;
  const expected = ['¡Hola, señora!', '¿Dónde está Lucía?', 'Estoy aquí.', 'Gracias, José.'];
  for (const language of ['auto', 'es']) {
    assert.deepEqual(texts(splitScript(script, language)), expected);
    assert.deepEqual(batch(script, language), splitScript(script, language));
  }
  assert.deepEqual(splitScript(script, 'en'), []);
});

test('explicit Chinese selection and pure Chinese batch auto remain available', () => {
  assert(splitScript(bilingual, 'zh').some(line => line.text.includes('小姐')));
  const script = '第1集\n小明：你好！\n小红：请进。';
  assert.deepEqual(texts(batch(script)), ['你好!', '请进.']);
  assert.deepEqual(batch(script, 'en'), []);
});

test('explicit language markers continue to exclude unmarked rows', () => {
  const script = '[EN] OONA: Hello.\n\nDRIVER: This unmarked line is intentionally excluded.\n[ES] JOSÉ: ¡Hola!';
  assert.deepEqual(texts(splitScript(script)), ['Hello.', '¡Hola!']);
});

test('episode titles with colons are context rather than dialogue in either language', () => {
  assert.deepEqual(texts(splitScript('第1集: An airport reunion\nJACK: Hello.')), ['Hello.']);
  const script='第1集 相遇：标题说明\n小明：你好。';
  assert.deepEqual(texts(batch(script,'zh')),['你好.']);
  assert.deepEqual(texts(batch(script)),['你好.']);
});

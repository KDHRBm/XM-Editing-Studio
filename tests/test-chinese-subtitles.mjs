import test from 'node:test';
import assert from 'node:assert/strict';
import { splitScript, validateScoreRequest, validateLines, materialTexts, scoreMessages } from '../app/shared/script-score.mjs';
import { newProject, rememberProject } from '../app/shared/script-projects.mjs';
import { createScriptQueue, restoreJobs } from '../app/shared/script-queue.mjs';

test('Chinese speaker lines output only dialogue after either colon', () => {
  const script = '卡尔维克托（阴沉）：岂有此理！埃利奥特有个私生子。\nCARL VIKTOR-卡尔维克托: 顶峰娱乐城。\n小明：你好，Mr Harris！';
  const lines = splitScript(script, 'zh');
  assert.deepEqual(lines.map(line => line.text), ['岂有此理!', '埃利奥特有个私生子.', '顶峰娱乐城.', '你好,Mr Harris!']);
  assert.ok(lines.every(line => line.language === 'zh' && line.speaker === ''));
  assert.deepEqual(lines.map(line => line.sourceLine), [1, 1, 2, 3]);
});

test('Chinese markers support simplified and traditional Chinese', () => {
  const script = '[ZH] 小明：等等...\n[CN] 小红: 我知道了。\n【中文】 阿明：你在哪裡？\n[zh-TW] 小美：請等一下！\n[ZH-CN] 张三：OK.';
  assert.deepEqual(splitScript(script, 'zh').map(line => line.text), ['等等...', '我知道了.', '你在哪裡?', '請等一下!', 'OK.']);
});

test('Chinese mode rejects directions, scene metadata and other subtitle languages', () => {
  const script = '第1集：故事开始\n场景：大厅\n时间：晚上\n出场人物：小明、小红\n△ 小明：走到门前。\n▲ 小红：愣住。\n【特写】屏幕：显示文字。\nVO: 动作提示。\n[EN] JACK: Hello.\n[ES] JOSÉ: ¡Hola!\n[FR] JEAN: 中文备注\n小明走到门前。\n没有冒号的中文\n小明：快进来。';
  assert.deepEqual(splitScript(script, 'zh').map(line => line.text), ['快进来.']);
});

test('speaker annotations and dialogue directions are omitted without truncating dialogue colons', () => {
  const script = '小明（语气：低沉）：（低声）我的规矩：十点回来。\n小红（VO）：（惊讶）真的吗？△ 她后退。\n小明：现在是10:30，花了3.5元。\n张三：等一下……我还没说完。';
  assert.deepEqual(splitScript(script, 'zh').map(line => line.text), ['我的规矩：十点回来.', '真的吗?', '现在是10:30,花了3.5元.', '等一下...', '我还没说完.']);
});

test('long Chinese dialogue wraps at pauses while preserving the complete spoken content', () => {
  const content = '我从早上一直等到现在，就是想当面告诉你这件事情，可你却一直躲着我不肯出现，今天无论如何也要听我把话说完。';
  const lines = splitScript('小明：' + content, 'zh');
  assert.ok(lines.length > 1);
  assert.equal(lines.map(line => line.text).join(''), content.replaceAll('，', ',').replaceAll('。', '.'));
});

test('Chinese selection preserves existing English and Spanish filtering', () => {
  const script = '小明：你好。\n[EN] XIAOMING-小明: Hello.\n[ES] XIAOMING-小明: ¡Hola!';
  assert.deepEqual(splitScript(script, 'zh').map(line => line.text), ['你好.']);
  assert.deepEqual(splitScript(script, 'en').map(line => line.text), ['Hello.']);
  assert.deepEqual(splitScript(script, 'es').map(line => line.text), ['¡Hola!']);
  assert.deepEqual(splitScript(script).map(line => line.text), ['Hello.', '¡Hola!']);
});

test('Chinese survives request validation, Gemini context and subtitle exports', () => {
  const input = { script: '小明：请等一下。\n小红：为什么？', subtitleLanguage: 'zh' };
  const data = validateScoreRequest(input);
  assert.equal(data.subtitleLanguage, 'zh');
  assert.deepEqual(validateLines(data.lines).map(line => line.language), ['zh', 'zh']);
  const message = JSON.parse(scoreMessages(input)[1].content);
  assert.equal(message.originalScript, input.script);
  assert.deepEqual(message.editedLines.map(line => line.text), ['请等一下.', '为什么?']);
  const exports = materialTexts({ ...data, source: 'library', localTrack: { title: 'song' }, analysis: { summary: '', keywords: [] } });
  assert.equal(exports['逐行台词.txt'], '请等一下.\n为什么?');
  assert.equal(exports['角色台词.txt'], exports['逐行台词.txt']);
});

test('Chinese language persists across project history and queued task restore', () => {
  const draft = { script: '小明：别走。', subtitleLanguage: 'zh' };
  const history = JSON.parse(JSON.stringify(rememberProject([], newProject(draft))));
  assert.equal(history[0].draft.subtitleLanguage, 'zh');
  const queue = createScriptQueue({ save: () => {}, getProvider: () => null });
  const gemini = { providerId: 'g', protocol: 'gemini', model: 'gemini-test' };
  const suno = { providerId: 's', protocol: 'suno', model: 'suno-test' };
  queue.add(draft, gemini, suno);
  const restored = restoreJobs(JSON.parse(JSON.stringify(queue.snapshot().jobs)));
  assert.equal(restored[0].subtitleLanguage, 'zh');
  assert.equal(restored[0].lines[0].text, '别走.');
  assert.equal(restored[0].lines[0].language, 'zh');
});

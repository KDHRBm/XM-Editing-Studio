import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSrt, restoreSrtPunctuation, periodKeeperStatusText } from '../app/shared/subtitle-punctuation.mjs';

const srt = texts => texts.map((text, index) => `${index + 1}\n00:00:${String(index * 2).padStart(2, '0')},100 --> 00:00:${String(index * 2 + 1).padStart(2, '0')},900\n${text}`).join('\n\n');

test('restores the screenshot English punctuation with unchanged cue count and timings', () => {
  const original = "Well, look at this.\nNora Grant.\nYou didn't actually think a piece of trash like you\ncould walk all over the Kanes, did you?\nLet me spell it out - you're done.";
  const input = srt(['Well look at this', 'Nora Grant', "You didnt actually think a piece of trash like you", 'could walk all over the Kanes did you', 'Let me spell it out youre done']);
  const result = restoreSrtPunctuation(original, input);
  assert.equal(result.cues, 5); assert.equal(result.changed, 5);
  assert.deepEqual(parseSrt(result.text).map(cue => cue.timing), parseSrt(input).map(cue => cue.timing));
  assert.deepEqual(parseSrt(result.text).map(cue => cue.text), original.split('\n'));
  assert.doesNotMatch(result.text, /[․﹒‚﹐\u2060]/);
});

test('preserves Jianying cue boundaries when they differ from source lines', () => {
  const result = restoreSrtPunctuation('Wait...\nMr Harris, please come back.\nI need you!', srt(['Wait Mr Harris', 'please come', 'back I need you']));
  assert.deepEqual(parseSrt(result.text).map(cue => cue.text), ['Wait... Mr Harris,', 'please come', 'back. I need you!']);
});

test('Chinese and Spanish punctuation is restored without losing accents or numbers', () => {
  assert.deepEqual(parseSrt(restoreSrtPunctuation('等一下...\n我还没说完!\n现在是10:30，花了3.5元。', srt(['等一下我还没说完', '现在是1030花了35元'])).text).map(cue => cue.text), ['等一下...我还没说完!', '现在是10:30,花了3.5元.']);
  assert.deepEqual(parseSrt(restoreSrtPunctuation('¿Dónde está María?\n¡Ven aquí!', srt(['Dónde está María', 'Ven aquí'])).text).map(cue => cue.text), ['¿Dónde está María?', '¡Ven aquí!']);
});

test('opening quotes attach to the following cue and repeated lines map in order', () => {
  const result = restoreSrtPunctuation('She said: “Come back.”\nNora Grant.\nNora Grant!', srt(['She said', 'Come back', 'Nora Grant', 'Nora Grant']));
  assert.deepEqual(parseSrt(result.text).map(cue => cue.text), ['She said:', '“Come back.”', 'Nora Grant.', 'Nora Grant!']);
});

test('mismatched, missing or reordered dialogue never silently produces a new SRT', () => {
  for (const input of [srt(['Hello world']), srt(['Hello']), srt(['world Hello']), srt(['Hello world again'])]) {
    assert.throws(() => restoreSrtPunctuation('Hello, world! Goodbye.', input), /不一致/);
  }
  assert.throws(() => restoreSrtPunctuation('付了15元。', srt(['付了五十元'])), /不一致/);
  assert.throws(() => restoreSrtPunctuation('', srt(['Hello'])), /请先整理/);
});

test('supports BOM, CRLF, styled SRT and unchanged time coordinates', () => {
  const input = '\ufeff19\r\n01:02:03,004 --> 01:02:04,900 X1:0 X2:1 Y1:2 Y2:3\r\n<i>hello</i>\r\nworld\r\n';
  const result = restoreSrtPunctuation('Hello, world.', input);
  assert.deepEqual(parseSrt(result.text), [{ index: '19', timing: '01:02:03,004 --> 01:02:04,900 X1:0 X2:1 Y1:2 Y2:3', text: 'Hello, world.' }]);
});

test('rejects broken files, wrong timestamps, unsupported encoding and punctuation-only cues', () => {
  for (const input of ['', 'Hello', '1\n00:00:99,000 --> 00:00:01,000\nHello', '1\n00:00:02,000 --> 00:00:01,000\nHello', '1\n00:00:01,000 --> 00:00:02,000\n\uFFFD']) assert.throws(() => parseSrt(input));
  assert.throws(() => restoreSrtPunctuation('Hello.', srt(['...', 'Hello'])), /只有标点/);
  assert.throws(() => parseSrt('a'.repeat(2_000_001)), /过大/);
});

test('restoring twice is stable and never substitutes nonstandard ASCII lookalikes', () => {
  const original = "Wait․․․ Hello‚ world․\nDon't leave!";
  const first = restoreSrtPunctuation(original, srt(['Wait Hello world', 'Dont leave']));
  const second = restoreSrtPunctuation(original, first.text);
  assert.equal(second.text, first.text); assert.equal(second.changed, 0);
  assert.doesNotMatch(first.text, /[․﹒‚﹐\u2060]/);
});

test('native patch status never claims generated subtitles were verified', () => {
  assert.equal(periodKeeperStatusText({ engine: 'active', patchedSites: 4 }), '兼容规则已加载，字幕结果尚未验证');
  assert.doesNotMatch(periodKeeperStatusText({ engine: 'active' }), /已生效|已保留/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createPunctuationClipboard, protectPunctuation, restoreProtectedPunctuation } from '../app/electron/period-clipboard.mjs';
import { segmentScoreInput, findSegmentJob } from '../app/shared/segment-shortcut.mjs';
import { createScriptQueue } from '../app/shared/script-queue.mjs';
import { splitScript, scoreMessages } from '../app/shared/script-score.mjs';
import { newProject } from '../app/shared/script-projects.mjs';
import { installMusicPlayback } from '../app/src/music-playback.mjs';
import { score } from './script-test-fixtures.mjs';

function clipboardFixture() {
  let value = 'Hello, world. Wait...', reads = 0, writes = 0, tick, formats = ['text/plain'];
  const guard = createPunctuationClipboard({ clipboard: { readText: () => { reads++; return value; }, writeText: text => { writes++; value = text; }, availableFormats: () => formats }, schedule: fn => { tick = fn; return 1; }, cancel: () => { tick = null; } });
  return { guard, get value() { return value; }, set value(v) { value = v; }, get reads() { return reads; }, get writes() { return writes; }, tick: () => tick?.(), get polling() { return !!tick; }, set formats(f) { formats = f; } };
}
test('explicit standard mode keeps ASCII comma/dot, three-dot ellipses and never polls unrelated clipboard', async () => {
  const f = clipboardFixture(); await f.guard.configure(true, 'standard');
  assert.equal(f.reads, 0); assert.equal(f.writes, 0); assert.equal(f.polling, false);
  const copied = await f.guard.copy('Yes, go. Wait...');
  assert.equal(f.value, 'Yes, go. Wait...'); assert.equal(copied.clipboardProtected, false);
  assert.equal(f.guard.status().punctuationMode, 'standard');
});
test('compatible mode protects both commas and periods immediately and for newly copied text', async () => {
  const f = clipboardFixture(); await f.guard.configure(true, 'compatible');
  assert.equal(f.value, 'Hello‚ world․ Wait․․․'); assert.equal(f.polling, true);
  const writes = f.writes; await f.tick(); assert.equal(f.writes, writes);
  f.value = 'Second, text. ...'; await f.tick(); assert.equal(f.value, 'Second‚ text․ ․․․');
  await f.guard.configure(false); assert.equal(f.value, 'Second, text. ...'); assert.equal(f.polling, false);
  f.value = 'No, guard.'; await f.tick(); assert.equal(f.value, 'No, guard.');
});
test('switching back restores only owned clipboard; disposal preserves a newer unrelated copy', async () => {
  const f = clipboardFixture(); await f.guard.configure(true, 'compatible'); await f.guard.configure(true, 'standard');
  assert.equal(f.value, 'Hello, world. Wait...'); assert.equal(f.polling, false);
  await f.guard.configure(true, 'compatible'); f.value = 'A newer copy.'; await f.guard.dispose();
  assert.equal(f.value, 'A newer copy.');
  await f.guard.configure(true, 'compatible'); f.formats = ['image/png']; f.value = 'image description.'; await f.tick();
  assert.equal(f.value, 'image description.'); await f.guard.dispose();
  f.formats = ['text/plain']; await f.guard.configure(true, 'compatible');
  f.formats = ['image/png']; const before = f.writes; await f.guard.dispose();
  assert.equal(f.writes, before, 'a newer image copy is preserved even with identical text');
});
test('upstream protection is reversible, idempotent and adds no invisible joins or broken ellipses', () => {
  const plain = 'Yes, go. Wait ... 中文，继续。 3.5, finish...';
  const protectedText = protectPunctuation(plain);
  assert.equal(protectedText, 'Yes‚ go․ Wait ․․․ 中文﹐继续﹒ 3․5‚ finish․․․');
  assert.equal(protectPunctuation(protectedText), protectedText);
  assert.equal(restoreProtectedPunctuation(protectedText), plain);
  assert.doesNotMatch(protectedText, /\u2060|\u0000/);
});

test('default upstream copy keeps all 1500 lines, words, accents, CJK and both punctuation types', async () => {
  const f = clipboardFixture(); await f.guard.configure(true);
  const original = Array.from({ length: 1500 }, (_, n) => `Line ${n + 1}, señor. 中文台词, Wait...`).join('\n');
  const result = await f.guard.copy(original);
  assert.equal(result.copyVerified, true); assert.equal(result.copiedLines, 1500);
  assert.equal(restoreProtectedPunctuation(f.value).replace(/\r\n/g, '\n'), original);
  assert.match(f.value, /Line 1500‚ señor․ 中文台词‚ Wait․․․$/);
  assert.equal(f.value.split('\r\n').length, 1500);
});

test('partial clipboard writes retry the complete text and reject persistent truncation', async () => {
  let value = '', attempts = 0, truncated = true;
  const guard = createPunctuationClipboard({ clipboard: { readText: () => value, writeText: text => { attempts++; value = truncated && attempts < 3 ? text.slice(0, 5) : text; } }, retryDelay: async () => {} });
  const result = await guard.copy('Hello, world.\nFinal line.');
  assert.equal(result.copyVerified, true); assert.equal(attempts, 3); assert.equal(value, 'Hello, world.\r\nFinal line.');
  const broken = createPunctuationClipboard({ clipboard: { readText: () => value, writeText: text => { value = text.slice(0, 5); } }, retryDelay: async () => {} });
  await assert.rejects(broken.copy('Complete, dialogue.'), /完整性校验/);
});

test('NUL artifacts cannot truncate the rest and a newer clipboard copy is never overwritten by retry', async () => {
  const f = clipboardFixture(); await f.guard.configure(true);
  await f.guard.copy('First.\0\nSecond, complete.');
  assert.equal(f.value, 'First․\r\nSecond‚ complete․');
  let value = '', tick;
  const guard = createPunctuationClipboard({ clipboard: { readText: () => value, writeText: text => { value = text.slice(0, 3); } }, schedule: fn => { tick = fn; return 1; }, cancel: () => {}, retryDelay: async () => { await tick(); value = 'User copied something else'; } });
  await guard.configure(true);
  await assert.rejects(guard.copy('All, words.'), /其他复制操作/);
  assert.equal(value, 'User copied something else');
});

const input = { script: '△ 追逐\n[EN] A: Run, now.\n△ 重逢\n[EN] B: Welcome, back.', subtitleLanguage: 'en', hint: '', durationSeconds: 60, segmented: true };
input.lines = splitScript(input.script);
const segment = { id: 'segment-2', startLine: 3, endLine: 4, title: '重逢', summary: '温暖重逢', keywords: ['温暖', '钢琴'] };
const config = { providerId: 'p', baseUrl: 'http://mock', protocol: 'suno', model: 'suno-test' };
test('segment shortcut sends only the selected script and carries its mood/keywords without truncating requirements', () => {
  const scoped = segmentScoreInput({ ...input, hint: 'a'.repeat(1000) }, segment);
  assert.equal(scoped.script, '△ 重逢\n[EN] B: Welcome, back.'); assert.equal(scoped.segmented, false);
  assert.equal(scoped.lines.length, 1); assert.equal(scoped.lines[0].sourceLine, 2);
  const message = JSON.parse(scoreMessages(scoped)[1].content);
  assert.deepEqual(message.segmentContext.keywords, ['温暖', '钢琴']); assert.equal(message.musicRequirements.length, 1000);
  assert.doesNotMatch(message.originalScript, /追逐|Run/);
  assert.throws(() => segmentScoreInput(input, { ...segment, endLine: 200 }), /范围/);
});
test('clicks are durable and scoped: other paused jobs never submit, including after restart', async () => {
  let next = 0, saved, requests = [];
  const options = { uuid: () => String(++next), save: value => { saved = structuredClone(value); }, getProvider: () => ({ ...config, apiKey: 'test-only' }), request: async (url, body) => { requests.push({ url, body }); return url.endsWith('/score') ? { score } : { tracks: [{ id: 'paid-once', taskId: 'paid-once', status: 'complete', audioUrl: 'https://example.com/test.mp3' }] }; } };
  const q = createScriptQueue(options); const unrelated = q.add(input, config, config);
  const id = q.addSegment(input, segment, 'project', config, config); assert.equal(q.addSegment(input, segment, 'project', config, config), id);
  q.startOnly(id); await q.tick(); await q.tick(); await q.tick();
  assert.equal(requests.length, 2); assert.equal(requests[0].body.segmented, false); assert.deepEqual(requests[0].body.segmentContext.keywords, segment.keywords);
  assert.equal(q.snapshot().jobs.find(j => j.id === unrelated).status, 'queued');
  assert.equal(q.snapshot().jobs.find(j => j.id === id).status, 'complete'); assert.equal(q.snapshot().running, false);
  const restart = createScriptQueue({ ...options, initial: saved });
  assert.equal(restart.addSegment(input, segment, 'project', config, config), id); restart.startOnly(id); await restart.tick();
  assert.equal(requests.length, 2); assert.equal(findSegmentJob(saved, input, segment, 'project').id, id);
  assert.equal(findSegmentJob(saved, { ...input, durationSeconds: 90 }, segment, 'project'), undefined);
});
test('uncertain segment submission cannot be duplicated by clicking again or restarting', async () => {
  let saved, submitted = 0;
  const options = { save: jobs => { saved = structuredClone(jobs); }, getProvider: () => ({ ...config, apiKey: 'test' }), request: async url => { if (url.endsWith('/score')) return { score }; submitted++; throw new Error('response lost'); } };
  const q = createScriptQueue(options); const id = q.addSegment(input, segment, 'p', config, config); q.startOnly(id); await q.tick(); await q.tick();
  assert.equal(q.snapshot().jobs[0].status, 'uncertain');
  const restart = createScriptQueue({ ...options, initial: saved }); assert.equal(restart.addSegment(input, segment, 'p', config, config), id);
  restart.startOnly(id); await restart.tick(); assert.equal(submitted, 1);
});
test('retired requirements cannot be inherited by a new or restored project', () => {
  assert.equal(newProject({ script: input.script, hint: 'old hidden suspense' }).draft.hint, '');
});

function playbackFixture() {
  const handlers = new Map();
  const audios = [0, 1].map(() => ({ tagName: 'AUDIO', paused: true, isConnected: true, pause() { this.paused = true; }, play() { this.paused = false; handlers.get('play')({ target: this }); return Promise.resolve(); }, closest: () => null }));
  const doc = { querySelectorAll: () => audios, addEventListener: (key, fn) => handlers.set(key, fn), removeEventListener: key => handlers.delete(key) };
  const dispose = installMusicPlayback(doc);
  function key(target = { closest: () => null }, extra = {}) { const event = { code: 'Space', key: ' ', target, preventDefault() { this.prevented = true; }, stopPropagation() {}, ...extra }; handlers.get('keydown')(event); return event; }
  return { audios, handlers, key, dispose };
}
test('starting another music pauses the first without resetting its position', async () => {
  const f = playbackFixture(), [a, b] = f.audios; a.currentTime = 24;
  await a.play(); await b.play(); assert.equal(a.paused, true); assert.equal(b.paused, false); assert.equal(a.currentTime, 24);
  f.dispose(); assert.equal(f.handlers.size, 0);
});
test('space pauses/resumes only current audio, ignores repeat, editors and disconnected media', async () => {
  const f = playbackFixture(), [a, b] = f.audios; await a.play(); await b.play();
  assert.equal(f.key().prevented, true); assert.equal(b.paused, true); assert.equal(a.paused, true);
  f.key(undefined, { repeat: true }); assert.equal(b.paused, true);
  f.key(); assert.equal(b.paused, false);
  assert.equal(f.key({ closest: () => ({ tagName: 'TEXTAREA' }) }).prevented, undefined); assert.equal(b.paused, false);
  assert.equal(f.key(undefined, { ctrlKey: true }).prevented, undefined);
  b.isConnected = false; assert.equal(f.key().prevented, undefined); f.dispose();
});

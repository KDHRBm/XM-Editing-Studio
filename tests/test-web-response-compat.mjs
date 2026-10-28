import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { webTaskResult, analyzeWithWeb } from '../app/shared/web-script-analysis.mjs';
import { parseSegments } from '../app/shared/script-segments.mjs';
import { webAIPageScript } from '../app/electron/web-ai-dom.mjs';
import { createWebAnalysis } from '../app/electron/web-ai-analysis.mjs';

const token = 'compat-current-task';
const analysis = { summary: '紧张后的重逢', keywords: ['钢琴'] };
const segment = { title: '重逢', startLine: 1, endLine: 2, ...analysis };
const envelope = result => JSON.stringify({ xmTaskId: token, result });
const read = (text, manual = false) => webTaskResult(text, token, manual);

test('fenced JSON survives unmatched prose braces; plain JSON survives unmatched prose quotes', () => {
  const answer = envelope(analysis);
  for (const prefix of ['Thinking { unfinished\n', 'Thinking [ unfinished\n', 'Thinking: "unfinished\n']) {
    assert.equal(read(prefix + '```json\n' + answer + '\n```'), JSON.stringify(analysis));
  }
  assert.equal(read('Thinking: "unfinished\n' + answer), JSON.stringify(analysis));
  assert.equal(read('Earlier {}.\n' + answer), JSON.stringify(analysis));
});

test('trailing-comma repair leaves all string contents and escaped quotes unchanged', () => {
  const payload = { summary: 'Keep ,] and ,} literally; "quoted ,]"; path \\; 中文，西语 ¡Hola!', keywords: ['piano', 'braces } ]'] };
  const raw = `{"xmTaskId":"${token}","result":${JSON.stringify(payload).slice(0, -1)},},}`;
  assert.deepEqual(JSON.parse(read(raw)), payload);
  assert.equal(read(envelope(payload)), JSON.stringify(payload));
  assert.equal(read(`{"xmTaskId":"${token}","result":{"matches":[{"id":"a","reason":"Keep ,]",},],},}`), '{"matches":[{"id":"a","reason":"Keep ,]"}]}');
});

test('nested wrappers, array results and trimmed segment task markers are accepted', () => {
  const marked = { ...segment, xmTaskId: ` ${token}\n` };
  const expected = JSON.stringify({ segments: [segment] });
  assert.equal(read(JSON.stringify({ result: { result: { segments: [marked] } } })), expected);
  assert.equal(read(envelope([marked])), expected);
  assert.equal(read(envelope([{ id: 'local-a', reason: '适合温暖重逢', xmTaskId: token }])), '{"matches":[{"id":"local-a","reason":"适合温暖重逢"}]}');
  assert.equal(read(envelope([{ title: 'unknown array shape' }])), null);
  assert.equal(read(envelope([])), null);
});

test('bare batch episodes and nested episode markers retain the 1.3.1 batch schema', () => {
  const episodes = [{ id: 'ep-1', ...analysis, segments: [segment] }, { id: 'ep-2', ...analysis, segments: [segment] }];
  const expected = JSON.stringify({ episodes });
  assert.equal(read(JSON.stringify({ xmTaskId: token, episodes })), expected);
  assert.equal(read(JSON.stringify({ episodes }), true), expected);
  assert.equal(read(JSON.stringify({ episodes })), null);
  assert.equal(read(envelope(episodes)), expected);
  const marked = structuredClone(episodes); marked[1].segments[0].xmTaskId = token;
  assert.equal(read(JSON.stringify({ episodes: marked })), expected);
});

test('conflicting markers at every level are rejected even during manual import', () => {
  for (const marker of ['other-task', null, 1, '']) {
    const values = [
      { xmTaskId: marker, result: { result: { xmTaskId: token, ...analysis } } },
      { xmTaskId: token, result: { result: { xmTaskId: marker, ...analysis } } },
      { xmTaskId: token, result: { segments: [{ ...segment, xmTaskId: marker }] } },
      { xmTaskId: token, episodes: [{ id: 'ep-1', xmTaskId: token, ...analysis }, { id: 'ep-2', ...analysis, xmTaskId: marker }] },
    ];
    for (const value of values) for (const manual of [false, true]) {
      const raw = JSON.stringify(value);
      assert.equal(read(raw, manual), null);
      assert.equal(read('```json\n' + raw + '\n```', manual), null);
    }
  }
});

test('partial streams cannot yield a nested result or the first episode prematurely', () => {
  const answer = envelope({ segments: [{ ...segment, xmTaskId: token }] });
  for (let cut = 1; cut < answer.length; cut++) assert.equal(read(answer.slice(0, cut)), null, `cut ${cut}`);
  assert.equal(read('[' + answer + ','), null);
  assert.equal(read(envelope({ episodes: [{ id: 'ep-1', ...analysis, xmTaskId: token }] }).slice(0, -2)), null);
  // A code fence quoted as data is never promoted to a separate response.
  const quoted = JSON.stringify({ xmTaskId: 'wrong', note: '```json\n' + envelope(analysis) + '\n```' });
  assert.equal(read(quoted), null);
  assert.equal(read(quoted.slice(0, -1)), null);
  assert.equal(read('{'.repeat(199999)), null);
});

test('numeric strings and skipped whitespace lines work without dropping real script content', () => {
  const input = { script: '\nFirst dialogue\n \t\nSecond dialogue\n', segmentCount: 3 };
  const data = { segments: [{ ...segment, startLine: ' 2 ', endLine: '2' }, { ...segment, startLine: '4', endLine: '4' }] };
  const parsed = parseSegments(JSON.stringify(data), input, 'library');
  assert.deepEqual(parsed.map(s => [s.startLine, s.endLine]), [[2, 2], [4, 4]]);
  for (const script of ['Scene title\nFirst dialogue\n \t\nSecond dialogue\n', '\nFirst dialogue\nScene change\nSecond dialogue\n', '\nFirst dialogue\n \t\nSecond dialogue\nLast dialogue']) {
    assert.throws(() => parseSegments(JSON.stringify(data), { ...input, script }, 'library'), /遗漏|覆盖/);
  }
  for (const line of ['', null, true, '2.5', '2e0', '0x2', -1, 0, 99, '9007199254740992']) {
    const bad = structuredClone(data); bad.segments[0].startLine = line;
    assert.throws(() => parseSegments(JSON.stringify(bad), input, 'library'), /行号/);
  }
  const overlap = structuredClone(data); overlap.segments[1].startLine = '2';
  assert.throws(() => parseSegments(JSON.stringify(overlap), input, 'library'), /重叠/);
  assert.equal(parseSegments(JSON.stringify({ segments: [{ ...segment, startLine: '1', endLine: '5' }] }), input, 'library').length, 1);
});

test('joint web batch keeps every episode and accepts single continuous segments with blank gaps', async () => {
  const episodes = [1, 2, 3].map(n => ({ id: `ep-${n}`, episodeNumber: n, script: `第${n}集\n\n[EN] A: Come home!\n` }));
  let calls = 0;
  const result = await analyzeWithWeb('batch-library-match', { episodes, tracks: [], segmented: true, segmentCount: 4 }, async messages => {
    calls++;
    const supplied = JSON.parse(messages[1].content).episodes;
    assert.equal(supplied.length, 3);
    return read(envelope({ episodes: supplied.map(episode => ({ id: episode.id, ...analysis, segments: [{ ...segment, startLine: '1', endLine: '3', xmTaskId: token }] })) }));
  });
  assert.equal(calls, 1);
  assert.deepEqual(result.episodes.map(e => e.id), ['ep-1', 'ep-2', 'ep-3']);
  assert(result.episodes.every(e => e.value.segments.length === 1 && e.value.segments[0].endLine === 3));
});

function domFixture() {
  const state = { answers: [], buttons: [], streams: [], queried: [] };
  const node = (text, options = {}) => ({
    innerText: text, textContent: text, getClientRects: () => options.hidden ? [] : [1],
    getAttribute: key => options[key] || '', closest: selector => selector.includes('think') && options.excluded ? {} : null,
    querySelector: () => null,
  });
  const context = { getComputedStyle: () => ({ visibility: 'visible' }), document: { querySelectorAll(selector) {
    state.queried.push(selector);
    if (selector.startsWith('pre,')) return state.answers;
    if (selector.startsWith('button')) return state.buttons;
    if (selector.startsWith('[data-streaming')) return state.streams;
    return [];
  } } };
  return { state, node, read: () => vm.runInNewContext(webAIPageScript({ command: 'read', token, prompt: 'FULL INPUT PROMPT' }), context) };
}

test('DOM reads message containers while excluding thought, user, hidden and prompt text', () => {
  const f = domFixture(), good = envelope(analysis);
  f.state.answers = [f.node(good), f.node(good), f.node(good + ' thought', { excluded: true }), f.node(good + ' hidden', { hidden: true }), f.node(good + ' FULL INPUT PROMPT'), f.node(good + ' 这里放入上面要求的完整结果对象')];
  assert.deepEqual(Array.from(f.read().texts), [good]);
  assert(f.state.queried.some(selector => selector.includes('message-content') && selector.includes('article')));
  assert.equal(f.read().busy, false);
});

test('DOM strips reasoning descendants on a clone without changing the official page', () => {
  const f = domFixture(), good = envelope(analysis);
  let removed = false;
  const original = f.node('thought ' + token + ' and answer ' + good);
  original.querySelector = () => ({});
  original.cloneNode = () => ({ get textContent() { return removed ? good : original.textContent; }, querySelectorAll: () => [{ remove() { removed = true; } }] });
  f.state.answers = [original];
  assert.deepEqual(Array.from(f.read().texts), [good]);
  assert.match(original.textContent, /^thought/);
});

test('DOM waits for active thinking and streaming, not completed or hidden indicators', () => {
  const f = domFixture();
  for (const label of ['停止思考', '正在思考', 'Stop generating']) {
    f.state.buttons = [f.node(label)]; assert.equal(f.read().busy, true);
  }
  f.state.buttons = [];
  f.state.streams = [f.node('', { 'data-streaming': 'true' })]; assert.equal(f.read().busy, true);
  for (const options of [{ hidden: true }, { 'data-streaming': 'false' }, { 'data-state': 'completed' }]) {
    f.state.streams = [f.node('', options)]; assert.equal(f.read().busy, false);
  }
  assert(f.state.queried.filter(s => s.startsWith('[data-streaming')).every(s => !s.includes('class*=')));
});

test('web workflow waits for a stable completed answer and sends only once', async () => {
  let reads = 0, sends = 0, time = 0;
  const host = createWebAnalysis({ uuid: () => token, now: () => time, delay: async () => { time += 1500; }, notify: () => {}, copy: async () => {}, driver: {
    visible: () => true, run: async (_provider, command) => {
      if (command.command === 'fill') return { state: 'filled' };
      if (command.command === 'send') { sends++; return { state: 'sent' }; }
      reads++;
      const complete = 'Thinking { unfinished\n```json\n' + envelope(analysis) + '\n```';
      return { texts: [reads < 3 ? envelope(analysis).slice(0, -1) : complete], busy: reads < 6 };
    },
  } });
  const result = await host.run({ id: 'compat-request-1', provider: 'deepseek', purpose: 'library-match', input: { script: '[EN] A: Come home!', tracks: [] } });
  assert.deepEqual(result.analysis, analysis);
  assert.equal(sends, 1); assert(reads >= 7); assert.equal(host.snapshot(), null);
});

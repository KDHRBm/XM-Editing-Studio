import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
import { analyzeWithWeb, webTaskPrompt, webTaskResult } from '../app/shared/web-script-analysis.mjs';
import { WEB_ANALYZERS, analysisName } from '../app/shared/script-analyzers.mjs';
import { createWebAnalysis } from '../app/electron/web-ai-analysis.mjs';
import { webAIPageScript } from '../app/electron/web-ai-dom.mjs';
import { requestScriptAnalysis } from '../app/src/AnalysisRequest.mjs';
import { createScriptQueue } from '../app/shared/script-queue.mjs';
import { score, analysis } from './script-test-fixtures.mjs';

const input = { script: '△ 追逐\n[EN] ELLA: My fiancée!\n△ 重逢\n[ES] JOSÉ: ¡Hola!', durationSeconds: 60, segmentCount: 3, tracks: [{ id: 'piano', title: '温暖钢琴' }] };
const segments = [{ title: '追逐', startLine: 1, endLine: 2, summary: '追逐紧张', keywords: ['紧张'], score: { ...score, style: 'tense drums, no vocals' } }, { title: '重逢', startLine: 3, endLine: 4, summary: '重逢温暖', keywords: ['温暖'], score }];
test('web analysis supports whole/segmented recommendations and validates candidate IDs', async () => {
  let requests = [];
  const result = await analyzeWithWeb('library-match', input, async messages => {
    requests.push(messages); return JSON.stringify(requests.length === 1 ? analysis : { matches: [{ id: 'piano', reason: '适合重逢情节', keywords: ['温暖'] }] });
  });
  assert.equal(result.matches[0].id, 'piano'); assert.equal(result.evaluated, 1);
  assert.equal(JSON.parse(requests[0][1].content).originalScript, input.script);
  requests = [];
  const segmented = await analyzeWithWeb('library-match', { ...input, segmented: true }, async messages => {
    requests.push(messages); return JSON.stringify(requests.length === 1 ? { segments } : { segments: [{ id: 'segment-1', matches: [] }, { id: 'segment-2', matches: [{ id: 'piano', reason: '温暖', keywords: ['钢琴'] }] }] });
  });
  assert.equal(segmented.segments[1].matches[0].id, 'piano'); assert.equal(segmented.segments[0].matches.length, 0);
  let calls = 0;
  await assert.rejects(analyzeWithWeb('library-match', input, async () => JSON.stringify(++calls === 1 ? analysis : { matches: [{ id: 'fabricated', reason: 'invalid', keywords: [] }] })), /ID/);
  assert.equal(calls, 3, 'only one correction request after the initial analysis and match');
  calls = 0; const empty = await analyzeWithWeb('library-match', { ...input, tracks: [] }, async () => { calls++; return JSON.stringify(analysis); });
  assert.equal(calls, 1); assert.equal(empty.matches.length, 0);
});

test('whole-script match repairs a malformed answer once using the same analysis and candidate IDs', async () => {
  const requests = [];
  const result = await analyzeWithWeb('library-match', input, async (messages, stage) => {
    requests.push({ messages, stage });
    if (requests.length === 1) return JSON.stringify(analysis);
    if (requests.length === 2) return '{broken';
    const context = JSON.parse(messages[1].content);
    assert.equal(context.originalScript, undefined);
    assert.deepEqual(context.analysis, analysis);
    assert.deepEqual(context.musicTitles, input.tracks);
    assert.match(context.validationError, /JSON/);
    assert.equal(context.previousResult, '{broken');
    return JSON.stringify({ matches: [{ id: 'piano', reason: '温暖重逢', keywords: ['温暖'] }] });
  });
  assert.equal(requests.length, 3);
  assert.equal(requests[2].stage, '修正音乐推荐格式（1/1）');
  assert.equal(result.matches[0].id, 'piano');
});

test('segmented repair keeps the original story plan and enforces each segment candidate list in a large library', async () => {
  const tracks = Array.from({ length: 1425 }, (_, n) => ({ id: `other-${n}`, title: '喜剧尤克里里' }));
  tracks.push({ id: 'tense_873bd1', title: '紧张鼓点' }, { id: 'warm_84a2c9', title: '温暖钢琴' });
  const requests = [];
  const result = await analyzeWithWeb('library-match', { ...input, segmented: true, tracks }, async (messages, stage) => {
    const context = JSON.parse(messages[1].content); requests.push({ context, stage });
    if (requests.length === 1) return JSON.stringify({ segments });
    if (requests.length === 2) return JSON.stringify({ segments: [
      { id: 'segment-1', matches: [{ id: 'warm_84a2c9', reason: '错用了其他情节候选', keywords: [] }] },
      { id: 'segment-2', matches: [{ id: 'warm_84a2c9', reason: '适合重逢', keywords: ['温暖'] }] },
    ] });
    assert.match(context.validationError, /第1段（segment-1）.*ID 无效/);
    assert.deepEqual(context.segments, requests[1].context.segments);
    assert.equal(context.originalScript, undefined);
    return JSON.stringify({ segments: context.segments.map(s => ({ id: s.id, matches: s.musicTitles.map(t => ({ id: t.id, reason: s.summary })) })) });
  });
  assert.equal(requests.length, 3);
  assert.equal(result.total, 1427); assert.equal(result.evaluated, 2);
  assert.deepEqual(result.segments.map(s => s.matches[0].id), ['tense_873bd1', 'warm_84a2c9']);
  assert.deepEqual(result.segments.map(s => [s.startLine, s.endLine]), [[1, 2], [3, 4]]);
});

test('format normalization avoids another web request; request failures are not treated as malformed answers', async () => {
  let calls = 0;
  const result = await analyzeWithWeb('library-match', input, async () => JSON.stringify(++calls === 1 ? analysis : { matches: [
    { id: ' piano ', reason: '温暖', keywords: '钢琴，温暖' }, { id: 'piano', reason: '重复' },
  ] }));
  assert.equal(calls, 2); assert.equal(result.matches.length, 1);
  for (const message of ['官网访问频繁', '网页分析已中断', '网页分析等待超时']) {
    calls = 0;
    await assert.rejects(analyzeWithWeb('library-match', input, async () => {
      if (++calls === 1) return JSON.stringify(analysis);
      throw new Error(message);
    }), new RegExp(message));
    assert.equal(calls, 2);
    calls = 0;
    await assert.rejects(analyzeWithWeb('library-match', input, async () => {
      if (++calls === 1) return JSON.stringify(analysis);
      if (calls === 2) return JSON.stringify({ matches: [{ id: 'invented', reason: '错误' }] });
      throw new Error(message);
    }), new RegExp(message));
    assert.equal(calls, 3);
  }
});

test('web host gives the correction its own task token and submits each completed step exactly once', async () => {
  let token = 0, sends = 0, time = 0;
  const events = [], tokens = [];
  const host = createWebAnalysis({ uuid: () => `token-${++token}`, now: () => time, delay: async () => { time += 1500; }, notify: state => events.push(state), copy: async () => {}, driver: {
    visible: () => true,
    async run(_provider, command) {
      if (command.command === 'fill') { tokens.push(command.token); return { state: 'filled' }; }
      if (command.command === 'send') { sends++; return { state: 'sent' }; }
      const result = token === 1 ? analysis : { matches: [{ id: token === 2 ? 'invented' : 'piano', reason: '适合重逢' }] };
      return { texts: [JSON.stringify({ xmTaskId: command.token, result })], busy: false };
    },
  } });
  const result = await host.run({ id: 'request-repair-123', provider: 'deepseek', purpose: 'library-match', input });
  assert.deepEqual(tokens, ['token-1', 'token-2', 'token-3']);
  assert.equal(sends, 3); assert.equal(result.matches[0].id, 'piano');
  assert(events.some(e => e?.stage === '修正音乐推荐格式（1/1）'));
  assert.equal(host.snapshot(), null);
});

test('renderer displays the provider failure without the Electron IPC prefix', async () => {
  const previous = globalThis.blackObsidian;
  globalThis.blackObsidian = { analyzeWebScript: async () => { throw new Error("Error invoking remote method 'bos:web-analysis-start': Error: DeepSeek 返回的第1首音乐 ID 无效。"); } };
  try {
    await assert.rejects(requestScriptAnalysis('library-match', { ...input, provider: WEB_ANALYZERS[0].provider }), error => error.message === 'DeepSeek 返回的第1首音乐 ID 无效。');
  } finally { globalThis.blackObsidian = previous; }
});
test('web Suno planning yields validated independent segment prompts without a music request', async () => {
  const whole = await analyzeWithWeb('score', input, async () => JSON.stringify(score)); assert.equal(whole.score.style, score.style);
  const result = await analyzeWithWeb('score', { ...input, segmented: true }, async () => JSON.stringify({ segments }));
  assert.equal(result.segments.length, 2); assert.notEqual(result.segments[0].score.style, result.segments[1].score.style);
  await assert.rejects(analyzeWithWeb('score', input, async () => JSON.stringify({ ...score, style: 'x'.repeat(1001) })), /1000/);
});
test('response envelopes reject prior conversations and partial JSON; manual import is explicit', () => {
  const envelope = JSON.stringify({ xmTaskId: 'current-token', result: analysis });
  assert.equal(webTaskResult('```json\n' + envelope + '\n```', 'current-token'), JSON.stringify(analysis));
  assert.equal(webTaskResult(envelope, 'old-token'), null);
  assert.equal(webTaskResult(envelope.slice(0, -1), 'current-token'), null);
  assert.equal(webTaskResult(JSON.stringify(analysis), 'current-token'), null);
  assert.equal(webTaskResult(JSON.stringify(analysis), 'current-token', true), JSON.stringify(analysis));
  assert.equal(webTaskResult(envelope, 'old-token', true), null);
  assert.equal(webTaskResult('{'.repeat(199999), 'current-token'), null);
  const prompt = webTaskPrompt([{ content: 'instruction' }, { content: 'fiancée.' }], 'current-token'); assert.match(prompt, /fiancée/); assert.match(prompt, /current-token/);
});

test('DeepSeek task marker inside result is accepted without accepting a different or conflicting task', () => {
  // Synthetic dialogue-free fixture reproduces the envelope returned by the official site.
  const result = { segments: [{ title: '转折', startLine: 1, endLine: 204, summary: '情绪变化', keywords: ['悬疑'] }] };
  const nested = { result: { ...result, xmTaskId: 'current-token' } };
  for (const manual of [false, true]) {
    assert.equal(webTaskResult(JSON.stringify(nested), 'current-token', manual), JSON.stringify(result));
    assert.equal(webTaskResult('```json\n' + JSON.stringify(nested) + '\n```', 'current-token', manual), JSON.stringify(result));
    assert.equal(webTaskResult(JSON.stringify(nested), 'other-token', manual), null);
    assert.equal(webTaskResult(JSON.stringify(nested).slice(0, -1), 'current-token', manual), null);
    for (const conflicting of [
      { xmTaskId: 'wrong', result: nested.result },
      { xmTaskId: 'current-token', result: { ...result, xmTaskId: 'wrong' } },
      { xmTaskId: null, result: nested.result },
    ]) assert.equal(webTaskResult(JSON.stringify(conflicting), 'current-token', manual), null);
    assert.equal(webTaskResult(JSON.stringify({ xmTaskId: 'current-token', result: nested.result }), 'current-token', manual), JSON.stringify(result));
  }
  assert.equal(webTaskResult(JSON.stringify({ result }), 'current-token'), null);
  assert.equal(webTaskResult(JSON.stringify({ result }), 'current-token', true), JSON.stringify(result));
  assert.equal(webTaskResult(JSON.stringify({ ...result, xmTaskId: 'current-token' }), 'current-token'), JSON.stringify(result));
  const prompt = webTaskPrompt([{ content: '只返回分段方案。' }], 'current-token');
  assert.match(prompt, /"xmTaskId":"current-token","result":/);
  assert.match(prompt, /两个并列字段/);
});

test('nested DeepSeek task marker advances from completed segmentation to music matching', async () => {
  const planned = segments.map(({ score, ...segment }) => segment);
  let token = 0, time = 0, sends = 0, reads = 0;
  const stages = [];
  const host = createWebAnalysis({ uuid: () => `nested-${++token}`, now: () => time, delay: async () => { time += 1500; }, notify: state => { if (state) stages.push(state.stage); }, copy: async () => {}, driver: {
    visible: () => true,
    async run(_provider, command) {
      if (command.command === 'fill') return { state: 'filled' };
      if (command.command === 'send') { sends++; return { state: 'sent' }; }
      reads++;
      const result = token === 1 ? { segments: planned } : { segments: [
        { id: 'segment-1', matches: [] },
        { id: 'segment-2', matches: [{ id: 'piano', reason: '适合温暖的情绪转折', keywords: ['温暖'] }] },
      ] };
      return { texts: [JSON.stringify({ result: { ...result, xmTaskId: command.token } })], busy: false };
    },
  } });
  const result = await host.run({ id: 'request-nested-123', provider: 'deepseek', purpose: 'library-match', input: { ...input, segmented: true } });
  assert.equal(sends, 2); assert.equal(token, 2);
  assert.equal(result.segments[1].matches[0].id, 'piano');
  assert(stages.includes('匹配各情节的本地音乐'));
  assert(reads < 12, 'completed response should proceed within a few polling cycles');
  assert.equal(host.snapshot(), null);
});
test('web driver waits for login, sends each step once, accepts only stable current response', async () => {
  let host, time = 0, fills = 0, sends = 0, reads = 0; const events = [];
  host = createWebAnalysis({ now: () => time, delay: async () => { time += 1500; }, uuid: () => 'current-token', notify: state => events.push(state), copy: async () => {}, driver: {
    visible: () => true,
    async run(_provider, command) {
      if (command.command === 'fill') return ++fills === 1 ? { state: 'login', message: 'login required' } : { state: 'filled' };
      if (command.command === 'send') { sends++; return { state: 'sent' }; }
      reads++; return { texts: sends ? [JSON.stringify({ xmTaskId: 'current-token', result: analysis })] : [], busy: reads < 4 };
    },
  } });
  const result = await host.run({ id: 'request-123', provider: 'deepseek', purpose: 'library-match', input: { ...input, tracks: [] } });
  assert.equal(result.analysis.summary, analysis.summary); assert.equal(sends, 1); assert.equal(fills, 2); assert.equal(host.snapshot(), null); assert.equal(events.at(-1), null);
  assert(events.some(e => e?.message === 'login required'));
});
test('cancellation stops waiting, rejects concurrent tasks and does not send a hidden page', async () => {
  let host, calls = 0;
  host = createWebAnalysis({ notify: () => {}, copy: async () => {}, driver: { visible: () => false, run: async () => { calls++; } }, delay: async () => { await assert.rejects(host.run({ id: 'request-999', provider: 'doubao', purpose: 'score', input }), /已有/); await host.action('request-123', 'cancel'); } });
  await assert.rejects(host.run({ id: 'request-123', provider: 'doubao', purpose: 'score', input }), /中断/);
  assert.equal(calls, 0); assert.equal(host.snapshot(), null);
});
test('manual fallback works without resending or accepting a different task response', async () => {
  let host, step = 0;
  host = createWebAnalysis({ notify: () => {}, copy: async () => {}, driver: { visible: () => true, run: async () => { throw new Error('DOM changed'); } }, delay: async () => {
    if (++step === 1) {
      await assert.rejects(host.action('request-123', 'import', JSON.stringify({ xmTaskId: 'wrong', result: analysis })), /没有找到/);
      await host.action('request-123', 'import', JSON.stringify(analysis));
    }
  } });
  const result = await host.run({ id: 'request-123', provider: 'doubao', purpose: 'library-match', input: { ...input, tracks: [] } });
  assert.equal(result.analysis.summary, analysis.summary);
});
test('rate-limited website stops analysis without submitting or automatically retrying', async () => {
  let calls = 0;
  const host = createWebAnalysis({ notify: () => {}, copy: async () => {}, driver: { visible: () => true, run: async () => { calls++; return { state: 'limited', message: '官网提示访问频繁，请稍后再试。' }; } }, delay: async () => { throw new Error('must not poll again'); } });
  await assert.rejects(host.run({ id: 'request-123', provider: 'doubao', purpose: 'score', input }), /访问频繁/);
  assert.equal(calls, 1); assert.equal(host.snapshot(), null);
});
test('a stalled page call can be cancelled without waiting for the page', { timeout: 1000 }, async () => {
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const host = createWebAnalysis({ notify: () => {}, copy: async () => {}, driver: { visible: () => true, run: () => { started(); return new Promise(() => {}); } } });
  const pending = host.run({ id: 'request-123', provider: 'doubao', purpose: 'score', input });
  const rejected = assert.rejects(pending, /中断/);
  await ready;
  await host.action('request-123', 'cancel');
  await rejected;
  assert.equal(host.snapshot(), null);
});
test('a stalled fill times out without resubmission and allows manual recovery', { timeout: 1000 }, async () => {
  let host; const calls = [], notices = [];
  host = createWebAnalysis({ pageTimeoutMs: 10, notify: value => notices.push(value), copy: async () => {}, driver: { visible: () => true, run: (_provider, command) => { calls.push(command.command); return new Promise(() => {}); } },
    delay: async () => { await host.action('request-123', 'import', JSON.stringify(analysis)); },
  });
  const result = await host.run({ id: 'request-123', provider: 'doubao', purpose: 'library-match', input: { ...input, tracks: [] } });
  assert.equal(result.analysis.summary, analysis.summary);
  assert.deepEqual(calls, ['fill']);
  assert(notices.some(value => /响应超时/.test(value?.message)));
});
test('visible login and rate-limit notices prevent DOM prompt writes and sends', () => {
  let clicks = 0;
  const item = text => ({ innerText: text, getClientRects: () => [1], closest: () => null, getAttribute: () => '', click: () => clicks++ });
  let alerts = [], buttons = [item('登录')];
  const context = { location: { protocol: 'https:', hostname: 'www.doubao.com' }, getComputedStyle: () => ({ visibility: 'visible' }), document: { querySelectorAll: selector => selector.startsWith('[role="alert"') ? alerts : selector.startsWith('button') ? buttons : [] } };
  const run = command => vm.runInNewContext(webAIPageScript({ command, prompt: 'script', token: 'task', host: 'www.doubao.com' }), context);
  assert.equal(run('fill').state, 'login'); assert.equal(clicks, 0);
  run('login'); assert.equal(clicks, 1);
  alerts = [item('当前服务访问频繁，请稍后重试')];
  assert.equal(run('send').state, 'limited'); assert.equal(clicks, 1);
  context.location.hostname = 'accounts.example.com'; assert.equal(run('send').state, 'login'); assert.equal(clicks, 1);
});
test('DOM integration preserves existing drafts and fills exact Unicode text before one send', () => {
  class Textarea { constructor(value = '') { this._value = value; } get value() { return this._value; } set value(value) { this._value = value; } getClientRects() { return [1]; } closest() { return null; } focus() {} dispatchEvent() {} }
  const editor = new Textarea('unsent draft'); editor.tagName = 'TEXTAREA'; let clicks = 0;
  const button = { getClientRects: () => [1], closest: () => null, getAttribute: name => name === 'aria-label' ? '发送' : '', click: () => clicks++ };
  const context = { HTMLTextAreaElement: Textarea, InputEvent: class {}, getComputedStyle: () => ({ visibility: 'visible' }), document: { querySelectorAll: selector => selector.startsWith('textarea') ? [editor] : selector.startsWith('button') ? [button] : [] } };
  const run = command => vm.runInNewContext(webAIPageScript({ command, prompt: 'My fiancée, José.\nNew line.', token: 'task123' }), context);
  assert.equal(run('fill').state, 'draft'); assert.equal(editor.value, 'unsent draft'); assert.equal(clicks, 0);
  editor.value = ''; assert.equal(run('fill').state, 'filled'); assert.equal(editor.value, 'My fiancée, José.\nNew line.'); assert.equal(clicks, 0);
  assert.equal(run('send').state, 'sent'); assert.equal(clicks, 1);
});
test('queue resolves official web analyzer without API keys; failed analysis cannot submit Suno', async () => {
  const suno = { providerId: 'suno', protocol: 'suno', baseUrl: 'https://fixture.test', model: 'suno-test' }; let planned = 0, submitted = 0;
  const options = { save: () => {}, getProvider: id => id === 'suno' ? { ...suno, apiKey: 'suno-test-only' } : null, request: async (url, body) => { if (url.endsWith('/score')) { planned++; assert.equal(body.provider.apiKey, undefined); assert.equal(body.provider.webId, 'deepseek'); return { score }; } submitted++; return { tracks: [{ id: 'paid-once', taskId: 'paid-once', status: 'pending' }] }; } };
  const queue = createScriptQueue(options); queue.add(input, WEB_ANALYZERS[0], suno); queue.start(); await queue.tick();
  assert.equal(planned, 1); assert.equal(submitted, 0); assert.equal(queue.snapshot().jobs[0].status, 'ready');
  await queue.tick(); assert.equal(submitted, 1);
  const failed = createScriptQueue({ ...options, request: async () => { throw new Error('网页分析已中断'); } }); failed.add(input, WEB_ANALYZERS[1], suno); failed.start(); await failed.tick();
  assert.equal(failed.snapshot().jobs[0].status, 'error'); assert.equal(failed.snapshot().running, false); assert.equal(submitted, 1);
});
test('renderer routes webpage analysis without HTTP or API credentials and cancels on abort', async () => {
  const originalFetch = globalThis.fetch; globalThis.fetch = () => { throw new Error('must not use HTTP'); };
  let captured, finish; const cancelled = [];
  globalThis.blackObsidian = { analyzeWebScript: request => { captured = request; return new Promise(resolve => { finish = resolve; }); }, webAnalysisAction: async (...args) => cancelled.push(args) };
  try {
    const controller = new AbortController(); const promise = requestScriptAnalysis('score', { ...input, provider: { ...WEB_ANALYZERS[1].provider, apiKey: 'must-not-pass' }, model: '豆包' }, controller.signal);
    assert.equal(captured.provider, 'doubao'); assert.equal(captured.input.provider, undefined); assert.doesNotMatch(JSON.stringify(captured), /must-not-pass/);
    controller.abort(); assert.equal(cancelled[0][0], captured.id); assert.equal(cancelled[0][1], 'cancel'); finish({ score }); await promise;
  } finally { globalThis.fetch = originalFetch; }
});

const saved = new Map(); globalThis.localStorage = { getItem: key => saved.get(key) || null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) };
let slots = [], cursor = 0;
globalThis.i = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }), useState(initial) { const at = cursor++; if (!(at in slots)) slots[at] = typeof initial === 'function' ? initial() : initial; return [slots[at], value => { slots[at] = value; }]; }, useRef: value => ({ current: value }), useEffect: () => {}, useMemo: fn => fn(), useSyncExternalStore: (_subscribe, snapshot) => snapshot() };
const built = await build({ entryPoints: ['app/src/upgrade.jsx'], bundle: true, write: false, format: 'esm', jsxFactory: 'i.createElement', jsxFragment: 'i.Fragment' });
const ui = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...(tree.children || []).flat(Infinity).flatMap(nodes)];
const textOf = tree => typeof tree === 'string' ? tree : (tree?.children || []).flat(Infinity).map(textOf).join('');
test('workspace selector includes built-in websites and updates step, guide and matching button labels', () => {
  const props = { providers: [{ id: 'g', protocol: 'gemini', name: 'Gemini API', apiKey: 'secret', models: ['gemini-3.7-flash-thinking-high'] }], automation: { queue: {}, jobs: [], running: false }, onNavigate: () => {} };
  const render = () => { cursor = 0; return ui.ScriptAutomation(props); };
  let tree = render(); const picker = nodes(tree).find(n => n.props['aria-label'] === '剧本分析模型');
  assert.match(textOf(picker), /DeepSeek 官方网页版 · 无需配置/); assert.match(textOf(picker), /豆包 官方网页版 · 无需配置/);
  for (const model of [WEB_ANALYZERS[0], WEB_ANALYZERS[1], { key: 'g::gemini-3.7-flash-thinking-high', model: 'gemini-3.7-flash-thinking-high' }]) {
    picker.props.onChange({ target: { value: model.key } }); tree = render(); const name = analysisName(model);
    assert.match(textOf(tree), /AI 分析剧本/);
    assert.match(textOf(picker), /gemini-3\.7-flash-thinking-high/);
    assert.doesNotMatch(textOf(tree).replace(textOf(picker), ''), /gemini-3\.7-flash-thinking-high/);
    const libraryNode = nodes(tree).find(n => typeof n.type === 'function' && n.props.onAnalysis && n.props.segmentJob);
    assert(libraryNode); slots = []; cursor = 0;
    const library = libraryNode.type(libraryNode.props);
    assert.match(textOf(library), new RegExp(name + ' 识别剧本关键词并匹配'));
    const localPicker = nodes(library).find(n => n.props['aria-label'] === '本地匹配分析模型');
    assert.match(textOf(localPicker), /gemini-3\.7-flash-thinking-high/);
    assert.doesNotMatch(textOf(library).replace(textOf(localPicker), ''), /gemini-3\.7-flash-thinking-high/);
    const sunoPanel = nodes(tree).find(n => n.props.className === 'bos-script-panel bos-script-config');
    assert.match(textOf(sunoPanel), /02 \/ Suno 生成配乐/);
    assert.doesNotMatch(textOf(sunoPanel), /本地音乐匹配|剪映素材文件夹|选用已有音乐/);
    assert.match(textOf(sunoPanel), /音乐保存目录/);
    if (!model.key.startsWith('webai:')) assert.equal(name, 'Gemini');
    slots = [];
  }
});

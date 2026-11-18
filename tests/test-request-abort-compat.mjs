import test from 'node:test';
import assert from 'node:assert/strict';
import { createAbortScope, withAbortScope, abortReason, throwIfAborted } from '../app/shared/request-abort.mjs';
import { createApiService } from '../app/shared/api-service.mjs';
import { requestScriptAnalysis } from '../app/src/AnalysisRequest.mjs';
import { requestJianyingAI } from '../app/electron/jianying-ai.mjs';

test('request scopes work without modern AbortSignal methods', async t => {
  const saved = [
    [AbortSignal, 'timeout'], [AbortSignal, 'any'], [AbortSignal.prototype, 'throwIfAborted'],
  ].map(([target, name]) => ({ target, name, descriptor: Object.getOwnPropertyDescriptor(target, name) }));
  for (const { target, name } of saved) Object.defineProperty(target, name, { configurable: true, value: undefined });
  try {
    await t.test('success, failure, and disposal release timers and parent listeners', async t => {
      const timers = new Set();
      t.mock.method(globalThis, 'setTimeout', (fn, ms) => { const timer = { fn, ms, unref() {} }; timers.add(timer); return timer; });
      t.mock.method(globalThis, 'clearTimeout', timer => timers.delete(timer));
      const parent = new AbortController();
      const add = t.mock.method(parent.signal, 'addEventListener');
      const remove = t.mock.method(parent.signal, 'removeEventListener');
      assert.equal(await withAbortScope({ timeoutMs: 100, signals: [parent.signal, parent.signal] }, async () => 'ok'), 'ok');
      assert.equal(timers.size, 0);
      assert.equal(add.mock.callCount(), 1);
      assert.equal(remove.mock.callCount(), 1);
      await assert.rejects(withAbortScope({ timeoutMs: 100, signals: [parent.signal] }, async () => { throw new Error('fixture failure'); }), /fixture failure/);
      assert.equal(timers.size, 0);
      assert.equal(remove.mock.callCount(), 2);
      parent.abort();
    });

    await t.test('deadlines abort once and release every parent listener', t => {
      let fire;
      t.mock.method(globalThis, 'setTimeout', fn => { fire = fn; return { unref() {} }; });
      const cleared = t.mock.method(globalThis, 'clearTimeout', () => {});
      const parents = [new AbortController(), new AbortController()];
      const removed = parents.map(parent => t.mock.method(parent.signal, 'removeEventListener'));
      const scope = createAbortScope({ timeoutMs: 10, signals: parents.map(parent => parent.signal) });
      let aborts = 0; scope.signal.addEventListener('abort', () => aborts++);
      fire(); parents[0].abort(); scope.dispose();
      assert.equal(aborts, 1);
      assert.equal(abortReason(scope.signal).name, 'TimeoutError');
      assert.throws(() => throwIfAborted(scope.signal), { name: 'TimeoutError' });
      assert.equal(cleared.mock.callCount(), 1);
      assert.ok(removed.every(mock => mock.mock.callCount() === 1));
    });

    await t.test('user cancellation retains its reason and pre-aborted work is never started', async () => {
      const parent = new AbortController(), reason = new Error('fixture cancellation');
      const scope = createAbortScope({ signals: [parent.signal] });
      parent.abort(reason);
      assert.equal(abortReason(scope.signal), reason);
      await assert.rejects(withAbortScope({ timeoutMs: 100, signals: [parent.signal] }, () => assert.fail('must not send')), error => error === reason);
      scope.dispose();
    });

    await t.test('cancellation during the response body cannot save a late success', async () => {
      const parent = new AbortController();
      const api = createApiService(async () => ({ ok: true, status: 200, text: async () => {
        parent.abort(); return JSON.stringify({ message: { content: 'OK' } });
      } }));
      await assert.rejects(api('/api/script/batch-library-match', { provider: { protocol: 'ollama' }, model: 'qwen3.5:4b', tracks: [], episodes: [{ id: 'ep2', episodeNumber: 2, script: '母女重逢。' }] }, parent.signal), { name: 'AbortError' });
    });

    await t.test('local model listing and three-part music analysis reach fetch and retain Chinese reasons', async t => {
      const provider = { protocol: 'ollama', models: ['qwen3.5:4b'] };
      const tracks = [{ id: 'warm', title: '温暖治愈_钢琴' }, { id: 'dark', title: '黑暗压抑_弦乐' }];
      const reasons = ['母亲轻轻抱住女儿，温暖钢琴对应康复重逢后的亲情与释然。', '母女说好一起回家，温暖治愈的曲名对应团聚后的安心。', '母女牵手走出医院，温暖钢琴对应重新开始生活的希望。'];
      let calls = 0;
      const api = createApiService(async (url, options) => {
        assert.ok(options.signal instanceof AbortSignal);
        assert.equal(options.signal.aborted, false);
        if (options.method === 'GET') return Response.json({ data: [{ id: 'qwen3.5:4b' }] });
        assert.equal(String(url), 'http://127.0.0.1:11435/api/chat');
        const body = JSON.parse(options.body);
        assert.equal(body.think, false);
        const rows = JSON.parse(body.messages[1].content).episodes;
        const reply = ++calls === 1 ? { episodes: rows.map(row => ({ id: row.id, summary: '母女在医院团聚后一起回家。', keywords: ['温暖'], segments: reasons.map((summary, n) => ({ title: `团聚${n + 1}`, startLine: n + 1, endLine: n + 1, summary, keywords: ['温暖'] })) })) }
          : { episodes: rows.map(row => ({ id: row.id, segments: row.segments.map((segment, n) => ({ id: segment.id, matches: [{ ref: segment.candidates.find(item => item.title.includes('温暖')).ref, evidenceLine: n + 1, reason: reasons[n] }], noMatchReason: '其他候选曲名情绪压抑，不适合亲情重逢。' })) })) };
        return Response.json({ message: { content: JSON.stringify(reply) }, done_reason: 'stop' });
      });
      assert.deepEqual((await api('/api/providers/models', { provider })).body.models, ['qwen3.5:4b']);
      t.mock.method(globalThis, 'fetch', async (url, options) => {
        const result = await api(url, JSON.parse(options.body), options.signal);
        return Response.json(result.body, { status: result.status });
      });
      const result = await requestScriptAnalysis('batch-library-match', { provider, model: 'qwen3.5:4b', tracks, segmented: true, segmentCount: 3,
        episodes: [{ id: 'ep2', episodeNumber: 2, script: '母亲轻轻抱住康复的女儿。\n女儿说妈妈我们一起回家。\n母女牵手走出医院。' }] }, new AbortController().signal);
      assert.equal(calls, 2);
      assert.equal(result.episodes[0].value.segments.length, 3);
      assert.deepEqual(result.episodes[0].value.segments.map(segment => segment.matches[0].id), ['warm', 'warm', 'warm']);
      assert.ok(result.episodes[0].value.segments.every((segment, n) => segment.matches[0].reason.endsWith(reasons[n])));
    });

    await t.test('official webpage analysis still bypasses API fetch', async t => {
      const { WEB_ANALYZERS } = await import('../app/shared/script-analyzers.mjs');
      const model = WEB_ANALYZERS[0];
      let calls = 0;
      t.mock.method(globalThis, 'fetch', () => assert.fail('web analysis must not call API'));
      const previous = globalThis.blackObsidian;
      globalThis.blackObsidian = { analyzeWebScript: async request => { calls++; assert.equal(request.provider, model.provider.webId); return { matches: [] }; } };
      try { await requestScriptAnalysis('library-match', { provider: model.provider, model: model.model, script: '测试' }); }
      finally { globalThis.blackObsidian = previous; }
      assert.equal(calls, 1);
    });

    await t.test('AI draft scanning uses compatible total and attempt deadlines', async () => {
      const result = await requestJianyingAI({ provider: { protocol: 'gemini', apiKey: 'fixture', baseUrl: 'https://example.invalid/v1beta' }, model: 'gemini-fixture' }, { prompt: 'fixture' }, null,
        async () => Response.json({ candidates: [{ content: { parts: [{ text: 'fixture-ok' }] } }] }));
      assert.equal(result, 'fixture-ok');
    });
  } finally {
    for (const { target, name, descriptor } of saved) {
      if (descriptor) Object.defineProperty(target, name, descriptor); else delete target[name];
    }
  }
});

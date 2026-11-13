import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiService } from '../app/shared/api-service.mjs';
import { isScriptAnalysisModel } from '../app/shared/script-score.mjs';
import { analysisName } from '../app/shared/script-analyzers.mjs';
import { LOCAL_MODEL_OPTIONS, recommendLocalModel } from '../app/src/LocalModelRecommendations.mjs';
import { createWebAnalysis } from '../app/electron/web-ai-analysis.mjs';
import { webAIProvider, isWebAIPage } from '../app/shared/web-ai.mjs';

test('local Qwen is an installed-model option, uses only loopback, and disables thinking', async () => {
  const provider = { id: 'local', protocol: 'ollama', baseUrl: 'https://wrong.example/v1', models: ['qwen3.5:4b'] };
  assert.ok(LOCAL_MODEL_OPTIONS.some(item => item.id === 'qwen3.5:4b'));
  assert.equal(recommendLocalModel({ ramGB: 32, vramGB: 8 }, 'qwen').id, 'qwen3.5:4b');
  assert.equal(isScriptAnalysisModel(provider, 'qwen3.5:4b'), true);
  assert.equal(isScriptAnalysisModel(provider, 'qwen3.5:cloud'), false);
  assert.equal(analysisName({ provider, model: 'qwen3.5:4b' }), '千问 本地');
  const api = createApiService(async (url, options) => {
    assert.equal(String(url), 'http://127.0.0.1:11435/api/chat');
    assert.equal(options.headers.Authorization, undefined);
    const body = JSON.parse(options.body);
    assert.equal(body.think, false);
    assert.equal(body.model, 'qwen3.5:4b');
    return Response.json({ message: { content: 'OK' }, done_reason: 'stop' });
  });
  assert.equal((await api('/api/providers/test', { provider, model: 'qwen3.5:4b' })).body.preview, 'OK');
});

test('DeepSeek relay uses the supplied endpoint and its own key for model listing and batch JSON', async () => {
  const provider = { id: 'relay', protocol: 'deepseek-relay', baseUrl: 'https://relay.example/service/v1/', apiKey: 'relay-key', models: ['deepseek-chat'] };
  assert.equal(isScriptAnalysisModel(provider, 'deepseek-chat'), true);
  assert.equal(analysisName({ provider, model: 'deepseek-chat' }), 'DeepSeek 中转 API');
  const calls = [];
  const api = createApiService(async (url, options) => {
    calls.push(String(url));
    assert.equal(options.headers.Authorization, 'Bearer relay-key');
    if (options.method === 'GET') return Response.json({ data: [{ id: 'deepseek-chat' }] });
    const body = JSON.parse(options.body);
    assert.deepEqual(body.response_format, { type: 'json_object' });
    return Response.json({ choices: [{ message: { content: JSON.stringify({ episodes: [{ id: 'episode-1', summary: '发现线索，气氛紧张。', keywords: ['悬疑'] }] }) }, finish_reason: 'stop' }] });
  });
  await api('/api/providers/models', { provider });
  const result = await api('/api/script/batch-library-match', { provider, model: 'deepseek-chat', episodes: [{ id: 'episode-1', episodeNumber: 1, script: '发现线索。' }], tracks: [] });
  assert.equal(result.body.episodes[0].id, 'episode-1');
  assert.deepEqual(calls, ['https://relay.example/service/v1/models', 'https://relay.example/service/v1/chat/completions']);
});

test('Qwen webpage analysis only accepts manual imports without reading, filling or sending', async () => {
  assert.equal(webAIProvider('qwen').url, 'https://www.qianwen.com/');
  assert.equal(isWebAIPage('qwen', 'https://www.qianwen.com/'), true);
  assert.equal(isWebAIPage('qwen', 'https://qianwen.com.evil.test/'), false);
  let time = 0, counter = 0, imported = false;
  const host = createWebAnalysis({
    uuid: () => `qwen-manual-${++counter}`, now: () => time,
    driver: { visible: () => true, run: () => { throw new Error('must never automate Qwen'); } },
    copy: async () => {}, notify: () => {},
    delay: async ms => {
      time += ms;
      const task = host.snapshot();
      if (task && !imported) {
        imported = true;
        assert.equal(task.manualOnly, true);
        assert.equal(task.requiresPaste, true);
        await host.action('qwen-request-123', 'import', JSON.stringify({ xmTaskId: task.token, result: { summary: '发现线索，悬疑氛围增强。', keywords: ['悬疑'] } }));
      }
    },
  });
  const result = await host.run({ id: 'qwen-request-123', provider: 'qwen', purpose: 'library-match', input: { script: '女主发现秘密合同。', tracks: [] } });
  assert.equal(result.analysis.keywords[0], '悬疑');
  assert.equal(host.snapshot(), null);
});

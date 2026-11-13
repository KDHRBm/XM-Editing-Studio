import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiService } from '../app/shared/api-service.mjs';
import { isScriptAnalysisModel } from '../app/shared/script-score.mjs';
import { analysisName, analysisReady } from '../app/shared/script-analyzers.mjs';
import { batchAnalyzers } from '../app/src/BatchAnalysisStore.mjs';
import { score, script } from './script-test-fixtures.mjs';

const provider = { id: 'qwen-official', name: '千问官方 API', protocol: 'qwen', baseUrl: 'https://untrusted.example/v1', apiKey: 'fixture-qwen-secret', models: ['qwen-plus'] };
const completion = (value, finish_reason = 'stop') => Response.json({ choices: [{ message: { content: typeof value === 'string' ? value : JSON.stringify(value) }, finish_reason }] });
const episodes = [1, 4].map(n => ({ id: `episode-${n}`, episodeNumber: n, title: `第${n}集`, script: '雨夜发现线索。\n真相浮现，矛盾升级。' }));
const tracks = Array.from({ length: 6 }, (_, i) => ({ id: `track-${i}`, title: `悬疑弦乐 ${i}` }));

test('Qwen lists supported text models from the fixed official origin with a header-only key', async () => {
  let request;
  const api = createApiService(async (url, options) => {
    request = { url: String(url), options };
    return Response.json({ data: ['qwen-plus', 'qwen-flash', 'qwen-plus-2025-07-28', 'qwen3.5-plus', 'qwen-plus', 'qwen-vl-max', 'qwen-image', 'qwen3-embedding-8b', 'qwen3-omni-flash', 'deepseek-flash'].map(id => ({ id })) });
  });
  const result = await api('/api/providers/models', { provider });
  assert.deepEqual(result.body.models, ['qwen-plus', 'qwen-flash', 'qwen-plus-2025-07-28', 'qwen3.5-plus']);
  assert.equal(request.url, 'https://dashscope.aliyuncs.com/compatible-mode/v1/models');
  assert.equal(request.options.headers.Authorization, `Bearer ${provider.apiKey}`);
  assert.equal(request.options.method, 'GET');
  assert.doesNotMatch(request.url, /untrusted|secret/);
});

test('Qwen is selectable for analysis and retains independent provider identity', () => {
  for (const model of ['qwen-plus', 'qwen-turbo', 'qwen-max-latest', 'qwen3.5-plus']) assert.equal(isScriptAnalysisModel(provider, model), true);
  for (const model of ['qwen-vl-plus', 'qwen-plus-audio', 'qwq-plus', 'deepseek-flash']) assert.equal(isScriptAnalysisModel(provider, model), false);
  const selected = batchAnalyzers([provider]).find(item => item.key === 'qwen-official::qwen-plus');
  assert.ok(selected);
  assert.equal(analysisName(selected), '千问 API');
  assert.equal(analysisReady(selected), true);
  assert.equal(analysisReady({ provider: { protocol: 'qwen', apiKey: '' } }), false);
  assert.equal(isScriptAnalysisModel({ protocol: 'custom' }, 'qwen-plus'), false);
});

test('Qwen connection test uses non-thinking mode and does not require a Base URL', async () => {
  const api = createApiService(async (url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(String(url), 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
    assert.equal(body.enable_thinking, false);
    assert.equal(body.response_format, undefined);
    assert.equal(body.model, 'qwen-plus');
    assert.doesNotMatch(options.body, /fixture-qwen-secret/);
    return completion('OK');
  });
  const result = await api('/api/providers/test', { provider: { ...provider, baseUrl: '' }, model: 'qwen-plus' });
  assert.equal(result.body.ok, true);
  assert.equal(result.body.preview, 'OK');
});

test('Qwen single script scoring and local-library matching request JSON throughout', async () => {
  let count = 0;
  const api = createApiService(async (_url, options) => {
    count++;
    const body = JSON.parse(options.body);
    assert.deepEqual(body.response_format, { type: 'json_object' });
    assert.equal(body.enable_thinking, false);
    assert.equal(body.max_tokens, 8192);
    assert.match(JSON.stringify(body.messages), /json/i);
    const input = JSON.parse(body.messages.find(item => item.role === 'user').content);
    return completion(input.editedLines ? score : input.musicTitles
      ? { matches: [{ id: 'piano', reason: '钢琴配乐承接雨夜和解的温暖情绪。', keywords: ['钢琴'] }] }
      : { summary: '雨夜误会逐渐化解，配乐转为温暖。', keywords: ['雨夜', '钢琴'] });
  });
  assert.equal((await api('/api/script/score', { provider, model: 'qwen-plus', script, durationSeconds: 90 })).body.score.title, score.title);
  const matching = await api('/api/script/library-match', { provider, model: 'qwen-plus', script, tracks: [{ id: 'piano', title: '雨夜钢琴' }] });
  assert.equal(matching.body.matches[0].id, 'piano');
  assert.equal(count, 3);
});

test('Qwen single-script segmented library planning includes the required JSON instruction', async () => {
  let count = 0;
  const api = createApiService(async (_url, options) => {
    count++;
    const body = JSON.parse(options.body);
    assert.deepEqual(body.response_format, { type: 'json_object' });
    assert.match(body.messages.map(message => message.content).join(' '), /json/i);
    return completion({ segments: [{ title: '发现线索', startLine: 1, endLine: 2, summary: '雨夜发现线索后，悬疑情绪不断加强。', keywords: ['悬疑', '弦乐'] }] });
  });
  const result = await api('/api/script/library-match', { provider, model: 'qwen-plus', script: episodes[0].script, tracks: [], segmented: true, segmentCount: 2 });
  assert.equal(result.body.segments.length, 1);
  assert.equal(count, 1);
});

for (const segmented of [false, true]) test(`Qwen batch matching validates local candidate references, segmented=${segmented}`, async () => {
  const stages = [];
  let count = 0;
  const api = createApiService(async (_url, options) => {
    count++;
    const body = JSON.parse(options.body), input = JSON.parse(body.messages[1].content);
    assert.equal(body.enable_thinking, false);
    assert.deepEqual(body.response_format, { type: 'json_object' });
    assert.match(body.messages[0].content, /json/i);
    if (count === 1) return completion({ episodes: input.episodes.map(episode => ({ id: episode.id, summary: '雨夜发现线索，真相浮现后矛盾升级，以悬疑弦乐逐步推进紧张情绪。', keywords: ['悬疑', '弦乐'], ...(segmented ? { segments: [{ title: '发现线索', startLine: 1, endLine: 2, summary: '雨夜发现线索，真相浮现引发冲突。', keywords: ['悬疑', '弦乐'] }] } : {}) })) });
    const pick = unit => {
      assert.ok(unit.candidates.every(track => track.ref && !track.id));
      return { id: unit.id, matches: [...unit.candidates.slice(0, 5).map(track => ({ ref: track.ref, reason: '悬疑弦乐衬托雨夜发现线索后的紧张冲突。' })), ...(count === 2 ? [{ ref: 'invented-not-in-library', reason: '悬疑弦乐衬托紧张情绪。' }] : [])] };
    };
    return completion({ episodes: input.episodes.map(episode => segmented ? { id: episode.id, segments: episode.segments.map(pick) } : pick(episode)) });
  }, (id, phase) => stages.push([id, phase]));
  const result = await api('/api/script/batch-library-match', { provider, model: 'qwen-plus', episodes, tracks, segmented, segmentCount: 2, progressId: 'qwen-batch' });
  assert.equal(result.status, 200);
  assert.equal(result.body.episodes.length, 2);
  for (const episode of result.body.episodes) {
    const matches = segmented ? episode.value.segments[0].matches : episode.value.matches;
    assert.deepEqual(matches.map(match => match.id), tracks.slice(0, 5).map(track => track.id));
  }
  assert.equal(count, 3, 'an invalid reference triggers exactly one bounded repair');
  assert.deepEqual(stages, [['qwen-batch', 'keywords'], ['qwen-batch', 'matching'], ['qwen-batch', 'review']]);
});

test('Qwen rejects blank/truncated responses and reports errors without exposing the key or replaying', async () => {
  for (const [text, finish, expected] of [['', 'stop', /千问 API.*空白/], ['{"episodes":[', 'length', /千问 API.*长度上限/]]) {
    const api = createApiService(async () => completion(text, finish));
    await assert.rejects(api('/api/script/batch-library-match', { provider, model: 'qwen-plus', episodes, tracks }), expected);
  }
  for (const status of [401, 403, 429]) {
    let count = 0;
    const api = createApiService(async () => { count++; return Response.json({ error: { message: `Rejected ${provider.apiKey}` } }, { status }); });
    await assert.rejects(api('/api/providers/test', { provider, model: 'qwen-plus' }), error => {
      assert.match(error.message, new RegExp(String(status)));
      assert.doesNotMatch(error.message, /fixture-qwen-secret/);
      return true;
    });
    assert.equal(count, 1);
  }
});

test('missing Qwen key and cancelled work make no upstream request', async () => {
  const api = createApiService(async () => { throw new Error('Must not call upstream'); });
  await assert.rejects(api('/api/providers/test', { provider: { ...provider, apiKey: '' }, model: 'qwen-plus' }), /API 密钥/);
  await assert.rejects(api('/api/script/batch-library-match', { provider, model: 'qwen-plus', episodes, tracks }, AbortSignal.abort()), { name: 'AbortError' });
});

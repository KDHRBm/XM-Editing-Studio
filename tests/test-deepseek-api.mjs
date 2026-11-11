import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiService } from '../app/shared/api-service.mjs';
import { isScriptAnalysisModel } from '../app/shared/script-score.mjs';
import { batchAnalyzers } from '../app/src/BatchAnalysisStore.mjs';
import { analyzeBatchMusic, batchKeywordMessages, batchMatchMessages } from '../app/shared/batch-music.mjs';
import { score, script } from './script-test-fixtures.mjs';

const provider = { id: 'deepseek-official', name: 'DeepSeek 官方 API', protocol: 'deepseek', baseUrl: 'https://untrusted.example/v1', apiKey: 'fixture-secret', models: ['deepseek-flash'] };

test('official DeepSeek model list uses fixed HTTPS origin and Bearer key', async () => {
  const calls = [];
  const api = createApiService(async (url, options) => {
    calls.push({ url: new URL(url), options });
    return Response.json({ data: [{ id: 'deepseek-flash' }, { id: 'deepseek-v4-pro' }, { id: 'deepseek-embedding' }] });
  });
  const result = await api('/api/providers/models', { provider });
  assert.deepEqual(result.body.models, ['deepseek-flash', 'deepseek-v4-pro']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.href, 'https://api.deepseek.com/models');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer fixture-secret');
  assert.doesNotMatch(calls[0].url.href, /fixture-secret|untrusted/);
});

test('official DeepSeek can be selected for script, local music and batch analysis', async () => {
  assert.equal(isScriptAnalysisModel(provider, 'deepseek-flash'), true);
  assert.equal(isScriptAnalysisModel(provider, 'not-a-deepseek-model'), false);
  assert.equal(isScriptAnalysisModel({ protocol: 'suno' }, 'suno-test'), false);
  assert.equal(batchAnalyzers([provider]).some(item => item.key === 'deepseek-official::deepseek-flash'), true);
  const calls = [];
  const api = createApiService(async (url, options) => {
    calls.push({ url: new URL(url), options, body: JSON.parse(options.body) });
    return Response.json({ choices: [{ message: { content: JSON.stringify({ episodes: [{ id: 'episode-1', summary: '雨夜相遇后产生误会，情绪从疑惑转向紧张。', keywords: ['悬疑', '弦乐'] }] }) } }] });
  });
  const result = await api('/api/script/batch-library-match', { provider, model: 'deepseek-flash', episodes: [{ id: 'episode-1', episodeNumber: 1, title: '第1集', script: '雨夜相遇，双方误会。' }], tracks: [] });
  assert.equal(result.body.episodes[0].id, 'episode-1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.href, 'https://api.deepseek.com/chat/completions');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer fixture-secret');
  assert.equal(calls[0].body.model, 'deepseek-flash');
  assert.equal(calls[0].body.max_tokens, 8192);
  assert.deepEqual(calls[0].body.response_format, { type: 'json_object' });
  assert.doesNotMatch(JSON.stringify(calls[0].body), /fixture-secret/);
});

test('official DeepSeek scores a script and matches a local library through the API', async () => {
  const calls = [];
  const api = createApiService(async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url: new URL(url), body });
    const user = JSON.parse(body.messages.find(item => item.role === 'user').content);
    const content = user.editedLines ? score : user.musicTitles
      ? { matches: [{ id: 'piano', reason: '钢琴适合雨夜转暖的情绪。', keywords: ['钢琴'] }] }
      : { summary: '雨夜的误会逐渐化解，情绪转为温暖。', keywords: ['雨夜', '钢琴'] };
    return Response.json({ choices: [{ message: { content: JSON.stringify(content) } }] });
  });
  const scoring = await api('/api/script/score', { provider, model: 'deepseek-flash', script, durationSeconds: 90 });
  assert.equal(scoring.body.score.title, score.title);
  const matching = await api('/api/script/library-match', { provider, model: 'deepseek-flash', script, tracks: [{ id: 'piano', title: '雨夜钢琴' }] });
  assert.equal(matching.body.matches[0].id, 'piano');
  assert.equal(calls.length, 3);
  assert.ok(calls.every(call => call.url.href === 'https://api.deepseek.com/chat/completions'));
});

test('official DeepSeek test request reports rate limits without automatic replay', async () => {
  let calls = 0;
  const api = createApiService(async () => {
    calls++;
    return Response.json({ error: { message: 'rate limit reached' } }, { status: 429 });
  });
  await assert.rejects(api('/api/providers/test', { provider, model: 'deepseek-flash' }), /429.*rate limit reached/);
  assert.equal(calls, 1);
});

const batchEpisodes = [1, 4].map(number => ({ id: `episode-${number}`, episodeNumber: number, title: `第${number}集`, script: `第${number}集\n雨夜里发现真相。` }));
const batchTracks = Array.from({ length: 6 }, (_, index) => ({ id: `track-${index}`, title: `悬疑弦乐 ${index}` }));
const keywordReply = messages => JSON.stringify({ episodes: JSON.parse(messages[1].content).episodes.map(episode => ({ id: episode.id, summary: '雨夜里发现真相，悬疑情绪逐步加强。', keywords: ['悬疑', '弦乐'] })) });

test('DeepSeek API uses short request-wide candidate references and maps them back to local IDs', async () => {
  const input = { episodes: batchEpisodes, tracks: batchTracks };
  assert.deepEqual(batchKeywordMessages(input), batchKeywordMessages(input, { deepseekApi: false }));
  assert.match(batchKeywordMessages(input, { deepseekApi: true })[0].content, /独立概念/);
  const seen = [];
  const result = await analyzeBatchMusic(input, async messages => {
    if (seen.length === 0) { seen.push('keywords'); return keywordReply(messages); }
    const request = JSON.parse(messages[1].content);
    seen.push(request);
    const refs = request.episodes.flatMap(episode => episode.candidates.map(track => track.ref));
    assert.equal(new Set(refs).size, refs.length);
    assert.ok(request.episodes.every(episode => episode.candidates.every(track => !('id' in track))));
    return JSON.stringify({ episodes: request.episodes.map(episode => ({ id: episode.id, matches: episode.candidates.slice(0, 5).map(track => ({ ref: track.ref, reason: '悬疑弦乐符合雨夜真相的氛围。' })) })) });
  }, { deepseekApi: true });
  assert.equal(seen.length, 2);
  assert.deepEqual(result.episodes.map(episode => episode.value.matches.map(match => match.id)), [batchTracks.slice(0, 5).map(track => track.id), batchTracks.slice(0, 5).map(track => track.id)]);
  assert.ok(result.episodes.every(episode => episode.value.warning === ''));
});

test('DeepSeek API rejects another episode reference and ID-only answers without guessing titles', async () => {
  const input = { episodes: batchEpisodes, tracks: batchTracks.slice(0, 2) };
  let calls = 0;
  const result = await analyzeBatchMusic(input, async messages => {
    if (++calls === 1) return keywordReply(messages);
    const request = JSON.parse(messages[1].content);
    if (calls === 2) return JSON.stringify({ episodes: request.episodes.map((episode, index) => ({ id: episode.id, matches: [{ ref: index === 0 ? episode.candidates[0].ref : request.episodes[0].candidates[0].ref, reason: '悬疑情节' }, { id: 'track-1', reason: '伪造完整ID' }] })) });
    assert.ok(request.episodes.every(episode => /候选编号无效/.test(episode.validationError)));
    return JSON.stringify({ episodes: request.episodes.map(episode => ({ id: episode.id, matches: [{ id: 'track-1', reason: '仍使用无编号ID' }] })) });
  }, { deepseekApi: true });
  assert.equal(calls, 3);
  assert.deepEqual(result.episodes.map(episode => episode.value.matches.map(match => match.id)), [['track-0'], []]);
  assert.match(result.episodes[1].value.warning, /候选编号无效/);
});

test('segmented DeepSeek API references are unique while web and Gemini prompts keep full IDs', () => {
  const candidate = (id, title) => ({ id, title });
  const units = [{ id: 'episode-1', segments: [
    { id: 'segment-1', candidates: [candidate('a', '悬疑弦乐')] },
    { id: 'segment-2', candidates: [candidate('b', '温暖钢琴')] }
  ] }, { id: 'episode-2', segments: [{ id: 'segment-1', candidates: [candidate('c', '急促鼓点')] }] }];
  const input = { segmented: true, recentEpisodes: [] };
  const api = batchMatchMessages(input, units, { deepseekApi: true });
  assert.deepEqual(JSON.parse(api[1].content).episodes.flatMap(episode => episode.segments.flatMap(segment => segment.candidates.map(track => track.ref))), ['M1', 'M2', 'M3']);
  const original = batchMatchMessages(input, units);
  assert.deepEqual(original, batchMatchMessages(input, units, { deepseekApi: false }));
  assert.equal(JSON.parse(original[1].content).episodes[0].segments[0].candidates[0].id, 'a');
  assert.doesNotMatch(original[0].content, /候选的 ref/);
});

test('DeepSeek API limits batch candidates and skips a redundant review when shortage is explained', async () => {
  const episodes = Array.from({ length: 10 }, (_, index) => ({ id: `episode-${index + 1}`, episodeNumber: index + 1, title: `第${index + 1}集`, script: '雨夜发现线索。' }));
  const tracks = Array.from({ length: 60 }, (_, index) => ({ id: `music-${index}`, title: `悬疑弦乐 ${index}` }));
  let calls = 0;
  const result = await analyzeBatchMusic({ episodes, tracks }, async messages => {
    calls++;
    const rows = JSON.parse(messages[1].content).episodes;
    if (calls === 1) return JSON.stringify({ episodes: rows.map(row => ({ id: row.id, summary: '雨夜发现线索，悬疑情绪逐步加深。', keywords: ['悬疑', '弦乐'] })) });
    assert.ok(rows.every(row => row.candidates.length <= 20));
    return JSON.stringify({ episodes: rows.map(row => ({ id: row.id, matches: [], noMatchReason: '曲名与具体冲突不符' })) });
  }, { deepseekApi: true });
  assert.equal(calls, 2);
  assert.ok(result.episodes.every(row => row.value.matchStatus === 'no-match'));
});

test('DeepSeek API reports malformed matches as incomplete, not no matching music', async () => {
  let calls = 0;
  const result = await analyzeBatchMusic({ episodes: batchEpisodes.slice(0, 1), tracks: batchTracks }, async messages => {
    if (++calls === 1) return keywordReply(messages);
    return JSON.stringify({ episodes: [{ id: 'episode-1', noMatchReason: '模型遗漏了匹配字段' }] });
  }, { deepseekApi: true });
  assert.equal(calls, 3);
  assert.equal(result.episodes[0].value.matchStatus, 'invalid');
  assert.match(result.episodes[0].value.noMatchReason, /未按要求返回/);
  await assert.rejects(analyzeBatchMusic({ episodes: batchEpisodes.slice(0, 1), tracks: batchTracks }, async messages => messages[0].content.includes('关键词用于检索') ? keywordReply(messages) : '{}', { deepseekApi: true }), /音乐匹配 JSON/);
});

test('DeepSeek API rejects blank and truncated batch responses before saving a zero-track result', async () => {
  for (const response of [
    { choices: [{ message: { content: '' }, finish_reason: 'stop' }] },
    { choices: [{ message: { content: '{"episodes":[' }, finish_reason: 'length' }] },
  ]) {
    const api = createApiService(async () => Response.json(response));
    await assert.rejects(api('/api/script/batch-library-match', { provider, model: 'deepseek-flash', episodes: batchEpisodes.slice(0, 1), tracks: batchTracks }), /空白内容|长度上限/);
  }
});

test('DeepSeek API reports the actual joint-analysis stages in request order', async () => {
  const stages = [];
  const api = createApiService(async (_url, options) => {
    const input = JSON.parse(JSON.parse(options.body).messages[1].content);
    const episodes = input.episodes.map(episode => episode.script
      ? { id: episode.id, summary: '雨夜发现线索，情绪转为紧张。', keywords: ['悬疑'] }
      : { id: episode.id, matches: [], noMatchReason: '候选曲名不符合情节' });
    return Response.json({ choices: [{ message: { content: JSON.stringify({ episodes }) }, finish_reason: 'stop' }] });
  }, (id, phase) => stages.push([id, phase]));
  await api('/api/script/batch-library-match', { provider, model: 'deepseek-flash', progressId: 'batch-19', episodes: batchEpisodes.slice(0, 1), tracks: batchTracks });
  assert.deepEqual(stages, [['batch-19', 'keywords'], ['batch-19', 'matching']]);
});

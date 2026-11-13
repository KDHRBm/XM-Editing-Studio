import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiService } from '../app/shared/api-service.mjs';
import { isScriptAnalysisModel } from '../app/shared/script-score.mjs';
import { analysisReady, analysisName } from '../app/shared/script-analyzers.mjs';
import { batchAnalyzers } from '../app/src/BatchAnalysisStore.mjs';
import { LOCAL_MODEL_OPTIONS, recommendLocalModel } from '../app/src/LocalModelRecommendations.mjs';
import { nextBatchGroup } from '../app/shared/batch-analysis.mjs';
import { DEFAULT_LOCAL_MODEL_SETTINGS, readLocalModelSettings, saveLocalModelSettings } from '../app/shared/local-model-settings.mjs';

const provider = { id: 'provider-ollama-local', name: 'DeepSeek 本地', protocol: 'ollama', baseUrl: 'https://untrusted.example/v1', apiKey: '', models: ['deepseek-r1:7b'] };

test('local DeepSeek uses fixed loopback endpoint without an API key', async () => {
  const calls = [];
  const api = createApiService(async (url, options) => {
    calls.push({ url: new URL(url).href, options });
    return Response.json({ message: { content: '<think>internal reasoning</think>OK' }, done_reason: 'stop' });
  });
  const result = await api('/api/providers/test', { provider, model: 'deepseek-r1:7b' });
  assert.equal(result.body.preview, 'OK');
  assert.equal(calls[0].url, 'http://127.0.0.1:11435/api/chat');
  assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.deepEqual(JSON.parse(calls[0].options.body).options, { num_ctx: 16384, num_predict: 4096 });
  assert.equal(JSON.parse(calls[0].options.body).stream, false);
  assert.ok(calls[0].options.signal);
});

test('downloaded local models can be selected for script and batch analysis', async () => {
  const selected = { provider, model: 'deepseek-r1:7b' };
  assert.equal(isScriptAnalysisModel(provider, selected.model), true);
  assert.equal(isScriptAnalysisModel(provider, 'deepseek-r1:99b'), false);
  assert.equal(analysisReady(selected), true);
  assert.equal(analysisName(selected), 'DeepSeek 本地');
  assert.equal(batchAnalyzers([provider]).some(item => item.key === 'provider-ollama-local::deepseek-r1:7b'), true);
  const api = createApiService(async url => {
    assert.equal(new URL(url).href, 'http://127.0.0.1:11435/v1/models');
    return Response.json({ data: [{ id: 'deepseek-r1:7b' }] });
  });
  const models = await api('/api/providers/models', { provider });
  assert.deepEqual(models.body.models, ['deepseek-r1:7b']);
});

test('local JSON analysis uses Ollama native options and format', async () => {
  const calls = [];
  const api = createApiService(async (url, options) => {
    calls.push(JSON.parse(options.body));
    return Response.json({ message: { content: calls.length === 1 ? 'OK' : '{"episodes":[{"id":"episode-1","summary":"发现关键线索，气氛变得紧张。","keywords":["悬疑"]}]}' }, done_reason: 'stop' });
  });
  await api('/api/chat', { provider, model: 'deepseek-r1:7b', messages: [{ role: 'user', content: 'OK' }] });
  assert.deepEqual(calls[0].options, { num_ctx: 16384, num_predict: 4096 });
  assert.equal(calls[0].format, undefined);
  await api('/api/script/batch-library-match', { provider, model: 'deepseek-r1:7b', episodes: [{ id: 'episode-1', episodeNumber: 1, title: '第1集', script: '发现关键线索。' }], tracks: [] });
  assert.deepEqual(calls[1].options, { num_ctx: 16384, num_predict: 4096, temperature: 0 });
  assert.equal(calls[1].format.properties.episodes.minItems, 1);
  assert.deepEqual(calls[1].format.properties.episodes.items.properties.id.enum, ['episode-1']);
});

test('local segmented analysis requires every episode and repairs a malformed first reply', async () => {
  const calls = [];
  const api = createApiService(async (_url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body);
    if (calls.length === 1) return Response.json({ message: { content: '{"episodes":[]}' }, done_reason: 'stop' });
    return Response.json({ message: { content: JSON.stringify({ episodes: [{ id: 'episode-1', summary: '女主发现线索后与对手对峙，情绪逐步紧张。', keywords: ['悬疑'], segments: [{ title: '发现线索', startLine: 1, endLine: 2, summary: '女主在房间发现线索，开始怀疑对手。', keywords: ['悬疑'] }, { title: '正面对峙', startLine: 3, endLine: 4, summary: '对手突然出现，两人发生正面冲突。', keywords: ['紧张'] }] }] }) }, done_reason: 'stop' });
  });
  const result = await api('/api/script/batch-library-match', { provider, model: 'deepseek-r1:7b', segmented: true, segmentCount: 2, episodes: [{ id: 'episode-1', episodeNumber: 1, script: '女主进入房间。\n她发现线索。\n对手突然出现。\n两人正面对峙。' }], tracks: [] });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].format.properties.episodes.minItems, 1);
  assert.equal(calls[0].format.properties.episodes.items.properties.segments.maxItems, 2);
  assert.match(calls[1].messages[0].content, /上一次结果未通过校验/);
  assert.deepEqual(result.body.episodes[0].value.segments.map(segment => [segment.startLine, segment.endLine]), [[1, 2], [3, 4]]);
});

test('local segmented analysis closes small line gaps after its model retry', async () => {
  let calls = 0;
  const api = createApiService(async () => {
    calls++;
    const segments = [
      { title: '发现合同', startLine: 1, endLine: 2, summary: '女主发现父亲留下的可疑合同，开始调查真相。', keywords: ['悬疑'] },
      { title: '发生对峙', startLine: 3, endLine: 3, summary: '对手出现并阻止调查，两人正面冲突。', keywords: ['紧张'] },
      { title: '独自反击', startLine: 5, endLine: 1, summary: '女主得知盟友背叛，决定独自反击。', keywords: ['压抑'] },
    ];
    return Response.json({ message: { content: calls === 1 ? '{"episodes":[]}' : JSON.stringify({ episodes: [{ id: 'episode-1', summary: '女主调查合同，遭遇对峙和背叛，最终决定反击。', keywords: ['悬疑'], segments }] }) }, done_reason: 'stop' });
  });
  const result = await api('/api/script/batch-library-match', { provider, model: 'deepseek-r1:7b', segmented: true, segmentCount: 3, episodes: [{ id: 'episode-1', episodeNumber: 1, script: '发现合同。\n发现日期异常。\n对手阻止调查。\n女主发现盟友背叛。\n她决定独自反击。' }], tracks: [] });
  assert.equal(calls, 2);
  assert.deepEqual(result.body.episodes[0].value.segments.map(segment => [segment.startLine, segment.endLine]), [[1, 2], [3, 4], [5, 5]]);
});

test('local JSON analysis stops with a clear error when output is capped', async () => {
  const api = createApiService(async () => Response.json({ message: { content: '{"episodes":[' }, done_reason: 'length' }));
  await assert.rejects(api('/api/script/batch-library-match', { provider, model: 'deepseek-r1:7b', episodes: [{ id: 'episode-1', episodeNumber: 1, title: '第1集', script: '发现线索。' }], tracks: [] }), /达到输出 token 上限/);
});

test('local music matching sends compact references and writes scene-specific reasons', async () => {
  const requests = [];
  const api = createApiService(async (url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    if (requests.length === 3) return Response.json({ message: { content: Array.from({ length: 5 }, (_, index) => `R${index + 1}：夜间发现线索后心生疑虑，悬疑曲名呼应第${index + 1}种追查真相的紧张情绪。`).join('\n') }, done_reason: 'stop' });
    const episodes = JSON.parse(body.messages[1].content).episodes;
    const content = requests.length === 1
      ? { episodes: episodes.map(row => ({ id: row.id, summary: '夜间发现重要线索，气氛渐紧。', keywords: ['悬疑', '弦乐'] })) }
      : { episodes: episodes.map(row => ({ id: row.id, matches: row.candidates.slice(0, 5).map(track => ({ ref: track.ref, reason: '悬疑弦乐契合剧情。' })) })) };
    return Response.json({ message: { content: JSON.stringify(content) }, done_reason: 'stop' });
  });
  const tracks = Array.from({ length: 40 }, (_, index) => ({ id: `track-${index}`, title: `悬疑弦乐 ${index}` }));
  const result = await api('/api/script/batch-library-match', { provider, model: 'deepseek-r1:7b', episodes: [{ id: 'episode-1', episodeNumber: 1, title: '第1集', script: '夜间发现线索。' }], tracks });
  assert.equal(requests.length, 3);
  const candidates = JSON.parse(requests[1].messages[1].content).episodes[0].candidates;
  assert.ok(candidates.length <= 20);
  assert.ok(candidates.every(track => /^M\d+$/.test(track.ref) && !('id' in track)));
  assert.equal(requests[1].format.properties.episodes.items.properties.matches.type, 'array');
  assert.ok(requests[1].format.properties.episodes.items.required.includes('matches'));
  assert.deepEqual(requests[1].format.properties.episodes.items.properties.matches.items.properties.ref.enum, candidates.map(track => track.ref));
  assert.match(requests[2].messages[1].content, /夜间发现线索/);
  assert.equal(requests[2].format.properties.reasons.maxItems, 5);
  assert.equal(result.body.episodes[0].value.matches.length, 5);
});

test('local music repair also requires matches in its JSON schema', async () => {
  const requests = [];
  const api = createApiService(async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    if (requests.length === 4) return Response.json({ message: { content: Array.from({ length: 5 }, (_, index) => `R${index + 1}：发现线索后受到威胁，悬疑曲名呼应第${index + 1}种继续调查时逐渐加深的紧张情绪。`).join('\n') }, done_reason: 'stop' });
    const episodes = JSON.parse(body.messages[1].content).episodes;
    const content = requests.length === 1
      ? { episodes: episodes.map(row => ({ id: row.id, summary: '发现线索，情绪紧张。', keywords: ['悬疑'] })) }
      : requests.length === 2
        ? { episodes: episodes.map(row => ({ id: row.id })) }
        : { episodes: episodes.map(row => ({ id: row.id, matches: row.candidates.slice(0, 5).map(track => ({ ref: track.ref, reason: '曲名契合紧张剧情。' })), noMatchReason: '' })) };
    return Response.json({ message: { content: JSON.stringify(content) }, done_reason: 'stop' });
  });
  const tracks = Array.from({ length: 10 }, (_, index) => ({ id: `track-${index}`, title: `悬疑弦乐 ${index}` }));
  const result = await api('/api/script/batch-library-match', { provider, model: 'deepseek-r1:7b', episodes: [{ id: 'episode-1', episodeNumber: 1, script: '发现线索。' }], tracks });
  assert.equal(requests.length, 4);
  assert.ok(requests[2].format.properties.episodes.items.required.includes('matches'));
  assert.equal(result.body.episodes[0].value.matches.length, 5);
});

test('local music reasons are rewritten in Chinese before saving', async () => {
  const requests = [];
  const api = createApiService(async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    if (requests.length === 3) return Response.json({ message: { content: 'R1：女主在雨夜发现重要线索后陷入怀疑，悬疑曲名呼应她追查真相时的紧张心情。\nR2：女主在雨夜发现线索后决定继续调查，紧张曲名呼应她急于查明真相的心情。' }, done_reason: 'stop' });
    const episodes = JSON.parse(body.messages[1].content).episodes;
    const content = requests.length === 1
      ? { episodes: episodes.map(row => ({ id: row.id, summary: '雨夜发现线索，气氛紧张。', keywords: ['悬疑'] })) }
      : { episodes: episodes.map(row => ({ id: row.id, matches: row.candidates.slice(0, 2).map((track, index) => ({ ref: track.ref, reason: requests.length === 2 ? index ? 'NoMatchReason: 缺乏足够理由推荐M2' : 'This track creates suspense in the scene.' : '曲名的悬疑气氛贴合雨夜发现线索的剧情。' })), noMatchReason: '' })) };
    return Response.json({ message: { content: JSON.stringify(content) }, done_reason: 'stop' });
  });
  const result = await api('/api/script/batch-library-match', { provider, model: 'deepseek-r1:7b', episodes: [{ id: 'episode-1', episodeNumber: 1, script: '雨夜发现线索。' }], tracks: [{ id: 'track-1', title: 'ES_Winter Warm 悬疑弦乐' }, { id: 'track-2', title: '紧张钢琴' }] });
  assert.equal(requests.length, 3);
  assert.deepEqual(requests[2].format.properties.reasons.items.properties.label.enum, ['R1', 'R2']);
  assert.equal(requests[2].format.type, 'object');
  assert.equal(result.body.episodes[0].value.matches.length, 2);
  assert.ok(result.body.episodes[0].value.matches.every(match => /女主在雨夜/.test(match.reason)));
});

test('local music does not accept example placeholders as analysis', async () => {
  const requests = [];
  const api = createApiService(async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    if (requests.length === 4) return Response.json({ message: { content: 'R1：女主在雨夜发现线索后决定继续追查，悬疑曲名呼应她心中的不安和疑虑。' }, done_reason: 'stop' });
    const episodes = JSON.parse(body.messages[1].content).episodes;
    const content = requests.length === 1
      ? { episodes: episodes.map(row => ({ id: row.id, summary: '雨夜发现线索，气氛紧张。', keywords: ['悬疑'] })) }
      : { episodes: episodes.map(row => ({ id: row.id, matches: row.candidates.slice(0, 1).map(track => ({ ref: track.ref, reason: requests.length === 2 ? '简短中文理由' : '曲名的悬疑氛围贴合雨夜发现线索的剧情。' })), noMatchReason: requests.length === 2 ? '没有推荐时解释原因' : '当前没有更多契合本段情绪的候选曲目。' })) };
    return Response.json({ message: { content: JSON.stringify(content) }, done_reason: 'stop' });
  });
  const result = await api('/api/script/batch-library-match', { provider, model: 'deepseek-r1:7b', episodes: [{ id: 'episode-1', episodeNumber: 1, script: '雨夜发现线索。' }], tracks: [{ id: 'track-1', title: '悬疑弦乐' }] });
  assert.equal(requests.length, 4);
  assert.doesNotMatch(requests[1].messages[0].content, /简短中文理由/);
  assert.match(result.body.episodes[0].value.matches[0].reason, /女主在雨夜发现线索/);
});

test('local segmented music explains each section using only its own script lines', async () => {
  const requests = [];
  const api = createApiService(async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    if (requests.length === 3) return Response.json({ message: { content: 'R1：女主在酒店发现秘密合同后开始怀疑父亲，悬疑曲名呼应她逐渐加深的不安。' }, done_reason: 'stop' });
    if (requests.length === 4) return Response.json({ message: { content: 'R1：对手在走廊追赶女主，她带着证据急忙逃离，紧张曲名呼应这段追逐。' }, done_reason: 'stop' });
    const rows = JSON.parse(body.messages[1].content).episodes;
    const content = requests.length === 1
      ? { episodes: [{ id: 'episode-1', summary: '女主发现合同后遭到对手追赶，情绪从怀疑转为紧张。', keywords: ['悬疑'], segments: [{ title: '发现合同', startLine: 1, endLine: 2, summary: '女主发现秘密合同，开始怀疑父亲。', keywords: ['悬疑'] }, { title: '走廊追逐', startLine: 3, endLine: 4, summary: '对手追赶女主，她带着证据逃离。', keywords: ['紧张'] }] }] }
      : { episodes: rows.map(row => ({ id: row.id, segments: row.segments.map(segment => ({ id: segment.id, matches: segment.candidates.slice(0, 1).map(track => ({ ref: track.ref, reason: 'This track is suitable.' })), noMatchReason: '其他曲名与该段情绪不符。' })) })) };
    return Response.json({ message: { content: JSON.stringify(content) }, done_reason: 'stop' });
  });
  const result = await api('/api/script/batch-library-match', { provider, model: 'deepseek-r1:7b', segmented: true, segmentCount: 2, episodes: [{ id: 'episode-1', episodeNumber: 1, script: '女主来到酒店。\n她发现父亲的秘密合同。\n对手在走廊追赶她。\n女主带着证据逃离。' }], tracks: [{ id: 'track-1', title: '悬疑真相' }, { id: 'track-2', title: '紧张追逐' }] });
  assert.equal(requests.length, 4);
  assert.match(requests[2].messages[1].content, /秘密合同/);
  assert.doesNotMatch(requests[2].messages[1].content, /对手在走廊追赶她/);
  assert.match(requests[3].messages[1].content, /对手在走廊追赶她/);
  assert.doesNotMatch(requests[3].messages[1].content, /女主来到酒店/);
  const sections = result.body.episodes[0].value.segments;
  assert.match(sections[0].matches[0].reason, /发现秘密合同/);
  assert.match(sections[1].matches[0].reason, /走廊追赶/);
});

test('local music accepts bold headings with multiline reasons in any order', async () => {
  let calls = 0;
  const api = createApiService(async (_url, options) => {
    const body = JSON.parse(options.body);
    calls++;
    if (calls === 3) return Response.json({ message: { content: '**R2：危机逼近**\n\n保安突然封锁走廊，女主被困在房间。曲名传达危机逐步迫近的情绪。\n\n**R1：悬疑真相**\n\n女主发现合同日期与父亲离世时间矛盾。曲名呼应她开始追查秘密的悬念。' }, done_reason: 'stop' });
    const rows = JSON.parse(body.messages[1].content).episodes;
    const content = calls === 1
      ? { episodes: [{ id: 'episode-1', summary: '女主发现合同异常，随后被困在酒店。', keywords: ['悬疑'] }] }
      : { episodes: rows.map(row => ({ id: row.id, matches: row.candidates.slice(0, 2).map(track => ({ ref: track.ref, reason: track.title })), noMatchReason: '当前没有更多契合剧情的候选曲目。' })) };
    return Response.json({ message: { content: JSON.stringify(content) }, done_reason: 'stop' });
  });
  const result = await api('/api/script/batch-library-match', { provider, model: 'deepseek-r1:7b', episodes: [{ id: 'episode-1', episodeNumber: 1, script: '女主发现合同日期与父亲离世时间矛盾。\n保安突然封锁走廊，女主被困在房间。' }], tracks: [{ id: 'track-1', title: '悬疑真相' }, { id: 'track-2', title: '危机逼近' }] });
  assert.equal(calls, 3);
  const matches = result.body.episodes[0].value.matches;
  assert.match(matches[0].reason, /合同日期与父亲离世时间矛盾/);
  assert.match(matches[1].reason, /保安突然封锁走廊/);
  assert.ok(matches.every(match => !match.reason.includes('请试听确认')));
});

test('local music caps overfilled recommendations and grounds failed reasons in script lines', async () => {
  let calls = 0;
  const api = createApiService(async (_url, options) => {
    const body = JSON.parse(options.body);
    calls++;
    if (calls === 3) return Response.json({ message: { content: '模型没有按编号回答。' }, done_reason: 'stop' });
    const rows = JSON.parse(body.messages[1].content).episodes;
    const content = calls === 1
      ? { episodes: [{ id: 'episode-1', summary: '女主发现秘密，随后遭到对手追赶。', keywords: ['悬疑'] }] }
      : { episodes: rows.map(row => ({ id: row.id, matches: row.candidates.slice(0, 8).map(track => ({ ref: track.ref, reason: 'This title fits the scene.' })), noMatchReason: '' })) };
    return Response.json({ message: { content: JSON.stringify(content) }, done_reason: 'stop' });
  });
  const tracks = Array.from({ length: 8 }, (_, index) => ({ id: `track-${index}`, title: `悬疑曲目${index}` }));
  const result = await api('/api/script/batch-library-match', { provider, model: 'deepseek-r1:7b', episodes: [{ id: 'episode-1', episodeNumber: 1, script: '女主发现秘密合同。\n对手突然追赶女主。' }], tracks });
  assert.equal(calls, 4);
  const matches = result.body.episodes[0].value.matches;
  assert.equal(matches.length, 5);
  assert.ok(matches.every(match => match.reason.includes('本段发生') && match.reason.includes('请试听确认')));
  assert.ok(matches.some(match => match.reason.includes('秘密合同')));
  assert.ok(matches.some(match => match.reason.includes('追赶女主')));
});

test('local music fills omitted Chinese reasons in one extra request', async () => {
  const requests = [];
  const api = createApiService(async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    if (requests.length === 3) return Response.json({ message: { content: 'R1：女主发现合同日期不对后开始怀疑父亲，悬疑曲名承接她继续调查时的不安。' }, done_reason: 'stop' });
    if (requests.length === 4) return Response.json({ message: { content: 'R2：女主发现合同日期不对后继续追查，爱情曲名对应她对父亲往事产生的疑问。\nR3：保安突然封锁房门，女主被困后急于脱身，紧张曲名承接这场突发危机。' }, done_reason: 'stop' });
    const rows = JSON.parse(body.messages[1].content).episodes;
    const content = requests.length === 1
      ? { episodes: [{ id: 'episode-1', summary: '女主发现合同异常，随后被保安困住。', keywords: ['悬疑'] }] }
      : { episodes: rows.map(row => ({ id: row.id, matches: row.candidates.slice(0, 3).map(track => ({ ref: track.ref, reason: '契合剧情。' })), noMatchReason: '' })) };
    return Response.json({ message: { content: JSON.stringify(content) }, done_reason: 'stop' });
  });
  const result = await api('/api/script/batch-library-match', { provider, model: 'deepseek-r1:7b', episodes: [{ id: 'episode-1', episodeNumber: 1, script: '女主发现合同日期不对。\n保安突然封锁房门，女主被困。' }], tracks: [{ id: 'track-1', title: '悬疑真相' }, { id: 'track-2', title: '爱情谜题' }, { id: 'track-3', title: '紧张危机' }] });
  assert.equal(requests.length, 4);
  assert.match(requests[3].messages[1].content, /R2 剧情/);
  assert.match(requests[3].messages[1].content, /R3 剧情/);
  const reasons = result.body.episodes[0].value.matches.map(match => match.reason);
  assert.ok(reasons.every(reason => /[\p{Script=Han}]/u.test(reason) && !reason.includes('未能生成有效')));
  assert.match(reasons[1], /合同日期不对/);
  assert.match(reasons[2], /保安突然封锁房门/);
});

test('local music uses the section summary when script lines have no usable plot text', async () => {
  let calls = 0;
  const api = createApiService(async (_url, options) => {
    const body = JSON.parse(options.body);
    calls++;
    if (calls >= 3) return Response.json({ message: { content: '未按要求提供理由。' }, done_reason: 'stop' });
    const rows = JSON.parse(body.messages[1].content).episodes;
    const content = calls === 1
      ? { episodes: [{ id: 'episode-1', summary: '女主发现失踪证据后与对手对峙。', keywords: ['悬疑'] }] }
      : { episodes: rows.map(row => ({ id: row.id, matches: row.candidates.slice(0, 1).map(track => ({ ref: track.ref, reason: 'This title fits.' })), noMatchReason: '' })) };
    return Response.json({ message: { content: JSON.stringify(content) }, done_reason: 'stop' });
  });
  const result = await api('/api/script/batch-library-match', { provider, model: 'deepseek-r1:7b', episodes: [{ id: 'episode-1', episodeNumber: 1, script: 'SCENE 1' }], tracks: [{ id: 'track-1', title: '悬疑谜团' }] });
  assert.equal(calls, 4);
  assert.match(result.body.episodes[0].value.matches[0].reason, /女主发现失踪证据后与对手对峙/);
  assert.doesNotMatch(result.body.episodes[0].value.matches[0].reason, /未能生成有效/);
});

test('token settings stay on this computer and constrain output to the context size', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  assert.deepEqual(readLocalModelSettings(storage), DEFAULT_LOCAL_MODEL_SETTINGS);
  assert.deepEqual(saveLocalModelSettings({ contextTokens: 32768, outputTokens: 8192 }, storage), { contextTokens: 32768, outputTokens: 8192 });
  assert.deepEqual(readLocalModelSettings(storage), { contextTokens: 32768, outputTokens: 8192 });
  assert.deepEqual(saveLocalModelSettings({ contextTokens: 4096, outputTokens: 8192 }, storage), { contextTokens: 4096, outputTokens: 2048 });
  values.set('xm-local-model-inference-v1', '{bad json');
  assert.deepEqual(readLocalModelSettings(storage), DEFAULT_LOCAL_MODEL_SETTINGS);
});

test('the next local request uses the saved token settings', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) } });
  try {
    saveLocalModelSettings({ contextTokens: 32768, outputTokens: 8192 });
    const api = createApiService(async (url, options) => {
      assert.deepEqual(JSON.parse(options.body).options, { num_ctx: 32768, num_predict: 8192 });
      return Response.json({ message: { content: 'OK' }, done_reason: 'stop' });
    });
    await api('/api/chat', { provider, model: 'deepseek-r1:7b', messages: [{ role: 'user', content: 'OK' }] });
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  }
});

test('new computers receive a recommendation from their own RAM and VRAM', () => {
  assert.equal(recommendLocalModel({ ramGB: 32, vramGB: 8 }).id, 'deepseek-r1:7b');
  assert.equal(recommendLocalModel({ ramGB: 32, vramGB: 12 }).id, 'deepseek-r1:14b');
  assert.equal(recommendLocalModel({ ramGB: 64, vramGB: 24 }).id, 'deepseek-r1:32b');
  assert.equal(recommendLocalModel({ ramGB: 96, vramGB: 48 }).id, 'deepseek-r1:70b');
  assert.equal(recommendLocalModel({ ramGB: 16, vramGB: 0 }).id, 'deepseek-r1:1.5b');
  assert.equal(recommendLocalModel({ ramGB: 6, vramGB: 0 }).id, '');
  for (const option of LOCAL_MODEL_OPTIONS) assert.equal(isScriptAnalysisModel(provider, option.id), true);
});

test('local analysis can split a cloud-sized group into smaller requests', () => {
  const tasks = Array.from({ length: 6 }, (_, index) => ({ id: `episode-${index}`, projectId: 'one', script: '剧本'.repeat(1000), status: 'queued', settings: { analyzerKey: 'provider-ollama-local::deepseek-r1:7b', segmented: false } }));
  assert.equal(nextBatchGroup(tasks).length, 6);
  assert.equal(nextBatchGroup(tasks, [], { episodes: 2, characters: 8000 }).length, 2);
  assert.equal(nextBatchGroup(tasks, [], { episodes: 6, characters: 3000 }).length, 1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createDesktopServer } from '../app/server/desktop-server.mjs';
import { parseSegments, planSegments, segmentCandidates, parseSegmentMatches } from '../app/shared/script-segments.mjs';
import { sameLibraryRequest } from '../app/shared/library-search.mjs';
import { createScriptQueue } from '../app/shared/script-queue.mjs';
import { splitScript } from '../app/shared/script-score.mjs';
import { score } from './script-test-fixtures.mjs';
const input = { script: '△ 暗巷追逐\n[EN] JACK: Run!\n△ 雨后重逢\n[ES] MARÍA: ¡Volviste!', hint: '', segmented: true, segmentCount: 3, durationSeconds: 60 };
const raw = { segments: [{ title: '追逐', startLine: 1, endLine: 2, summary: '暗巷追逐，紧张危险。', keywords: ['紧张', 'drums'], score: { ...score, title: '暗巷追逐', style: 'tense cinematic drums, no vocals' } }, { title: '重逢', startLine: 3, endLine: 4, summary: '雨后重逢，温暖释然。', keywords: ['温暖', 'piano'], score: { ...score, title: '雨后重逢', style: 'warm piano, no vocals' } }] };
test('segmentation validates full contiguous story coverage and distinct music schemas', () => {
  const parsed = parseSegments(JSON.stringify(raw), input, 'suno'); assert.equal(parsed.length, 2); assert.notEqual(parsed[0].score.style, parsed[1].score.style);
  for (const change of [{ startLine: 2 }, { endLine: 5 }, { startLine: 1 }, { endLine: 3 }]) {
    const invalid = structuredClone(raw); Object.assign(invalid.segments[1], change); assert.throws(() => parseSegments(JSON.stringify(invalid), input, 'suno'), /行号|覆盖/);
  }
  const invalid = structuredClone(raw); invalid.segments[0].score.style = 'a'.repeat(1001); assert.throws(() => parseSegments(JSON.stringify(invalid), input, 'suno'), /1000/);
  assert.equal(sameLibraryRequest(input, { ...input, segmented: false }), false); assert.equal(sameLibraryRequest(input, { ...input, segmentCount: 6 }), false);
});
test('segmentation accepts a complete JSON block with prose or trailing commas, but rejects truncated plans', () => {
  const answer = JSON.stringify(raw).replace(/}\]}/, '},]}');
  assert.equal(parseSegments(`方案如下：\n\`\`\`json\n${answer}\n\`\`\``, input, 'suno').length, 2);
  assert.equal(parseSegments(`说明中的未闭合花括号 {\n\`\`\`json\n${answer}\n\`\`\``, input, 'suno').length, 2);
  assert.throws(() => parseSegments(JSON.stringify(raw).slice(0, -2), input, 'suno'), /有效 JSON/);
  assert.throws(() => parseSegments(JSON.stringify({ segments: raw.segments.slice(0, 1) }), input, 'suno'), /连续情节/);
});
test('segmented planning repairs one invalid or truncated response without submitting music', async () => {
  const asks = [];
  const result = await planSegments(input, 'suno', async (messages, stage) => {
    asks.push({ messages, stage });
    return asks.length === 1 ? { text: '{"segments":[', finishReason: 'MAX_TOKENS' } : { text: JSON.stringify(raw) };
  });
  assert.equal(result.length, 2);
  assert.equal(asks.length, 2);
  assert.match(asks[1].messages[1].content, /上次回答被模型截断/);
  await assert.rejects(() => planSegments(input, 'suno', async () => '{"segments":['), /自动纠正后仍无效.*未提交 Suno/);
});
test('each scene validates its own candidate IDs and missing sections are rejected', () => {
  const segments = parseSegments(JSON.stringify(raw), input, 'library').map((s, at) => ({ ...s, candidates: [{ id: `track${at}`, title: s.title }] }));
  const matched = { segments: segments.map((s, at) => ({ id: s.id, matches: [{ id: `track${at}`, reason: s.summary, keywords: s.keywords }] })) };
  assert.equal(parseSegmentMatches(JSON.stringify(matched), segments)[1].matches[0].id, 'track1');
  matched.segments[0].id = ' segment-1\n';
  assert.equal(parseSegmentMatches(JSON.stringify(matched), segments)[0].id, 'segment-1');
  matched.segments[0].matches[0].id = 'track1'; assert.throws(() => parseSegmentMatches(JSON.stringify(matched), segments), /ID/);
  assert.throws(() => parseSegmentMatches(JSON.stringify(matched), segments), /第1段（segment-1）/);
  matched.segments[0].id = ' segment-2 ';
  assert.throws(() => parseSegmentMatches(JSON.stringify(matched), segments), /缺失或重复/);
});
test('one planning request atomically expands to ready tasks; restart/clear never duplicates paid submissions', async () => {
  const config = { providerId: 'p', baseUrl: 'http://mock', protocol: 'suno', model: 'suno-test' }; let num = 0, saved, submits = 0, plans = 0;
  const options = { uuid: () => String(++num), save: jobs => { saved = structuredClone(jobs); }, getProvider: () => ({ ...config, apiKey: 'mock' }), request: async url => { if (url.endsWith('/score')) { plans++; return raw; } submits++; return { tracks: [{ id: `task${submits}`, taskId: `task${submits}`, status: 'pending' }] }; } };
  const queue = createScriptQueue(options); queue.add({ ...input, lines: splitScript(input.script) }, config, config); queue.start(); await queue.tick();
  assert.equal(plans, 1); assert.equal(submits, 0); assert.equal(saved.length, 2); assert.ok(saved.every(j => j.status === 'ready'));
  assert.equal(saved[0].lines[0].language, 'en'); assert.equal(saved[1].lines[0].language, 'es');
  const restart = createScriptQueue({ ...options, initial: saved }); await restart.tick(); assert.equal(submits, 0);
  restart.start(); await restart.tick(); assert.equal(submits, 1); restart.clear(); assert.equal(restart.snapshot().jobs.filter(j => !j.archived).length, 0); assert.equal(restart.snapshot().jobs.length, 1);
});
test('Gemini API returns per-scene recommendations and multiple prompts without submitting Suno', async () => {
  const requests = [];
  const mock = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk); const body = JSON.parse(Buffer.concat(chunks)); requests.push(body);
    const data = JSON.parse(body.messages.find(m => m.role === 'user').content);
    const content = data.segments ? { segments: data.segments.map(s => ({ id: s.id, matches: s.musicTitles.slice(0, 1).map(t => ({ id: t.id, reason: s.summary, keywords: s.keywords })) })) } : raw;
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }));
  });
  await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve));
  const server = await createDesktopServer({ port: 0, clientDirectory: 'app/dist/client' });
  try {
    const provider = { protocol: 'openai', baseUrl: `http://127.0.0.1:${mock.address().port}/v1`, apiKey: 'test' };
    for (const route of ['score', 'library-match']) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/script/${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...input, provider, model: 'gemini-test', tracks: [{ id: 'a', title: '紧张鼓点' }, { id: 'b', title: '温暖钢琴' }] }) });
      const data = await response.json(); assert.equal(response.status, 200, JSON.stringify(data)); assert.equal(data.segments.length, 2);
      if (route === 'score') assert.ok(data.segments.every(s => s.score.instrumental)); else assert.ok(data.segments.every(s => s.matches.length === 1));
    }
    assert.equal(requests.length, 4); assert.ok(requests.every(r => r.model === 'gemini-test'));
  } finally { await new Promise(r => server.close(r)); await new Promise(r => mock.close(r)); }
});
test('Gemini segmented API retries a truncated plan with JSON output enabled', async () => {
  const requests = [];
  const mock = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    requests.push(JSON.parse(Buffer.concat(chunks)));
    const candidate = requests.length === 1
      ? { content: { parts: [{ text: '{"segments":[' }] }, finishReason: 'MAX_TOKENS' }
      : { content: { parts: [{ text: JSON.stringify(raw) }] }, finishReason: 'STOP' };
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ candidates: [candidate] }));
  });
  await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve));
  const server = await createDesktopServer({ port: 0, clientDirectory: 'app/dist/client' });
  try {
    const provider = { protocol: 'gemini', baseUrl: `http://127.0.0.1:${mock.address().port}/v1beta`, apiKey: 'test' };
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/script/score`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...input, provider, model: 'gemini-test' }) });
    const data = await response.json();
    assert.equal(response.status, 200, JSON.stringify(data));
    assert.equal(data.segments.length, 2);
    assert.equal(requests.length, 2);
    assert.ok(requests.every(request => request.generationConfig.responseMimeType === 'application/json'));
  } finally { await new Promise(r => server.close(r)); await new Promise(r => mock.close(r)); }
});

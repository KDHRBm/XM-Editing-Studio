import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, readdir } from 'node:fs/promises';
import { musicFileStem } from '../app/shared/music-filename.mjs';
import { createScriptQueue, restoreJobs } from '../app/shared/script-queue.mjs';
import { splitScript, parseScoreResponse, materialTexts } from '../app/shared/script-score.mjs';
import { createDesktopServer } from '../app/server/desktop-server.mjs';
import { exportScriptMaterials } from '../app/electron/material-export.mjs';
import { startMock, score, script, wav } from './script-test-fixtures.mjs';

const input = { title: '雨夜', script, lines: splitScript(script), hint: '温暖克制', durationSeconds: 90 };
const gemini = { providerId: 'g', model: 'gemini-test', baseUrl: 'http://mock/v1', protocol: 'gemini' };
const suno = { providerId: 's', model: 'suno-test', baseUrl: 'http://mock/v1', protocol: 'suno' };
function harness(overrides = {}) {
  const saved = [], calls = []; let time = 100000, num = 0;
  const q = createScriptQueue({ save: jobs => saved.push(structuredClone(jobs)), getProvider: id => ({ ...(id === 'g' ? gemini : suno), apiKey: 'mock-secret' }), now: () => time, uuid: () => String(++num), request: async (url, body) => {
    calls.push({ url, body });
    if (url.endsWith('/score')) return { score };
    if (url.endsWith('/generate')) return { tracks: [{ id: 't1', taskId: 't1', status: 'pending' }] };
    return { tracks: [{ id: 'clip', taskId: 't1', status: 'complete', taskStatus: 'success', audioUrl: 'http://mock/music.wav' }] };
  }, exportMaterials: async () => ({ ok: true, path: 'mock-folder' }), ...overrides });
  return { q, saved, calls, advance: () => { time += 9000; } };
}
test('organizer extracts only English subtitles and preserves decimal numbers and punctuation', () => {
  const lines = splitScript(script);
  assert.equal(lines.length, 5); assert.equal(lines[0].kind, 'dialogue'); assert.equal(lines[0].text, 'Why are you still here?'); assert.equal(lines[0].speaker, ''); assert.equal(lines[0].sourceLine, 3);
  assert.equal(splitScript('\n\n[EN] LIN: Hello.')[0].sourceLine, 3);
  assert.throws(() => splitScript('a'.repeat(30001)), /30000/);
});
test('strict Gemini schema and CSV escaping', () => {
  assert.throws(() => parseScoreResponse('Here is a song'), /JSON/);
  assert.throws(() => parseScoreResponse(JSON.stringify({ ...score, style: 'a'.repeat(1001) })), /1000/);
  assert.throws(() => parseScoreResponse(JSON.stringify({ ...score, structure: [{ tag: 'Intro', content: 'hi' }] })), /2–8/);
  assert.throws(() => parseScoreResponse(JSON.stringify({ ...score, structure: [{ tag: '[Intro]', content: 'hi' }, score.structure[1]] })), /方括号/);
  const normalized = parseScoreResponse('```json\n' + JSON.stringify(score) + '\n```'); assert.equal(normalized.instrumental, true); assert.match(normalized.prompt, /\[Instrumental\]/);
  const texts = materialTexts({ ...input, lines: [{ text: '=IMPORT("secret")', speaker: 'A', kind: 'dialogue' }], score: normalized });
  assert.match(texts['台词清单.csv'], /'=IMPORT/); assert.doesNotMatch(texts['逐行台词.txt'], /场景：/);
});
test('one score per whole script, queued FIFO, persisted before paid calls, keys not persisted', async () => {
  const { q, calls, saved } = harness(); q.add(input, gemini, suno); q.add(input, gemini, suno); q.start();
  await q.tick(); assert.equal(q.snapshot().jobs[0].status, 'ready'); await q.tick(); assert.equal(q.snapshot().jobs[0].status, 'pending');
  await q.tick(); assert.equal(q.snapshot().jobs[0].status, 'complete'); assert.equal(calls.filter(c => c.url.endsWith('/generate')).length, 1);
  assert.equal(q.snapshot().jobs[1].status, 'queued'); assert.equal(calls[0].body.lines.length, input.lines.length);
  assert.ok(saved.some(j => j[0].status === 'submitting')); assert.doesNotMatch(JSON.stringify(saved), /mock-secret/);
});
test('pause during planning prevents submission; restart ready needs an explicit start', async () => {
  let resolve; const gate = new Promise(r => { resolve = r; }); let calls = 0;
  const { q, saved } = harness({ request: async () => { calls++; await gate; return { score }; } }); q.add(input, gemini, suno); q.start();
  const pending = q.tick(); q.pause(); resolve(); await pending; await q.tick(); assert.equal(calls, 1); assert.equal(q.snapshot().jobs[0].status, 'ready');
  const restored = harness({ initial: saved.at(-1) }); await restored.q.tick(); assert.equal(restored.calls.length, 0);
});
test('interrupted or timed-out submission never resubmits; recover task ID queries only', async () => {
  const base = harness(); base.q.add(input, gemini, suno); const raw = base.q.snapshot().jobs[0];
  const { q, calls } = harness({ initial: [{ ...raw, status: 'submitting', score: parseScoreResponse(JSON.stringify(score)) }] });
  assert.equal(q.snapshot().jobs[0].status, 'uncertain'); assert.throws(q.start, /未知/); await q.tick(); assert.equal(calls.length, 0);
  q.recover(raw.id, 't1'); await q.tick(); assert.equal(calls[0].url, '/api/music/query'); assert.equal(q.snapshot().jobs[0].status, 'complete');
  const failing = harness({ request: async url => { if (url.endsWith('/score')) return { score }; throw new Error('network timeout'); } });
  failing.q.add(input, gemini, suno); failing.q.start(); await failing.q.tick(); await failing.q.tick(); assert.equal(failing.q.snapshot().jobs[0].status, 'uncertain'); await failing.q.tick();
  assert.throws(() => restoreJobs({}), /缓存/);
});
test('full disk before submit blocks the paid request', async () => {
  let fail = false, requests = 0;
  const { q } = harness({ save: jobs => { if (fail && jobs[0]?.status === 'submitting') throw new Error('disk full'); }, request: async () => { requests++; return { score }; } });
  q.add(input, gemini, suno); q.start(); await q.tick(); fail = true; await q.tick(); assert.equal(requests, 1); assert.equal(q.snapshot().running, false);
});
test('query failures pause without resubmission; continue query preserves task', async () => {
  const base = harness(); base.q.add(input, gemini, suno); const raw = base.q.snapshot().jobs[0]; let requests = 0;
  const { q, advance } = harness({ initial: [{ ...raw, status: 'pending', taskIds: ['t1'], monitoringSince: 100000 }], request: async url => { requests++; assert.equal(url, '/api/music/query'); throw new Error('offline'); } });
  for (let i = 0; i < 3; i++) { await q.tick(); advance(); } assert.equal(q.snapshot().jobs[0].status, 'pausedQuery'); await q.tick(); assert.equal(requests, 3);
  q.recover(raw.id); await q.tick(); assert.equal(requests, 4);
});
test('known task IDs remain visible when persistence fails after a successful submission', async () => {
  let fail = false;
  const { q } = harness({ save: jobs => { if (fail && jobs[0]?.monitoringSince) throw new Error('disk full'); } });
  q.add(input, gemini, suno); q.start(); await q.tick(); fail = true; await q.tick();
  assert.equal(q.snapshot().jobs[0].status, 'uncertain'); assert.deepEqual(q.snapshot().jobs[0].taskIds, ['t1']);
});
test('failed exports retry only download, preserve complete track', async () => {
  let attempts = 0; const { q, calls } = harness({ exportMaterials: async () => { if (++attempts === 1) throw new Error('offline'); return { ok: true, path: 'saved' }; } });
  const id = q.add(input, gemini, suno, 'output'); q.start(); await q.tick(); await q.tick(); await q.tick(); await q.tick();
  assert.equal(q.snapshot().jobs[0].status, 'complete'); assert.equal(q.snapshot().jobs[0].exportState, 'error'); await q.export(id, 'output'); assert.equal(q.snapshot().jobs[0].exportState, 'done'); assert.equal(calls.filter(c => c.url.endsWith('/generate')).length, 1);
});
test('native Gemini and OpenAI-compatible Gemini → Suno → audio saved directly in selected directory', async () => {
  const mock = await startMock(); const app = await createDesktopServer({ clientDirectory: path.resolve('app/dist/client'), port: 0 });
  const appUrl = `http://127.0.0.1:${app.address().port}`;
  const directory = await mkdtemp(path.resolve('.generated/tests/test-flat-music-'));
  const post = async (route, body) => { const r = await fetch(appUrl + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const data = await r.json(); assert.equal(r.status, 200, JSON.stringify(data)); return data; };
  try {
    for (const protocol of ['gemini', 'openai']) {
      const provider = { protocol, baseUrl: mock.url + (protocol === 'gemini' ? '/v1beta' : '/v1'), apiKey: 'local-test-key' };
      const planned = await post('/api/script/score', { ...input, provider, model: 'gemini-test' });
      const musicProvider = { ...provider, protocol: 'suno', baseUrl: mock.url + '/v1' };
      const submitted = await post('/api/music/generate', { ...planned.score, provider: musicProvider, model: 'suno-test' });
      const queried = await post('/api/music/query', { provider: musicProvider, model: 'suno-test', ids: submitted.tracks.map(t => t.taskId) });
      assert.ok(queried.tracks[0].audioUrl); assert.match(queried.tracks[0].status, /complete|success/i);
      const result = await exportScriptMaterials({ directory, job: { ...input, score: planned.score, primary: queried.tracks[0], taskIds: submitted.tracks.map(t => t.taskId) } });
      assert.equal(result.ok, true); assert.equal(result.kind, 'audio'); assert.equal(path.dirname(result.path), directory);
      assert.equal(path.basename(result.path), musicFileStem(planned.score) + (protocol === 'gemini' ? '' : '_2') + '.wav');
      assert.deepEqual(await readFile(result.path), wav());
    }
    const files = await readdir(directory); assert.equal(files.length, 2); assert.ok(files.every(name => name.endsWith('.wav')));
    const submits = mock.calls.filter(c => c.url === '/suno/submit/music'); assert.equal(submits.length, 2);
    for (const call of submits) { assert.equal(call.body.make_instrumental, true); assert.equal(call.body.custom_mode, true); assert.doesNotMatch(call.body.prompt, /你怎么/); assert.match(call.body.prompt, /\[Intro\]/); assert.equal(call.body.tags, score.style); }
    const native = mock.calls.find(c => c.url.includes(':generateContent')); assert.ok(native.body.systemInstruction); assert.equal(native.headers['x-goog-api-key'], 'local-test-key');
    const compatible = mock.calls.find(c => c.url.endsWith('/chat/completions')); assert.equal(compatible.headers.authorization, 'Bearer local-test-key'); assert.equal(compatible.body.messages[0].role, 'system');
  } finally { await new Promise(resolve => app.close(resolve)); await mock.close(); }
});
test('export rejects relative paths, text responses, and streamed size overflow without partial material folders', async () => {
  const directory = path.resolve('.generated/tests/test-export-failures'); await mkdir(directory, { recursive: true });
  const job = { ...input, title: '../CON', score, primary: { audioUrl: 'http://mock/audio' }, taskIds: [] };
  await assert.rejects(exportScriptMaterials({ directory: '../relative', job }), /绝对/);
  await assert.rejects(exportScriptMaterials({ directory, job }, { fetcher: async () => new Response('<html>error</html>', { headers: { 'content-type': 'text/html' } }) }), /文本/);
  await assert.rejects(exportScriptMaterials({ directory, job }, { fetcher: async () => new Response(wav()), maxBytes: 30 }), /250 MB/);
  await assert.rejects(exportScriptMaterials({ directory, job }, { fetcher: async () => new Response(Buffer.from('not audio but binary content')) }), /不是/);
  assert.deepEqual(await readdir(directory), []);
});

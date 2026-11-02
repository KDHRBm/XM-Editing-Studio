import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { splitEpisodes, episodeHeading, batchSubtitleLines, nextBatchGroup, createBatchAnalysisQueue } from '../app/shared/batch-analysis.mjs';
import { analyzeBatchMusic } from '../app/shared/batch-music.mjs';
import { webTaskResult, analyzeWithWeb } from '../app/shared/web-script-analysis.mjs';
import { createPunctuationClipboard, restoreProtectedPunctuation } from '../app/electron/period-clipboard.mjs';
import { handleApi } from '../app/server/api-plugin.mjs';
import { splitScript } from '../app/shared/script-score.mjs';

const settings = { analyzerKey: 'webai:deepseek::DeepSeek', subtitleLanguage: 'auto' };
const script = '剧名：重逢\n# 第一集 重逢\n[EN] JACK: Hello, Mia. Wait...\n\n## EP02: The truth\n[ES] MIA: ¿Dónde estás?\n\n第３集：尾声\n小马：终于找到你了，好久不见！';
const episodes = () => splitEpisodes(script).episodes;
function fixture(options = {}) {
  let data = null, id = 0, calls = [];
  const result = group => group.map(task => ({ id: task.id, analyzer: 'DeepSeek', revision: 'r1', value: { analysis: { summary: task.title, keywords: ['钢琴'] }, matches: [] } }));
  const queue = createBatchAnalysisQueue({ load: async () => data, save: async value => { data = structuredClone(value); }, makeId: () => `task-${++id}`, analyze: async group => { calls.push(group); return result(group); }, ...options });
  return { queue, calls, result, get data() { return data; } };
}
test('episode headings handle Chinese numerals, fullwidth, Markdown and EP without treating dialogue or scenes as headings', () => {
  assert.deepEqual(episodes().map(item => item.episodeNumber), [1, 2, 3]);
  assert.match(episodes()[1].script, /^剧名：重逢/);
  assert.doesNotMatch(episodes()[0].script, /The truth/);
  assert.equal(episodeHeading('第一百零二集')['number'], 102);
  assert.equal(episodeHeading('EPISODE 001 — Home')['number'], 1);
  for (const line of ['JACK: 第2集现在开始', '[EN] A: Episode 2.', '△ 第一集回忆', '1-1 修车行', '第2集台词里提到的人']) assert.equal(episodeHeading(line), null);
  assert.throws(() => splitEpisodes('第1集\nHello\n第一集\nAgain'), /重复/);
  assert.throws(() => splitEpisodes('第1集\n第2集\n台词'), /没有剧本正文/);
  assert.throws(() => splitEpisodes('第1集\n' + 'x'.repeat(30001)), /超过/);
  assert.throws(() => splitEpisodes('没有标题的剧本'), /未找到/);
});
test('batch subtitles keep punctuation independently and Chinese workspace defaults remain unchanged', () => {
  const task = { ...episodes()[2], settings };
  assert.equal(batchSubtitleLines(task, true).map(row => row.text).join(''), '终于找到你了,好久不见!');
  assert.equal(batchSubtitleLines(task, false).map(row => row.text).join(''), '终于找到你了好久不见');
  assert.equal(splitScript('小马：终于找到你了，好久不见！', 'zh').map(row => row.text).join(''), '终于找到你了好久不见');
  assert.equal(batchSubtitleLines({ ...episodes()[0], settings }).map(row => row.text).join(' '), 'Hello, Mia. Wait...');
  assert.match(batchSubtitleLines({ ...episodes()[1], settings })[0].text, /¿Dónde estás\?/);
});
test('one batch call handles all imported episodes and persists separate result cards without API credentials', async () => {
  const f = fixture(); await f.queue.initialize();
  assert.equal(await f.queue.import(episodes(), { ...settings, apiKey: 'must-not-save' }), 3);
  await f.queue.start();
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].length, 3);
  assert.deepEqual(f.queue.snapshot().tasks.map(task => task.status), ['complete', 'complete', 'complete']);
  assert.deepEqual(f.queue.snapshot().tasks.map(task => task.result.analysis.summary), episodes().map(episode => episode.title));
  assert.ok(f.data.tasks.every(task => task.subtitleCount > 0));
  assert.doesNotMatch(JSON.stringify(f.data), /must-not-save|apiKey/);
  assert.equal(await f.queue.import(episodes(), settings), 0, 'same paste must not spend quota twice');
  await f.queue.remove(f.data.tasks[0].id); assert.equal(f.data.tasks.length, 2);
  await f.queue.clear(); assert.equal(f.data.tasks.length, 0);
});
test('large batches group multiple episodes with explicit size limits and preserve all episodes', async () => {
  const f = fixture(); await f.queue.initialize();
  const many = Array.from({ length: 27 }, (_, index) => ({ episodeNumber: index + 1, title: `第${index + 1}集`, script: `[EN] A: Episode ${index + 1}.` }));
  await f.queue.import(many, settings); await f.queue.start();
  assert.deepEqual(f.calls.map(group => group.length), [12, 12, 3]);
  const group = nextBatchGroup(many.map((task, index) => ({ ...task, id: String(index), status: 'queued', settings, script: 'x'.repeat(29000) })));
  assert.equal(group.length, 2);
});
test('pause discards late batch replies, preserves cards, and resume analyzes the group together', async () => {
  let finish, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const f = fixture({ analyze: async group => { entered(); await new Promise(resolve => { finish = resolve; }); return f.result(group); } });
  await f.queue.initialize(); await f.queue.import(episodes(), settings);
  const running = f.queue.start(); await started; f.queue.pause(); finish(); await running;
  assert.ok(f.queue.snapshot().tasks.every(task => task.status === 'paused' && task.result === null));
  assert.equal(f.queue.snapshot().running, false); assert.deepEqual(f.queue.snapshot().activeIds, []);
  const reloaded = fixture({ load: async () => f.data }); await reloaded.queue.initialize(); await reloaded.queue.start();
  assert.equal(reloaded.calls.length, 1); assert.ok(reloaded.data.tasks.every(task => task.status === 'complete'));
});
test('incomplete results and storage errors stop batch processing without advancing or losing input', async () => {
  const f = fixture({ analyze: async group => f.result(group).slice(1) });
  await f.queue.initialize(); await f.queue.import(episodes(), settings); await f.queue.start();
  assert.ok(f.data.tasks.every(task => task.status === 'error' && !task.result));
  const broken = fixture({ save: async () => { throw new Error('disk full'); } });
  await broken.queue.initialize(); await assert.rejects(broken.queue.import(episodes(), settings), /disk full/);
  assert.equal(broken.queue.snapshot().tasks.length, 0); assert.match(broken.queue.snapshot().error, /保存失败/);
});
const request = { episodes: episodes().map((episode, index) => ({ ...episode, id: `episode-${index}` })), tracks: [{ id: 'piano', title: '温暖钢琴' }, { id: 'strings', title: '悬疑弦乐' }] };
function reply(messages, requests) {
  const context = JSON.parse(messages[1].content); requests.push(context);
  if (context.episodes[0].script) return JSON.stringify({ episodes: context.episodes.map(episode => ({ id: episode.id, summary: `配乐 ${episode.title}`, keywords: ['钢琴'] })) });
  return JSON.stringify({ episodes: context.episodes.map(episode => ({ id: episode.id, matches: [{ id: 'piano', reason: '钢琴适合本集温暖的情绪', keywords: ['温暖'] }] })).reverse() });
}
test('all episodes share joint model requests and one bounded review and results are assigned by IDs, not answer order', async () => {
  const requests = [];
  const result = await analyzeBatchMusic(request, async messages => reply(messages, requests));
  assert.equal(requests.length, 3); assert.ok(requests.every(context => context.episodes.length === 3));
  assert.deepEqual(result.episodes.map(episode => episode.id), request.episodes.map(episode => episode.id));
  assert.ok(result.episodes.every(episode => episode.value.matches[0].id === 'piano'));
  const empty = []; const noMusic = await analyzeWithWeb('batch-library-match', { ...request, tracks: [] }, async messages => reply(messages, empty));
  assert.equal(empty.length, 1); assert.ok(noMusic.episodes.every(episode => !episode.value.matches.length));
});
test('batch matching rejects omitted/duplicate episodes and invented tracks', async () => {
  for (const invalid of [{ episodes: [] }, { episodes: request.episodes.map(() => ({ id: 'episode-0', summary: 'x', keywords: ['钢琴'] })) }]) await assert.rejects(analyzeBatchMusic(request, async () => JSON.stringify(invalid)), /集数/);
  let calls = 0;
  const filtered = await analyzeBatchMusic(request, async messages => ++calls === 1 ? reply(messages, []) : JSON.stringify({ episodes: request.episodes.map(episode => ({ id: episode.id, matches: [{ id: 'invented', reason: 'fake' }] })) }));
  assert.equal(calls,3); assert.ok(filtered.episodes.every(e=>e.value.matches.length===0 && e.value.warning.includes('无效')));
  const raw = JSON.stringify({ episodes: request.episodes.map(episode => ({ id: episode.id, matches: [] })) });
  assert.equal(webTaskResult(raw, 'token', true), raw);
  assert.equal(webTaskResult(JSON.stringify({ xmTaskId: 'wrong', result: JSON.parse(raw) }), 'token'), null);
});
test('one-shot batch punctuation protection does not change workspace settings or lose words', async () => {
  let text = ''; let tick;
  const guard = createPunctuationClipboard({ clipboard: { readText: () => text, writeText: value => { text = value; } }, schedule: fn => { tick = fn; return 1; }, cancel: () => {} });
  await guard.copy('One, two.\nThree...', { protect: true });
  assert.equal(text, 'One‚ two․\r\nThree․․․'); assert.equal(guard.status().clipboardProtected, false);
  await guard.configure(true, 'compatible');
  await guard.copy('Keep, ASCII.', { protect: false }); await tick();
  assert.equal(text, 'Keep, ASCII.'); assert.equal(guard.status().clipboardProtected, true);
  const long = Array.from({ length: 1500 }, (_, index) => `Line ${index}, señor.`).join('\n');
  const result = await guard.copy(long, { protect: true });
  assert.equal(result.copiedLines, 1500); assert.equal(restoreProtectedPunctuation(text).replace(/\r\n/g, '\n'), long);
});
test('Gemini API batch endpoint passes all episodes to both provider calls', async () => {
  const calls = [];
  const provider = createServer(async (req, res) => {
    let raw = ''; for await (const part of req) raw += part;
    const value = JSON.parse(raw); const answer = reply(value.messages, calls);
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: answer } }] }));
  });
  const api = createServer((req, res) => handleApi(req, res).catch(error => { res.statusCode = error.status || 500; res.end(JSON.stringify({ error: error.message })); }));
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve)); await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
  try {
    const origin = `http://127.0.0.1:${api.address().port}`;
    const response = await fetch(origin + '/api/script/batch-library-match', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ ...request, provider: { protocol: 'openai', baseUrl: `http://127.0.0.1:${provider.address().port}`, apiKey: 'fixture' }, model: 'gemini-test' }) });
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal((await response.json()).episodes.length, 3); assert.equal(calls.length, 3);
  } finally { provider.closeAllConnections(); api.closeAllConnections(); await Promise.all([new Promise(resolve => provider.close(resolve)), new Promise(resolve => api.close(resolve))]); }
});

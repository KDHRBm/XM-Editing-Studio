import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { createBatchAnalysisQueue, splitEpisodes } from '../app/shared/batch-analysis.mjs';
import { batchAnalysisProgress } from '../app/src/BatchAnalysisStore.mjs';

const provider = { id: 'deepseek', name: 'DeepSeek 官方 API', protocol: 'deepseek', apiKey: 'fixture', models: ['deepseek-flash'] };
const gemini = { id: 'gemini', name: 'Gemini', protocol: 'gemini', apiKey: 'fixture', models: ['gemini-test'] };
const settings = { analyzerKey: 'deepseek::deepseek-flash', subtitleLanguage: 'auto', segmented: false, segmentCount: 3 };

function harness(analyze, groupLimits) {
  let serial = 0;
  return createBatchAnalysisQueue({ load: async () => null, save: async () => {}, extract: () => [], makeId: () => `task-${++serial}`, analyze, groupLimits });
}

const episodes = [1, 2].map(episodeNumber => ({ episodeNumber, title: `第${episodeNumber}集`, script: `第${episodeNumber}集\n雨夜相遇。` }));
const results = group => group.map(task => ({ id: task.id, value: { analysis: { summary: '雨夜相遇', keywords: ['钢琴'] }, matches: [] }, revision: 'r1', analyzer: 'DeepSeek API' }));

test('API progress reflects the real batch and remains visible after completion until dismissed', async () => {
  let finish, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const queue = harness(async (group, signal, recent, onStage) => { onStage('keywords'); entered(); return new Promise(resolve => { finish = () => { onStage('matching'); resolve(results(group)); }; }); });
  await queue.initialize();
  await queue.import(episodes, settings);
  const running = queue.start();
  await started;
  let progress = batchAnalysisProgress(queue.snapshot(), [provider]);
  assert.equal(progress.model, 'DeepSeek API');
  assert.equal(progress.status, 'running');
  assert.equal(progress.total, 2);
  assert.equal(progress.active, 2);
  assert.equal(progress.completed, 0);
  assert.equal(progress.phase, 'keywords');
  assert.deepEqual([progress.batchFirst, progress.batchLast, progress.batchSize], [1, 2, 2]);
  finish(); await running;
  progress = batchAnalysisProgress(queue.snapshot(), [provider]);
  assert.equal(progress.status, 'complete');
  assert.equal(progress.completed, 2);
  assert.equal(progress.failed, 0);
  assert.equal(progress.phase, 'saving');
  assert.ok(progress.finishedAt >= progress.startedAt);
  queue.dismissProgress();
  assert.equal(batchAnalysisProgress(queue.snapshot(), [provider]), null);
});

test('a joint batch reports its range and phase before any episode is saved', async () => {
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const queue = harness(async (group, signal, recent, onStage) => {
    onStage('keywords'); entered();
    await new Promise(resolve => { release = resolve; });
    return results(group);
  });
  await queue.initialize();
  await queue.import([{ episodeNumber: 19, title: '第19集', script: '雨夜相遇。' }, { episodeNumber: 20, title: '第20集', script: '发现真相。' }], settings);
  const running = queue.start(); await started;
  const progress = batchAnalysisProgress(queue.snapshot(), [provider]);
  assert.deepEqual([progress.batchFirst, progress.batchLast, progress.batchSize, progress.completed, progress.phase], [19, 20, 2, 0, 'keywords']);
  release(); await running;
  assert.equal(batchAnalysisProgress(queue.snapshot(), [provider]).completed, 2);
});

test('local Qwen serial batches retain the total imported episode count through episode 19 and completion', async () => {
  const qwen = { id: 'local-qwen', protocol: 'ollama', models: ['qwen3.5:4b'] };
  const snapshots = [];
  const queue = harness(async group => {
    snapshots.push(batchAnalysisProgress(queue.snapshot(), [qwen]));
    return results(group);
  }, () => ({ episodes: 1 }));
  await queue.initialize();
  const pasted = Array.from({ length: 40 }, (_, index) => `第${index + 1}集\n第${index + 1}段剧情，人物发现新的线索。`).join('\n\n');
  await queue.import(splitEpisodes(pasted).episodes, { ...settings, analyzerKey: 'local-qwen::qwen3.5:4b' });
  await queue.start();
  assert.equal(snapshots.length, 40);
  assert.ok(snapshots.every(item => item.total === 40 && item.batchSize === 1));
  assert.deepEqual([snapshots[18].firstEpisode, snapshots[18].completed, snapshots[18].total], [19, 18, 40]);
  const complete = batchAnalysisProgress(queue.snapshot(), [qwen]);
  assert.deepEqual([complete.status, complete.completed, complete.total], ['complete', 40, 40]);
});

test('Gemini API and official web analysis both show progress', async () => {
  const queue = harness(async group => results(group));
  await queue.initialize();
  await queue.import(episodes, { ...settings, analyzerKey: 'gemini::gemini-test' });
  await queue.start();
  assert.equal(batchAnalysisProgress(queue.snapshot(), [gemini]).model, 'Gemini');
  const snapshot = queue.snapshot();
  assert.equal(batchAnalysisProgress({ ...snapshot, progress: { ...snapshot.progress, analyzerKey: 'webai:deepseek::DeepSeek' } }, [gemini]).model, 'DeepSeek');
});

test('mixed API and web batches count only the current model', async () => {
  let finish, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const queue = harness(async group => {
    if (group[0].settings.analyzerKey === 'webai:deepseek::DeepSeek') entered();
    return group[0].settings.analyzerKey === 'webai:deepseek::DeepSeek'
      ? new Promise(resolve => { finish = () => resolve(results(group)); }) : results(group);
  });
  await queue.initialize();
  await queue.import(episodes, settings);
  await queue.import(episodes, { ...settings, analyzerKey: 'webai:deepseek::DeepSeek' });
  const running = queue.start();
  assert.equal(batchAnalysisProgress(queue.snapshot(), [provider]).total, 2);
  await started;
  assert.equal(batchAnalysisProgress(queue.snapshot(), [provider]).model, 'DeepSeek');
  assert.equal(batchAnalysisProgress(queue.snapshot(), [provider]).total, 2);
  finish(); await running;
});

test('paused and failed API runs retain accurate counts without repeating requests', async () => {
  let finish, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const queue = harness(async group => { entered(); return new Promise(resolve => { finish = () => resolve(results(group)); }); });
  await queue.initialize(); await queue.import(episodes, settings);
  const running = queue.start(); await started;
  queue.pause(); finish(); await running;
  assert.equal(batchAnalysisProgress(queue.snapshot(), [provider]).status, 'paused');
  assert.equal(batchAnalysisProgress(queue.snapshot(), [provider]).completed, 0);
  const failed = harness(async () => { throw new Error('HTTP 429'); });
  await failed.initialize(); await failed.import(episodes, settings); await failed.start();
  const progress = batchAnalysisProgress(failed.snapshot(), [provider]);
  assert.equal(progress.status, 'error');
  assert.equal(progress.failed, 2);
  assert.equal(progress.completed, 0);
});

test('progress card renders actual completed count and an interrupt action', async () => {
  globalThis.i = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState: value => [value, () => {}], useEffect: () => {},
  };
  const bundle = await build({ stdin: { contents: "export { BatchProgressCard } from '../app/src/BatchAnalysis.jsx'", resolveDir: fileURLToPath(new URL('.', import.meta.url)) }, bundle: true, write: false, format: 'esm', jsxFactory: 'i.createElement', jsxFragment: 'i.Fragment' });
  const ui = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
  const state = { progress: { ids: ['a', 'b'], analyzerKey: settings.analyzerKey, startedAt: Date.now() - 3000, status: 'running' }, activeIds: ['b'], tasks: [{ id: 'a', episodeNumber: 1, status: 'complete' }, { id: 'b', episodeNumber: 2, status: 'analyzing' }] };
  const card = ui.BatchProgressCard({ state, providers: [provider], onNavigate: () => {} });
  const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...(tree.children || []).flat(Infinity).flatMap(nodes)];
  const text = tree => typeof tree === 'string' || typeof tree === 'number' ? String(tree) : (tree?.children || []).flat(Infinity).map(text).join('');
  assert.equal(card.props['aria-label'], 'AI 分析进度');
  assert.match(text(card), /DeepSeek API/);
  assert.match(text(card), /已完成 1 \/ 2 集/);
  assert.match(text(card), /正在准备分析 · 当前 第 2 集 · 本次共 2 集/);
  assert.match(text(card), /本批结果返回并保存后/);
  assert.equal(nodes(card).find(node => node.props.role === 'progressbar').props['aria-valuenow'], 1);
  assert.ok(nodes(card).some(node => node.type === 'button' && /中断/.test(text(node))));
  const web = ui.BatchProgressCard({ state: { ...state, progress: { ...state.progress, analyzerKey: 'webai:deepseek::DeepSeek' } }, providers: [], onNavigate: () => {} });
  assert.match(text(web), /DeepSeek/);
  globalThis.blackObsidian = { reportBatchProgress: async () => {} };
  try { assert.equal(ui.BatchProgressCard({ state, providers: [provider], onNavigate: () => {} }), null); }
  finally { delete globalThis.blackObsidian; }
});

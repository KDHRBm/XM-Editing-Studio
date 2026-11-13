import { createBatchAnalysisQueue } from '../shared/batch-analysis.mjs';
import { isScriptAnalysisModel } from '../shared/script-score.mjs';
import { WEB_ANALYZERS, analysisName, analysisReady, webAnalyzer } from '../shared/script-analyzers.mjs';
import { excludeUsedMusic } from '../shared/library-usage.mjs';
import { musicUsage } from './MusicUsage.mjs';
import { requestScriptAnalysis } from './AnalysisRequest.mjs';

let providers = [], database;
export function batchAnalyzers(items = providers) {
  return [...WEB_ANALYZERS, ...items.flatMap(provider => (provider.models || []).filter(model => isScriptAnalysisModel(provider, model)).map(model => ({ key: `${provider.id}::${model}`, provider, providerId: provider.id, model })))];
}
export function setBatchProviders(value) { providers = value || []; }
export function batchAnalysisProgress(state, items = providers) {
  const progress = state.progress;
  if (!progress?.ids?.length) return null;
  const analyzer = batchAnalyzers(items).find(item => item.key === progress.analyzerKey);
  if (!analyzer) return null;
  const tasks = progress.ids.map(id => state.tasks.find(task => task.id === id)).filter(Boolean);
  const activeIds = state.activeIds.filter(id => progress.ids.includes(id));
  const current = state.tasks.find(task => task.id === activeIds[0]);
  return {
    id: `${progress.startedAt}:${progress.analyzerKey}`, model: analysisName(analyzer), status: progress.status, startedAt: progress.startedAt,
    finishedAt: progress.finishedAt, completed: progress.completed ?? tasks.filter(task => task.status === 'complete').length,
    failed: progress.failed ?? tasks.filter(task => task.status === 'error').length,
    total: progress.ids.length, active: activeIds.length, firstEpisode: current?.episodeNumber || 0,
    batchFirst: progress.batchFirst || current?.episodeNumber || 0, batchLast: progress.batchLast || current?.episodeNumber || 0,
    batchSize: progress.batchSize || activeIds.length, phase: progress.phase || 'preparing',
  };
}
function openDatabase() {
  return database ||= new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error('当前环境不支持本地任务存储，请使用桌面程序。')); return; }
    const request = indexedDB.open('xm-batch-analysis', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('state');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function storage(write, value) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('state', write ? 'readwrite' : 'readonly');
    const request = write ? transaction.objectStore('state').put(value, 'queue') : transaction.objectStore('state').get('queue');
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(transaction.error || request.error);
    transaction.onabort = () => reject(transaction.error || new Error('存储操作被中止'));
  });
}
export const batchQueue = createBatchAnalysisQueue({
  load: () => storage(false), save: value => storage(true, value),
  groupLimits: task => {
    const selected = batchAnalyzers().find(item => item.key === task.settings.analyzerKey);
    if (selected?.provider?.protocol !== 'ollama') return {};
    const size = selected.model.split(':')[1];
    if (/^qwen/.test(selected.model)) return { episodes: 1, characters: size === '4b' ? 6000 : 9000 };
    return size === '1.5b' ? { episodes: 1, characters: 3000 }
      : size === '7b' ? { episodes: 1, characters: 6000 }
      : size === '14b' ? { episodes: 2, characters: 9000 }
      : { episodes: 3, characters: 12000 };
  },
  async analyze(tasks, signal, recentEpisodes = [], onStage = () => {}) {
    const model = batchAnalyzers().find(item => item.key === tasks[0].settings.analyzerKey);
    if (!model || !analysisReady(model)) throw new Error('此任务所选模型已移除或缺少密钥，请检查工作空间中的模型连接。');
    onStage('library');
    const catalog = await globalThis.blackObsidian?.getMusicLibrary?.() || { tracks: [], revision: '' };
    signal.throwIfAborted();
    const tracks = excludeUsedMusic(catalog.tracks, musicUsage.snapshot().history);
    const value = await requestScriptAnalysis('batch-library-match', { segmented: !!tasks[0].settings.segmented, segmentCount: tasks[0].settings.segmentCount || 3, manualWeb: !!tasks[0].settings.manualWeb, episodes: tasks.map(({ id, episodeNumber, title, script }) => ({ id, episodeNumber, title, script })), recentEpisodes, provider: model.provider, model: model.model, tracks: tracks.map(({ id, title }) => ({ id, title })) }, webAnalyzer(model) ? signal : AbortSignal.any([signal, AbortSignal.timeout(730000)]), onStage);
    signal.throwIfAborted();
    const titleMatches = matches => (matches || []).map(match => ({ ...match, title: catalog.tracks.find(track => track.id === match.id)?.title || match.id }));
    return value.episodes.map(episode => ({ id: episode.id, value: { ...episode.value, matches: titleMatches(episode.value.matches), ...(episode.value.segments ? {segments:episode.value.segments.map(segment=>({...segment,matches:titleMatches(segment.matches)}))} : {}) }, revision: catalog.revision, analyzer: analysisName(model) }));
  },
});
export function useBatchAnalysis() {
  const state = i.useSyncExternalStore(batchQueue.subscribe, batchQueue.snapshot);
  i.useEffect(() => { void batchQueue.initialize(); }, []);
  return state;
}

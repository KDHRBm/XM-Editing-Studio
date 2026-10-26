import { createBatchAnalysisQueue } from '../shared/batch-analysis.mjs';
import { isGeminiModel } from '../shared/script-score.mjs';
import { WEB_ANALYZERS, analysisName, analysisReady, webAnalyzer } from '../shared/script-analyzers.mjs';
import { excludeUsedMusic } from '../shared/library-usage.mjs';
import { musicUsage } from './MusicUsage.mjs';
import { requestScriptAnalysis } from './AnalysisRequest.mjs';

let providers = [], database;
export function batchAnalyzers(items = providers) {
  return [WEB_ANALYZERS.find(item => item.provider.webId === 'deepseek'), ...items.flatMap(provider => (provider.models || []).filter(model => isGeminiModel(provider, model)).map(model => ({ key: `${provider.id}::${model}`, provider, providerId: provider.id, model })))];
}
export function setBatchProviders(value) { providers = value || []; }
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
  async analyze(tasks, signal) {
    const model = batchAnalyzers().find(item => item.key === tasks[0].settings.analyzerKey);
    if (!model || !analysisReady(model)) throw new Error('此任务所选模型已移除或缺少密钥，请检查工作空间中的模型连接。');
    const catalog = await globalThis.blackObsidian?.getMusicLibrary?.() || { tracks: [], revision: '' };
    signal.throwIfAborted();
    const tracks = excludeUsedMusic(catalog.tracks, musicUsage.snapshot().history);
    const value = await requestScriptAnalysis('batch-library-match', { segmented: !!tasks[0].settings.segmented, segmentCount: tasks[0].settings.segmentCount || 3, episodes: tasks.map(({ id, episodeNumber, title, script }) => ({ id, episodeNumber, title, script })), provider: model.provider, model: model.model, tracks: tracks.map(({ id, title }) => ({ id, title })) }, webAnalyzer(model) ? signal : AbortSignal.any([signal, AbortSignal.timeout(730000)]));
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

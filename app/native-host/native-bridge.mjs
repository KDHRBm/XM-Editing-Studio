import { createApiService } from '../shared/api-service.mjs';
import { createWebAnalysis } from '../electron/web-ai-analysis.mjs';
import { createJianyingWebScan } from '../electron/jianying-web-scan.mjs';
import { webAIPageScript } from '../electron/web-ai-dom.mjs';
import { webAIProvider } from '../shared/web-ai.mjs';
import { webAIScriptPrompt } from '../shared/web-ai-prompts.mjs';
import { requestJianyingAI, buildJianyingAIRequest } from '../electron/jianying-ai.mjs';
import { isDeepSeekScan } from '../shared/jianying-models.mjs';
import { materialTexts, validateScoreRequest, parseScoreResponse } from '../shared/script-score.mjs';
import { parseKeywords } from '../shared/library-match.mjs';
import { musicFileStem } from '../shared/music-filename.mjs';

const markNativeSurface = () => { document.documentElement.dataset.nativeHost = 'true'; };
if (document.documentElement) markNativeSurface();
else document.addEventListener('DOMContentLoaded', markNativeSurface, { once: true });

const pending = new Map(), listeners = new Map();
let serial = 0;
function emit(event, value) { for (const fn of listeners.get(event) || []) { try { fn(value); } catch (error) { console.error(error); } } }
function on(event, fn) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(fn); return () => listeners.get(event)?.delete(fn); }
function invoke(cmd, payload = {}, timeout = 60_000, files) {
  return new Promise((resolve, reject) => {
    const id = ++serial, timer = setTimeout(() => { pending.delete(id); reject(new Error('本机操作响应超时，请重试。')); }, timeout);
    pending.set(id, { resolve, reject, timer });
    try { const data = JSON.stringify({ id, cmd, payload }); if (files) chrome.webview.postMessageWithAdditionalObjects(data, files); else chrome.webview.postMessage(data); }
    catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
  });
}
chrome.webview.addEventListener('message', ({ data }) => {
  if (data.event) { emit(data.event, data.data); return; }
  const item = pending.get(data.id); if (!item) return;
  pending.delete(data.id); clearTimeout(item.timer); data.error ? item.reject(new Error(data.error)) : item.resolve(data.result);
});
async function nativeFetch(url, options = {}) {
  const requestId = crypto.randomUUID(), signal = options.signal; signal?.throwIfAborted();
  const cancel = () => { void invoke('http-cancel', { requestId }).catch(() => {}); };
  let rejectAbort;
  const abort = () => { cancel(); rejectAbort(signal.reason || new DOMException('请求已中断', 'AbortError')); };
  try {
    const interrupted = new Promise((_, reject) => { rejectAbort = reject; signal?.addEventListener('abort', abort, { once: true }); });
    const value = await Promise.race([invoke('http-fetch', { requestId, url: String(url), method: options.method || 'GET', headers: Object.fromEntries(new Headers(options.headers)), body: options.body || '', timeout: 600000 }, 610000), interrupted]);
    return new Response([204, 205, 304].includes(value.status) ? null : value.body, { status: value.status, headers: value.headers });
  } finally { signal?.removeEventListener('abort', abort); }
}
const browserFetch = window.fetch.bind(window);
window.fetch = async (input, options = {}) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
  if (url.origin === location.origin && url.pathname.startsWith('/api/')) {
    const signal = options.signal || input?.signal || new AbortController().signal;
    if ((options.method || input?.method || 'GET').toUpperCase() !== 'POST') return Response.json({ error: '仅支持 POST 请求。' }, { status: 405 });
    try {
      const raw = options.body ?? (input instanceof Request ? await input.text() : '{}');
      const max = /library-match$/.test(url.pathname) ? 5 * 1024 * 1024 : 2 * 1024 * 1024;
      if (new TextEncoder().encode(raw).length > max) return Response.json({ error: '请求内容过大。' }, { status: 413 });
      let body; try { body = JSON.parse(raw || '{}'); } catch { return Response.json({ error: '请求内容不是有效 JSON。' }, { status: 400 }); }
      const api = createApiService((address, init = {}) => nativeFetch(address, { ...init, signal: init.signal ? AbortSignal.any([signal, init.signal]) : signal }));
      const result = await api(url.pathname, body, signal); signal.throwIfAborted();
      return Response.json(result.body, { status: result.status });
    } catch (error) { signal.throwIfAborted(); return Response.json({ error: error.message }, { status: error.status || 500 }); }
  }
  return browserFetch(input, options);
};

let visibleProvider = '', jyConnection = null, jyController;
const driver = {
  visible: id => id === visibleProvider,
  run: (provider, input, signal) => { signal?.throwIfAborted(); return invoke('web-ai-run', { provider, script: webAIPageScript({ ...input, host: webAIProvider(provider).host }) }, 20000); },
};
const copy = text => invoke('clipboard-text', { text });
const analysis = createWebAnalysis({ driver, copy, notify: task => emit('bos:web-analysis-task', task) });
const scan = createJianyingWebScan({ driver, copy, isBusy: () => !!analysis.snapshot(), notify: task => { emit('bos:web-analysis-task', task); if (task) void invoke('progress-action', { action: 'reveal-web-ai' }); } });
function cancelJianying() { jyController?.abort(); scan.close(); }
on('bos:native-ai-cancel', cancelJianying);
on('bos:native-ai', async input => {
  const connection = jyConnection, signal = jyController?.signal; let result;
  try {
    if (!connection || !signal) throw new Error('未选择 AI 连接。'); signal.throwIfAborted();
    const report = message => invoke('progress-message', { message }).catch(() => {});
    const text = isDeepSeekScan(connection) ? await scan.request(input, signal, report) : await requestJianyingAI(connection, input, signal, nativeFetch, { onRetry: report });
    result = { text };
  } catch (error) { result = { error: error.message }; }
  await invoke('jianying-action', { action: 'ai_result', args: { token: input.token, ...result } }).catch(() => {});
});
async function jianyingAction(action, args = {}, selectedConnection) {
  if (action === 'stop') cancelJianying();
  if (action === 'scan' || action === 'preview' && args.ai) {
    const connection = selectedConnection || jyConnection, web = isDeepSeekScan(connection);
    if (web && action !== 'scan') throw new Error('DeepSeek 网页仅用于草稿扫描。');
    if (!web) buildJianyingAIRequest(connection, { prompt: 'validate' });
    const state = await invoke('jianying-action', { action: 'status' });
    if (state.busy || state.recording || state.exporting || state.modal) throw new Error('请先结束当前任务。');
    cancelJianying(); jyController = new AbortController(); jyConnection = structuredClone(connection);
    if (action === 'scan') args = { ...args, webScan: web };
  }
  return invoke('jianying-action', { action, args });
}
on('bos:companion-request', async ({ action, value }) => {
  try { await jianyingAction(action.slice(3), value || (action === 'jy-export' ? { index: 0 } : {})); }
  catch (error) { await invoke('notify', { message: error.message }); }
});
async function exportMaterials({ directory, job }) {
  const input = validateScoreRequest(job || {});
  if (job.source !== 'library') { const score = parseScoreResponse(JSON.stringify(job.score), input.durationSeconds); return invoke('export-script-materials', { directory, audioUrl: job.primary?.audioUrl, name: musicFileStem(score) }, 240000); }
  const analysis = parseKeywords(JSON.stringify(job.analysis));
  const texts = materialTexts({ ...input, source: 'library', analysis, localTrack: job.localTrack, matchReason: String(job.matchReason || '').slice(0, 500) });
  texts['素材清单.json'] = JSON.stringify({ version: 2, source: 'local-library', title: input.title, musicTitle: job.localTrack?.title, createdAt: new Date().toISOString(), targetSeconds: input.durationSeconds, spokenLines: input.lines.filter(l => l.kind !== 'scene').length, files: Object.keys(texts) }, null, 2);
  return invoke('export-script-materials', { directory, localTrackId: job.localTrack?.id, title: input.title, texts }, 240000);
}
const wm = (action, value) => invoke('watermark-action', { action, value });
window.scanCard = Object.freeze({state:()=>invoke('progress-action',{action:'state'}), action:action=>invoke('progress-action',{action}),subscribe:fn=>on('bos:scan-card-progress',fn)});
window.blackObsidian = Object.freeze({
  runtime: 'csharp-webview2',
  getUpdaterStatus: () => invoke('updater-status'), updaterAction: action => invoke('updater-action', { action }, 25 * 60000), onUpdaterState: fn => on('bos:updater-state', fn),
  setTitlebarTheme: theme => invoke('titlebar-theme', { theme }), onTrayNavigate: fn => on('bos:tray-navigate', fn),
  companionAction: (action, value) => invoke('companion-action', { action, value }, 25 * 60000), onCompanionState: fn => on('bos:companion-state', fn), onCompanionTheme: fn => on('bos:companion-theme', fn),
  layoutWebAI: input => { visibleProvider = input.visible ? input.provider : ''; return invoke('web-ai-layout', input); },
  webAIAction: async (provider, action) => {
    const state = await invoke('web-ai-action', { provider, action });
    if (['login', 'page-status'].includes(action) && driver.visible(provider)) { try { const access = await driver.run(provider, { command: action === 'login' ? 'login' : 'probe' }); return { ...state, access: access.state, pageNotice: access.message }; } catch {} }
    return state;
  },
  copyWebAITask: (draft, purpose) => copy(webAIScriptPrompt(draft, purpose)),
  analyzeWebScript: request => { if (scan.snapshot()) throw new Error('已有草稿扫描任务，请先完成或中断。'); return analysis.run(request); },
  getWebAnalysisTask: async () => scan.snapshot() || analysis.snapshot(),
  webAnalysisAction: (id, action, value) => scan.snapshot()?.id === id ? action === 'cancel' ? jianyingAction('stop') : scan.action(id, action, value) : analysis.action(id, action, value),
  onWebAnalysisTask: fn => on('bos:web-analysis-task', fn),
  getWatermarkState: () => wm('state'), chooseWatermarkVideos: () => wm('choose-videos'),
  getWatermarkBrowsers:()=>invoke('watermark-browsers'),
  openWatermarkBrowser:input=>invoke('watermark-browser-open',{browser:input.browser,count:input.files.length,hasWatermark:!!input.watermark,settings:input.settings},60000,[...input.files,...(input.watermark?[input.watermark]:[])]),
  addWatermarkVideos: files => invoke('watermark-drop', {}, 60000, files),
  chooseWatermarkImage: () => wm('choose-image'), chooseWatermarkOutputDir: () => wm('choose-output-dir'), updateWatermarkSettings: value => wm('update-settings', value),
  removeWatermarkJob: id => wm('remove-job', id), clearWatermarkJobs: mode => wm('clear-jobs', mode), retryWatermarkJobs: () => wm('retry-failed'), startWatermarkBatch: () => wm('start'), cancelWatermarkBatch: () => wm('cancel'), openWatermarkJob: id => wm('open-job', id), onWatermarkState: fn => on('bos:watermark-state', fn),
  prepareMusicDrag: value => invoke('prepare-music-drag', value), startMusicDrag: token => { void invoke('start-music-drag', { token }).catch(error => emit('bos:music-drag-error', error.message)); }, onMusicDragError: fn => on('bos:music-drag-error', fn),
  getPeriodKeeperStatus: () => invoke('period-status'), probePeriodKeeper: () => invoke('period-probe'), setPeriodKeeperEnabled: (enabled, mode) => invoke('period-enabled', { enabled, mode }), setBatchPunctuationEnabled: enabled => invoke('period-batch-enabled', { enabled }), copySubtitleText: (text, options) => invoke('period-copy', { text, options }),
  jianyingAction, chooseJianyingFiles: () => invoke('jianying-files'), quickLaunch: (action, value) => invoke('quick-launch', { action, value }), addQuickFolders: files => invoke('quick-folders-drop', {}, 60000, files),
  chooseDirectory: () => invoke('choose-directory'), writeCache: payload => invoke('write-cache', payload), readCache: payload => invoke('read-cache', payload), downloadAudio: payload => invoke('download-audio', payload, 240000), exportScriptMaterials: exportMaterials,
  getMusicLibrary: () => invoke('music-library-list'), connectMusicLibrary: () => invoke('music-library-connect', {}, 180000), connectDroppedMusicFolders: files => invoke('music-library-drop', {}, 180000, files), refreshMusicLibrary: () => invoke('music-library-refresh', {}, 180000), disconnectMusicLibrary: id => invoke('music-library-disconnect', { id }, 180000),
});
document.addEventListener('DOMContentLoaded', () => {
  if (location.pathname === '/jianying-scan/index.html') return;
  const style = document.createElement('style'); style.textContent = 'html[data-native-host=true] .bos-titlebar{padding-right:150px}.xm-native-controls{position:fixed;top:0;right:0;height:36px;display:flex;align-items:stretch;z-index:10000;-webkit-app-region:no-drag}.xm-native-controls button{display:grid;place-items:center;box-sizing:border-box;width:46px;height:36px;padding:0;border:0;border-radius:0;background:transparent;color:var(--ui-text);font:17px system-ui;line-height:1;cursor:pointer;transition:background-color 140ms ease}.xm-native-controls button:focus-visible{outline:2px solid var(--ui-accent);outline-offset:-3px}.xm-native-controls button:hover{background:var(--ui-raised)}.xm-native-controls button:last-child:hover{background:#c42b1c;color:white}'; document.head.append(style);
  if (location.pathname === '/index.html') { const controls = document.createElement('div'); controls.className = 'xm-native-controls'; for (const [action, label, icon] of [['min', '最小化', '−'], ['max', '最大化或还原', '□'], ['close', '关闭窗口', '×']]) { const button = document.createElement('button'); button.textContent = icon; button.ariaLabel = label; button.onclick = () => invoke('window-control', { action }); controls.append(button); } document.body.append(controls); }
  document.addEventListener('mousedown', event => { if (event.button === 0 && event.target.closest('.bos-titlebar-drag, .panel > header') && !event.target.closest('button,input')) void invoke('window-control', { action: 'drag' }); });
  document.addEventListener('dblclick', event => { if (event.target.closest('.bos-titlebar-drag')) void invoke('window-control', { action: 'max' }); });
});

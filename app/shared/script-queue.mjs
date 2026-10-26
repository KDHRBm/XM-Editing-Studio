import { validateScoreRequest, parseScoreResponse } from './script-score.mjs';
import { stripChineseSubtitlePunctuation } from './chinese-subtitles.mjs';
import { mergeTracks, isComplete, isFailed, safeMediaUrl } from './music-options.mjs';
import { parseKeywords } from './library-match.mjs';
import { parseSegments } from './script-segments.mjs';
import { segmentScoreInput, findSegmentJob } from './segment-shortcut.mjs';
import { webAnalyzer } from './script-analyzers.mjs';

export const QUEUE_KEY = 'black-obsidian.script-queue.v1';
const taskIds = tracks => [...new Set(tracks.map(t => t.taskId || t.id).filter(Boolean))];
export const primaryTrack = tracks => tracks.find(t => safeMediaUrl(t.audioUrl) && isComplete(t.status) && (!t.taskStatus || isComplete(t.taskStatus)));
export function restoreJobs(saved) {
  if (!Array.isArray(saved)) throw new Error('配乐任务缓存损坏，请保留缓存并检查，不能自动恢复提交。');
  return saved.map(job => {
    if (!job || typeof job.id !== 'string' || !Array.isArray(job.tracks) || !Array.isArray(job.taskIds)) throw new Error('配乐任务缓存格式无效。');
    if (job.status === 'submitting') return { ...job, status: 'uncertain', error: '上次提交被中断。请先在服务商记录核对任务，填写任务 ID 后恢复查询。' };
    if (job.status === 'planning') return { ...job, status: 'queued' };
    const lines = Array.isArray(job.lines) ? job.lines.map(line => line?.language === 'zh' && typeof line.text === 'string' ? { ...line, text: stripChineseSubtitlePunctuation(line.text) } : line) : job.lines;
    if (job.exportState === 'exporting') return { ...job, ...(lines ? { lines } : {}), exportState: 'error', exportError: '上次导出被中断，可重新导出素材。' };
    return { ...job, ...(lines ? { lines } : {}) };
  });
}

// Every paid transition is persisted before the request. Interrupted submissions
// are never retried automatically, even if a browser reload lost their response.
export function createScriptQueue({ initial = [], save, request, getProvider, exportMaterials, onComplete = () => {}, onArchive = () => {}, now = Date.now, uuid = () => crypto.randomUUID() }) {
  let state = { jobs: restoreJobs(initial), running: false, targetIds: null, notice: '' }, busy = false;
  const listeners = new Set();
  const emit = () => listeners.forEach(fn => fn());
  function commit(jobs, patch = {}) { save(jobs); state = { ...state, ...patch, jobs }; emit(); }
  function patch(id, change) {
    if (!state.jobs.some(j => j.id === id)) return;
    commit(state.jobs.map(j => j.id === id ? { ...j, ...change } : j));
    const job = state.jobs.find(j => j.id === id);
    if (job.archived) { try { onArchive(job); } catch { stop('历史记录保存失败，任务记录仍保留，请释放本机存储空间。'); } }
  }
  function stop(message = '') { state = { ...state, running: false, targetIds: null, notice: message }; emit(); }
  function providerFor(config, allowWeb = false) {
    const web = allowWeb && webAnalyzer(config);
    if (web && config.protocol === web.protocol && config.baseUrl === web.baseUrl) return web.provider;
    const provider = getProvider(config.providerId);
    if (!provider?.apiKey?.trim()) throw new Error('连接已移除或密钥为空，请在「模型与连接」修复原连接。');
    if (provider.baseUrl !== config.baseUrl || provider.protocol !== config.protocol) throw new Error('连接地址或协议已改变，请恢复原配置后继续。');
    return provider;
  }
  function acceptTracks(id, incoming) {
    const job = state.jobs.find(j => j.id === id);
    if (!job) return;
    const tracks = mergeTracks(job.tracks, incoming);
    const primary = primaryTrack(tracks);
    const failed = !primary && tracks.length && tracks.every(t => isFailed(t.status) || isFailed(t.taskStatus));
    patch(id, { tracks, taskIds: taskIds(tracks), primary, status: primary ? 'complete' : failed ? 'error' : 'pending', phase: failed ? 'music' : '', error: failed ? tracks.find(t => t.error)?.error || 'Suno 任务生成失败，请核对服务商任务记录。' : '', failures: 0 });
    if (primary) { try { onComplete(state.jobs.find(j => j.id === id)); } catch { /* main queue is already durable */ } }
    if (failed) stop('生成失败，队列已暂停。');
  }
  async function doExport(job, directory) {
    if (!directory) throw new Error('请先选择保存目录。');
    patch(job.id, { exportState: 'exporting', exportError: '', exportDirectory: directory });
    try {
      const result = await exportMaterials({ directory, job });
      if (!result?.ok) throw new Error('保存失败。');
      patch(job.id, { exportState: 'done', exportPath: result.path });
    } catch (err) { patch(job.id, { exportState: 'error', exportError: err.message || '导出失败，可重试导出。' }); }
  }
  return {
    snapshot: () => state,
    subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    addLocal(input, track, analysis, reason, directory = '', origin = '') {
      if (state.jobs.length >= 50) throw new Error('最多保留 50 份任务，请移除旧记录后继续。');
      if (!track || !/^[a-f0-9]{64}$/.test(track.id) || typeof track.title !== 'string' || !track.title.trim()) throw new Error('本地音乐信息无效，请刷新音乐库。');
      const base = new URL(origin);
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) throw new Error('本地音乐只能在本机程序中使用。');
      const localTrack = { id: track.id, libraryId: track.libraryId, title: track.title };
      const primary = { id: track.id, title: track.title, audioUrl: `${base.origin}/local-music/${track.id}`, status: 'complete' };
      const job = { ...validateScoreRequest(input), id: uuid(), createdAt: now(), source: 'library', localTrack, analysis: parseKeywords(JSON.stringify(analysis)), matchReason: String(reason || '').slice(0, 500), status: 'complete', primary, tracks: [primary], taskIds: [], exportDirectory: directory };
      commit([...state.jobs, job]);
      try { onComplete(job); } catch { /* durable queue is available */ }
      return job.id;
    },
    add(input, gemini, suno, directory = '') {
      if (state.jobs.length >= 50) throw new Error('最多保留 50 份任务，请导出并移除旧任务后继续。');
      const config = value => ({ providerId: value.providerId, model: value.model, baseUrl: value.baseUrl, protocol: value.protocol });
      const job = { ...validateScoreRequest(input), id: uuid(), createdAt: now(), gemini: config(gemini), suno: config(suno), status: 'queued', tracks: [], taskIds: [], exportDirectory: directory };
      commit([...state.jobs, job]); return job.id;
    },
    addSegment(input, segment, projectId, gemini, suno, directory = '') {
      if (typeof projectId !== 'string' || !projectId) throw new Error('当前剧本状态无效。');
      const existing = findSegmentJob(state.jobs, input, segment, projectId);
      if (existing) return existing.id;
      if (state.jobs.length >= 50) throw new Error('最多保留 50 份任务，请清理旧任务后继续。');
      const config = value => ({ providerId: value.providerId, model: value.model, baseUrl: value.baseUrl, protocol: value.protocol });
      const job = { ...segmentScoreInput(input, segment), id: uuid(), createdAt: now(), shortcutProjectId: projectId, segment: { id: segment.id, title: segment.title, startLine: segment.startLine, endLine: segment.endLine }, gemini: config(gemini), suno: config(suno), status: 'queued', tracks: [], taskIds: [], exportDirectory: directory };
      commit([...state.jobs, job]); return job.id;
    },
    startOnly(id) {
      const job = state.jobs.find(item => item.id === id && !item.archived);
      if (!job || !['queued', 'ready'].includes(job.status)) return;
      commit(state.jobs, { running: true, targetIds: [...new Set([...(state.running && state.targetIds || []), id])], notice: '仅处理所选情节；其他等待任务保持暂停。' });
    },
    start() {
      if (state.jobs.some(j => !j.archived && j.status === 'uncertain')) throw new Error('存在提交结果未知的任务，请先填写原任务 ID 恢复，或在服务商确认未提交后重试。');
      commit(state.jobs, { running: true, targetIds: null, notice: '' });
    },
    pause: () => stop('已暂停后续提交；已提交的音乐继续查询。'),
    clear() {
      // Persist history first. A failed history write must never delete the queue.
      const retained = state.jobs.filter(job => job.archived || job.taskIds.length || job.tracks.length || ['submitting', 'uncertain', 'pending', 'pausedQuery'].includes(job.status));
      for (const job of retained) onArchive(job);
      commit(retained.map(job => ({ ...job, archived: true })), { running: false, notice: '配乐任务已清空；作品历史可在「音乐 → 我的作品」查看，已提交音乐继续查询。' });
    },
    remove(id) { const job = state.jobs.find(j => j.id === id); if (!job || !['queued', 'ready', 'error', 'complete'].includes(job.status) || job.exportState === 'exporting') return; commit(state.jobs.filter(j => j.id !== id)); },
    retryPlan(id) { const job = state.jobs.find(j => j.id === id); if (job?.status === 'error' && job.phase !== 'music') patch(id, { status: job.score ? 'ready' : 'queued', error: '' }); },
    recover(id, rawIds) {
      const job = state.jobs.find(j => j.id === id);
      if (!job || !['uncertain', 'pausedQuery'].includes(job.status)) return;
      const ids = rawIds ? [...new Set(rawIds.split(/[,，\s]+/).filter(Boolean))] : job.taskIds;
      if (!ids.length || ids.length > 10 || ids.some(id => id.length > 200)) throw new Error('请输入 1–10 个有效任务 ID。');
      patch(id, { status: 'pending', taskIds: ids, tracks: ids.map(id => ({ id, taskId: id, status: 'pending' })), failures: 0, monitoringSince: now(), lastQueryAt: 0, error: '' });
    },
    confirmNotSubmitted(id) { const job = state.jobs.find(j => j.id === id); if (job?.status === 'uncertain') patch(id, { status: 'ready', error: '' }); },
    async export(id, directory) {
      const job = state.jobs.find(j => j.id === id);
      if (!job || job.status !== 'complete' || job.exportState === 'exporting') return;
      await doExport(job, directory || job.exportDirectory);
    },
    async tick() {
      if (busy) return;
      busy = true;
      let job, phase = '', receivedTracks;
      try {
        const settled = state.jobs.find(j => j.archived && ['complete', 'error'].includes(j.status) && j.exportState !== 'exporting' && !(j.status === 'complete' && j.exportDirectory && !j.exportState));
        if (settled) { onArchive({ ...settled, historyDetached: true }); commit(state.jobs.filter(j => j.id !== settled.id)); return; }
        job = state.jobs.find(j => j.status === 'pending' && now() - (j.lastQueryAt || 0) >= 8000);
        if (job) {
          phase = 'query';
          if (now() - (job.monitoringSince || job.createdAt) > 20 * 60 * 1000) { patch(job.id, { status: 'pausedQuery', error: '已查询 20 分钟，点击继续查询获取结果，不会重新生成。' }); stop(); return; }
          patch(job.id, { lastQueryAt: now() });
          const data = await request('/api/music/query', { provider: providerFor(job.suno), model: job.suno.model, ids: job.taskIds });
          acceptTracks(job.id, Array.isArray(data.tracks) ? data.tracks : []); return;
        }
        job = state.jobs.find(j => j.status === 'complete' && !j.exportState && j.exportDirectory);
        if (job) { phase = 'export'; await doExport(job, job.exportDirectory); return; }
        if (!state.running || state.jobs.some(j => !j.archived && ['pending', 'pausedQuery', 'uncertain'].includes(j.status))) return;
        job = state.jobs.find(j => !j.archived && (!state.targetIds || state.targetIds.includes(j.id)) && ['queued', 'ready'].includes(j.status));
        if (!job) { stop(); return; }
        phase = 'setup';
        // Check both connections before spending on the planning step.
        const suno = providerFor(job.suno);
        if (job.status === 'queued') {
          const gemini = providerFor(job.gemini, true);
          phase = 'plan'; patch(job.id, { status: 'planning', error: '' });
          const result = await request('/api/script/score', { script: job.script, lines: job.lines, subtitleLanguage: job.subtitleLanguage, title: job.title, hint: job.hint, segmentContext: job.segmentContext, segmented: job.segmented, segmentCount: job.segmentCount, durationSeconds: job.durationSeconds, provider: gemini, model: job.gemini.model });
          if (!state.jobs.some(j => j.id === job.id)) return;
          if (job.segmented) {
            const segments = parseSegments(JSON.stringify(result), job, 'suno');
            if (state.jobs.length - 1 + segments.length > 50) throw new Error('分段后超过 50 份任务，请清理旧任务再重试策划。');
            const children = segments.map((segment, index) => ({ ...job, id: uuid(), parentId: job.id, segmented: false, segment, title: `${job.title.slice(0, 45)} · ${index + 1}. ${segment.title}`, lines: job.lines.filter(line => line.sourceLine >= segment.startLine && line.sourceLine <= segment.endLine), status: 'ready', score: segment.score, tracks: [], taskIds: [], error: '' }));
            // One durable transaction: no segment can be submitted twice after a reload.
            commit(state.jobs.flatMap(item => item.id === job.id ? children : [item])); return;
          }
          const score = parseScoreResponse(JSON.stringify(result.score), job.durationSeconds);
          patch(job.id, { status: 'ready', score }); return;
        }
        patch(job.id, { status: 'submitting', error: '' });
        phase = 'submit';
        const data = await request('/api/music/generate', { ...job.score, provider: suno, model: job.suno.model });
        if (!Array.isArray(data.tracks) || !data.tracks.length || !taskIds(data.tracks).length) throw new Error('接口未返回可用任务 ID，请核对服务商记录。');
        receivedTracks = data.tracks;
        patch(job.id, { monitoringSince: now() });
        acceptTracks(job.id, data.tracks);
      } catch (err) {
        const error = err.message || '任务处理失败。';
        stop(error);
        if (job) {
          let change;
          if (phase === 'submit') change = { ...(receivedTracks ? { tracks: receivedTracks, taskIds: taskIds(receivedTracks) } : {}), status: 'uncertain', error: `${error} 提交可能已成功，请核对服务商记录，不会自动重复提交。` };
          else if (phase === 'query') change = { status: (job.failures || 0) >= 2 ? 'pausedQuery' : 'pending', failures: (job.failures || 0) + 1, error, lastQueryAt: now() };
          else if (phase === 'export') change = { exportState: 'error', exportError: error };
          else change = { status: 'error', phase, error };
          try { patch(job.id, change); }
          catch { state = { ...state, jobs: state.jobs.map(j => j.id === job.id ? { ...j, ...change } : j), notice: '任务存储失败，已停止提交。请保留任务 ID，释放本机空间后再继续。' }; emit(); }
        }
      } finally { busy = false; }
    },
  };
}

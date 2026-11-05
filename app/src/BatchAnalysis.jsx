import { MusicUsageHistory } from './MusicUsageHistory.jsx';
import { BATCH_TEXT_LIMIT, BATCH_PROJECT_LIMIT, splitEpisodes, batchSubtitleLines } from '../shared/batch-analysis.mjs';
import { analysisName, openWebAnalyzer, webAnalyzer } from '../shared/script-analyzers.mjs';
import { batchQueue, batchAnalyzers, setBatchProviders, useBatchAnalysis } from './BatchAnalysisStore.mjs';
import { protectPunctuation } from '../electron/period-clipboard.mjs';
import { Pagination } from './Pagination.jsx';
import { MusicDragButton } from './MusicDragButton.jsx';
import { musicUsage } from './MusicUsage.mjs';
import { subtitleClipboardError } from '../shared/period-text.mjs';

const statuses = { queued: '待分析', analyzing: '联合分析中', paused: '已中断', complete: '已完成', error: '需处理' };
const PREFERENCES = 'xm.batch-preferences.v1';
const EPISODES_PER_PAGE = 12;
function preferences() { try { return JSON.parse(localStorage.getItem(PREFERENCES)) || {}; } catch { return {}; } }
function download(text, name, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name.replace(/[<>:"/\\|?*]/g, '_'); anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function copyBatchSubtitles(text, preserve) {
  if (globalThis.blackObsidian?.copySubtitleText) return globalThis.blackObsidian.copySubtitleText(text, { protect: preserve });
  await navigator.clipboard.writeText(preserve ? protectPunctuation(text) : text);
  return { copiedLines: text.split('\n').filter(Boolean).length, clipboardProtected: preserve };
}
function DramaPicker({ id, label, projects, tasks, activeProjectId, disabled, deleteDisabled, onSelect, onDelete }) {
  const [open, setOpen] = i.useState(false), [confirming, setConfirming] = i.useState('');
  const root = i.useRef(null), trigger = i.useRef(null), popup = i.useRef(null);
  const current = projects.find(project => project.id === activeProjectId);
  const deleting = projects.find(project => project.id === confirming);
  const count = projectId => tasks.filter(task => task.projectId === projectId).length;
  const close = (restoreFocus = false) => { setOpen(false); setConfirming(''); if (restoreFocus) trigger.current?.focus(); };
  i.useEffect(() => {
    if (!open) return;
    const outside = event => { if (!root.current?.contains(event.target)) close(); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  i.useEffect(() => {
    if (!open) return;
    const target = confirming ? popup.current?.querySelector('[data-cancel-delete]') : popup.current?.querySelector('[aria-current="true"]') || popup.current?.querySelector('.bos-batch-project-option');
    target?.focus();
  }, [open, confirming]);
  const handleKeys = event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
    else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && open) {
      event.preventDefault();
      const buttons = [...popup.current.querySelectorAll('button:not(:disabled)')];
      const index = buttons.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }
  };
  return <div className="bos-batch-project-select" ref={root} onKeyDown={handleKeys} onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) close(); }}>
    <span>切换剧目</span>
    <button type="button" className="bos-batch-project-trigger" ref={trigger} aria-label={label} aria-expanded={open} aria-controls={id} aria-haspopup="dialog" disabled={disabled || !projects.length} onClick={() => { setOpen(value => !value); setConfirming(''); }} onKeyDown={event => { if (event.key === 'ArrowDown' && !open) { event.preventDefault(); setOpen(true); } }}><span>{current ? `${current.name} · ${count(current.id)} 集` : '暂无剧目，请先输入剧名'}</span><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg></button>
    {open && <div className="bos-batch-project-menu" ref={popup} id={id} role="dialog" aria-label={label + '列表'}>
      {deleting ? <div className="bos-batch-project-delete-confirm"><strong>删除“{deleting.name}”？</strong><p>将同时删除本剧 {count(deleting.id)} 集卡片、字幕和推荐。</p><div><button type="button" data-cancel-delete onClick={() => setConfirming('')}>取消</button><button type="button" className="bos-batch-project-confirm-delete" disabled={deleteDisabled} onClick={async () => { if (await onDelete(deleting.id)) close(true); }}>确认删除剧目</button></div></div> : projects.map(project => <div className={'bos-batch-project-row' + (project.id === activeProjectId ? ' is-current' : '')} key={project.id}>
        <button type="button" className="bos-batch-project-option" aria-label={'切换到 ' + project.name} aria-current={project.id === activeProjectId ? 'true' : undefined} disabled={disabled} onClick={() => { close(true); void onSelect(project.id); }}><span>{project.name}</span><small>{count(project.id)} 集</small>{project.id === activeProjectId && <span className="bos-batch-project-check" aria-hidden="true">✓</span>}</button>
        <button type="button" className="bos-batch-project-delete" aria-label={'删除剧目 ' + project.name} title={'删除 ' + project.name} disabled={deleteDisabled} onClick={() => setConfirming(project.id)}>×</button>
      </div>)}
    </div>}
  </div>;
}
function TaskDialog({ task, preserve, catalog, busy, analyzerName, previousTask, nextTask, position, total, onNavigate, onClose, onRetry }) {
  const dialog = i.useRef(null);
  const body = i.useRef(null), copyLock = i.useRef(false), retryLock = i.useRef(false);
  const [tab, setTab] = i.useState('subtitles'), [feedback, setFeedback] = i.useState({}), [drafts, setDrafts] = i.useState({});
  const [copying, setCopying] = i.useState(false), [submitting, setSubmitting] = i.useState(false);
  const notice = feedback.taskId === task.id ? feedback.notice : '', error = feedback.taskId === task.id ? feedback.error : '';
  const setNotice = notice => setFeedback({ taskId: task.id, notice });
  const setError = error => setFeedback({ taskId: task.id, error });
  const options = drafts[task.id] || { segmented: !!task.settings.segmented, segmentCount: task.settings.segmentCount || 3 };
  const changeOptions = patch => setDrafts(values => ({ ...values, [task.id]: { ...options, ...patch } }));
  const analyzing = task.status === 'analyzing';
  const usage = i.useSyncExternalStore(musicUsage.subscribe, musicUsage.snapshot);
  const extraction = i.useMemo(() => { try { return { lines: batchSubtitleLines(task, preserve) }; } catch (err) { return { lines: [], error: err.message }; } }, [task.script, task.settings.subtitleLanguage, preserve]);
  const subtitleText = extraction.lines.map(line => line.text).join('\n');
  i.useEffect(() => { const element = dialog.current; element.showModal(); return () => element.close(); }, []);
  i.useEffect(() => { if (body.current) body.current.scrollTop = 0; }, [task.id, tab]);
  const copySubtitles = async () => {
    if (copyLock.current) return;
    copyLock.current = true; setCopying(true); setNotice('');
    try {
      const result = await copyBatchSubtitles(subtitleText, preserve);
      setNotice(`已完整复制 ${result.copiedLines || extraction.lines.length} 行字幕${result.clipboardProtected ? '，标点已按剪映兼容方式保护' : ''}。可直接到剪映粘贴。${result.warning || ''}`);
    } catch (err) { setError(subtitleClipboardError(err)); }
    finally { copyLock.current = false; setCopying(false); }
  };
  const reanalyze = async () => {
    if (busy || retryLock.current) return;
    retryLock.current = true; setSubmitting(true); setNotice(''); setTab('music');
    try {
      const status = await onRetry(task, options);
      if (status === 'complete') setNotice('本集音乐推荐已更新。');
    } catch (err) { setError(err.message || '重新分析失败，请重试。'); }
    finally { retryLock.current = false; setSubmitting(false); }
  };
  return <dialog role="dialog" ref={dialog} className="bos-batch-dialog bos-script" aria-labelledby="bos-batch-dialog-title" onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) { const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) onClose(); } }}>
    <button type="button" className="bos-batch-episode-nav bos-batch-episode-prev" aria-label="上一集" title={previousTask ? `上一集：${previousTask.title}` : '已是第一集'} disabled={!previousTask || copying} onClick={() => onNavigate(previousTask.id)}><span className="bos-batch-episode-surface" aria-hidden="true"><svg focusable="false" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m15 6-6 6 6 6" /></svg></span></button>
    <div className="bos-batch-dialog-panel">
    <header className="bos-batch-dialog-heading"><div><span className="bos-script-eyebrow">EPISODE {task.episodeNumber}</span><h2 id="bos-batch-dialog-title">{task.title}</h2><p>{statuses[task.status]} · {task.analyzer || analysisName(task.settings.analyzerKey.split('::').at(-1))}</p></div><button type="button" className="bos-batch-dialog-close" aria-label="关闭任务详情" onClick={onClose}>×</button></header>
    <div className="bos-batch-dialog-tabs" role="group" aria-label="查看任务内容"><button type="button" aria-pressed={tab === 'subtitles'} onClick={() => setTab('subtitles')}>整理字幕 · {extraction.lines.length} 行</button><button type="button" aria-pressed={tab === 'music'} onClick={() => setTab('music')}>本地音乐推荐 · {task.result?.matches?.length || 0} 首</button><button type="button" aria-pressed={tab === 'script'} onClick={() => setTab('script')}>原剧本</button></div>
    <div className="bos-batch-dialog-body" ref={body}>
      {(task.error || error || extraction.error) && <p role="alert" className="bos-script-warning">{error || extraction.error || task.error}</p>}{notice && <p role="status" className="bos-script-message">{notice}</p>}
      {tab === 'subtitles' && <><div className="bos-script-actions"><span>{preserve ? '字幕标点保留已开启' : '标点保护已关闭'} · 此设置独立于工作空间</span><div className="bos-script-actions"><button type="button" disabled={!subtitleText || copying} aria-busy={copying} className="bos-script-primary" onClick={copySubtitles}>{copying ? '正在复制…' : '复制到剪映'}</button><button type="button" disabled={!subtitleText} onClick={() => download(subtitleText, `${task.title}-字幕.txt`)}>导出 TXT</button></div></div><pre className="bos-batch-subtitle-text">{subtitleText || '没有识别到所选语言的台词。请检查“角色：台词”格式，或更改字幕语言后重新导入。'}</pre></>}
      {tab === 'music' && analyzing && <p role="status" className="bos-script-message">正在为本集重新分析{task.settings.segmented ? '多段' : '整段'}音乐…{task.result ? '完成前保留上次推荐。' : ''}</p>}
      {tab === 'music' && <>{task.result ? <><h3>本集配乐思路</h3><p>{task.result.analysis.summary}</p><div className="bos-library-keywords">{task.result.analysis.keywords.map(word => <span key={word}>{word}</span>)}</div>
        {(task.result.segments || [{ id: 'whole', title: '整集配乐', ...task.result.analysis, ...task.result }]).map((section,index) => <section className="bos-batch-music-section" key={section.id}>
          {task.result.segments && <><h3>第 {index+1} 段 · {section.title}</h3><small>原剧本第 {section.startLine}–{section.endLine} 行 · 已评估 {section.evaluated ?? 0} 首候选</small><p>{section.summary}</p><div className="bos-library-keywords">{section.keywords.map(word => <span key={word}>{word}</span>)}</div></>}
          {section.warning && <p className="bos-script-warning">{section.warning}</p>}
          {!!section.matches.length && section.noMatchReason && <p className="bos-script-footnote">{section.noMatchReason}</p>}
          {!section.matches.length && <div className="bos-script-empty"><strong>已分析，暂未找到适合的本地音乐</strong><p>{section.noMatchReason || '已保存关键词，请刷新音乐库后重新匹配。'}</p><small>音乐库 {task.result.total ?? catalog.tracks.length} 首 · 本段评估 {section.evaluated ?? 0} 首候选</small></div>}
          {section.matches.map(match => { const track = catalog.tracks.find(item => item.id === match.id); return <article className="bos-library-match" key={match.id}><h4>{track?.title || match.title || '历史音乐'}</h4><p>{match.reason}</p>{track ? <><audio controls preload="none" src={`/local-music/${track.id}`} aria-label={`试听 ${track.title}`} /><div className="bos-script-actions"><MusicDragButton libraryId={track.id} /><button type="button" aria-pressed={usage.history.some(item => item.id === track.id)} title="再次点击可取消使用标记" onClick={() => { const used = musicUsage.toggle(track); setNotice(used ? `已记录「${track.title}」，后续推荐避开最近使用音乐。` : `已取消「${track.title}」的使用标记，可再次参与推荐。`); }}>{usage.history.some(item => item.id === track.id) ? '已标记使用' : '标记已使用'}</button></div></> : <small>原音乐库当前未连接，请在跑量剪辑流页面重新连接。</small>}</article>; })}
        </section>)}
      </> : <div className="bos-script-empty"><strong>{task.status === 'analyzing' ? '多集剧本正在联合分析' : '尚未完成本地音乐分析'}</strong><p>字幕已在本机整理，音乐结果会按集接回对应卡片。</p></div>}</>}
      {tab === 'script' && <pre className="bos-batch-subtitle-text">{task.script}</pre>}
    </div><footer className="bos-batch-dialog-footer">
      <div className="bos-batch-dialog-analysis">
        <label><span>本集配乐方式</span><select aria-label="本集配乐分析方式" disabled={busy || submitting} value={options.segmented ? 'segments' : 'whole'} onChange={event => changeOptions({ segmented: event.target.value === 'segments' })}><option value="whole">整段分析</option><option value="segments">多段分析</option></select></label>
        {options.segmented && <label><span>最多情节数</span><select aria-label="本集配乐段数" disabled={busy || submitting} value={options.segmentCount} onChange={event => changeOptions({ segmentCount: Number(event.target.value) })}>{[2,3,4,5,6].map(n => <option key={n} value={n}>{n} 段</option>)}</select></label>}
        <button type="button" className="bos-script-primary" disabled={busy || submitting} onClick={reanalyze}>{analyzing ? '正在分析…' : options.segmented ? '重新分析多段音乐' : '重新分析整段音乐'}</button>
      </div>
      <div className="bos-batch-dialog-footer-meta"><small>仅分析本集 · {analyzerName} · {position} / {total} 集</small><button type="button" onClick={onClose}>完成</button></div>
    </footer></div>
    <button type="button" className="bos-batch-episode-nav bos-batch-episode-next" aria-label="下一集" title={nextTask ? `下一集：${nextTask.title}` : '已是最后一集'} disabled={!nextTask || copying} onClick={() => onNavigate(nextTask.id)}><span className="bos-batch-episode-surface" aria-hidden="true"><svg focusable="false" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6" /></svg></span></button>
  </dialog>;
}
export function BatchAnalysis({ active, providers, onNavigate }) {
  setBatchProviders(providers);
  const state = useBatchAnalysis(), models = batchAnalyzers(providers);
  const [draftTexts, setDraftTexts] = i.useState({}), [dramaName, setDramaName] = i.useState(''), [projectViews, setProjectViews] = i.useState({}), [projectPending, setProjectPending] = i.useState(false), [error, setError] = i.useState(''), [notice, setNotice] = i.useState(''), [selected, setSelected] = i.useState(''), [confirmClear, setConfirmClear] = i.useState(false);
  const [settings, setSettings] = i.useState(() => ({ analyzerKey: models[0].key, subtitleLanguage: 'auto', segmented: false, segmentCount: 3 }));
  const [preserve, setPreserve] = i.useState(() => preferences().preserve !== false);
  const [catalog, setCatalog] = i.useState({ tracks: [], directories: [] }), [scanning, setScanning] = i.useState(false);
  const importLock = i.useRef(false), attemptedText = i.useRef(''), dramaNameInput = i.useRef(null), focusNewDrama = i.useRef(false);
  const model = models.find(item => item.key === settings.analyzerKey) || models[0];
  const busy = state.running || !!state.activeIds.length;
  const currentProject = state.projects.find(p => p.id === state.activeProjectId);
  const inputKey = currentProject?.id || 'new';
  const text = draftTexts[inputKey] || '';
  const setText = value => setDraftTexts(previous => ({ ...previous, [inputKey]: value }));
  const requestedName = dramaName.trim();
  const importBusy = busy || projectPending;
  const setView = (id, patch) => setProjectViews(previous => ({ ...previous, [id]: { ...previous[id], ...patch } }));
  i.useEffect(() => { setDramaName(currentProject?.name || ''); attemptedText.current = ''; }, [state.activeProjectId]);
  i.useEffect(() => {
    if (projectPending || !focusNewDrama.current) return;
    focusNewDrama.current = false;
    dramaNameInput.current?.focus(); dramaNameInput.current?.select();
  }, [projectPending, state.activeProjectId]);
  const current = state.tasks.find(task => task.id === selected);
  const currentTasks = state.tasks.filter(task => task.projectId === current?.projectId);
  const currentIndex = currentTasks.findIndex(task => task.id === selected);
  const perform = async action => { setError(''); try { await action(); } catch (err) { setError(err.message || '操作失败。'); } };
  const selectDrama = async id => {
    if (importLock.current || !state.loaded) return;
    const project = state.projects.find(item => item.id === id);
    if (!project) return;
    importLock.current = true; setProjectPending(true); setError('');
    try {
      await batchQueue.selectProject(id);
      setDramaName(project.name); setView(id, { collapsed: false });
      setSelected(''); setConfirmClear(false); setNotice('');
    } catch (err) { setError(err.message || '切换剧目失败，请重试。'); }
    finally { importLock.current = false; setProjectPending(false); }
  };
  const removeDrama = async id => {
    if (importLock.current || importBusy) return false;
    importLock.current = true; setProjectPending(true); setError('');
    try {
      await batchQueue.removeProject(id);
      setDraftTexts(previous => { const next = { ...previous }; delete next[id]; return next; });
      setSelected(''); setConfirmClear(false); setNotice('');
      return true;
    } catch (err) { setError(err.message || '删除剧目失败，请重试。'); return false; }
    finally { importLock.current = false; setProjectPending(false); }
  };
  const projectSelect = label => <DramaPicker id={'bos-picker-' + label} label={label} projects={state.projects} tasks={state.tasks} activeProjectId={state.activeProjectId} disabled={projectPending || !state.loaded} deleteDisabled={importBusy} onSelect={selectDrama} onDelete={removeDrama} />;
  i.useEffect(() => { try { localStorage.setItem(PREFERENCES, JSON.stringify({ preserve })); } catch { setError('字幕保留偏好无法保存，当前开关仍有效。'); } }, [preserve]);
  i.useEffect(() => {
    if (!globalThis.blackObsidian?.setBatchPunctuationEnabled) return;
    let live = true;
    globalThis.blackObsidian.setBatchPunctuationEnabled(active && preserve).catch(err => { if (live) setError(`剪映标点组件未启用：${err.message}。复制时仍会尝试兼容保护。`); });
    return () => { live = false; };
  }, [active, preserve]);
  i.useEffect(() => { if (!active) return; let live = true; Promise.resolve(globalThis.blackObsidian?.getMusicLibrary?.() || { tracks: [], directories: [] }).then(value => { if (live) setCatalog(value); }).catch(err => { if (live) setError(err.message); }); return () => { live = false; }; }, [active]);
  const newDrama = async () => {
    if (importLock.current || importBusy || !state.loaded) return;
    importLock.current = true; setProjectPending(true); setError('');
    try {
      let name = '新剧本', suffix = 2;
      while (state.projects.some(project => project.name === name)) name = `新剧本 ${suffix++}`;
      const id = await batchQueue.createProject(name);
      setDraftTexts(previous => ({ ...previous, [id]: '' }));
      setDramaName(name); setView(id, { collapsed: false, page: 1, filter: 'all' });
      setSelected(''); setConfirmClear(false); setNotice('');
      focusNewDrama.current = true;
    } catch (err) { setError(err.message || '新建剧本失败，请重试。'); }
    finally { importLock.current = false; setProjectPending(false); }
  };
  const saveDrama = async () => {
    if (importLock.current || importBusy || !state.loaded) return;
    importLock.current = true;
    setProjectPending(true); setError('');
    try {
      if (!requestedName) throw new Error('请先输入剧名。');
      const id = currentProject?.id || await batchQueue.createProject(requestedName);
      if (currentProject && requestedName !== currentProject.name) await batchQueue.renameProject(id, requestedName);
      if (id !== inputKey && text) setDraftTexts(previous => ({ ...previous, [inputKey]: '', [id]: [previous[id], text].filter(Boolean).join('\n\n') }));
      setDramaName(requestedName); setView(id, { collapsed: false });
      return id;
    }
    catch (err) { setError(err.message); return ''; }
    finally { importLock.current = false; setProjectPending(false); }
  };
  const importAndAnalyze = async value => {
    if (importLock.current || importBusy || !state.loaded || !value.trim()) return;
    importLock.current = true; setProjectPending(true); attemptedText.current = requestedName + '\n' + value; setError('');
    try {
      const { episodes } = splitEpisodes(value);
      if (!requestedName) throw new Error('请先输入剧名，再粘贴或导入分集。');
      const projectId = currentProject?.id || await batchQueue.createProject(requestedName);
      if (currentProject && requestedName !== currentProject.name) await batchQueue.renameProject(projectId, requestedName);
      const count = await batchQueue.import(episodes, { ...settings, analyzerKey: model.key }, projectId);
      setText(''); setView(projectId, { page: Math.ceil(batchQueue.snapshot().tasks.filter(t => t.projectId === projectId).length / EPISODES_PER_PAGE), collapsed: false });
      setNotice(count ? `已识别并导入 ${count} 集，正在联合分析配乐。字幕已在本机整理。` : '这些剧本与设置已经导入，已有结果保持不变。');
      if (count) void batchQueue.start(batchQueue.snapshot().tasks.filter(t => t.projectId === projectId).map(t => t.id));
    } catch (err) { setError(err.message); }
    finally { importLock.current = false; setProjectPending(false); }
  };
  i.useEffect(() => {
    if (!active || importBusy || !state.loaded || !requestedName || !text.trim() || requestedName + '\n' + text === attemptedText.current) return;
    const timer = setTimeout(() => { void importAndAnalyze(text); }, 1400);
    return () => clearTimeout(timer);
  }, [text, requestedName, active, importBusy, state.loaded, settings.analyzerKey, settings.subtitleLanguage, settings.segmented, settings.segmentCount, model.key]);
  const libraryAction = async method => {
    setScanning(true); setError('');
    try { if (!globalThis.blackObsidian?.[method]) throw new Error('连接音乐库需要使用更新后的桌面程序。'); setCatalog(await globalThis.blackObsidian[method]()); }
    catch (err) { setError(err.message); } finally { setScanning(false); }
  };
  const retry = async (task, options) => {
    await batchQueue.retry(task.id, model.key, options);
    await batchQueue.start([task.id]);
    const latest = batchQueue.snapshot();
    if (latest.error) throw new Error(latest.error);
    return latest.tasks.find(item => item.id === task.id)?.status;
  };
  const retryMany = tasks => perform(async () => { for (const task of tasks) await batchQueue.retry(task.id, model.key, settings); void batchQueue.start(tasks.map(task => task.id)); });
  if (!active) return null;
  return <section className="bos-script bos-batch" aria-labelledby="bos-batch-title">
    <div className="bos-batch-preserve"><div><strong>字幕标点保留</strong><small>默认开启 · 同步启用剪映标点保留，复制时保护逗号、句号和省略号 · 本页独立设置</small></div><button type="button" role="switch" aria-label="跑量字幕标点保留" aria-checked={preserve} className="bos-batch-switch" onClick={() => setPreserve(value => !value)}><span aria-hidden="true" />{preserve ? '已开启' : '已关闭'}</button></div>
    <header className="bos-script-heading"><div><span className="bos-script-eyebrow">BATCH ANALYSIS</span><h2 id="bos-batch-title">多集一起分析，按集独立整理。</h2><p>粘贴剧本即可开始。字幕在本机整理，AI 联合分析剧情并匹配本地音乐。</p></div><span className="bos-script-badge">{state.tasks.filter(task => task.status === 'complete').length} / {state.tasks.length} 集已完成</span></header>
    {(error || state.error) && <p role="alert" className="bos-script-alert">{error || state.error}</p>}{notice && <p role="status" className="bos-script-message">{notice}</p>}
    <section className="bos-script-panel bos-batch-input"><div className="bos-script-section-title bos-batch-project-heading"><h3>粘贴多集剧本</h3>{projectSelect('剧本输入区切换剧目')}</div>
      <div className="bos-batch-drama-name"><label><span>剧名</span><input ref={dramaNameInput} aria-label="剧名" maxLength={40} disabled={importBusy} value={dramaName} onChange={event => setDramaName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void saveDrama(); } }} placeholder="例如：亡妻归来、莫雷蒂夫人" /></label><button type="button" disabled={importBusy || !state.loaded || state.projects.length >= BATCH_PROJECT_LIMIT} title={state.projects.length >= BATCH_PROJECT_LIMIT ? '最多保留 5 个剧本，请先删除不再需要的剧目' : '新建空白剧本'} onClick={newDrama}>新剧本</button>{currentProject && <button type="button" disabled={importBusy || !requestedName || requestedName === currentProject.name} onClick={saveDrama}>重命名当前剧目</button>}<small>{state.projects.length} / {BATCH_PROJECT_LIMIT} 个剧本</small></div>
      <p className="bos-script-footnote">本次粘贴归入：<strong>{requestedName || '请先输入剧名'}</strong>。点击“新剧本”新建空白剧目；修改剧名后按回车保存，从下拉列表切换已有剧目。</p>
      <div className="bos-batch-settings"><label><span>分析模型</span><select aria-label="跑量剪辑流模型" disabled={busy} value={model.key} onChange={event => setSettings(value => ({ ...value, analyzerKey: event.target.value }))}>{models.map(item => <option value={item.key} key={item.key}>{item.label || `${item.model} · ${item.provider.name}`}</option>)}</select></label><label><span>字幕语言</span><select aria-label="跑量字幕语言" disabled={busy} value={settings.subtitleLanguage} onChange={event => setSettings(value => ({ ...value, subtitleLanguage: event.target.value }))}><option value="auto">自动识别</option><option value="zh">中文</option><option value="en">英文</option><option value="es">西语</option></select></label><div className="bos-batch-model-tools">{webAnalyzer(model) ? <button type="button" onClick={() => openWebAnalyzer(model)}>登录 DeepSeek ↗</button> : <button type="button" onClick={() => onNavigate('providers')}>管理 Gemini 连接 ↗</button>}</div></div>
      <div className="bos-batch-segment-settings"><label><span>配乐分析方式</span><select aria-label="跑量配乐分析方式" disabled={busy} value={settings.segmented ? 'segments' : 'whole'} onChange={event => setSettings(value => ({ ...value, segmented: event.target.value === 'segments' }))}><option value="whole">每集整篇推荐</option><option value="segments">每集分析多段音乐</option></select></label>{settings.segmented && <label><span>每集最多情节数</span><select aria-label="每集配乐段数" disabled={busy} value={settings.segmentCount} onChange={event => setSettings(value => ({ ...value, segmentCount: Number(event.target.value) }))}>{[2,3,4,5,6].map(n => <option key={n} value={n}>{n} 段</option>)}</select></label>}<small>根据真实剧情与情绪转折分段，场次编号仅供参考；每段优先推荐 5–8 首本地音乐。</small></div>
      <label><span className="bos-visually-hidden">多集完整剧本</span><textarea aria-label="多集完整剧本" rows={7} maxLength={BATCH_TEXT_LIMIT} disabled={importBusy} value={text} onChange={event => setText(event.target.value)} placeholder={'第1集 重逢\n[EN] JACK: We meet again.\n\n第2集 真相\n[EN] MIA: Tell me the truth.\n\n粘贴后自动识别全部集数，并联合分析本地配乐。'} /></label>
      <div className="bos-script-actions"><small>{text.length.toLocaleString()} / 1,000,000 字符 · 单集不超过 3 万字符</small><button type="button" disabled={!text.trim() || !requestedName || importBusy || !state.loaded} onClick={() => importAndAnalyze(text)}>立即识别并分析</button></div>
      <p className="bos-script-footnote">标题独占一行，支持“第1集”“第一集”“EP01”“Episode 1”。同一批多集一起分析；超长内容按最多 12 集 / 6 万字符分组；多段模式每批最多规划 24 个情节，避免官网截断。网页模型需先登录，Gemini 使用已配置连接。每次 API 分析按服务商规则使用额度。</p>
    </section>
    {!state.projects.length && <div className="bos-script-empty"><strong>输入剧名，开始整理第一部剧</strong><p>每部剧会生成一张独立大卡片，分集字幕与推荐统一保存在其中。</p></div>}
    {state.projects.filter(project => project.id === state.activeProjectId).map(project => {
      const tasks = state.tasks.filter(task => task.projectId === project.id);
      const view = projectViews[project.id] || {}, filter = view.filter || 'all';
      const filtered = tasks.filter(task => filter === 'all' || (filter === 'pending' ? ['queued', 'paused'].includes(task.status) : task.status === filter));
      const count = Math.max(1, Math.ceil(filtered.length / EPISODES_PER_PAGE)), page = Math.max(1, Math.min(view.page || 1, count));
      const pages = {page, count, pageSize: EPISODES_PER_PAGE, setPage: value => setView(project.id, {page:value}), visible: filtered.slice((page-1)*EPISODES_PER_PAGE, page*EPISODES_PER_PAGE)};
      const tasksCollapsed = !!view.collapsed, toggleTasksCollapsed = () => setView(project.id, {collapsed:!tasksCollapsed});
      const setFilter = value => setView(project.id, {filter:value, page:1});
      return (<section key={project.id} className="bos-script-panel bos-batch-tasks is-active-drama" aria-label={"剧目 " + project.name}><header className="bos-script-section-title bos-batch-project-heading"><div><span className="bos-script-eyebrow">EPISODE CARDS</span><h3>{project.name} <small>{tasks.length} 集</small></h3><p role="status">{busy ? `${state.running ? '联合分析中' : '正在中断'} · ${state.activeIds.length} 集` : '点击卡片，打开本集字幕与音乐推荐'}</p></div><div className="bos-batch-project-tools">{projectSelect('任务卡区切换剧目')}<button type="button" className="bos-panel-toggle" aria-expanded={!tasksCollapsed} aria-controls={"bos-batch-tasks-" + project.id} onClick={toggleTasksCollapsed}>{tasksCollapsed ? '展开任务卡' : '收起任务卡'} <span aria-hidden="true">{tasksCollapsed ? '⌄' : '⌃'}</span></button></div></header>
      <div id={"bos-batch-tasks-" + project.id} hidden={tasksCollapsed}>
      <div className="bos-script-actions bos-batch-task-actions">{busy ? <button type="button" disabled={!state.running} onClick={() => batchQueue.pause()}>中断分析</button> : <><button type="button" disabled={!tasks.some(task => ['queued', 'paused'].includes(task.status))} onClick={() => perform(() => batchQueue.start(tasks.map(task => task.id)))}>继续批量分析</button><button type="button" disabled={!tasks.length} onClick={() => retryMany(tasks)}>按当前方式重新分析全部</button>{tasks.some(task => task.status === 'complete' && ((task.result?.segments ? task.result.segments.some(segment => segment.matches.length < 5) : (task.result?.matches?.length || 0) < 5))) && <button type="button" onClick={() => retryMany(tasks.filter(task => task.status === 'complete' && ((task.result?.segments ? task.result.segments.some(segment => segment.matches.length < 5) : (task.result?.matches?.length || 0) < 5))))}>补充不足五首的推荐</button>}{tasks.some(task => task.status === 'error') && <button type="button" onClick={() => perform(async () => { for (const task of tasks.filter(task => task.status === 'error')) await batchQueue.retry(task.id, model.key, settings); void batchQueue.start(tasks.map(task => task.id)); })}>批量重试失败</button>}</>}<button type="button" disabled={!tasks.length} onClick={() => download(JSON.stringify(batchQueue.backup(project.id), null, 2), project.name + '-任务备份.json', 'application/json')}>导出备份</button><button type="button" disabled={busy || !tasks.length} onClick={() => setConfirmClear(project.id)}>清空所有卡片</button></div>
      {confirmClear === project.id && <div className="bos-script-warning"><p>清空后会删除本剧目的所有卡片、字幕记录和推荐结果。工作空间及音乐文件不受影响。</p><button type="button" disabled={busy} onClick={() => perform(async () => { await batchQueue.clear(project.id); setConfirmClear(false); setSelected(''); })}>确认清空所有卡片</button> <button type="button" onClick={() => setConfirmClear(false)}>取消</button></div>}
      <div className="bos-batch-filter" role="group" aria-label="任务状态筛选">{[['all', '全部'], ['pending', '待分析'], ['complete', '已完成'], ['error', '需处理']].map(([value, label]) => <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div>
      {!filtered.length ? <div className="bos-script-empty"><strong>{state.loaded ? '剧本准备好，粘贴即可开始' : '正在加载任务存档…'}</strong><p>每一集都会整理成一张独立卡片，关闭软件后仍可查看。</p></div> : <div className="bos-batch-cards">{pages.visible.map(task => <article className="bos-batch-card" key={task.id} data-status={task.status}><button type="button" className="bos-batch-card-open" onClick={() => setSelected(task.id)} aria-label={`查看第${task.episodeNumber}集字幕与音乐`}><span className="bos-batch-card-top"><strong>第 {task.episodeNumber} 集</strong><span className="bos-script-state">{task.status === 'complete' && !task.result?.matches?.length ? '已分析 · 暂无匹配' : statuses[task.status]}</span></span><span className="bos-batch-card-title">{task.title}</span><small>{task.subtitleCount == null ? '字幕已可预览' : `${task.subtitleCount} 行字幕`} · {task.result?.segments ? `${task.result.segments.length} 段 · ` : ''}{task.result?.matches?.length || 0} 首音乐推荐</small>{task.error && <span className="bos-batch-card-error">{task.error}</span>}<span className="bos-batch-card-link">查看字幕与配乐 ↗</span></button><button type="button" className="bos-batch-card-close" disabled={busy} aria-label={`关闭第${task.episodeNumber}集卡片`} title="移除此卡片及其推荐" onClick={() => perform(() => batchQueue.remove(task.id))}>×</button></article>)}</div>}
      {filtered.length > EPISODES_PER_PAGE && <Pagination {...pages} unit="集" label="跑量任务分页" />}
      <p className="bos-script-footnote">5 个剧目共保存最多 200 张卡片。批量请求完成后按集保存结果；中断保留已完成卡片，重启后手动继续待处理批次。最近使用的音乐会自动从下次推荐候选中排除。</p>
      </div>
    </section>);
    })}
    <section className="bos-batch-library"><div><strong>本地音乐库</strong><p>{catalog.tracks.length} 首可用音乐 · {catalog.directories.length} 个文件夹</p><small>{catalog.directories.map(folder => `${folder.path}（${folder.count ?? 0} 首${folder.error ? `；${folder.error}` : ''}）`).join(' · ') || '未连接音乐时，先分析剧本关键词；连接后可重新匹配。'}</small>{catalog.warning && <p className="bos-script-warning" role="status">{catalog.warning}</p>}</div><div className="bos-script-actions"><button type="button" disabled={scanning || busy} onClick={() => libraryAction('connectMusicLibrary')}>{scanning ? '扫描中…' : '连接音乐文件夹'}</button><button type="button" disabled={scanning || busy || !catalog.directories.length} onClick={() => libraryAction('refreshMusicLibrary')}>刷新</button></div></section>
    <MusicUsageHistory tracks={catalog.tracks} scope="batch" />
    {current && <TaskDialog task={current} preserve={preserve} catalog={catalog} busy={busy} analyzerName={analysisName(model)} previousTask={currentTasks[currentIndex - 1]} nextTask={currentTasks[currentIndex + 1]} position={currentIndex + 1} total={currentTasks.length} onNavigate={setSelected} onClose={() => setSelected('')} onRetry={retry} />}
  </section>;
}

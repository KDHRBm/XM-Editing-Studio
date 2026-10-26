import { MusicDragButton } from './MusicDragButton.jsx';
import { connectScriptQueue } from './ScriptQueueBridge.mjs';
import { SCRIPT_LIMIT, splitScript, isGeminiModel, isSunoModel } from '../shared/script-score.mjs';
import { QUEUE_KEY, createScriptQueue } from '../shared/script-queue.mjs';
import { importScriptScore, syncScriptMusic } from './MusicStudio.jsx';
import { MusicLibrary, clearCurrentLibraryMatch } from './MusicLibrary.jsx';
import { usePanelCollapsed } from './PanelState.jsx';
import { useScriptProjects } from './ScriptProjects.jsx';
import { PeriodKeeper, copySubtitleText } from './PeriodKeeper.jsx';
import { findSegmentJob } from '../shared/segment-shortcut.mjs';
import { installMusicPlayback } from './music-playback.mjs';
import { WEB_ANALYZERS, webAnalyzer, analysisName, analysisReady, openWebAnalyzer } from '../shared/script-analyzers.mjs';
import { requestScriptAnalysis } from './AnalysisRequest.mjs';

const DRAFT = 'black-obsidian.script-draft.v1';
const SETTINGS = 'black-obsidian.script-settings.v1';
let runtime, providersNow = [];
const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
function getRuntime() {
  if (runtime) return runtime;
  let saved = [], loadError = '';
  try { saved = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch { loadError = '任务缓存无法读取。请保留现有缓存，修复后再提交。'; }
  const options = {
    initial: saved,
    save: jobs => { if (loadError) throw new Error(loadError); localStorage.setItem(QUEUE_KEY, JSON.stringify(jobs)); },
    getProvider: id => providersNow.find(p => p.id === id),
    request: async (url, body) => {
      if (url === '/api/script/score') return requestScriptAnalysis('score', body, webAnalyzer(body.provider) ? undefined : AbortSignal.timeout(135000));
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(url.endsWith('generate') ? 195000 : 135000) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `请求失败（HTTP ${response.status}）`);
      return result;
    },
    exportMaterials: payload => {
      if (!globalThis.blackObsidian?.exportScriptMaterials) throw new Error('导出本地素材需要使用更新后的桌面程序。');
      return globalThis.blackObsidian.exportScriptMaterials(payload);
    },
    onComplete: syncScriptMusic,
    onArchive: syncScriptMusic,
  };
  try { runtime = createScriptQueue(options); }
  catch (error) { loadError = error.message; runtime = createScriptQueue({ ...options, initial: [] }); }
  runtime.loadError = loadError;
  connectScriptQueue(runtime);
  return runtime;
}
export function useScriptAutomation(providers) {
  providersNow = providers;
  const queue = getRuntime();
  const state = i.useSyncExternalStore(queue.subscribe, queue.snapshot);
  i.useEffect(() => {
    for (const job of queue.snapshot().jobs) if (job.archived || (job.status === 'complete' && job.primary && (job.score || job.source === 'library'))) { try { syncScriptMusic(job); } catch { /* Queue remains durable. */ } }
    const timer = setInterval(() => { void queue.tick(); }, 1000);
    const disposePlayback = installMusicPlayback(document);
    return () => { clearInterval(timer); disposePlayback(); };
  }, [queue]);
  return { queue, ...state };
}
const labels = { queued: '等待处理', planning: '模型策划中', ready: '提示词就绪', submitting: '提交 Suno 中', pending: '配乐生成中', complete: '配乐已完成', uncertain: '待核对提交', pausedQuery: '查询已暂停', error: '需要处理' };

export function ScriptAutomation({ providers, automation, onNavigate }) {
  const { queue, running, notice } = automation;
  const jobs = automation.jobs.filter(job => !job.archived);
  const projects = useScriptProjects();
  const draft = projects.project.draft;
  const [directory, setDirectory] = i.useState(() => read(SETTINGS, {}).directory || read('black-obsidian.music-settings.v1', {}).downloadDirectory || '');
  const [localDirectory, setLocalDirectory] = i.useState(() => read(SETTINGS, {}).localDirectory ?? read(SETTINGS, {}).directory ?? '');
  const [error, setError] = i.useState('');
  const [message, setMessage] = i.useState('');
  const [collapsed, toggleCollapsed] = usePanelCollapsed('script');
  const [linesCollapsed, toggleLinesCollapsed] = usePanelCollapsed('english-lines');
  const [recovery, setRecovery] = i.useState({});
  const [confirm, setConfirm] = i.useState('');
  const [opened, setOpened] = i.useState('');
  const models = providers.flatMap(provider => (provider.models || []).map(model => ({ key: `${provider.id}::${model}`, providerId: provider.id, protocol: provider.protocol, baseUrl: provider.baseUrl, provider, model })));
  const geminis = [...models.filter(m => isGeminiModel(m.provider, m.model)), ...WEB_ANALYZERS];
  const sunos = models.filter(m => isSunoModel(m.provider, m.model));
  const gemini = geminis.find(m => m.key === draft.geminiKey) || geminis[0];
  const analyzerName = analysisName(gemini);
  const stages = ['提取字幕', 'AI 分析剧本', '选择或生成音乐', '剪映素材'];
  const suno = sunos.find(m => m.key === draft.sunoKey) || sunos[0];
  const extraction = i.useMemo(() => { try { return { lines: draft.script.trim() ? splitScript(draft.script, draft.subtitleLanguage || 'auto') : [], error: '' }; } catch (err) { return { lines: [], error: err.message }; } }, [draft.script, draft.subtitleLanguage]);
  const subtitleLines = extraction.lines;
  const change = values => { projects.change(values); setError(''); };
  const clearCurrent = () => perform(() => {
    queue.clear();
    clearCurrentLibraryMatch(projects.project.id, draft);
    projects.clearCurrent();
    setError('');
    setMessage('已清空当前内容和配乐任务，作品历史保留在「音乐 → 我的作品」。');
  });
  const perform = async fn => { setError(''); try { await fn(); } catch (err) { setError(err.message || '操作失败。'); } };
  const enqueue = start => perform(() => {
    if (!gemini || !suno) throw new Error('请选择剧本分析模型，并配置 Suno 音乐模型。');
    if (!analysisReady(gemini) || !suno.provider.apiKey?.trim()) throw new Error('所选 API 连接缺少密钥，请先补充。DeepSeek、豆包网页版只需登录账号。');
    if (extraction.error) throw new Error(extraction.error);
    const lines = subtitleLines;
    const id = queue.add({ ...draft, lines }, gemini, suno, directory);
    setOpened(id); change({ script: '', title: '' });
    setMessage(draft.segmented ? `剧本已加入分段配乐队列；${analyzerName} 完成策划后将展开为多个独立音乐任务。` : '剧本已加入队列；可继续粘贴下一份剧本。');
    if (start) queue.start();
  });
  const chooseDirectory = (local = false) => perform(async () => {
    if (!globalThis.blackObsidian?.chooseDirectory) throw new Error('请在桌面程序中选择保存目录。');
    const selected = await globalThis.blackObsidian.chooseDirectory();
    if (selected) { localStorage.setItem(SETTINGS, JSON.stringify({ ...read(SETTINGS, {}), [local ? 'localDirectory' : 'directory']: selected })); (local ? setLocalDirectory : setDirectory)(selected); }
  });
  const exportLines = () => perform(() => {
    const url = URL.createObjectURL(new Blob([subtitleLines.map(l => l.text).join('\n')], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = '逐行字幕.txt'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  const copyLines = () => perform(async () => { const result = await copySubtitleText(subtitleLines.map(line => line.text).join('\n')); setMessage(result.clipboardProtected ? `已完整复制 ${result.copiedLines} 行台词，已按原工具保护标点，可粘贴到剪映。` : '已复制字幕台词，使用标准英文标点。'); });
  const useLocalMusic = (track, analysis, reason, lines, segment) => {
    if (extraction.error) throw new Error(extraction.error);
    const id = queue.addLocal({ ...draft, lines, title: segment ? `${draft.title.slice(0, 45)} · ${segment.title}` : draft.title }, track, analysis, reason, localDirectory, window.location.origin);
    setOpened(id); setMessage(localDirectory ? '已选用本地音乐，正在准备导出素材。' : '已选用本地音乐。选择素材文件夹后，可从下方任务导出。');
  };
  const segmentJob = segment => {
    try { return findSegmentJob(automation.jobs, { ...draft, lines: subtitleLines }, segment, projects.project.id); }
    catch { return null; }
  };
  const viewSegmentJob = job => {
    if (job.archived) { onNavigate('music'); return; }
    setOpened(job.id);
    if (collapsed) toggleCollapsed();
    setTimeout(() => document.getElementById('bos-script-queue-body')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };
  const generateSegment = segment => {
    if (queue.loadError) throw new Error(queue.loadError);
    if (!analysisReady(gemini) || !suno?.provider.apiKey?.trim()) throw new Error('请选择可用的剧本分析模型，并配置 Suno 模型及 API 密钥。');
    if (extraction.error) throw new Error(extraction.error);
    const id = queue.addSegment({ ...draft, lines: subtitleLines }, segment, projects.project.id, gemini, suno, directory);
    queue.startOnly(id);
    setOpened(id); setMessage('已为「' + segment.title + '」启动配乐任务，当前剧本和其他情节推荐已保留。');
  };
  const complete = jobs.filter(j => j.status === 'complete').length;
  const selectModel = (label, list, selected, key) => <label><span>{label}</span><select aria-label={label} value={selected?.key || ''} onChange={e => change({ [key]: e.target.value })}>{!list.length && <option value="">先添加模型与连接</option>}{list.map(m => <option key={m.key} value={m.key} title={m.model}>{m.label || `${m.model} · ${m.provider.name}`}</option>)}</select></label>;

  const localSettings = <div className="bos-local-match-settings">
    <div className="bos-script-section-title"><h4>本地音乐匹配</h4><button type="button" onClick={() => onNavigate('providers')}>管理连接 ↗</button></div>
    <div className="bos-local-match-grid">
      <div>{selectModel('本地匹配分析模型', geminis, gemini, 'geminiKey')}{webAnalyzer(gemini) && <button type="button" onClick={() => openWebAnalyzer(gemini)}>打开 {analyzerName} 登录</button>}</div>
      <label><span>匹配方式</span><select aria-label="本地音乐匹配方式" value={draft.segmented ? 'segments' : 'whole'} onChange={event => change({ segmented: event.target.value === 'segments' })}><option value="whole">整篇剧本统一配乐</option><option value="segments">按情节分段配乐</option></select></label>
      {draft.segmented && <label><span>最多情节段数</span><select aria-label="本地匹配最多情节段数" value={draft.segmentCount || 3} onChange={event => change({ segmentCount: Number(event.target.value) })}>{[2,3,4,5,6].map(count => <option value={count} key={count}>{count} 段</option>)}</select></label>}
      <label><span>剪映素材文件夹</span><div className="bos-script-folder"><input aria-label="剪映素材文件夹" readOnly value={localDirectory} placeholder="选择后，选用音乐自动导出素材" /><button type="button" onClick={() => chooseDirectory(true)}>选择</button></div><small>每份剧本独立保存音频、字幕台词和配乐说明。</small></label>
    </div>
    <p className="bos-script-footnote">{analyzerName} {draft.segmented ? '按场景、事件和情绪转折划分情节，各段分别匹配本地音乐。' : '读取完整剧本，推荐适合整篇故事的本地音乐。'}模型和分段方式与当前剧本同步；缺少合适音乐时，可按段使用右侧配置的 Suno 模型生成。</p>
  </div>;

  return <section className="bos-script" aria-labelledby="bos-script-title">
    <div className="bos-script-group">
    <header className="bos-script-heading"><div><span className="bos-script-eyebrow">SCRIPT TO SOUND</span><h2 id="bos-script-title">让剧本，自带配乐。</h2><p>提取字幕，用完整故事匹配本地音乐，也可通过 Suno 创作配乐。</p></div><div className="bos-panel-heading-actions"><span className="bos-script-badge">{running ? '配乐队列运行中' : '字幕台词 · 本地音乐'}</span><button type="button" className="bos-panel-toggle" onClick={clearCurrent} disabled={!draft.script && !draft.hint && !draft.customKeywords && !projects.project.recommendation && !jobs.length} title="清空当前内容和配乐任务列表，作品历史保留在音乐页；已提交音乐继续查询">清空当前内容</button><button type="button" className="bos-panel-toggle" aria-expanded={!collapsed} aria-controls="bos-script-body bos-script-queue-body" onClick={toggleCollapsed}>{collapsed ? '展开剧本配乐' : '收起剧本配乐'} <span aria-hidden="true">{collapsed ? '⌄' : '⌃'}</span></button></div></header>
    <div id="bos-script-body" hidden={collapsed}>
    <ol className="bos-script-steps">{stages.map((stage, index) => <li key={stage}><b>{String(index + 1).padStart(2, '0')}</b><span>{stage}</span></li>)}</ol>
    {(error || queue.loadError || projects.storageError) && <div className="bos-script-alert" role="alert">{error || queue.loadError || projects.storageError}</div>}
    <div className="bos-project-bar"><div className="bos-project-tabs" role="tablist" aria-label="选择剧本">{projects.projects.map((p, index) => <div className="bos-project-tab" key={p.id}><button type="button" role="tab" aria-selected={p.id === projects.project.id} title={p.draft.title} onClick={() => projects.select(p.id)}>剧本 {index + 1}{p.recommendation && <span aria-label="已有推荐"> ·</span>}</button><button type="button" className="bos-project-close" aria-label={`关闭剧本 ${index + 1}`} title="关闭并存入历史" onClick={() => projects.close(p.id)}>×</button></div>)}</div><div className="bos-project-tools"><button type="button" onClick={() => perform(projects.add)}>＋ 新建剧本</button><label><span className="bos-visually-hidden">历史剧本</span><select aria-label="历史剧本" value="" onChange={e => perform(() => projects.restore(e.target.value))}><option value="">历史剧本 · {projects.history.length} / 5</option>{projects.history.map(p => <option key={p.id} value={p.id}>{p.draft.title} · {p.recommendation ? '查看历史推荐' : '查看原文'}</option>)}</select></label><button type="button" disabled={!projects.history.length} title="清空历史剧本和历史推荐，保留当前打开的剧本及生成任务" onClick={() => perform(() => { projects.clearHistory(); setMessage("历史剧本及其推荐已清空。"); })}>清空历史</button></div></div>
    <div className="bos-script-layout">
      <div className="bos-script-panel">
        <div className="bos-script-section-title"><h3>01 / 剧本与字幕</h3><span>粘贴后自动提取</span></div>
        <label><span>粘贴完整剧本 <small>{draft.script.length} / {SCRIPT_LIMIT.toLocaleString()}</small></span><textarea className="bos-script-input" rows={7} maxLength={SCRIPT_LIMIT} value={draft.script} onChange={e => change({ script: e.target.value })} placeholder={'3-1 日 外 银泉庄园大门\n守卫甲：你好，请问二位有请柬吗？\n[EN] GUARD A: Good day. May I see your invitation?\n△ 车窗缓缓降下。\n凯尔：我来见我的家人。\n[EN] KYLE: I came to see my family.'} /></label>
        <p className="bos-script-footnote">完整剧本用于所选模型的剧情分析；英文用 [EN]，西语用 [ES]。选择中文可直接提取“角色：台词”，也支持 [ZH] / [CN]。仅保留角色冒号后的台词，去除动作说明，按停顿分行；省略号统一为 ...。</p>
        <label><span>字幕语言</span><select aria-label="字幕语言" value={draft.subtitleLanguage || "auto"} onChange={event => change({ subtitleLanguage: event.target.value })}><option value="auto">自动识别英文 / 西语（保留原文顺序）</option><option value="en">仅英文 [EN]</option><option value="es">仅西语 [ES]</option><option value="zh">仅中文（角色：台词）</option></select></label>
        <div className="bos-script-lines">
          <div className="bos-script-section-title"><strong>字幕台词 · {subtitleLines.length} 行</strong><div className="bos-script-actions"><button type="button" disabled={!subtitleLines.length} onClick={copyLines}>复制全部</button><button type="button" disabled={!subtitleLines.length} onClick={exportLines}>导出台词 TXT</button><button type="button" className="bos-lines-toggle" aria-label={linesCollapsed ? '展开台词框' : '收起台词框'} title={linesCollapsed ? '展开台词框' : '收起台词框'} aria-expanded={!linesCollapsed} aria-controls="bos-english-body" onClick={toggleLinesCollapsed}>{linesCollapsed ? '⌄' : '⌃'}</button></div></div>
          <PeriodKeeper text={subtitleLines.map(line => line.text).join('\n')} />
          <div id="bos-english-body" hidden={linesCollapsed}>
          {extraction.error && <p className="bos-script-warning">{extraction.error}</p>}
          {!subtitleLines.length && <p className="bos-english-empty">{draft.script.trim() ? (draft.subtitleLanguage === 'zh' ? '未找到中文角色台词。请使用“小明：你好。”或“[ZH] 小明：你好。”格式，只提取角色冒号后的内容。' : '未找到所选语言的字幕。请使用 [EN] JACK: Hello. 或 [ES] JOSÉ: ¡Hola! 格式；中文剧本请选择“仅中文”。') : '粘贴剧本后，字幕台词会直接逐行显示在这里。'}</p>}
          <div className="bos-english-lines" aria-label="提取的字幕台词">{subtitleLines.map(line => <p key={line.id} lang={line.language || "en"}>{line.text}</p>)}</div>
          </div>
        </div>
      </div>
      <div className="bos-script-panel bos-script-config">
        <div className="bos-script-section-title"><h3>02 / Suno 生成配乐</h3><button type="button" onClick={() => onNavigate('providers')}>管理连接 ↗</button></div>
        {selectModel('剧本分析模型', geminis, gemini, 'geminiKey')}
        {webAnalyzer(gemini) && <div className="bos-web-analyzer-note"><p>{analyzerName} 使用内嵌官方网页分析，无需 API 配置。首次使用需登录账号，模型选项与额度以官网为准。</p><button type="button" onClick={() => openWebAnalyzer(gemini)}>打开 {analyzerName} 登录</button></div>}
        <div className="bos-segment-settings"><label><span>配乐方式</span><select aria-label="配乐方式" value={draft.segmented ? 'segments' : 'whole'} onChange={event => change({ segmented: event.target.value === 'segments' })}><option value="whole">整篇剧本统一配乐</option><option value="segments">按情节分段配乐</option></select></label>{draft.segmented && <><label><span>最多情节段数</span><select aria-label="最多情节段数" value={draft.segmentCount || 3} onChange={event => change({ segmentCount: Number(event.target.value) })}>{[2,3,4,5,6].map(count => <option value={count} key={count}>{count} 段</option>)}</select></label><p className="bos-script-footnote">{analyzerName} 为各情节生成独立提示词；每段单独提交 Suno，最多产生 {draft.segmentCount || 3} 次音乐生成费用。目标时长按每段计算。</p></>}</div>
        {selectModel('Suno 音乐模型', sunos, suno, 'sunoKey')}
        <label><span>{draft.segmented ? '每段目标时长 / 秒' : '目标时长 / 秒'}</span><input type="number" min={15} max={480} value={draft.durationSeconds} onChange={e => change({ durationSeconds: e.target.value })} /><small>15–480 秒，实际长度由 Suno 决定。</small></label>
        <label><span>音乐保存目录</span><div className="bos-script-folder"><input aria-label="音乐保存目录" readOnly value={directory} placeholder="选择后，生成完成自动保存音乐" /><button type="button" onClick={() => chooseDirectory()}>选择</button></div><small>按配乐方案的情绪调性和主要乐器命名，音频直接存入此目录；同名自动加序号。</small></label>
        <div className="bos-script-submit"><button type="button" onClick={() => enqueue(false)} disabled={!draft.script.trim() || !!queue.loadError}>加入队列</button><button type="button" className="bos-script-primary" onClick={() => enqueue(true)} disabled={!draft.script.trim() || !!queue.loadError}>{draft.segmented ? '一键生成多段配乐 ↗' : '一键生成配乐 ↗'}</button></div><p className="bos-script-footnote">{webAnalyzer(gemini) ? `${analyzerName} 分析使用官方网页账号额度；Suno 音乐生成按原服务商规则计费。` : `开始后会调用 ${analyzerName} 与 Suno 服务，按服务商规则计费。`}{draft.segmented ? '各段按顺序生成；暂停只停止后续提交，已经提交的继续查询。' : '整篇剧本统一配乐。'}</p>
      </div>
    </div>
    </div>
    </div>
    <div><MusicLibrary key={projects.project.id} input={draft} projectId={projects.project.id} savedRecommendation={projects.project.recommendation} onAnalysis={projects.remember} onChange={change} lines={subtitleLines} gemini={gemini} settings={localSettings} onUse={useLocalMusic} onGenerate={generateSegment} segmentJob={segmentJob} onViewJob={viewSegmentJob} /></div>
    <div id="bos-script-queue-body" hidden={collapsed}>
    {(message || notice) && <p role="status" className="bos-script-message">{notice || message}</p>}
    <section className="bos-script-queue" aria-label="剧本配乐任务队列">
      <div className="bos-script-queue-heading"><div><span className="bos-script-eyebrow">PRODUCTION QUEUE</span><h3>配乐任务 <small>{complete} / {jobs.length} 已完成</small></h3></div><div className="bos-script-actions"><button type="button" disabled={!jobs.length} onClick={() => perform(queue.clear)}>清空任务</button>{running ? <button type="button" onClick={queue.pause}>暂停后续提交</button> : <button type="button" className="bos-script-primary" disabled={!jobs.some(j => ['queued', 'ready'].includes(j.status)) || !!queue.loadError} onClick={() => perform(queue.start)}>开始队列</button>}<span>{running ? '按顺序处理' : '等待开始'}</span></div></div>
      {!jobs.length && <div className="bos-script-empty"><span>♫</span><strong>你的第一段故事，等待配乐。</strong><p>加入剧本后，提示词、生成进度和剪映素材会集中显示在这里。</p></div>}
      {jobs.map((job, index) => <article key={job.id} className="bos-script-job" data-status={job.status}>
        <div className="bos-script-job-heading"><div className="bos-script-job-number">{String(index + 1).padStart(2, '0')}</div><div><h4>{job.title}</h4><small>{job.lines.filter(l => l.kind !== 'scene').length} 行台词 · {job.source === 'library' ? `本地音乐 · ${job.localTrack.title}` : `目标 ${job.durationSeconds} 秒 · ${job.suno.model}`}</small></div><span className="bos-script-state">{job.source === 'library' ? '已选用本地音乐' : (job.status === 'planning' ? `${analysisName(job.gemini)} 策划中` : labels[job.status] || job.status)}</span></div>
        {job.segment && <p className="bos-script-footnote">情节：{job.segment.title} · 原文第 {job.segment.startLine}–{job.segment.endLine} 行 · {job.segment.summary}</p>}
        {job.error && <p className="bos-script-warning">{job.error}</p>}
        {!!job.taskIds.length && <p className="bos-script-ids">任务 ID：{job.taskIds.join('、')}</p>}
        {job.primary && <><audio controls preload="none" src={job.primary.audioUrl} aria-label={`${job.title} 配乐试听`} /><MusicDragButton libraryId={job.source === "library" ? job.localTrack.id : ""} url={job.primary.audioUrl} filePath={job.source === "library" ? "" : job.exportPath} /></>}
        {job.source === 'library' && <details><summary>查看匹配理由与字幕台词</summary><p>{job.analysis.summary}</p><p>{job.analysis.keywords.join(' · ')}</p><p>{job.matchReason}</p><pre>{job.lines.map(line => line.text).join('\n')}</pre></details>}
        {job.score && <details open={opened === job.id} onToggle={e => { if (e.currentTarget.open) setOpened(job.id); else if (opened === job.id) setOpened(''); }}><summary>查看 {analysisName(job.gemini)} 配乐方案与台词</summary><p>{job.score.summary}</p><div className="bos-script-score"><div><strong>音乐风格</strong><p>{job.score.style}</p></div><div><strong>音乐结构</strong><pre>{job.score.prompt}</pre></div></div><details><summary>查看整理后的 {job.lines.length} 行文本</summary><pre>{job.lines.map(l => `${l.kind === 'scene' ? '【场景】' : l.speaker ? l.speaker + '：' : ''}${l.text}`).join('\n')}</pre></details><button type="button" onClick={() => perform(() => { importScriptScore(job); onNavigate('music'); })}>导入音乐页继续编辑</button><small className="bos-script-edit-note">音乐页再次提交会创建新作品。</small></details>}
        {job.status === 'uncertain' && <div className="bos-script-recovery"><label><span>从服务商记录找回任务 ID</span><input aria-label={`恢复任务 ${job.title}`} value={recovery[job.id] || ''} onChange={e => setRecovery(r => ({ ...r, [job.id]: e.target.value }))} placeholder="多个 ID 用逗号分隔" /></label><button type="button" onClick={() => perform(() => queue.recover(job.id, recovery[job.id]))}>恢复查询</button><button type="button" onClick={() => setConfirm(job.id)}>服务商未收到任务</button>{confirm === job.id && <div className="bos-script-warning"><p>仅当服务商记录已确认没有该任务时继续，下一次开始会重新提交并可能计费。</p><button type="button" onClick={() => perform(() => { queue.confirmNotSubmitted(job.id); setConfirm(''); })}>已核对未提交，允许重试</button><button type="button" onClick={() => setConfirm('')}>取消</button></div>}</div>}
        <div className="bos-script-job-actions">{job.status === 'pausedQuery' && <button type="button" onClick={() => perform(() => queue.recover(job.id))}>继续查询原任务</button>}{job.status === 'error' && job.phase !== 'music' && <button type="button" onClick={() => perform(() => queue.retryPlan(job.id))}>修复后重新排队</button>}{job.status === 'complete' && <button type="button" disabled={job.exportState === 'exporting'} onClick={() => perform(() => queue.export(job.id, job.source === 'library' ? localDirectory : directory))}>{job.exportState === 'exporting' ? '正在保存…' : job.source === 'library' ? (job.exportState === 'done' ? '再次导出素材' : '导出剪映素材') : (job.exportState === 'done' ? '再次保存音乐' : '保存音乐')}</button>}{['queued', 'ready', 'error', 'complete'].includes(job.status) && <button type="button" disabled={job.exportState === 'exporting'} onClick={() => perform(() => queue.remove(job.id))}>移除记录</button>}</div>
        {job.exportPath && <p className="bos-script-export">已保存：{job.exportPath}</p>}{job.exportError && <p className="bos-script-warning">保存失败：{job.exportError} 可重新保存，无需重新生成配乐。</p>}
      </article>)}
      <p className="bos-script-footnote">切换页面不影响队列。关闭软件后任务记录保留；重启会继续查询已提交的任务，新任务需点击开始。Suno 音乐按调性与乐器命名，直接保存音频；本地音乐仍可导出配乐与台词底稿。台词也可单独导出 TXT。</p>
    </section>
    </div>
  </section>;
}

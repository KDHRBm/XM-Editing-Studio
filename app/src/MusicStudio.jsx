import { MusicDragButton } from './MusicDragButton.jsx';
import { Pagination, usePages } from './Pagination.jsx';
import { creationRows, groupCreationRows } from '../shared/creation-pages.mjs';
import { usePanelCollapsed } from './PanelState.jsx';
import { scriptMusicHistory } from '../shared/script-music-history.mjs';
import { recoverScriptMusic } from './ScriptQueueBridge.mjs';
import { MUSIC_LIMITS, SECTION_TYPES, STYLE_PRESETS, addStyleTag, autoTitle, normalizeMusicOptions, serializeStructure, mergeTracks, isFailed, isComplete, safeMediaUrl } from '../shared/music-options.mjs';
import { musicFileStem, safeMusicStem } from '../shared/music-filename.mjs';

const DRAFT_KEY = 'black-obsidian.music-draft.v2';
const JOBS_KEY = 'black-obsidian.music-jobs.v2';
const SETTINGS_KEY = 'black-obsidian.music-settings.v1';
const CACHE_FILE = 'black-obsidian-music-cache.json';
const initialSettings = () => ({ cacheDirectory: '', downloadDirectory: '' });
const readSettings = () => {
  const value = read(SETTINGS_KEY, initialSettings());
  return value && typeof value === 'object' ? { ...initialSettings(), ...value } : initialSettings();
};
const uid = () => globalThis.crypto.randomUUID();
const section = (tag, content = '') => ({ id: uid(), tag, content });
const initialDraft = () => ({ mode: 'custom', title: '', brief: '', style: '', instrumental: true, voice: '', modelKey: '', editor: 'structure', raw: '', sections: [section('Intro'), section('Verse'), section('Chorus'), section('Outro')] });
function read(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function loadDraft() {
  const base = initialDraft(), saved = read(DRAFT_KEY, {});
  if (!saved || typeof saved !== 'object') return base;
  for (const key of ['title', 'brief', 'style', 'voice', 'modelKey', 'raw']) if (typeof saved[key] === 'string') base[key] = saved[key];
  base.mode = saved.mode === 'simple' ? 'simple' : 'custom';
  base.editor = saved.editor === 'raw' ? 'raw' : 'structure';
  base.instrumental = saved.instrumental !== false;
  if (Array.isArray(saved.sections) && saved.sections.length && saved.sections.length <= 24 && saved.sections.every(s => s && typeof s.tag === 'string' && typeof s.content === 'string')) base.sections = saved.sections.map(s => ({ ...s, id: s.id || uid() }));
  return base;
}
const readJobs = () => { const value = read(JOBS_KEY, []); return Array.isArray(value) ? value.filter(j => j && typeof j.id === 'string' && Array.isArray(j.tracks) && Array.isArray(j.taskIds)).slice(0, 100) : []; };
let memoryJobs = readJobs();
let externalCacheDirectory = readSettings().cacheDirectory;
const nativeFiles = () => globalThis.blackObsidian && typeof globalThis.blackObsidian.readCache === 'function' ? globalThis.blackObsidian : null;
async function writeExternalCache() {
  const api = nativeFiles();
  if (!api || !externalCacheDirectory) return;
  try { await api.writeCache({ directory: externalCacheDirectory, fileName: CACHE_FILE, data: { version: 1, draft: read(DRAFT_KEY, {}), jobs: memoryJobs } }); }
  catch { window.dispatchEvent(new CustomEvent('bos-music-storage-error')); }
}
function updateJobs(updater, strict = false) {
  const next = updater(memoryJobs).slice(0, 100);
  try { localStorage.setItem(JOBS_KEY, JSON.stringify(next)); }
  catch (error) { window.dispatchEvent(new CustomEvent('bos-music-storage-error')); if (strict) throw new Error('作品历史保存失败，配乐任务未清空。请释放本机存储空间。'); }
  memoryJobs = next;
  void writeExternalCache();
  window.dispatchEvent(new CustomEvent('bos-music-jobs'));
}
export function importScriptScore(job) {
  const draft = { ...initialDraft(), title: job.score.title, style: job.score.style, raw: job.score.prompt, modelKey: `${job.suno.providerId}::${job.suno.model}`, sections: job.score.structure.map(s => section(s.tag, s.content)) };
  localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  window.dispatchEvent(new CustomEvent('bos-music-draft-import'));
}
export function syncScriptMusic(job) {
  const item = scriptMusicHistory(job);
  updateJobs(list => {
    const old = list.find(j => j.id === item.id);
    return [old ? { ...old, ...item, tracks: mergeTracks(old.tracks, item.tracks) } : item, ...list.filter(j => j.id !== item.id)];
  }, true);
}
export function cancelLocalMusicHistory(jobs) {
  const ids = new Set(jobs.filter(job => job.source === 'library').map(job => `script-${job.id}`));
  updateJobs(list => list.filter(item => !ids.has(item.id)), true);
}
let submissionInFlight = false;
function setSubmitting(value) { submissionInFlight = value; window.dispatchEvent(new CustomEvent('bos-music-submit')); }
function resultState(tracks) {
  if (tracks.some(t => isFailed(t.status) || isFailed(t.taskStatus))) return 'failed';
  if (tracks.length && tracks.every(t => t.audioUrl && isComplete(t.status) && (!t.taskStatus || isComplete(t.taskStatus)))) return 'complete';
  return 'pending';
}
const templates = {
  pop: () => [section('Intro'), section('Verse'), section('Pre-Chorus'), section('Chorus'), section('Verse'), section('Chorus'), section('Bridge'), section('Chorus'), section('Outro')],
  electronic: () => [section('Intro'), section('Build'), section('Drop'), section('Break'), section('Build'), section('Drop'), section('Outro')],
  cinematic: () => [section('Intro', 'Soft piano, distant strings'), section('Build', 'Layers of strings gradually rise'), section('Chorus', 'Full orchestra, sweeping melody'), section('Outro', 'Piano fades into silence')],
};

export function MusicStudio({ providers, onGoProviders }) {
  const [creationsCollapsed, toggleCreations] = usePanelCollapsed('music-creations');
  const [recoveryIds, setRecoveryIds] = i.useState({});
  const [draft, setDraft] = i.useState(loadDraft);
  const [jobs, setJobs] = i.useState(() => memoryJobs);
  const rows = i.useMemo(() => creationRows(jobs), [jobs]);
  const creationPages = usePages(rows, 10);
  const visibleJobs = groupCreationRows(creationPages.visible);
  const [submitting, setBusy] = i.useState(submissionInFlight);
  const [error, setError] = i.useState('');
  const [notice, setNotice] = i.useState('');
  const [storageError, setStorageError] = i.useState(false);
  const [settings, setSettings] = i.useState(readSettings);
  const [settingsOpen, setSettingsOpen] = i.useState(false);
  const [downloadState, setDownloadState] = i.useState({});
  const [templateChoice, setTemplateChoice] = i.useState('');
  const [templateConfirm, setTemplateConfirm] = i.useState(false);
  const providersRef = i.useRef(providers);
  providersRef.current = providers;
  const models = i.useMemo(() => providers.flatMap(p => (p.models || []).map(model => ({ key: `${p.id}::${model}`, providerId: p.id, model, provider: p.name, suno: p.protocol === 'suno' || /^suno[_-]/i.test(model) }))).sort((a, b) => Number(b.suno) - Number(a.suno)), [providers]);
  const selected = models.find(m => m.key === draft.modelKey) || models[0];
  const change = patch => { setDraft(old => ({ ...old, ...patch })); setError(''); };
  const custom = draft.mode === 'custom';
  const style = draft.instrumental || !draft.voice ? draft.style : addStyleTag(draft.style, draft.voice);
  let preview = '', previewError = '';
  try { preview = custom ? (draft.editor === 'structure' ? serializeStructure(draft.sections, draft.instrumental) : `${draft.instrumental && !/^\s*\[Instrumental\]/i.test(draft.raw) ? '[Instrumental]\n\n' : ''}${draft.raw}`) : draft.brief; }
  catch (err) { previewError = err.message; }

  i.useEffect(() => {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch { setStorageError(true); }
    void writeExternalCache();
  }, [draft]);
  i.useEffect(() => {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { setStorageError(true); }
    externalCacheDirectory = settings.cacheDirectory || '';
    void writeExternalCache();
  }, [settings]);
  i.useEffect(() => {
    const api = nativeFiles();
    if (!api || !settings.cacheDirectory) return undefined;
    let cancelled = false;
    api.readCache({ directory: settings.cacheDirectory, fileName: CACHE_FILE }).then(result => {
      if (cancelled || !result?.data || typeof result.data !== 'object') return;
      const cachedDraft = result.data.draft;
      const cachedJobs = result.data.jobs;
      if (cachedDraft && typeof cachedDraft === 'object') setDraft(current => ({ ...current, ...cachedDraft }));
      if (Array.isArray(cachedJobs)) { const known = new Set(memoryJobs.map(j => j.id)); updateJobs(current => [...current, ...cachedJobs.filter(j => j && typeof j.id === 'string' && Array.isArray(j.tracks) && Array.isArray(j.taskIds) && !known.has(j.id))].slice(0, 100)); setJobs([...memoryJobs]); }
    }).catch(() => setStorageError(true));
    return () => { cancelled = true; };
  }, []);
  i.useEffect(() => {
    const refresh = () => setJobs([...memoryJobs]);
    const busy = () => setBusy(submissionInFlight);
    const importDraft = () => setDraft(loadDraft());
    const storageFailed = () => setStorageError(true);
    const crossTab = event => { if (event.key === JOBS_KEY) { memoryJobs = readJobs(); refresh(); } };
    window.addEventListener('bos-music-jobs', refresh);
    window.addEventListener('bos-music-submit', busy);
    window.addEventListener('bos-music-draft-import', importDraft);
    window.addEventListener('bos-music-storage-error', storageFailed);
    window.addEventListener('storage', crossTab);
    return () => {
      window.removeEventListener('bos-music-jobs', refresh);
      window.removeEventListener('bos-music-submit', busy);
      window.removeEventListener('bos-music-draft-import', importDraft);
      window.removeEventListener('bos-music-storage-error', storageFailed);
      window.removeEventListener('storage', crossTab);
    };
  }, []);
  i.useEffect(() => {
    let stopped = false, timer;
    const controller = new AbortController();
    const poll = async () => {
      for (const job of [...memoryJobs].filter(j => j.status === 'pending' && !j.queueManaged)) {
        if (stopped) return;
        const provider = providersRef.current.find(p => p.id === job.providerId);
        let issue = !provider ? '原连接已移除。恢复连接后可继续查询。' : provider.baseUrl !== job.baseUrl ? '连接地址已变更，请恢复原地址后继续查询。' : '';
        if (Date.now() - (job.monitoringSince || job.createdAt) > 15 * 60 * 1000) issue = '已暂停自动查询。任务可能仍在生成，可手动继续查询。';
        if (issue) { updateJobs(list => list.map(j => j.id === job.id ? { ...j, status: 'paused', error: issue } : j)); continue; }
        try {
          const response = await fetch('/api/music/query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, model: job.model, ids: job.taskIds }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]) });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || `查询失败（${response.status}）`);
          if (stopped) return;
          updateJobs(list => list.map(j => {
            if (j.id !== job.id) return j;
            const tracks = mergeTracks(j.tracks, Array.isArray(data.tracks) ? data.tracks : []);
            return { ...j, tracks, status: resultState(tracks), queryFailures: 0, error: tracks.find(t => t.error)?.error || '' };
          }));
        } catch (err) {
          if (stopped) return;
          updateJobs(list => list.map(j => j.id === job.id ? { ...j, queryFailures: (j.queryFailures || 0) + 1, status: (j.queryFailures || 0) >= 2 ? 'paused' : 'pending', error: err.message || '查询失败，可稍后继续查询。' } : j));
        }
      }
      if (!stopped) timer = setTimeout(poll, 8000);
    };
    timer = setTimeout(poll, 1200);
    return () => { stopped = true; clearTimeout(timer); controller.abort(); };
  }, []);

  const submit = async event => {
    event.preventDefault();
    if (submissionInFlight) return;
    setError(''); setNotice('');
    if (!selected) { setError('请先添加支持音乐生成的模型。'); return; }
    const provider = providers.find(p => p.id === selected.providerId);
    if (!provider?.apiKey?.trim()) { setError('当前连接缺少 API 密钥，请到「模型与连接」补充。'); return; }
    let options;
    try {
      if (previewError) throw new Error(previewError);
      options = normalizeMusicOptions({ customMode: custom, title: draft.title, prompt: custom ? draft.raw : draft.brief, style, instrumental: draft.instrumental, ...(custom && draft.editor === 'structure' ? { structure: draft.sections } : {}) });
    } catch (err) { setError(err.message); return; }
    setSubmitting(true);
    try {
      const response = await fetch('/api/music/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...options, provider, model: selected.model }), signal: AbortSignal.timeout(195000) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `生成请求失败（${response.status}）`);
      if (!Array.isArray(data.tracks) || !data.tracks.length) throw new Error('接口没有返回任务 ID 或音频，请先查看服务商记录，避免重复生成。');
      const job = { id: uid(), providerId: selected.providerId, baseUrl: provider.baseUrl, model: selected.model, title: options.title, style: options.style, createdAt: Date.now(), monitoringSince: Date.now(), tracks: data.tracks, taskIds: [...new Set(data.tracks.map(t => t.taskId || t.id).filter(Boolean))], status: resultState(data.tracks), error: '' };
      job.prompt = options.prompt;
      updateJobs(list => [job, ...list]);
      setNotice('创作已提交，完成后可在下方试听。');
    } catch (err) {
      setError(`${err.message || '提交失败'}${err.name === 'TimeoutError' || err instanceof TypeError ? ' 请求可能已经提交，请先查看服务商任务记录，避免重复计费。' : ''}`);
    } finally { setSubmitting(false); }
  };
  const editSection = (id, patch) => change({ sections: draft.sections.map(s => s.id === id ? { ...s, ...patch } : s) });
  const move = (index, delta) => { const items = [...draft.sections]; [items[index], items[index + delta]] = [items[index + delta], items[index]]; change({ sections: items }); };
  const insertTag = tag => {
    const next = addStyleTag(draft.style, tag);
    if (next.length > MUSIC_LIMITS.style) { setError(`音乐风格最多 ${MUSIC_LIMITS.style} 个字符。`); return; }
    change({ style: next });
  };
  const chooseDirectory = async key => {
    const api = nativeFiles();
    if (!api) { setError('文件夹选择功能需要在 Electron 程序中使用。'); return; }
    try {
      const directory = await api.chooseDirectory();
      if (directory) setSettings(current => ({ ...current, [key]: directory }));
    } catch (err) { setError(err.message || '无法选择本地文件夹。'); }
  };
  const clearDirectory = key => setSettings(current => ({ ...current, [key]: '' }));
  const downloadTrack = async (job, track, index) => {
    const api = nativeFiles();
    if (!api) { setError('下载到指定文件夹需要在 Electron 程序中使用。'); return; }
    if (!settings.downloadDirectory) { setSettingsOpen(true); setError('请先在「本地文件设置」中选择歌曲下载文件夹。'); return; }
    const key = `${job.id}:${track.id || track.taskId || index}`;
    setDownloadState(current => ({ ...current, [key]: 'downloading' }));
    try {
      const cleanTitle = job.source === 'library' || job.model === '本地音乐库' ? safeMusicStem(track.title || job.title) : musicFileStem(job);
      const suffix = job.tracks.length > 1 ? `-${index + 1}` : '';
      let extension = '.mp3';
      try { const candidate = new URL(track.audioUrl).pathname.match(/\.(mp3|wav|m4a|ogg|flac)$/i)?.[0]; if (candidate) extension = candidate.toLowerCase(); } catch { /* validated by the main process */ }
      const result = await api.downloadAudio({ url: track.audioUrl, directory: settings.downloadDirectory, fileName: `${cleanTitle}${suffix}${extension}` });
      if (!result?.ok) throw new Error('文件保存失败。');
      setNotice(`歌曲已保存到：${result.path}`);
      updateJobs(list => list.map(item => item.id === job.id ? { ...item, tracks: item.tracks.map((value, at) => at === index ? { ...value, localPath: result.path } : value) } : item));
      setDownloadState(current => ({ ...current, [key]: 'done' }));
    } catch (err) {
      setError(err.message || '歌曲下载失败。');
      setDownloadState(current => ({ ...current, [key]: 'failed' }));
    }
  };
  const applyTemplate = () => { change({ sections: templates[templateChoice](), editor: 'structure' }); setTemplateConfirm(false); setTemplateChoice(''); };
  const chooseTemplate = value => { setTemplateChoice(value); setTemplateConfirm(Boolean(value)); };
  const setEditor = value => {
    if (value === 'raw' && draft.editor === 'structure') { change({ editor: 'raw', raw: preview }); return; }
    if (value === 'structure' && draft.editor === 'raw') {
      // Preserve arbitrary free-form lyrics as one section; never discard user text.
      const raw = draft.raw.replace(/^\s*\[Instrumental\]\s*/i, '');
      const matches = [...raw.matchAll(/^\[([^\]\r\n]+)\][ \t]*$/gm)];
      if (matches.length && !raw.slice(0, matches[0].index).trim() && matches.length <= 24) {
        change({ editor: 'structure', sections: matches.map((match, idx) => section(match[1], raw.slice(match.index + match[0].length, matches[idx + 1]?.index ?? raw.length).trim())) });
      } else change({ editor: 'structure', sections: [section('Verse', raw)] });
    }
  };
  const copyPrompt = async () => { try { await navigator.clipboard.writeText(preview); setNotice('已复制歌词与结构标签。'); } catch { setNotice('复制不可用，请在预览中选择文字复制。'); } };

  return <section className="bos-studio" aria-label="音乐创作工作台">
    <div className="bos-engine">
      <div className="bos-engine-symbol">♫</div><div className="bos-engine-copy"><span className="bos-kicker">CONNECTED MODEL</span><strong>{selected?.model || '连接你的音乐模型'}</strong></div>
      <label className="bos-model-label"><span className="bos-sr">音乐生成模型</span><select value={selected?.key || ''} onChange={event => change({ modelKey: event.target.value })} aria-label="音乐生成模型">{!models.length && <option value="">尚未配置模型</option>}{models.map(m => <option key={m.key} value={m.key}>{m.model} · {m.provider}</option>)}</select></label>
      <button type="button" className="bos-text-button" onClick={() => setSettingsOpen(value => !value)}>本地文件设置</button>
      <button type="button" className="bos-text-button" onClick={onGoProviders}>管理连接 ↗</button>
    </div>
    {settingsOpen && <section className="bos-card bos-file-settings" aria-label="本地文件设置">
      <div className="bos-file-settings-heading"><div><span className="bos-kicker">LOCAL FILES</span><h2>本地文件夹</h2><p>缓存目录保存草稿和任务记录；下载目录保存已完成的歌曲文件。</p></div><button type="button" className="bos-text-button" onClick={() => setSettingsOpen(false)}>收起</button></div>
      <div className="bos-directory-grid">
        <div className="bos-directory-field"><label htmlFor="bos-cache-directory">缓存文件夹</label><div className="bos-directory-control"><input id="bos-cache-directory" readOnly value={settings.cacheDirectory} placeholder="未设置，使用浏览器缓存" /><button type="button" onClick={() => chooseDirectory('cacheDirectory')}>选择文件夹</button>{settings.cacheDirectory && <button type="button" className="bos-directory-clear" onClick={() => clearDirectory('cacheDirectory')} aria-label="清除缓存文件夹">×</button>}</div><small>文件名：{CACHE_FILE}</small></div>
        <div className="bos-directory-field"><label htmlFor="bos-download-directory">歌曲下载文件夹</label><div className="bos-directory-control"><input id="bos-download-directory" readOnly value={settings.downloadDirectory} placeholder="未设置，点击下载时提醒" /><button type="button" onClick={() => chooseDirectory('downloadDirectory')}>选择文件夹</button>{settings.downloadDirectory && <button type="button" className="bos-directory-clear" onClick={() => clearDirectory('downloadDirectory')} aria-label="清除歌曲下载文件夹">×</button>}</div><small>生成完成后按调性和乐器命名保存，同名自动加序号</small></div>
      </div>
      {!nativeFiles() && <div className="bos-file-hint">当前是浏览器预览。安装包中的 Electron 版本会提供系统文件夹选择器和本地文件保存。</div>}
    </section>}
    {selected && !selected.suno && <div className="bos-advice">当前选择的是通用模型。请确认服务商支持音乐生成；普通聊天模型无法直接合成音频。</div>}
    {storageError && <div role="alert" className="bos-alert">本机存储空间不足，草稿或任务记录可能无法保存。请保留任务 ID。</div>}
    <form onSubmit={submit} onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.requestSubmit(); } }}>
      <div className="bos-studio-grid"><div className="bos-editor">
        <div className="bos-card bos-composer">
          <div className="bos-card-top"><div className="bos-tabs" role="group" aria-label="创作模式"><button type="button" aria-pressed={!custom} className={!custom ? 'active' : ''} onClick={() => change({ mode: 'simple' })}>灵感描述</button><button type="button" aria-pressed={custom} className={custom ? 'active' : ''} onClick={() => change({ mode: 'custom' })}>自定义创作</button></div><span className="bos-small-badge">SUNO STUDIO</span></div>
          <label className="bos-field"><span>作品标题 <small>留空时自动补全</small></span><input maxLength={80} value={draft.title} onChange={event => change({ title: event.target.value })} placeholder="给这段旋律起个名字" /></label>
          <div className="bos-vocal-row"><div><strong>声音设定</strong><small>选择作品中的声音</small></div><div className="bos-tabs bos-vocal-tabs" role="group" aria-label="声音设定"><button type="button" aria-pressed={!draft.instrumental} className={!draft.instrumental ? 'active' : ''} onClick={() => change({ instrumental: false })}>♩ 人声歌曲</button><button type="button" aria-pressed={draft.instrumental} className={draft.instrumental ? 'active' : ''} onClick={() => change({ instrumental: true })}>♫ 纯音乐</button></div></div>
          {!draft.instrumental && <label className="bos-field bos-voice"><span>人声偏好</span><select value={draft.voice} onChange={event => change({ voice: event.target.value })}><option value="">由模型决定</option><option value="female vocals">女声</option><option value="male vocals">男声</option><option value="duet vocals">男女对唱</option><option value="choir vocals">合唱</option></select></label>}
          {!custom && <label className="bos-field"><span>描述你的音乐 <small>{draft.brief.length} / 3000</small></span><textarea rows={5} maxLength={3000} value={draft.brief} onChange={event => change({ brief: event.target.value })} placeholder="例如：一首适合雨夜独行的梦幻流行乐，温暖的电钢琴、轻柔鼓点，情绪从孤独走向释然。" /></label>}
          <label className="bos-field bos-style"><span>自定义音乐风格 <small className={style.length > MUSIC_LIMITS.style ? 'bos-danger' : ''}>{style.length} / {MUSIC_LIMITS.style}</small></span><textarea rows={3} maxLength={MUSIC_LIMITS.style} value={draft.style} onChange={event => change({ style: event.target.value })} placeholder="流派、情绪、速度、乐器、音色…\n例如：dream pop, warm piano, 98 bpm, cinematic strings" /></label>
          <div className="bos-style-tags" aria-label="音乐风格快捷标签">{STYLE_PRESETS.map(([tag, name]) => <button key={tag} type="button" onClick={() => insertTag(tag)} className={draft.style.split(',').some(v => v.trim().toLowerCase() === tag.toLowerCase()) ? 'selected' : ''}>{name}<span>{tag}</span></button>)}</div>
          <div className="bos-secondary-tags"><span>灵感</span>{['dreamy', 'energetic', 'lo-fi', 'piano', '98 bpm'].map(tag => <button key={tag} type="button" onClick={() => insertTag(tag)}>+ {tag}</button>)}</div>
        </div>
        {custom && <div className="bos-card bos-structure">
          <div className="bos-section-heading"><div><span className="bos-kicker">SONG STRUCTURE</span><h2>让音乐有起承转合</h2></div><span className="bos-count">{draft.editor === 'structure' ? `${draft.sections.length} 个段落` : '自由编辑'}</span></div>
          <div className="bos-structure-toolbar"><div className="bos-tabs bos-compact-tabs" role="group" aria-label="结构编辑方式"><button type="button" className={draft.editor === 'structure' ? 'active' : ''} aria-pressed={draft.editor === 'structure'} onClick={() => setEditor('structure')}>段落编排</button><button type="button" className={draft.editor === 'raw' ? 'active' : ''} aria-pressed={draft.editor === 'raw'} onClick={() => setEditor('raw')}>歌词 / 标签</button></div><select aria-label="音乐结构模板" value={templateChoice} onChange={event => chooseTemplate(event.target.value)}><option value="">选择结构模板</option><option value="pop">流行歌曲</option><option value="electronic">电子 / 舞曲</option><option value="cinematic">电影配乐</option></select></div>
          {templateConfirm && <div className="bos-inline-confirm"><span>使用此模板将替换当前段落及歌词。</span><button type="button" onClick={applyTemplate}>使用模板</button><button type="button" onClick={() => { setTemplateConfirm(false); setTemplateChoice(''); }}>取消</button></div>}
          <p className="bos-help">{draft.instrumental ? '填写每段的乐器、节奏与情绪。纯音乐会将这些内容转换为方括号演奏指令。' : '在每段写下歌词；方括号标签用于指导前奏、主歌、副歌等结构。'}</p>
          {draft.editor === 'structure' ? <><ol className="bos-sections">{draft.sections.map((s, index) => <li key={s.id} className="bos-section">
            <div className="bos-section-number">{String(index + 1).padStart(2, '0')}</div><div className="bos-section-body"><div className="bos-section-controls"><select aria-label={`第 ${index + 1} 段类型`} value={SECTION_TYPES.some(([tag]) => tag === s.tag) ? s.tag : '__custom'} onChange={event => editSection(s.id, { tag: event.target.value === '__custom' ? 'Custom Section' : event.target.value })}>{SECTION_TYPES.map(([tag, name]) => <option key={tag} value={tag}>{name} · {tag}</option>)}<option value="__custom">自定义段落</option></select><div className="bos-order-buttons"><button type="button" aria-label={`上移第 ${index + 1} 段`} disabled={index === 0} onClick={() => move(index, -1)}>↑</button><button type="button" aria-label={`下移第 ${index + 1} 段`} disabled={index === draft.sections.length - 1} onClick={() => move(index, 1)}>↓</button><button type="button" aria-label={`删除第 ${index + 1} 段`} disabled={draft.sections.length === 1} onClick={() => change({ sections: draft.sections.filter(item => item.id !== s.id) })}>×</button></div></div>
            {!SECTION_TYPES.some(([tag]) => tag === s.tag) && <input aria-label={`第 ${index + 1} 段自定义标签`} value={s.tag} maxLength={80} onChange={event => editSection(s.id, { tag: event.target.value })} placeholder="如 Lumbering Monster Intro" />}
            <textarea aria-label={`第 ${index + 1} 段${draft.instrumental ? '演奏描述' : '歌词'}`} rows={2} maxLength={5000} value={s.content} onChange={event => editSection(s.id, { content: event.target.value })} placeholder={draft.instrumental ? '例如：柔和钢琴进入，弦乐渐强…' : '在这里写下这一段的歌词…'} />
          </div></li>)}</ol><button type="button" className="bos-add-section" disabled={draft.sections.length >= 24} onClick={() => change({ sections: [...draft.sections, section('Verse')] })}>＋ 添加段落</button></> : <label className="bos-field"><span className="bos-sr">歌词与结构标签</span><textarea className="bos-raw" rows={14} maxLength={5000} value={draft.raw} onChange={event => change({ raw: event.target.value })} placeholder={'[Verse]\n在这里写下歌词\n\n[Chorus]\n让旋律继续'} /><small className="bos-help">自由模式会原样提交文本；纯音乐中的演奏描述请放在 [方括号] 内。</small></label>}
        </div>}
      </div><aside className="bos-summary">
        <div className="bos-card bos-preview-card"><div className="bos-preview-art"><span className="bos-art-label">YOUR NEXT SOUND</span><div className="bos-record"><div /></div><div className="bos-waveform" aria-hidden="true">{[20,36,18,48,64,30,50,76,44,60,25,44,30,16,34,22,40,56,28,18].map((height, index) => <span key={index} style={{ height }} />)}</div><span className="bos-art-caption">{draft.instrumental ? 'INSTRUMENTAL' : 'VOCAL TRACK'}</span></div>
          <div className="bos-preview-content"><span className="bos-kicker">创作预览</span><h3>{draft.title || autoTitle(custom ? preview : draft.brief, '你的下一首作品')}</h3><p className="bos-preview-style">{style || '选择风格，赋予旋律独特个性'}</p><div className="bos-preview-divider" /><div className="bos-preview-heading"><strong>{custom ? '歌词与结构' : '灵感描述'}</strong><button type="button" onClick={copyPrompt} disabled={!preview}>复制</button></div><pre className={preview.length > 5000 ? 'bos-danger' : ''}>{preview || '你的创作内容将在这里呈现。'}</pre><div className="bos-preview-meta"><span>{draft.instrumental ? '纯音乐' : '人声歌曲'}</span><span>{preview.length} / {custom ? '5000' : '3000'}</span></div></div>
        </div>
        <div className="bos-submit-box"><button className="bos-generate" type="submit" disabled={submitting || !selected}><span>✦</span>{submitting ? '正在提交创作…' : '生成音乐'}<span>↗</span></button><p>Ctrl / ⌘ + Enter 提交 · Enter 换行</p><small>生成由所选服务商提供并按其规则计费。段落标签、速度和人声均为创作指导，实际效果由模型决定。</small></div>
        {!selected && <button type="button" className="bos-connect" onClick={onGoProviders}>＋ 添加音乐模型</button>}
        {error && <div role="alert" className="bos-alert">{error}</div>}{notice && <div role="status" className="bos-notice">{notice}</div>}
      </aside></div>
    </form>
    <section className="bos-results" aria-label="我的音乐作品"><div className="bos-results-heading"><div><span className="bos-kicker">YOUR CREATIONS</span><h2>我的作品 <span>{rows.length.toString().padStart(2, '0')}</span></h2></div><div className="bos-panel-heading-actions"><span className="bos-local-note">草稿与最近 100 次创作保存在本机</span><button type="button" className="bos-panel-toggle" aria-expanded={!creationsCollapsed} aria-controls="bos-creations-body" onClick={toggleCreations}>{creationsCollapsed ? "展开作品 ⌄" : "收起作品 ⌃"}</button></div></div><div id="bos-creations-body" hidden={creationsCollapsed}>
      {!jobs.length ? <div className="bos-empty"><div>♫</div><strong>第一段旋律，从这里开始</strong><p>完成风格与结构设定，生成的作品将在这里等你。</p></div> : <div className="bos-job-list">{visibleJobs.map(({ job, tracks }) => <article className="bos-job" key={job.id}>
        <div className="bos-job-top"><div><h3>{job.title || '音乐作品'}</h3><p>{job.model} · {new Date(job.createdAt).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p></div><span className={`bos-job-status ${job.status}`}>{({ pending: '正在生成', complete: '可以试听', failed: '生成失败', paused: '查询已暂停', uncertain: '待核对提交', submitting: '提交中' })[job.status] || '待查询'}</span></div>
        {job.error && <p className="bos-job-error">{job.error}</p>}
        <div className="bos-tracks">{tracks.map(({ track, index }) => { const downloadKey = `${job.id}:${track.id || track.taskId || index}`; const downloadStatus = downloadState[downloadKey]; return <div className="bos-track" key={`${track.taskId}:${track.id}:${index}`}><div className="bos-track-art">{safeMediaUrl(track.coverUrl) ? <img src={safeMediaUrl(track.coverUrl)} alt="作品封面" loading="lazy" /> : <span>♫</span>}</div><div className="bos-track-content"><strong>{track.title || job.title}{job.tracks.length > 1 && ` · ${index + 1}`}</strong>{safeMediaUrl(track.audioUrl) ? <audio controls preload="none" src={safeMediaUrl(track.audioUrl)} aria-label={`${track.title || job.title}试听`} /> : <small>{isFailed(track.status) ? '生成未完成，请查看服务商任务详情。' : '等待音频，自动查询任务进度…'}</small>}<details><summary>任务信息</summary><code>{track.taskId || track.id}</code><small>状态：{track.status || 'pending'}</small></details></div>{safeMediaUrl(track.audioUrl) && <div className="bos-track-actions"><MusicDragButton libraryId={job.source === "library" ? track.id : ""} url={track.audioUrl} filePath={track.localPath || ((job.primaryAudioUrl ? track.audioUrl === job.primaryAudioUrl : index === 0) ? job.exportPath : "")} /><button type="button" className="bos-download-button" disabled={downloadStatus === 'downloading'} onClick={() => downloadTrack(job, track, index)}>{downloadStatus === 'downloading' ? '保存中…' : downloadStatus === 'done' ? '已保存 ✓' : '下载歌曲 ↓'}</button><a href={safeMediaUrl(track.audioUrl)} target="_blank" rel="noreferrer" className="bos-audio-link">打开音频 ↗</a></div>}</div>; })}</div>
        {job.queueManaged && job.status === 'uncertain' && <label className="bos-field"><span>从服务商记录找回任务 ID</span><input value={recoveryIds[job.id] || ''} onChange={event => setRecoveryIds(current => ({ ...current, [job.id]: event.target.value }))} placeholder="多个 ID 用逗号分隔" /><button type="button" onClick={() => { try { recoverScriptMusic(job.scriptJobId, recoveryIds[job.id]); } catch (err) { setError(err.message); } }}>恢复查询（不重新生成）</button></label>}
        {job.queueManaged && job.status === 'paused' && <button type="button" className="bos-text-button" onClick={() => { try { recoverScriptMusic(job.scriptJobId); } catch (err) { setError(err.message); } }}>继续查询原任务 ↻</button>}
        {job.exportPath && <p className="bos-local-note">已保存：{job.exportPath}</p>}{job.exportError && <p className="bos-job-error">自动保存失败：{job.exportError}，可点击下载歌曲。</p>}
        {!job.queueManaged && ['paused', 'failed'].includes(job.status) && <button type="button" className="bos-text-button" onClick={() => updateJobs(list => list.map(j => j.id === job.id ? { ...j, status: 'pending', monitoringSince: Date.now(), queryFailures: 0, error: '' } : j))}>继续查询（不重新生成） ↻</button>}
      </article>)}</div>}
      {!!rows.length && <Pagination {...creationPages} label="我的作品页码" />}
    </div></section>
  </section>;
}

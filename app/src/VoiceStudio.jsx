import { UpdateNavIcon, DownloadNavIcon, PlayNavIcon } from './NavigationIcons.jsx';
import { formatDownloadRate, formatRemainingTime } from './LocalDownloadRate.mjs';

const MODES = [
  { id:'design', label:'声音设计', description:'描述音色与情绪，直接生成配音' },
  { id:'clone', label:'音频克隆', description:'保留参考声音，可调整表达风格' },
  { id:'ultimate', label:'极致克隆', description:'结合原声与原文，还原声音细节' },
];
const KEY = 'bos:voice-studio:v1';
const DEFAULTS = { mode:'clone', text:'', control:'', reference:'', prompt:'', cfg:2, steps:10, seed:-1, normalize:false, denoise:false, device:'auto' };
function readForm() { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return DEFAULTS; } }

export function VoiceStudio({ active = true }) {
  const api = globalThis.blackObsidian;
  const [state, setState] = i.useState(null);
  const [progress, setProgress] = i.useState(null);
  const [form, setForm] = i.useState(readForm);
  const [busy, setBusy] = i.useState('');
  const [error, setError] = i.useState('');
  const [advanced, setAdvanced] = i.useState(false);
  const [selected, setSelected] = i.useState('');
  const [elapsed, setElapsed] = i.useState(0);
  const [cancelling, setCancelling] = i.useState(false);
  const statusRevision = i.useRef(0);
  const refresh = async () => {
    if (!api?.voiceAction) return;
    const revision = ++statusRevision.current;
    try { const value = await api.voiceAction('status'); if (revision === statusRevision.current) { setState(value); setProgress(value.progress); } }
    catch (failure) { setError(failure.message); }
  };
  i.useEffect(() => api?.onVoiceProgress?.(value => {
    setProgress(value);
    if (value.transcript) setForm(old => ({ ...old, prompt:value.transcript }));
    if (value.result?.id) setSelected(value.result.id);
  }), [api]);
  i.useEffect(() => { if (active) void refresh(); }, [active]);
  i.useEffect(() => {
    if (!active || !state?.busy || busy) return;
    let live=true, pending=false;
    const timer=setInterval(async()=>{
      if(pending || document.hidden) return;
      pending=true;
      try {const next=await api.voiceAction('status'); if(live){setState(next);setProgress(next.progress);}}
      catch {} finally {pending=false;}
    },2500);
    return ()=>{live=false;clearInterval(timer);};
  }, [active, state?.busy, busy, api]);
  i.useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(form)); } catch {} }, [form]);
  i.useEffect(() => {
    if (!busy && !state?.busy) return;
    const started = Date.now(); setElapsed(0);
    const timer = setInterval(() => setElapsed(Math.floor((Date.now()-started)/1000)), 1000);
    return () => clearInterval(timer);
  }, [busy, state?.busy]);
  const change = patch => setForm(old => ({ ...old, ...patch }));
  const working = !!busy || !!state?.busy;
  const ready = state?.runtimeReady && state?.modelReady;
  const act = async (action, value) => {
    if (!api?.voiceAction || working) return;
    ++statusRevision.current; setBusy(action); setError(''); setProgress(null);
    try { setState(await api.voiceAction(action, value)); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(''); setCancelling(false); await refresh(); }
  };
  const chooseReference = async () => {
    try { const result = await api.voiceAction('choose-reference'); if (result.path) change({ reference:result.path, prompt:'' }); }
    catch (failure) { setError(failure.message); }
  };
  const cancel = async () => {
    setCancelling(true);
    try { await api.voiceAction('cancel'); }
    catch (failure) { setError(failure.message); setCancelling(false); }
  };
  const results = state?.results || [];
  const result = results.find(item => item.id === selected) || results[0];
  const percent = progress?.total > 0 ? Math.min(100, Math.round(progress.completed/progress.total*100)) : null;
  if (!active) return null;
  return <section className="bos-voice-studio" aria-label="音频克隆">
    <div className="bos-voice-deploy">
      <div><span className="bos-voice-kicker">本地语音 · VoxCPM2</span><h2>{ready ? '语音模型已就绪' : '先部署，再开始配音'}</h2><p>模型按需下载，首次打开不会自动安装。语音在本机生成，无需 API 密钥。</p><small>{state?.root || '模型、缓存与音频保存在安装目录 / data / voxcpm'}</small></div>
      <div className="bos-voice-deploy-actions"><button type="button" onClick={refresh} disabled={working} title="检查运行环境和模型文件"><UpdateNavIcon size={16} />刷新状态</button><button type="button" className="primary" disabled={working || !api?.voiceAction} onClick={() => act('install')}><DownloadNavIcon size={16}/>{ready ? '校验 / 修复部署' : '下载安装模型'}</button></div>
      {!ready && <p className="bos-voice-download-note">主模型约 5GB，另需下载 Python 与 PyTorch；首次部署建议预留 18GB。支持断点续传。NVIDIA 显卡建议 8GB 及以上显存，CPU 模式耗时较长。</p>}
    </div>
    <div className="bos-voice-modes" role="group" aria-label="生成方式">{MODES.map(mode => <button type="button" key={mode.id} className={form.mode === mode.id ? 'selected' : ''} aria-pressed={form.mode === mode.id} disabled={working} onClick={() => change({mode:mode.id})}><strong>{mode.label}</strong><span>{mode.description}</span></button>)}</div>
    <div className="bos-voice-grid">
      <div className="bos-voice-inputs">
        {form.mode !== 'design' && <div className="bos-voice-card"><h3>参考音频</h3><p>使用你有权使用的声音。建议 3–15 秒清晰人声，支持 WAV、MP3、FLAC、OGG。</p><div className="bos-voice-reference"><input aria-label="参考音频路径" value={form.reference} placeholder="粘贴音频完整路径，或选择文件" disabled={working} onChange={event => change({reference:event.target.value.replace(/^"|"$/g,''),prompt:''})}/><button type="button" disabled={working || !api?.voiceAction} onClick={chooseReference}>选择音频</button></div>
          {form.mode === 'ultimate' && <><div className="bos-voice-field-head"><label htmlFor="voice-transcript">参考音频原文</label><button type="button" disabled={working || !ready || !form.reference} onClick={() => act('transcribe', {reference:form.reference})}>自动识别原文</button></div><textarea id="voice-transcript" rows={3} value={form.prompt} maxLength={1500} disabled={working} onChange={event => change({prompt:event.target.value})} placeholder="填写参考音频里说的内容，越准确，克隆效果越稳定"/><small>首次自动识别需下载 SenseVoice 辅助模型；也可直接手动填写。</small></>}
        </div>}
        <div className="bos-voice-card">
          {form.mode !== 'ultimate' && <label>声音描述 <span className="optional">可选</span><textarea rows={2} maxLength={500} value={form.control} disabled={working} onChange={event => change({control:event.target.value})} placeholder="例如：年轻女声，语气温柔自然，语速适中，适合剧情旁白"/></label>}
          <div className="bos-voice-field-head"><label htmlFor="voice-target">配音文本</label><span>{form.text.length} / 1500</span></div><textarea id="voice-target" className="bos-voice-target" rows={7} maxLength={1500} value={form.text} disabled={working} onChange={event => change({text:event.target.value})} placeholder="输入需要朗读的文字，支持中文、英语、西班牙语等语言。长剧本建议分段生成。"/>
          <button type="button" className="bos-voice-advanced-toggle" aria-expanded={advanced} onClick={() => setAdvanced(value => !value)}>高级设置 {advanced ? '⌃' : '⌄'}</button>
          {advanced && <div className="bos-voice-settings"><label>推理设备<select disabled={working} value={form.device} onChange={event=>change({device:event.target.value})}><option value="auto">自动选择</option><option value="cuda">NVIDIA 显卡</option><option value="cpu">CPU</option></select></label><label>生成步数<input type="number" min="1" max="50" disabled={working} value={form.steps} onChange={event=>change({steps:Number(event.target.value)})}/></label><label>引导强度<input type="number" min="1" max="3" step="0.1" disabled={working} value={form.cfg} onChange={event=>change({cfg:Number(event.target.value)})}/></label><label>随机种子（-1 随机）<input type="number" min="-1" max="2147483647" disabled={working} value={form.seed} onChange={event=>change({seed:Number(event.target.value)})}/></label><label className="check"><input type="checkbox" disabled={working} checked={form.normalize} onChange={event=>change({normalize:event.target.checked})}/>规范化数字与日期读法</label>{form.mode !== 'design' && <label className="check"><input type="checkbox" disabled={working} checked={form.denoise} onChange={event=>change({denoise:event.target.checked})}/>参考音频降噪（首次下载辅助模型）</label>}<small>默认 10 步。增加步数会更慢；显存不足时请释放本地语言模型显存，或切换 CPU。</small></div>}
          <div className="bos-voice-generate"><button type="button" className="primary" disabled={working || !ready || !form.text.trim() || (form.mode !== 'design' && !form.reference) || (form.mode === 'ultimate' && !form.prompt.trim())} onClick={() => act('generate',form)}><PlayNavIcon size={17}/>{busy === 'generate' ? '正在生成…' : '生成配音'}</button>{!ready && <span>请先点击上方“下载安装模型”</span>}</div>
        </div>
      </div>
      <div className="bos-voice-result-column">
        <div className="bos-voice-card bos-voice-result"><div className="bos-voice-field-head"><h3>生成结果</h3><button type="button" disabled={!api?.voiceAction} onClick={() => api.voiceAction('open-directory').catch(failure=>setError(failure.message))}>打开目录</button></div>{result ? <><p>{result.title}</p><audio key={result.id} controls preload="metadata" src={`/voice-audio/${encodeURIComponent(result.id)}`}/><div className="bos-voice-output-info"><span>{Number(result.duration).toFixed(1)} 秒 · {result.sampleRate / 1000} kHz · WAV</span><button type="button" onClick={() => api.voiceAction('export',{id:result.id}).catch(failure=>setError(failure.message))}>另存为</button></div></> : <div className="bos-voice-empty"><span aria-hidden="true">♫</span><strong>等待你的第一段配音</strong><p>生成后可在这里试听，音频会自动保存在本机。</p></div>}</div>
        {(working || progress?.message) && <div className={`bos-voice-card bos-voice-progress ${progress?.stage==='error' ? 'error' : ''}`} role="status" aria-live="polite"><strong>{cancelling ? '正在停止…' : progress?.message || '正在准备…'}</strong>{working && <span>已用时 {Math.floor(elapsed/60)}分{elapsed%60}秒</span>}{percent != null && <><progress max="100" value={percent}/><span>{percent}% · {(progress.completed/1e9).toFixed(2)} / {(progress.total/1e9).toFixed(2)} GB</span></>}{progress?.speed > 0 && <small>{formatDownloadRate(progress.speed)} · 当前文件剩余{formatRemainingTime(progress.remaining)}</small>}{progress?.audioSeconds > 0 && <span>已合成 {progress.audioSeconds} 秒音频</span>}{working && <button type="button" disabled={cancelling} onClick={cancel}>停止{busy === 'install' ? '下载' : '任务'}</button>}</div>}
        {results.length > 0 && <div className="bos-voice-card"><h3>最近生成</h3><div className="bos-voice-history">{results.map(item=><button type="button" className={result?.id===item.id?'selected':''} key={item.id} onClick={()=>setSelected(item.id)}><strong>{item.title}</strong><span>{item.createdAt} · {Number(item.duration).toFixed(1)} 秒</span></button>)}</div></div>}
      </div>
    </div>
    {error && <p className="bos-voice-error" role="alert">{error}</p>}
  </section>;
}

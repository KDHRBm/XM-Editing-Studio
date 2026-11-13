import { UpdateNavIcon, CheckNavIcon, DownloadNavIcon, PlayNavIcon } from './NavigationIcons.jsx';
import { LOCAL_MODEL_OPTIONS as OPTIONS, recommendLocalModel } from './LocalModelRecommendations.mjs';
import { createDownloadRateTracker, formatDownloadRate, formatRemainingTime } from './LocalDownloadRate.mjs';
import { LOCAL_CONTEXT_OPTIONS, LOCAL_OUTPUT_OPTIONS, readLocalModelSettings, saveLocalModelSettings } from '../shared/local-model-settings.mjs';

export function useLocalProvider(setProviders) {
  i.useEffect(() => {
    const add = event => {
      const model = event.detail;
      if (!OPTIONS.some(item => item.id === model)) return;
      setProviders(items => {
        const existing = items.find(item => item.id === 'provider-ollama-local');
        if (existing) return items.map(item => item.id === existing.id
          ? { ...item, models: [...new Set([...(item.models || []), model])] } : item);
        return [...items, { id: 'provider-ollama-local', name: '本地模型', description: '本机运行 · 无需账号和 API 密钥', protocol: 'ollama', baseUrl: 'http://127.0.0.1:11435/v1', apiKey: '', models: [model], markIcon: '', tone: 'custom' }];
      });
    };
    window.addEventListener('bos:add-local-provider', add);
    let live = true;
    globalThis.blackObsidian?.localModelAction?.('status').then(state => {
      if (live) for (const model of state.models || []) if (/^qwen3\.5:/.test(model)) add({ detail: model });
    }).catch(() => {});
    return () => { live = false; window.removeEventListener('bos:add-local-provider', add); };
  }, [setProviders]);
}

export function LocalModels() {
  const api = globalThis.blackObsidian;
  const [state, setState] = i.useState(null);
  const [progress, setProgress] = i.useState(null);
  const [busy, setBusy] = i.useState('');
  const [error, setError] = i.useState('');
  const [sources, setSources] = i.useState(null);
  const [inference, setInference] = i.useState(readLocalModelSettings);
  const rateTracker = i.useRef(createDownloadRateTracker());
  const [clock, setClock] = i.useState(Date.now());
  const refresh = async () => {
    if (!api?.localModelAction) return;
    try { const next = await api.localModelAction('detect'); setState(next); setProgress(next.progress); }
    catch (failure) { setError(failure.message); }
  };
  i.useEffect(() => {
    void refresh();
    return api?.onLocalModelProgress?.(next => {
      rateTracker.current.update(next);
      setProgress(next);
      setClock(Date.now());
    });
  }, []);
  i.useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [busy]);
  const act = async (action, model = '') => {
    rateTracker.current.reset(); setProgress(null);
    setBusy(action === 'pull' ? model : action); setError('');
    try { setState(await api.localModelAction(action, model)); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(''); await refresh(); }
  };
  const checkSources = async () => {
    setBusy('sources'); setSources(null); setError('');
    try { setSources(await api.localModelAction('sources', recommendation.id || 'deepseek-r1:7b')); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(''); }
  };
  const installed = new Set(state?.models || []);
  const recommendation = recommendLocalModel(state?.hardware, 'qwen');
  const hardware = state?.hardware;
  const percent = progress?.total > 0 ? Math.min(100, Math.round(progress.completed / progress.total * 100)) : null;
  const rate = rateTracker.current.read(progress, clock);
  const changeInference = patch => {
    try { setInference(saveLocalModelSettings({ ...inference, ...patch })); setError(''); }
    catch { setError('本地 token 设置无法保存，请检查程序数据目录。'); }
  };
  return <section className="bos-local-models" aria-labelledby="bos-local-models-title">
    <div className="bos-local-models-heading"><div><h2 id="bos-local-models-title">本地千问 / DeepSeek</h2><p>运行环境与模型保存在 {state?.root || '安装目录的数据文件夹'}。模型推理在本机完成，无 API 费用。</p></div><button type="button" className="bos-local-refresh" onClick={refresh} title="重新检测设备和模型状态"><UpdateNavIcon size={17} /> 刷新状态</button></div>
    {hardware && <div className="bos-local-hardware"><strong>当前设备</strong><span>{hardware.gpuName || '未检测到显卡'} · 显存 {hardware.vramGB || 0} GB · 内存 {hardware.ramGB || 0} GB</span><span>{recommendation.id ? `推荐 ${recommendation.id}：${recommendation.reason}` : recommendation.reason}</span></div>}
    <div className="bos-local-sources"><button type="button" disabled={!!busy || !api?.localModelAction} onClick={checkSources}><UpdateNavIcon size={15} /> {busy === 'sources' ? '正在检测下载源…' : '检测下载源'}</button>{sources && <span role="status">{sources.runtime.message}；{sources.model.message}</span>}</div>
    <div className="bos-local-runtime"><span className={state?.running ? 'bos-local-dot active' : 'bos-local-dot'} aria-hidden="true" /><span>{!api?.localModelAction ? '需更新桌面程序后使用' : state?.running ? '本地服务运行中' : state?.runtimeInstalled ? '运行环境已安装，服务未启动' : '尚未安装运行环境'}</span>{state?.runtimeInstalled ? state?.running ? <button type="button" disabled={!!busy} onClick={() => act('stop')}>停止</button> : <button type="button" disabled={!!busy} onClick={() => act('start')}><PlayNavIcon size={15} /> 启动</button> : <button type="button" disabled={!!busy || !api?.localModelAction} onClick={() => act('install-runtime')}><DownloadNavIcon size={16} /> 下载运行环境</button>}</div>
    <div className="bos-local-inference"><strong>本机推理设置</strong><div className="bos-local-inference-controls"><label>上下文 token<select value={inference.contextTokens} onChange={event => changeInference({ contextTokens: Number(event.target.value) })}>{LOCAL_CONTEXT_OPTIONS.map(value => <option key={value} value={value}>{value / 1024}K</option>)}</select></label><label>最大输出 token<select value={inference.outputTokens} onChange={event => changeInference({ outputTokens: Number(event.target.value) })}>{LOCAL_OUTPUT_OPTIONS.map(value => <option key={value} value={value} disabled={value > inference.contextTokens / 2}>{value / 1024}K</option>)}</select></label></div><small>仅影响本机下一次分析。提高上下文会增加显存和内存占用，超出设备能力时请调低。</small></div>
    <div className="bos-local-model-list">{OPTIONS.map(option => <div className="bos-local-model-row" key={option.id}><div><strong>{option.label}{recommendation.id === option.id && <span className="bos-local-recommended">推荐</span>}</strong><span>{option.id} · {option.size}</span><small>{option.detail}</small></div><div className="bos-local-model-actions">{installed.has(option.id) ? <><span className="bos-local-installed"><CheckNavIcon size={15} /> 已下载</span><button type="button" onClick={() => window.dispatchEvent(new CustomEvent('bos:add-local-provider', { detail: option.id }))}>加入分析模型</button></> : <button type="button" disabled={!!busy || !state?.runtimeInstalled} onClick={() => act('pull', option.id)}><DownloadNavIcon size={16} /> 下载模型</button>}</div></div>)}</div>
    {busy && <div className="bos-local-progress" role="status"><span>{progress?.message || '正在处理…'}{percent == null ? '' : ` · ${percent}%`}</span>{percent != null && <progress value={percent} max="100" />}{percent != null && percent < 100 && <span className="bos-local-progress-details">{rate ? `速度 ${formatDownloadRate(rate.bytesPerSecond)} · 剩余 ${formatRemainingTime(rate.remainingSeconds)}` : '速度与剩余时间计算中'}</span>}{busy === 'install-runtime' || OPTIONS.some(option => option.id === busy) ? <button type="button" onClick={() => api.localModelAction('cancel')}>取消下载</button> : null}</div>}
    {error && <p className="bos-local-error" role="alert">{error}</p>}
    <p className="bos-local-note">本地量化模型的推理质量通常低于官方网页端；DeepSeek-R1 仅支持文本，不承担剪映截图识别。</p>
  </section>;
}

import { UpdateNavIcon, CheckNavIcon, DownloadNavIcon, PlayNavIcon } from './NavigationIcons.jsx';
import { LOCAL_MODEL_OPTIONS as OPTIONS, recommendLocalModel } from './LocalModelRecommendations.mjs';
import { createDownloadRateTracker, formatDownloadRate, formatRemainingTime } from './LocalDownloadRate.mjs';
import { LOCAL_CONTEXT_OPTIONS, LOCAL_OUTPUT_OPTIONS, readLocalModelSettings, saveLocalModelSettings } from '../shared/local-model-settings.mjs';
import { LOCAL_ACCELERATION_OPTIONS, localAccelerationMessage, localVramText } from './LocalAccelerationStatus.mjs';
import { LocalModelManager } from './LocalModelManager.jsx';
import { isLocalModelName, removeLocalProviderModel } from './LocalModelManagement.mjs';

export function useLocalProvider(setProviders) {
  i.useEffect(() => {
    const removedDuringLoad = new Set();
    const add = event => {
      const model = event.detail;
      if (!isLocalModelName(model)) return;
      setProviders(items => {
        const existing = items.find(item => item.id === 'provider-ollama-local');
        if (existing) return items.map(item => item.id === existing.id
          ? { ...item, models: [...new Set([...(item.models || []), model])] } : item);
        return [...items, { id: 'provider-ollama-local', name: '本地模型', description: '本机运行 · 无需账号和 API 密钥', protocol: 'ollama', baseUrl: 'http://127.0.0.1:11435/v1', apiKey: '', models: [model], markIcon: '', tone: 'custom' }];
      });
    };
    window.addEventListener('bos:add-local-provider', add);
    const remove = event => { if (isLocalModelName(event.detail)) { removedDuringLoad.add(event.detail); setProviders(items => removeLocalProviderModel(items, event.detail)); } };
    window.addEventListener('bos:remove-local-provider-model', remove);
    let live = true;
    globalThis.blackObsidian?.localModelAction?.('status').then(state => {
      if (live) for (const model of state.models || []) if (/^qwen3\.5:/.test(model) && !removedDuringLoad.has(model)) add({ detail: model });
    }).catch(() => {});
    return () => { live = false; window.removeEventListener('bos:add-local-provider', add); window.removeEventListener('bos:remove-local-provider-model', remove); };
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
  const [vulkanDevice, setVulkanDevice] = i.useState('');
  const statusRevision = i.useRef(0);
  const rateTracker = i.useRef(createDownloadRateTracker());
  const [clock, setClock] = i.useState(Date.now());
  const refresh = async () => {
    if (!api?.localModelAction) return;
    statusRevision.current++;
    try { const next = await api.localModelAction('detect'); setState(next); setProgress(next.progress); setVulkanDevice(next.acceleration?.settings?.vulkanDevice || ''); }
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
    if (!api?.localModelAction) return;
    let live = true, pending = false;
    const timer = setInterval(async () => {
      if (pending || document.hidden) return;
      pending = true;
      const revision = statusRevision.current;
      try { const next = await api.localModelAction('status'); if (live && revision === statusRevision.current) setState(next); }
      catch { /* Preserve the last status; a manual refresh reports failures. */ }
      finally { pending = false; }
    }, 4000);
    return () => { live = false; clearInterval(timer); };
  }, [api]);
  i.useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [busy]);
  const act = async (action, model = '', settings) => {
    statusRevision.current++;
    rateTracker.current.reset(); setProgress(null);
    setBusy(action === 'pull' ? model : action); setError('');
    try {
      const next = await api.localModelAction(action, model, ...(settings ? [settings] : []));
      setState(next);
      if (action === 'pull' && next.models?.includes(model)) window.dispatchEvent(new CustomEvent('bos:add-local-provider', { detail: model }));
      if (action === 'delete-model' && !next.models?.includes(model)) window.dispatchEvent(new CustomEvent('bos:remove-local-provider-model', { detail: model }));
      return true;
    }
    catch (failure) { setError(failure.message); return false; }
    finally { setBusy(''); await refresh(); }
  };
  const checkSources = async () => {
    setBusy('sources'); setSources(null); setError('');
    try { setSources(await api.localModelAction('sources', recommendation.id || 'deepseek-r1:7b')); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(''); }
  };
  const installed = new Set(state?.models || []);
  for (const model of state?.modelDetails || []) if (!model.complete) installed.delete(model.name);
  const recommendation = recommendLocalModel(state?.hardware, 'qwen');
  const hardware = state?.hardware;
  const acceleration = state?.acceleration;
  const accelerationMode = acceleration?.settings?.mode || 'auto';
  const saveAcceleration = async (patch = {}) => {
    statusRevision.current++;
    setBusy('acceleration'); setError('');
    try { setState(await api.localModelAction('acceleration', '', { mode: accelerationMode, vulkanDevice, ...patch })); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(''); }
  };
  const percent = progress?.total > 0 ? Math.min(100, Math.round(progress.completed / progress.total * 100)) : null;
  const rate = rateTracker.current.read(progress, clock);
  const changeInference = patch => {
    try { setInference(saveLocalModelSettings({ ...inference, ...patch })); setError(''); }
    catch { setError('本地 token 设置无法保存，请检查程序数据目录。'); }
  };
  return <section className="bos-local-models" aria-labelledby="bos-local-models-title">
    <div className="bos-local-models-heading"><div><h2 id="bos-local-models-title">本地千问 / DeepSeek</h2><p>运行环境与模型保存在 {state?.root || '安装目录的数据文件夹'}。模型推理在本机完成，无 API 费用。</p></div><button type="button" className="bos-local-refresh" onClick={refresh} title="重新检测设备和模型状态"><UpdateNavIcon size={17} /> 刷新状态</button></div>
    <p>新电脑可直接下载千问；缺少运行环境时自动安装，完成后自动加入分析模型。</p>
    <LocalModelManager state={state} busy={busy} onAction={act} />
    <h3 className="bos-local-download-heading">下载模型</h3>
    <div className="bos-local-model-list">{OPTIONS.map(option => <div className="bos-local-model-row" key={option.id}><div><strong>{option.label}{recommendation.id === option.id && <span className="bos-local-recommended">推荐</span>}</strong><span>{option.id} · {option.size}</span><small>{option.detail}</small></div><div className="bos-local-model-actions">{installed.has(option.id) ? <><span className="bos-local-installed"><CheckNavIcon size={15} /> 已下载</span><button type="button" onClick={() => window.dispatchEvent(new CustomEvent('bos:add-local-provider', { detail: option.id }))}>加入分析模型</button></> : <button type="button" disabled={!!busy || !api?.localModelAction} onClick={() => act('pull', option.id)}><DownloadNavIcon size={16} /> {state?.runtimeInstalled ? '下载模型' : '一键下载部署'}</button>}</div></div>)}</div>
    {hardware && <div className="bos-local-hardware"><strong>当前设备</strong><span>{hardware.gpuName || '未检测到显卡'} · 显存 {hardware.vramGB || 0} GB · 内存 {hardware.ramGB || 0} GB</span><span>{recommendation.id ? `推荐 ${recommendation.id}：${recommendation.reason}` : recommendation.reason}</span></div>}
    <div className="bos-local-sources"><button type="button" disabled={!!busy || !api?.localModelAction} onClick={checkSources}><UpdateNavIcon size={15} /> {busy === 'sources' ? '正在检测下载源…' : '检测下载源'}</button>{sources && <span role="status">{sources.runtime.message}；{sources.model.message}</span>}</div>
    <div className="bos-local-runtime"><span className={state?.running ? 'bos-local-dot active' : 'bos-local-dot'} aria-hidden="true" /><span>{!api?.localModelAction ? '需更新桌面程序后使用' : state?.running ? '本地服务运行中' : state?.runtimeInstalled ? '运行环境已安装，服务未启动' : '尚未安装运行环境'}</span>{state?.runtimeInstalled ? state?.running ? <button type="button" disabled={!!busy} onClick={() => act('stop')}>停止</button> : <button type="button" disabled={!!busy} onClick={() => act('start')}><PlayNavIcon size={15} /> 启动</button> : <button type="button" disabled={!!busy || !api?.localModelAction} onClick={() => act('install-runtime')}><DownloadNavIcon size={16} /> 下载运行环境</button>}</div>
    {acceleration && <div className="bos-local-inference"><strong>显卡加速</strong>
      <div className="bos-local-inference-controls"><label>加速方式<select value={accelerationMode} disabled={!!busy || !state?.runtimeInstalled} onChange={event => saveAcceleration({ mode: event.target.value })}>{LOCAL_ACCELERATION_OPTIONS.map(option => <option key={option.value} value={option.value} disabled={option.value === 'vulkan' && !acceleration.vulkanInstalled || option.value === 'rocm' && !acceleration.rocmInstalled}>{option.label}</option>)}</select></label>
        {accelerationMode === 'vulkan' && <label>Vulkan 设备编号<input value={vulkanDevice} placeholder="留空自动选择" disabled={!!busy} onChange={event => setVulkanDevice(event.target.value)} onBlur={() => { if (vulkanDevice !== (acceleration.settings?.vulkanDevice || '')) void saveAcceleration(); }} /></label>}
      </div>
      {acceleration.hasAmd && <small>RX 6500 XT 等 AMD 显卡可使用 Vulkan 兼容方式；需安装支持 Vulkan 的 AMD 显卡驱动。双显卡设备编号以 Ollama 检测编号为准，留空自动选择。</small>}
      {acceleration.restartRequired && <small role="status">设置将在本地服务下次启动后生效。请先等分析完成，再点击上方“停止”和“启动”。</small>}
      <span role="status">{localAccelerationMessage(acceleration)}</span>
      {(acceleration.models || []).map(model => <small key={model.name}>{model.name} · 模型占用显存 {localVramText(model)}</small>)}
      {acceleration.usageState === 'cpu' && acceleration.hasAmd && <small>若未使用显卡，请选 Vulkan 兼容、重新启动本地服务，并降低上下文；驱动或显存不足时可能继续使用 CPU。</small>}
      {acceleration.hasAmd && !acceleration.vulkanInstalled && <small>当前运行环境缺少 Vulkan 组件，需要更新完整 Ollama Windows 运行环境。</small>}
      <div><button type="button" disabled={!!busy || !!state?.running} onClick={() => act('upgrade-runtime')}>更新运行环境</button><small> 需先停止本地服务；模型保留，旧运行环境会备份。</small></div>
    </div>}
    <div className="bos-local-inference"><strong>本机推理设置</strong><div className="bos-local-inference-controls"><label>上下文 token<select value={inference.contextTokens} onChange={event => changeInference({ contextTokens: Number(event.target.value) })}>{LOCAL_CONTEXT_OPTIONS.map(value => <option key={value} value={value}>{value / 1024}K</option>)}</select></label><label>最大输出 token<select value={inference.outputTokens} onChange={event => changeInference({ outputTokens: Number(event.target.value) })}>{LOCAL_OUTPUT_OPTIONS.map(value => <option key={value} value={value} disabled={value > inference.contextTokens / 2}>{value / 1024}K</option>)}</select></label></div>{hardware?.vramGB > 0 && hardware.vramGB <= 4.5 && <button type="button" onClick={() => changeInference({ contextTokens: 8192, outputTokens: 2048 })}>应用 4GB 显存设置（8K / 2K）</button>}<small>仅影响本机下一次分析。提高上下文会增加显存和内存占用，超出设备能力时请调低。</small></div>
    {busy && <div className="bos-local-progress" role="status"><span>{progress?.message || '正在处理…'}{percent == null ? '' : ` · ${percent}%`}</span>{percent != null && <progress value={percent} max="100" />}{percent != null && percent < 100 && <span className="bos-local-progress-details">{rate ? `速度 ${formatDownloadRate(rate.bytesPerSecond)} · 剩余 ${formatRemainingTime(rate.remainingSeconds)}` : '速度与剩余时间计算中'}</span>}{busy === 'install-runtime' || busy === 'upgrade-runtime' || OPTIONS.some(option => option.id === busy) ? <button type="button" onClick={() => api.localModelAction('cancel')}>取消下载</button> : null}</div>}
    {error && <p className="bos-local-error" role="alert">{error}</p>}
    <p className="bos-local-note">本地量化模型的推理质量通常低于官方网页端；DeepSeek-R1 仅支持文本，不承担剪映截图识别。</p>
  </section>;
}

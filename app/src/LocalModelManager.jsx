import { installedModelRows, modelBytes } from './LocalModelManagement.mjs';

export function LocalModelManager({ state, busy, onAction }) {
  const [pendingDelete, setPendingDelete] = i.useState('');
  const [notice, setNotice] = i.useState('');
  const rows = installedModelRows(state);
  const supported = Array.isArray(state?.modelDetails);
  const blocked = !!busy || !!state?.analysisActive || !supported || !state?.runtimeInstalled;
  const manage = async (action, name) => {
    setNotice('');
    const ok = await onAction(action, name, action === 'delete-model' ? { confirmModel: name } : undefined);
    if (ok) {
      setPendingDelete('');
      setNotice(action === 'delete-model' ? `${name} 已删除，已保存的分析结果保留。` : `${name} 已释放内存与显存，下次分析时自动加载。`);
    }
  };
  return <section className="bos-local-manager" aria-labelledby="bos-local-manager-title">
    <div className="bos-local-manager-heading"><div><h3 id="bos-local-manager-title">已安装模型 <span>{rows.length}</span></h3><p>{state ? `模型文件合计 ${modelBytes(state.modelStorageBytes)} · 共享文件只计算一次` : '正在读取已安装模型…'}</p></div>
      <button type="button" disabled={!!busy || !supported} onClick={() => onAction('open-model-folder')}>打开模型目录</button></div>
    {state?.modelsPath && <p className="bos-local-model-path" title={state.modelsPath}>{state.modelsPath}</p>}
    {!rows.length && state && <p className="bos-local-manager-empty">尚未下载模型，可在下方选择适合设备的模型。</p>}
    <div className="bos-local-managed-list">{rows.map(model => <article className="bos-local-managed-model" key={model.name}>
      <div className="bos-local-managed-info"><strong>{model.name}</strong><span>{modelBytes(model.sizeBytes)}{[model.parameters, model.quantization].filter(Boolean).map(value => ` · ${value}`)}</span>
        <span className={model.loaded ? 'bos-local-model-state loaded' : 'bos-local-model-state'}>{!model.complete ? '文件不完整' : model.loaded ? `已加载 · 显存 ${modelBytes(model.vramBytes)}` : !state.running ? '已下载 · 服务未启动' : state.acceleration?.usageState === 'unknown' ? '加载状态暂不可用' : '已下载 · 未加载'}</span></div>
      <div className="bos-local-managed-actions">
        <button type="button" disabled={!!busy || !model.complete} onClick={() => { window.dispatchEvent(new CustomEvent('bos:add-local-provider', { detail: model.name })); setNotice(`${model.name} 已加入分析模型。`); }}>加入分析</button>
        <button type="button" disabled={blocked || !model.loaded} onClick={() => manage('unload-model', model.name)} title="释放模型占用的内存和显存，保留下载文件">释放显存</button>
        <button type="button" className="bos-local-delete" disabled={blocked} onClick={() => { setPendingDelete(model.name); setNotice(''); }}>删除</button>
      </div>
      {pendingDelete === model.name && <div className="bos-local-delete-confirm" role="group" aria-label={`确认删除 ${model.name}`}><p>确定删除 <strong>{model.name}</strong>？删除后需重新下载；已有剧本和分析结果保留。</p><div><button type="button" disabled={!!busy} onClick={() => setPendingDelete('')}>取消</button><button type="button" className="bos-local-delete" disabled={blocked} onClick={() => manage('delete-model', model.name)}>确认删除</button></div></div>}
    </article>)}</div>
    {state?.analysisActive && <p role="status">本地分析正在进行，完成后可释放或删除模型。</p>}
    {state?.modelWarning && <p className="bos-local-error" role="alert">{state.modelWarning}</p>}
    {notice && <p className="bos-local-manager-notice" role="status">{notice}</p>}
  </section>;
}

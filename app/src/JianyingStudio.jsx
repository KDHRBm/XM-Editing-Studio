import { isGeminiModel } from '../shared/script-score.mjs';
import { usePanelCollapsed } from './PanelState.jsx';

function ToolPanel({ id, number, title, detail, children }) {
  const [collapsed, toggle] = usePanelCollapsed('jianying-' + id);
  return <section className="bos-jy-panel"><header><div><small>{number} / JIANYING</small><h3>{title}</h3><p>{detail}</p></div><button type="button" className="bos-panel-toggle" aria-expanded={!collapsed} aria-controls={'jy-' + id} onClick={toggle}>{collapsed ? '展开' : '收起'} {collapsed ? '⌄' : '⌃'}</button></header><div id={'jy-' + id} hidden={collapsed} className="bos-jy-panel-body">{children}</div></section>;
}
const waitsLabels = { open_draft: '打开草稿', export: '点击导出', confirm: '确认导出', popup_close: '收起至首页', close_btn: '关闭导出窗口', draft_close: '关闭草稿' };
const empty = { queue: [], plan: [], logs: [], templates: [], waits: {}, ready: false, busy: false, status: '正在准备本地引擎…' };

export function JianyingStudio({ active, providers, onNavigate }) {
  const [visited, setVisited] = i.useState(active);
  const [state, setState] = i.useState(empty);
  const [error, setError] = i.useState('');
  const [pending, setPending] = i.useState(false);
  const [selected, setSelected] = i.useState(0);
  const [modelKey, setModelKey] = i.useState(() => localStorage.getItem('xm.jianying.model') || '');
  const [folder, setFolder] = i.useState('');
  const [template, setTemplate] = i.useState('短剧名称_第1集');
  const [aiRename, setAiRename] = i.useState(false);
  const [waits, setWaits] = i.useState(null);
  const [templateName, setTemplateName] = i.useState('');
  const [exportOptionsCollapsed, toggleExportOptions] = usePanelCollapsed('jianying-export-options');
  const api = globalThis.blackObsidian;
  const models = providers.flatMap(provider => (provider.models || []).filter(model => isGeminiModel(provider, model)).map(model => ({ key: provider.id + '::' + model, provider, model })));
  const connection = models.find(item => item.key === modelKey) || models[0];
  const locked = pending || state.busy || state.recording || !!state.modal;
  i.useEffect(() => { if (active) setVisited(true); }, [active]);
  i.useEffect(() => {
    if (!visited || !api?.jianyingAction) return;
    let alive = true, timer;
    const poll = async () => {
      try { const value = await api.jianyingAction('status', {}); if (alive) setState(value); }
      catch (err) { if (alive) setError(err.message); }
      if (alive) timer = setTimeout(poll, 1500);
    };
    void poll(); return () => { alive = false; clearTimeout(timer); };
  }, [visited]);
  const perform = async fn => { setPending(true); setError(''); try { await fn(); } catch (err) { setError(err.message || '操作失败。'); } finally { setPending(false); } };
  const run = (action, args = {}) => perform(async () => {
    if (!api?.jianyingAction) throw new Error('此功能需要桌面版的本地引擎。');
    setState(await api.jianyingAction(action, args, connection ? { provider: connection.provider, model: connection.model } : undefined));
  });
  const choosePath = key => perform(async () => { const value = await api.chooseDirectory(); if (value) setState(await api.jianyingAction('paths', { [key]: value })); });
  const chooseFiles = () => perform(async () => { const files = await api.chooseJianyingFiles(); if (files) { setFolder(''); setState(await api.jianyingAction('files', { files })); } });
  return <section className="bos-script bos-jianying" hidden={!active} aria-label="JianYing-Ai-Pro">
    <div className="bos-jy-overview"><div><span className="bos-script-eyebrow">JIANYING AI PRO</span><h2>让重复操作，自动完成。</h2><p>批量导出、字幕工程、文件命名，在一个工作台完成。</p></div><div><span role="status">{state.status}</span><button type="button" onClick={() => run('stop')} disabled={!state.ready}>中断任务 · F10</button></div></div>
    {error && <p className="bos-script-alert" role="alert">{error}</p>}
    {state.notice && <p className="bos-script-message" role="status">{state.notice}</p>}
    <div className="bos-jy-panels">
      <ToolPanel id="export" number="01" title="批量导出" detail="识别剪映首页草稿，按所选模式连续导出。">
        <div className="bos-jy-toolbar"><button type="button" disabled={locked || !state.ready} onClick={() => run('wizard')}>录制坐标 · F8</button><button type="button" disabled={locked || !connection || !state.ready} onClick={() => run('scan')}>AI 扫描草稿</button><button type="button" className="bos-script-primary" disabled={locked || !state.queue.length || !state.coordinatesReady} onClick={() => run('export', { index: selected })}>从所选草稿开始导出</button></div>
        <p className="bos-script-footnote">{state.guide || '首次使用需录制坐标。'} · 扫描时工作台会最小化，将剪映首页截图交给所选 Gemini。仅识别当前屏幕可见草稿。</p>
        <div className="bos-jy-table"><table><thead><tr><th>选择</th><th>草稿名称</th><th>状态</th></tr></thead><tbody>{state.queue.map((item, index) => <tr key={index} aria-selected={selected === index}><td><input type="radio" name="jy-draft" aria-label={'从草稿 ' + item.name + ' 开始'} checked={selected === index} onChange={() => setSelected(index)} /></td><td>{item.name}</td><td>{item.st}</td></tr>)}</tbody></table>{!state.queue.length && <p>打开剪映首页，扫描后在这里选择起始草稿。</p>}</div>
        <small>录制时鼠标移到相应按钮并按 F8；等待完成模式下按 F9 跳过“收起至首页”。F10 随时中断。导出期间请保持剪映在前台。</small>
        <section className="bos-jy-export-options">
          <header><div><h4>导出模式与参数</h4><small>{state.mode === 'wait_close' ? '等待完成 · 逐个完整渲染' : '收起至首页 · 后台继续渲染'} · {state.templates.find(item => item.id === state.templateId)?.name || '尚未选择坐标模板'}</small></div><button type="button" className="bos-panel-toggle" aria-expanded={!exportOptionsCollapsed} aria-controls="bos-jy-export-options-body" onClick={toggleExportOptions}>{exportOptionsCollapsed ? '展开设置 ⌄' : '收起设置 ⌃'}</button></header>
          <div id="bos-jy-export-options-body" hidden={exportOptionsCollapsed} className="bos-jy-export-options-body">
        <label><span>导出模式</span><select value={state.mode || 'return_home'} disabled={locked || !state.ready} onChange={event => run('settings', { mode: event.target.value })}><option value="return_home">收起至首页 · 后台继续渲染</option><option value="wait_close">等待完成 · 逐个完整渲染</option></select></label>
        <label><span>坐标模板 · {state.resolution?.join(' × ') || '待检测'}</span><select value={state.templateId || ''} disabled={locked || !state.ready} onChange={event => run('select_template', { id: event.target.value })}><option value="">请先完成坐标录制</option>{state.templates.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        {state.templateId && <div className="bos-jy-toolbar"><input aria-label="模板新名称" maxLength={40} value={templateName} onChange={event => setTemplateName(event.target.value)} placeholder="模板新名称" /><button type="button" disabled={locked || !templateName.trim()} onClick={() => run('rename_template', { id: state.templateId, name: templateName })}>改名</button><button type="button" disabled={locked} onClick={() => run('delete_template', { id: state.templateId })}>删除模板</button></div>}
        <div className="bos-jy-waits">{Object.entries(waitsLabels).map(([key, label]) => <label key={key}><span>{label} / 秒</span><input type="number" min="0.1" max="600" step="0.1" disabled={locked || !state.ready} value={(waits || state.waits)[key] ?? ''} onChange={event => setWaits(previous => ({ ...(previous || state.waits), [key]: event.target.value }))} /></label>)}</div>
        <button type="button" disabled={locked || !waits} onClick={() => perform(async () => { setState(await api.jianyingAction('settings', { waits })); setWaits(null); })}>保存等待时间</button>
          </div>
        </section>
      </ToolPanel>
      <ToolPanel id="subtitles" number="02" title="字幕工程" detail="提取字幕、统一字体或恢复字幕轨道显示。">
        <label><span>剪映草稿根目录</span><div className="bos-jy-path"><input readOnly value={state.draftDir || ''} placeholder="选择包含各草稿的文件夹" /><button type="button" disabled={locked} onClick={() => choosePath('draftDir')}>选择</button></div></label>
        <label><span>字幕导出文件夹</span><div className="bos-jy-path"><input readOnly value={state.subtitleOutput || ''} /><button type="button" disabled={locked} onClick={() => choosePath('subtitleOutput')}>选择</button></div></label>
        <div className="bos-jy-toolbar"><button type="button" disabled={locked || !state.draftDir} onClick={() => run('extract')}>提取字幕并隐藏轨道</button><button type="button" disabled={locked || !state.draftDir} onClick={() => run('fonts')}>统一 Noto Sans Bold 字体</button><button type="button" disabled={locked || !state.draftDir} onClick={() => run('unhide')}>恢复字幕显示</button></div>
        <small>修改草稿前请完全退出剪映。支持普通 JSON 及原项目支持的加密草稿、多时间线；写入前自动备份并校验。字体操作需本机已安装 Noto Sans Bold。</small>
      </ToolPanel>
      <ToolPanel id="rename" number="03" title="批量改名" detail="先预览，再一次执行；保留扩展名并检查名称冲突。">
        <div className="bos-source-choice"><button type="button" aria-pressed={!aiRename} disabled={locked} onClick={() => { setAiRename(false); }}>按集数模板</button><button type="button" aria-pressed={aiRename} disabled={locked} onClick={() => { setAiRename(true); }}>AI 智能命名</button></div>
        <label><span>文件夹 {aiRename && '或单独选择文件'}</span><div className="bos-jy-path"><input readOnly value={folder} placeholder={state.fileCount ? '已选择 ' + state.fileCount + ' 个文件' : '选择要改名的文件夹'} /><button type="button" disabled={locked} onClick={() => perform(async () => { const value = await api.chooseDirectory(); if (value) setFolder(value); })}>选择文件夹</button>{aiRename && <button type="button" disabled={locked} onClick={chooseFiles}>选择文件</button>}</div></label>
        <label><span>命名模板</span><input maxLength={500} value={template} disabled={locked} onChange={event => setTemplate(event.target.value)} placeholder="例如：短剧名称_第1集" /></label>
        <div className="bos-jy-toolbar"><button type="button" disabled={locked || !state.ready || (aiRename && !connection)} onClick={() => run('preview', { folder, template, ai: aiRename })}>{aiRename ? 'AI 生成预览' : '生成改名预览'}</button><button type="button" className="bos-script-primary" disabled={locked || !state.plan.length} onClick={() => run('rename')}>执行预览中的改名</button></div>
        <div className="bos-jy-table"><table><thead><tr><th>原文件名</th><th>新文件名</th></tr></thead><tbody>{state.plan.map((item, index) => <tr key={index}><td>{item.old_name}</td><td>{item.new_name}</td></tr>)}</tbody></table>{!state.plan.length && <p>改名方案会显示在这里，预览不会修改文件。</p>}</div>
      </ToolPanel>
      <ToolPanel id="settings" number="04" title="模型连接" detail="复用已有 Gemini 连接，供草稿扫描和智能命名使用。">
        <label><span>Gemini 模型</span><select value={connection?.key || ''} disabled={locked} onChange={event => { setModelKey(event.target.value); localStorage.setItem('xm.jianying.model', event.target.value); }}>{!models.length && <option value="">请先添加 Gemini 连接</option>}{models.map(item => <option key={item.key} value={item.key}>{item.model} · {item.provider.name}</option>)}</select></label>
        <button type="button" onClick={() => onNavigate('providers')}>管理已有模型与连接 ↗</button>
        <small>无需再次填写 API Key。AI 扫描发送截图，AI 改名仅发送文件名；本地字幕工具和模板改名不调用 AI。</small>
      </ToolPanel>
    </div>
    <details className="bos-jy-log" open><summary>任务日志 · {state.logs.length} 条</summary><pre>{state.logs.join('\n') || '操作开始后会在这里显示进度。'}</pre></details>
    {state.modal && <div className="bos-jy-modal-backdrop"><section className="bos-jy-modal" role="dialog" aria-modal="true" aria-labelledby="jy-modal-title"><h3 id="jy-modal-title">{state.modal.title}</h3><p>{state.modal.message}</p><div className="bos-jy-toolbar"><button type="button" disabled={pending} onClick={() => run('modal', { id: state.modal.id, confirmed: false })}>取消</button><button type="button" className="bos-script-primary" disabled={pending} onClick={() => run('modal', { id: state.modal.id, confirmed: true })}>确认执行</button></div></section></div>}
  </section>;
}

import { isGeminiModel } from '../shared/script-score.mjs';
import { DEEPSEEK_SCAN } from '../shared/jianying-models.mjs';
import { usePanelCollapsed } from './PanelState.jsx';
import { WatermarkStudio } from './WatermarkStudio.jsx';

const stages = ['export', 'subtitles', 'rename', 'watermark'];
const stageInfo = [
  { id: 'export', number: '01', title: '批量导出', detail: 'AI 扫描草稿并顺序导出' },
  { id: 'subtitles', number: '02', title: '字幕工程', detail: '提取、整理与显示字幕' },
  { id: 'rename', number: '03', title: '批量改名', detail: '预览后批量执行' },
  { id: 'watermark', number: '04', title: '样片水印', detail: '本地批量处理视频' },
];

function ToolPanel({ id, number, title, detail, hiddenStage, children }) {
  const [collapsed, toggle] = usePanelCollapsed('jianying-' + id);
  return <section className="bos-jy-panel" hidden={hiddenStage}><header><div><small>{number} / JIANYING</small><h3>{title}</h3><p>{detail}</p></div><button type="button" className="bos-panel-toggle" aria-expanded={!collapsed} aria-controls={'jy-' + id} onClick={toggle}>{collapsed ? '展开' : '收起'} {collapsed ? '⌄' : '⌃'}</button></header><div id={'jy-' + id} hidden={collapsed} className="bos-jy-panel-body">{children}</div></section>;
}
const waitsLabels = { open_draft: '打开草稿', export: '点击导出', confirm: '确认导出', popup_close: '收起至首页', close_btn: '关闭导出窗口', draft_close: '关闭草稿' };
const empty = { queue: [], plan: [], logs: [], templates: [], waits: {}, ready: false, busy: false, status: '正在准备本地引擎…' };

function ToolDialog({ open, title, onCancel, children }) {
  const dialog = i.useRef(null);
  i.useEffect(() => {
    const node = dialog.current;
    if (open && !node.open) node.showModal();
    else if (!open && node.open) node.close();
    return () => { if (node.open) node.close(); };
  }, [open]);
  return <dialog ref={dialog} className="bos-jy-modal bos-jy-native-dialog" aria-label={title} onCancel={event => { event.preventDefault(); onCancel(); }}><h3>{title}</h3>{children}</dialog>;
}

function DirectoryField({ label, value, disabled, onSave, onBrowse, placeholder }) {
  const [draft, setDraft] = i.useState(value || '');
  const dirty = i.useRef(false);
  i.useEffect(() => { if (!dirty.current) setDraft(value || ''); }, [value]);
  const save = async () => {
    if (!dirty.current) return;
    if (await onSave(draft)) dirty.current = false;
  };
  return <label><span>{label}</span><div className="bos-jy-path"><input aria-label={label} value={draft} disabled={disabled} placeholder={placeholder} onChange={event => { dirty.current = true; setDraft(event.target.value); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void save(); } }} /><button type="button" disabled={disabled || draft === value} onClick={() => void save()}>保存路径</button><button type="button" disabled={disabled} onClick={onBrowse}>选择</button></div></label>;
}

export function JianyingStudio({ active, providers, onNavigate }) {
  const [visited, setVisited] = i.useState(active);
  const [stage, setStage] = i.useState(() => {
    const saved = localStorage.getItem('xm.jianying.stage');
    return stages.includes(saved) ? saved : 'export';
  });
  const [state, setState] = i.useState(empty);
  const [error, setError] = i.useState('');
  const [pending, setPending] = i.useState(false);
  const [selected, setSelected] = i.useState(0);
  const [modelKey, setModelKey] = i.useState(() => localStorage.getItem('xm.jianying.model') || '');
  const [scanModelKey, setScanModelKey] = i.useState(() => localStorage.getItem('xm.jianying.scan-model') || 'gemini');
  const [folder, setFolder] = i.useState('');
  const [template, setTemplate] = i.useState('短剧名称_第1集');
  const [aiRename, setAiRename] = i.useState(false);
  const [waits, setWaits] = i.useState(null);
  const [waitsMode, setWaitsMode] = i.useState('return_home');
  const [templateName, setTemplateName] = i.useState('');
  const [exportOptionsCollapsed, toggleExportOptions] = usePanelCollapsed('jianying-export-options');
  const api = globalThis.blackObsidian;
  const models = providers.flatMap(provider => (provider.models || []).filter(model => isGeminiModel(provider, model)).map(model => ({ key: provider.id + '::' + model, provider, model })));
  const connection = models.find(item => item.key === modelKey) || models[0];
  const scanConnection = scanModelKey === DEEPSEEK_SCAN.key ? DEEPSEEK_SCAN : connection;
  const locked = pending || state.busy || state.recording || !!state.modal;
  const selectStage = next => {
    if (!stages.includes(next)) return;
    setStage(next);
    localStorage.setItem('xm.jianying.stage', next);
    document.querySelector('.main-scroll')?.scrollTo({ top: 0, behavior: 'smooth' });
  };
  i.useEffect(() => {
    const onStage = event => selectStage(event.detail);
    window.addEventListener('xm-jianying-stage', onStage);
    return () => window.removeEventListener('xm-jianying-stage', onStage);
  }, []);
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
  const perform = async fn => { setPending(true); setError(''); try { await fn(); return true; } catch (err) { setError(err.message || '操作失败。'); return false; } finally { setPending(false); } };
  const run = (action, args = {}) => perform(async () => {
    if (!api?.jianyingAction) throw new Error('此功能需要桌面版的本地引擎。');
    const selectedConnection = action === 'scan' ? scanConnection : connection;
    setState(await api.jianyingAction(action, args, selectedConnection ? { provider: selectedConnection.provider, model: selectedConnection.model } : undefined));
  });
  const choosePath = key => perform(async () => { const value = await api.chooseDirectory(state[key] || ''); if (value) setState(await api.jianyingAction('paths', { [key]: value })); });
  const savePath = (key, value) => perform(async () => { setState(await api.jianyingAction('paths', { [key]: value.trim().replace(/^"|"$/g, '') })); });
  const chooseFiles = () => perform(async () => { const files = await api.chooseJianyingFiles(); if (files) { setFolder(''); setState(await api.jianyingAction('files', { files })); } });
  return <section className="bos-script bos-jianying" hidden={!active} aria-label="JianYing-Ai-Pro">
    <div className="bos-jy-overview"><div><span className="bos-script-eyebrow">JIANYING AI PRO</span><h2>剪映自动化与样片水印</h2><p>批量导出、字幕工程、文件命名与样片水印。</p></div><div><span role="status">{state.status}</span><button type="button" onClick={() => run('stop')} disabled={!state.ready}>中断任务 · F10</button></div></div>
    <nav className="bos-top-stage-bar bos-top-stage-bar-4" role="tablist" aria-label="剪映自动化功能">
      {stageInfo.map(item => <button type="button" role="tab" key={item.id} className={'bos-stage-tab' + (stage === item.id ? ' is-active' : '')} aria-selected={stage === item.id} onClick={() => selectStage(item.id)}><span className="bos-stage-num">{item.number}</span><span className="bos-stage-text"><strong>{item.title}</strong><small>{item.detail}</small></span></button>)}
    </nav>
    {error && <p className="bos-script-alert" role="alert">{error}</p>}
    {state.notice && <p className="bos-script-message" role="status">{state.notice}</p>}
    <div className="bos-jy-panels">
      <ToolPanel id="export" number="01" title="批量导出" detail="识别剪映首页草稿，按所选模式连续导出。" hiddenStage={stage !== 'export'}>
        <label><span>草稿扫描模型</span><select aria-label="草稿扫描模型" value={scanModelKey} disabled={locked} onChange={event => { setScanModelKey(event.target.value); localStorage.setItem('xm.jianying.scan-model', event.target.value); }}><option value="gemini">Gemini · 使用下方已配置连接</option><option value={DEEPSEEK_SCAN.key}>DeepSeek · 官方网页版，无需 API</option></select></label>
        <div className="bos-jy-toolbar"><button type="button" disabled={locked || !state.ready} onClick={() => run('wizard')}>录制坐标 · F8</button><button type="button" disabled={locked || !scanConnection || !state.ready} onClick={() => run('scan')}>AI 扫描草稿</button><button type="button" className="bos-script-primary" disabled={locked || !state.queue.length || !state.coordinatesReady} onClick={() => run('export', { index: selected })}>从所选草稿开始导出</button></div>
        <p className="bos-script-footnote">{state.guide || '首次使用需录制坐标。'} · 扫描时工作台会最小化，右下角显示进度。请在剪映中显示“草稿”或“本地草稿”及下方项目，支持文件夹内页面，无需显示数量；AI 会排除功能卡片与文件夹，坐标校验失败时自动纠正一次。扫描后请保持剪映窗口位置和草稿列表不变再导出。</p>
        {scanModelKey === DEEPSEEK_SCAN.key && <small>截图后直接使用“国内 AI”中已有的 DeepSeek 页面，复用登录账号，无需 API。先填入完整问题，再上传截图并发送；回答会自动接回草稿列表。请使用支持图片理解的模式。按 F10 可中断；网页未自动发送时，可直接点击页面中的发送箭头。</small>}
        {state.recordingError && <p className="bos-script-alert" role="alert">{state.recordingError}</p>}
        <div className="bos-jy-table"><table><thead><tr><th>选择</th><th>草稿名称</th><th>状态</th></tr></thead><tbody>{state.queue.map((item, index) => <tr key={index} aria-selected={selected === index}><td><input type="radio" name="jy-draft" aria-label={'从草稿 ' + item.name + ' 开始'} checked={selected === index} onChange={() => setSelected(index)} /></td><td>{item.name}</td><td>{item.st}</td></tr>)}</tbody></table>{!state.queue.length && <p>打开剪映首页，扫描后在这里选择起始草稿。</p>}</div>
        <small>开启录制后，工作台最小化。鼠标放到目标按钮文字或图标中心，按下并松开 F8 记录，再手动点击该按钮进入下一步。等待完成模式依次按 F8 录制：导出 → 确认导出 → 关闭导出界面 → 关闭草稿，第四次 F8 后自动保存。第三步请等导出完成后录制，第四步请先关闭导出界面。收起至首页模式在该按钮出现时按第三次 F8 保存。按 F10 结束录制或导出运行；已提交给剪映的后台渲染会继续。导出期间保持剪映在前台，不滚动草稿列表；窗口大小或显示缩放改变后重新扫描和录制。</small>
        <section className="bos-jy-export-options">
          <header><div><h4>导出模式与参数</h4><small>{state.mode === 'wait_close' ? '等待完成 · 逐个完整渲染' : '收起至首页 · 后台继续渲染'} · {state.templates.find(item => item.id === state.templateId)?.name || '尚未选择坐标模板'}</small></div><button type="button" className="bos-panel-toggle" aria-expanded={!exportOptionsCollapsed} aria-controls="bos-jy-export-options-body" onClick={toggleExportOptions}>{exportOptionsCollapsed ? '展开设置 ⌄' : '收起设置 ⌃'}</button></header>
          <div id="bos-jy-export-options-body" hidden={exportOptionsCollapsed} className="bos-jy-export-options-body">
        <label><span>导出模式</span><select value={state.mode || 'return_home'} disabled={locked || !state.ready} onChange={event => run('settings', { mode: event.target.value })}><option value="return_home">收起至首页 · 后台继续渲染</option><option value="wait_close">等待完成 · 逐个完整渲染</option></select></label>
        <label><span>坐标模板 · {state.resolution?.join(' × ') || '待检测'}</span><select value={state.templateId || ''} disabled={locked || !state.ready} onChange={event => run('select_template', { id: event.target.value })}><option value="">请先完成坐标录制</option>{state.templates.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        {state.templateId && <div className="bos-jy-toolbar"><input aria-label="模板新名称" maxLength={40} value={templateName} onChange={event => setTemplateName(event.target.value)} placeholder="模板新名称" /><button type="button" disabled={locked || !templateName.trim()} onClick={() => run('rename_template', { id: state.templateId, name: templateName })}>改名</button><button type="button" disabled={locked} onClick={() => run('delete_template', { id: state.templateId })}>删除模板</button></div>}
        <button type="button" disabled={locked || !state.ready} onClick={() => { setWaitsMode(state.mode); setWaits({ ...state.waits }); }}>调整等待时间参数</button>
        <small>两种导出模式分别记忆等待时间，切换模式时自动恢复。</small>
          </div>
        </section>
      </ToolPanel>
      <ToolPanel id="subtitles" number="02" title="字幕工程" detail="提取字幕、统一字体或恢复字幕轨道显示。" hiddenStage={stage !== 'subtitles'}>
        <DirectoryField key={'draft:' + state.draftDir} label="剪映草稿根目录" value={state.draftDir || ''} disabled={locked} placeholder="粘贴目录路径后按 Enter 保存" onSave={value => savePath('draftDir', value)} onBrowse={() => choosePath('draftDir')} />
        <DirectoryField key={'output:' + state.subtitleOutput} label="字幕导出文件夹" value={state.subtitleOutput || ''} disabled={locked} placeholder="粘贴目录路径后按 Enter 保存" onSave={value => savePath('subtitleOutput', value)} onBrowse={() => choosePath('subtitleOutput')} />
        <div className="bos-jy-toolbar"><button type="button" disabled={locked || !state.draftDir} onClick={() => run('extract')}>提取字幕并隐藏轨道</button><button type="button" disabled={locked || !state.draftDir} onClick={() => run('fonts')}>统一 Noto Sans Bold 字体</button><button type="button" disabled={locked || !state.draftDir} onClick={() => run('unhide')}>恢复字幕显示</button></div>
        <section className="bos-jy-export-options"><h4>还原标准标点</h4><p>生成字幕后，将保护用的 ․ / ‚ 还原为标准 . / ,，省略号还原为 ...，避免替代字符引起句点单独换行。</p><div className="bos-jy-toolbar"><button type="button" disabled={locked || !state.ready || !state.draftDir} onClick={() => run('restore_punctuation')}>检查并还原标准标点</button></div><small>先保存并完全退出剪映，再检查上方目录。显示待处理草稿后确认执行，自动备份，保留字体、字号、时间轴及轨道显示状态。完成后重新打开草稿检查排版。此工具也支持在上方选择单个草稿目录；不自动监控正在编辑的草稿。</small></section>
        <small>修改草稿前请完全退出剪映。11.6.5、11.7.5 草稿可通过本地字幕兼容组件提取，草稿版本保持不变；支持普通 JSON 和多时间线，写入前备份并校验。仅装有剪映 11.7.5 的电脑，请先把字幕兼容组件包安装到 XM剪辑台目录，无需回退剪映。字体操作需本机已安装 Noto Sans Bold。</small>
      </ToolPanel>
      <ToolPanel id="rename" number="03" title="批量改名" detail="先预览，再一次执行；保留扩展名并检查名称冲突。" hiddenStage={stage !== 'rename'}>
        <div className="bos-source-choice"><button type="button" aria-pressed={!aiRename} disabled={locked} onClick={() => { setAiRename(false); }}>按集数模板</button><button type="button" aria-pressed={aiRename} disabled={locked} onClick={() => { setAiRename(true); }}>AI 智能命名</button></div>
        <label><span>文件夹或单独选择文件</span><div className="bos-jy-path"><input readOnly value={folder} placeholder={state.fileCount ? '已选择 ' + state.fileCount + ' 个文件' : '选择要改名的文件夹'} /><button type="button" disabled={locked} onClick={() => perform(async () => { const value = await api.chooseDirectory(folder); if (value) setFolder(value); })}>选择文件夹</button><button type="button" disabled={locked} onClick={chooseFiles}>选择文件</button><button type="button" disabled={locked || (!folder && !state.fileCount && !state.plan.length)} onClick={() => perform(async () => { setState(await api.jianyingAction('files', { files: [] })); setFolder(''); })}>清除列表</button></div></label>
        <label><span>命名模板</span><input maxLength={500} value={template} disabled={locked} onChange={event => setTemplate(event.target.value)} placeholder="例如：短剧名称_第1集" /></label>
        <div className="bos-jy-toolbar"><button type="button" disabled={locked || !state.ready || (aiRename && !connection)} onClick={() => run('preview', { folder, template, ai: aiRename })}>{aiRename ? 'AI 生成预览' : '生成改名预览'}</button><button type="button" className="bos-script-primary" disabled={locked || !state.plan.length} onClick={() => run('rename')}>执行预览中的改名</button></div>
        <div className="bos-jy-table"><table><thead><tr><th>原文件名</th><th>新文件名</th></tr></thead><tbody>{state.plan.map((item, index) => <tr key={index}><td>{item.old_name}</td><td>{item.new_name}</td></tr>)}</tbody></table>{!state.plan.length && <p>改名方案会显示在这里，预览不会修改文件。</p>}</div>
      </ToolPanel>
      <ToolPanel id="settings" number="AI" title="模型连接" detail="复用已有 Gemini 连接，供草稿扫描和智能命名使用。" hiddenStage={stage === 'subtitles' || stage === 'watermark'}>
        <label><span>Gemini 模型</span><select value={connection?.key || ''} disabled={locked} onChange={event => { setModelKey(event.target.value); localStorage.setItem('xm.jianying.model', event.target.value); }}>{!models.length && <option value="">请先添加 Gemini 连接</option>}{models.map(item => <option key={item.key} value={item.key}>{item.model} · {item.provider.name}</option>)}</select></label>
        <button type="button" onClick={() => onNavigate('providers')}>管理已有模型与连接 ↗</button>
        <small>无需再次填写 API Key。AI 扫描发送截图，AI 改名仅发送文件名；本地字幕工具和模板改名不调用 AI。</small>
      </ToolPanel>
    </div>
    <WatermarkStudio active={active && stage === 'watermark'} />
    <details className="bos-jy-log" open><summary>任务日志 · {state.logs.length} 条</summary><pre>{state.logs.join('\n') || '操作开始后会在这里显示进度。'}</pre></details>
    <ToolDialog open={active && !!waits} title={'等待时间 · ' + (waitsMode === 'wait_close' ? '等待完成' : '收起至首页')} onCancel={() => { if (!pending) setWaits(null); }}>
      <div className="bos-jy-waits">{Object.entries(waitsLabels).map(([key, label]) => <label key={key}><span>{label} / 秒</span><input type="number" min="0.1" max="600" step="0.1" disabled={pending} value={waits?.[key] ?? ''} onChange={event => setWaits(previous => ({ ...previous, [key]: event.target.value }))} /></label>)}</div>
      <div className="bos-jy-toolbar"><button type="button" disabled={pending} onClick={() => setWaits(null)}>取消</button><button type="button" disabled={pending} onClick={() => perform(async () => { setState(await api.jianyingAction('settings', { waits, waitsMode })); setWaits(null); })}>保存等待时间</button></div>
      {error && <p role="alert">{error}</p>}
    </ToolDialog>
    <ToolDialog open={active && !!state.modal} title={state.modal?.title || '确认操作'} onCancel={() => { if (!pending && state.modal) void run('modal', { id: state.modal.id, confirmed: false }); }}><p>{state.modal?.message}</p><div className="bos-jy-toolbar"><button type="button" disabled={pending} onClick={() => run('modal', { id: state.modal.id, confirmed: false })}>取消</button><button type="button" className="bos-script-primary" disabled={pending} onClick={() => run('modal', { id: state.modal.id, confirmed: true })}>确认执行</button></div></ToolDialog>
  </section>;
}

import { isGeminiModel } from '../shared/script-score.mjs';
import { usePanelCollapsed } from './PanelState.jsx';
import { WatermarkStudio } from './WatermarkStudio.tsx';

declare const i: any;

function ToolPanel({
  id,
  number,
  title,
  detail,
  hiddenStage,
  children,
}: {
  id: string;
  number: string;
  title: string;
  detail: string;
  hiddenStage?: boolean;
  children: any;
}) {
  const [collapsed, toggle] = usePanelCollapsed('jianying-' + id);
  return (
    <section className="bos-jy-panel" data-panel-id={id} hidden={hiddenStage}>
      <header>
        <div className="bos-jy-panel-title">
          <span className="bos-jy-step-badge">{number}</span>
          <div>
            <h3>{title}</h3>
            <p>{detail}</p>
          </div>
        </div>
        <button
          type="button"
          className="bos-panel-toggle"
          aria-expanded={!collapsed}
          aria-controls={'jy-' + id}
          onClick={toggle}
        >
          {collapsed ? '展开' : '收起'} {collapsed ? '⌄' : '⌃'}
        </button>
      </header>
      <div id={'jy-' + id} hidden={collapsed} className="bos-jy-panel-body">
        {children}
      </div>
    </section>
  );
}

const waitsLabels: Record<string, string> = {
  open_draft: '打开草稿',
  export: '点击导出',
  confirm: '确认导出',
  popup_close: '收起至首页',
  close_btn: '关闭导出窗口',
  draft_close: '关闭草稿',
};

const empty = {
  queue: [] as any[],
  plan: [] as any[],
  logs: [] as string[],
  templates: [] as any[],
  waits: {} as Record<string, any>,
  ready: false,
  busy: false,
  status: '正在准备本地引擎…',
};

export type JianyingStage = 'export' | 'subtitles' | 'rename' | 'watermark';

export function JianyingStudio({ active, providers, onNavigate }: { active: boolean; providers: any[]; onNavigate: (tab: string) => void }) {
  const [visited, setVisited] = i.useState(active);
  const [stage, setStage] = i.useState<JianyingStage>(() => {
    try {
      const saved = localStorage.getItem('xm.jianying.stage') as JianyingStage;
      return ['export', 'subtitles', 'rename', 'watermark'].includes(saved) ? saved : 'export';
    } catch {
      return 'export';
    }
  });
  const [state, setState] = i.useState(empty as any);
  const [error, setError] = i.useState('');
  const [pending, setPending] = i.useState(false);
  const [pendingAct, setPendingAct] = i.useState('');
  const [selected, setSelected] = i.useState(0);
  const [modelKey, setModelKey] = i.useState(() => localStorage.getItem('xm.jianying.model') || '');
  const [folder, setFolder] = i.useState('');
  const [template, setTemplate] = i.useState('短剧名称_第1集');
  const [aiRename, setAiRename] = i.useState(false);
  const [waits, setWaits] = i.useState(null as any);
  const [templateName, setTemplateName] = i.useState('');
  const [exportOptionsCollapsed, toggleExportOptions] = usePanelCollapsed('jianying-export-options');
  const [companionVisible, setCompanionVisible] = i.useState(false);
  const [companionBusy, setCompanionBusy] = i.useState(false);

  const selectStage = (next: JianyingStage) => {
    setStage(next);
    try {
      localStorage.setItem('xm.jianying.stage', next);
    } catch {
      /* ignore */
    }
  };

  const api = (globalThis as any).blackObsidian;

  i.useEffect(() => {
    let alive = true;
    api?.companionAction?.('sync').then((cs: any) => {
      if (alive && cs) setCompanionVisible(Boolean(cs.visible && cs.panelOpen));
    }).catch(() => {});
    const off = api?.onCompanionState?.((cs: any) => {
      if (alive && cs) setCompanionVisible(Boolean(cs.visible && cs.panelOpen));
    });
    return () => {
      alive = false;
      if (typeof off === 'function') off();
    };
  }, [api, active]);

  const toggleFloatingWindow = async (openStage?: JianyingStage) => {
    if (companionBusy || !api?.companionAction) return;
    setCompanionBusy(true);
    try {
      if (openStage) {
        selectStage(openStage);
        await api.companionAction('set-stage', openStage);
        const res = await api.companionAction('show', true);
        if (res) setCompanionVisible(Boolean(res.visible && res.panelOpen));
      } else if (companionVisible) {
        const res = await api.companionAction('hide');
        if (res) setCompanionVisible(Boolean(res.visible && res.panelOpen));
      } else {
        const res = await api.companionAction('show', true);
        if (res) setCompanionVisible(Boolean(res.visible && res.panelOpen));
      }
    } catch (err: any) {
      setError(err?.message || '无法切换悬浮窗状态');
    } finally {
      setTimeout(() => setCompanionBusy(false), 260);
    }
  };
  const models = providers.flatMap(provider => {
    const rawName = String(provider?.name || '').trim();
    const pName = (rawName && rawName !== 'Provider Select')
      ? rawName
      : (provider?.protocol === 'gemini' ? 'Gemini AI Studio' : String(provider?.id || 'AI'));
    return (provider.models || [])
      .filter((model: string) => Boolean(String(model || '').trim()))
      .map((model: string) => ({ key: (provider.id || pName) + '::' + model, label: `${pName}-${model}`, provider, model }));
  });
  const connection = models.find(item => item.key === modelKey) || models[0];
  const locked = pending || state.busy || state.recording || !!state.modal;

  i.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
    window.dispatchEvent(new CustomEvent('bos:jianying-state-sync', { detail: state }));
  }, [state]);

  i.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    const onStage = (event: any) => {
      const target = event?.detail as JianyingStage;
      if (['export', 'subtitles', 'rename', 'watermark'].includes(target)) {
        selectStage(target);
      }
    };
    window.addEventListener('xm-jianying-stage', onStage);
    return () => window.removeEventListener('xm-jianying-stage', onStage);
  }, []);
  i.useEffect(() => { if (active) setVisited(true); }, [active]);
  i.useEffect(() => {
    if (!active || !visited || !api?.jianyingAction) return;
    let alive = true, timer: any, lastJson = '';
    const poll = async () => {
      let nextDelay = 2500;
      try {
        const value = await api.jianyingAction('status', {});
        if (alive && value) {
          const serialized = JSON.stringify(value);
          if (serialized !== lastJson) {
            lastJson = serialized;
            setState(value);
          }
          if (value.busy || value.recording || value.exporting || !value.ready) nextDelay = 1000;
        }
      } catch (err: any) {
        if (alive) setError(err.message);
      }
      if (alive) timer = setTimeout(poll, nextDelay);
    };
    void poll();
    return () => { alive = false; clearTimeout(timer); };
  }, [active, visited]);

  const perform = async (fn: () => Promise<void>, actName = '') => {
    setPending(true); setPendingAct(actName); setError('');
    try { await fn(); }
    catch (err: any) { setError(err.message || '操作失败。'); }
    finally { setPending(false); setPendingAct(''); }
  };

  const run = (action: string, args: Record<string, any> = {}) => perform(async () => {
    if (!api?.jianyingAction) throw new Error('此功能需要桌面版的本地引擎。');
    setState(await api.jianyingAction(action, args, connection ? { provider: connection.provider, model: connection.model } : undefined));
  }, action);

  const choosePath = (key: string) => perform(async () => {
    const value = await api.chooseDirectory();
    if (value) setState(await api.jianyingAction('paths', { [key]: value }));
  });

  const chooseFiles = () => perform(async () => {
    const files = await api.chooseJianyingFiles();
    if (files) {
      setFolder('');
      setState(await api.jianyingAction('files', { files }));
    }
  });

  return (
    <section className="bos-script bos-jianying" data-jy-stage={stage} hidden={!active} aria-label="JianYing-Ai-Pro">
      {/* Main Window Prompt Card: Redirects user to the Desktop Floating Window */}
      <div className="bos-jy-floating-handoff">
        <div className="bos-jy-handoff-badge">DESKTOP FLOATING SUITE · 独立置顶工作流</div>
        <h2>剪映自动化功能请使用桌面「悬浮窗」</h2>
        <p>
          为避免遮挡剪映主界面，<strong>01 批量导出（坐标录制 / AI 截图识别）</strong>、<strong>02 字幕工程</strong>、<strong>03 批量改名</strong> 与 <strong>04 样片水印</strong> 已全部集成至桌面置顶「悬浮窗」与「月薪喵」中。把视频或文件夹直接拖到月薪喵身上即可一键改名或加水印！
        </p>
        <div className="bos-jy-handoff-actions">
          <button
            type="button"
            className={`bos-script-primary bos-jy-handoff-btn${companionBusy ? ' is-loading' : ''}`}
            disabled={companionBusy}
            onClick={() => toggleFloatingWindow()}
          >
            {companionBusy && <span className="bos-btn-spinner" aria-hidden="true" />}
            {companionBusy
              ? (companionVisible ? '正在关闭悬浮窗…' : '正在开启悬浮窗…')
              : (companionVisible ? '✕ 关闭悬浮窗' : '🐱 开启悬浮窗')}
          </button>
        </div>
        <div className="bos-jy-handoff-shortcuts">
          <button type="button" onClick={() => toggleFloatingWindow('export')}>01 批量导出 ↗</button>
          <button type="button" onClick={() => toggleFloatingWindow('subtitles')}>02 字幕工程 ↗</button>
          <button type="button" onClick={() => toggleFloatingWindow('rename')}>03 批量改名 ↗</button>
          <button type="button" onClick={() => toggleFloatingWindow('watermark')}>04 样片水印 ↗</button>
        </div>
      </div>

      {/* Hidden structure retained for background state sync and test compatibility */}
      <div className="bos-jy-legacy-container" hidden aria-hidden="true">
      {/* Top-Level Prominent 4-Stage Navigation Bar (Unified with Workspace 3-Stage Bar) */}
      <nav className="bos-top-stage-bar bos-top-stage-bar-4" role="tablist" aria-label="剪映自动化与样片水印四大核心模块">
        <button
          type="button"
          role="tab"
          className={`bos-stage-tab ${stage === 'export' ? 'is-active' : ''}`}
          aria-selected={stage === 'export'}
          onClick={() => selectStage('export')}
        >
          <span className="bos-stage-num">01</span>
          <div className="bos-stage-text">
            <strong>批量导出</strong>
            <small>AI 识别剪映草稿 · 全自动顺序导出</small>
          </div>
        </button>

        <button
          type="button"
          role="tab"
          className={`bos-stage-tab ${stage === 'subtitles' ? 'is-active' : ''}`}
          aria-selected={stage === 'subtitles'}
          onClick={() => selectStage('subtitles')}
        >
          <span className="bos-stage-num">02</span>
          <div className="bos-stage-text">
            <strong>字幕工程</strong>
            <small>提取 SRT 字幕 · 统一字体与显隐轨道</small>
          </div>
        </button>

        <button
          type="button"
          role="tab"
          className={`bos-stage-tab ${stage === 'rename' ? 'is-active' : ''}`}
          aria-selected={stage === 'rename'}
          onClick={() => selectStage('rename')}
        >
          <span className="bos-stage-num">03</span>
          <div className="bos-stage-text">
            <strong>批量改名</strong>
            <small>集数模板或 AI 语义对齐 · 预览后执行</small>
          </div>
        </button>

        <button
          type="button"
          role="tab"
          className={`bos-stage-tab ${stage === 'watermark' ? 'is-active' : ''}`}
          aria-selected={stage === 'watermark'}
          onClick={() => selectStage('watermark')}
        >
          <span className="bos-stage-num">04</span>
          <div className="bos-stage-text">
            <strong>样片水印</strong>
            <small>内置红薯样片图层 · C# 硬件加速批处理</small>
          </div>
        </button>
      </nav>

      {stage !== 'watermark' && (
        <div className="bos-jy-overview">
          <div className="bos-jy-hotkeys">
            <span className="bos-jy-pill"><kbd>F8</kbd> 录制坐标</span>
            <span className="bos-jy-pill"><kbd>F9</kbd> 跳过等待</span>
            <span className="bos-jy-pill"><kbd>F10</kbd> 紧急中断</span>
          </div>
          <div className="bos-jy-status-box">
            <span className={`bos-status-dot${state.ready ? ' is-online' : ''}`} />
            <span role="status">{state.status}</span>
            <button type="button" className="bos-danger-btn" onClick={() => run('stop')} disabled={!state.ready}>
              中断 · F10
            </button>
          </div>
        </div>
      )}

      {error && <p className="bos-script-alert" role="alert">{error}</p>}
      {state.notice && <p className="bos-script-message" role="status">{state.notice}</p>}

      <div className="bos-jy-panels" hidden={stage === 'watermark'}>
        <ToolPanel id="export" number="01" title="批量导出" detail="AI 视觉识别剪映草稿队列，全自动顺序导出" hiddenStage={stage !== 'export'}>
          <div className="bos-jy-toolbar">
            <button type="button" className={pendingAct === 'wizard' || state.recording ? 'is-loading' : ''} disabled={locked || !state.ready} onClick={() => run('wizard')}>
              {(pendingAct === 'wizard' || state.recording) && <span className="bos-btn-spinner" aria-hidden="true" />}
              {pendingAct === 'wizard' || state.recording ? '正在录制坐标…' : '录制坐标 · F8'}
            </button>
            <button type="button" className={pendingAct === 'scan' ? 'is-loading' : ''} disabled={locked || !connection || !state.ready} onClick={() => run('scan')}>
              {pendingAct === 'scan' && <span className="bos-btn-spinner" aria-hidden="true" />}
              {pendingAct === 'scan' ? '正在扫描草稿…' : 'AI 扫描草稿'}
            </button>
            <button
              type="button"
              className={`bos-script-primary${pendingAct === 'export' || state.exporting ? ' is-loading' : ''}`}
              disabled={locked || !state.queue.length || !state.coordinatesReady}
              onClick={() => run('export', { index: selected })}
            >
              {(pendingAct === 'export' || state.exporting) && <span className="bos-btn-spinner" aria-hidden="true" />}
              {pendingAct === 'export' || state.exporting ? '正在批量导出…' : '开始批量导出 ↗'}
            </button>
          </div>
          {state.guide && <p className="bos-script-footnote">{state.guide}</p>}
          <div className="bos-jy-table">
            <table>
              <thead>
                <tr><th>起点</th><th>草稿名称</th><th>状态</th></tr>
              </thead>
              <tbody>
                {state.queue.map((item: any, index: number) => (
                  <tr key={index} aria-selected={selected === index} onClick={() => setSelected(index)}>
                    <td>
                      <input
                        type="radio"
                        name="jy-draft"
                        aria-label={'从草稿 ' + item.name + ' 开始'}
                        checked={selected === index}
                        onChange={() => setSelected(index)}
                      />
                    </td>
                    <td>{item.name}</td>
                    <td><span className="bos-jy-row-badge">{item.st}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!state.queue.length && <p>打开剪映首页后点击「AI 扫描草稿」加载列表</p>}
          </div>

          <section className="bos-jy-export-options">
            <header>
              <div>
                <h4>导出模式与参数</h4>
                <small>
                  {state.mode === 'wait_close' ? '等待完成 · 逐个' : '收起至首页 · 后台'} · 切换模式自动匹配对应坐标
                </small>
              </div>
              <button
                type="button"
                className="bos-panel-toggle"
                aria-expanded={!exportOptionsCollapsed}
                aria-controls="bos-jy-export-options-body"
                onClick={toggleExportOptions}
              >
                {exportOptionsCollapsed ? '展开参数 ⌄' : '收起参数 ⌃'}
              </button>
            </header>
            <div id="bos-jy-export-options-body" hidden={exportOptionsCollapsed} className="bos-jy-export-options-body">
              <div className="bos-local-match-grid">
                <label>
                  <span>导出模式（切换自动匹配对应坐标）</span>
                  <select value={state.mode || 'return_home'} disabled={locked || !state.ready} onChange={(event: any) => run('settings', { mode: event.target.value })}>
                    <option value="return_home">收起至首页 · 后台渲染</option>
                    <option value="wait_close">等待完成 · 逐个渲染</option>
                  </select>
                </label>
              </div>
              <div className="bos-jy-waits">
                {Object.entries(waitsLabels).map(([key, label]) => (
                  <label key={key}>
                    <span>{label} (s)</span>
                    <input
                      type="number"
                      min="0.1"
                      max="600"
                      step="0.1"
                      disabled={locked || !state.ready}
                      value={(waits || state.waits)[key] ?? ''}
                      onChange={(event: any) => setWaits((previous: any) => ({ ...(previous || state.waits), [key]: event.target.value }))}
                    />
                  </label>
                ))}
              </div>
              <button
                type="button"
                disabled={locked || !waits}
                onClick={() => perform(async () => { setState(await api.jianyingAction('settings', { waits })); setWaits(null); })}
              >
                保存等待时间
              </button>
            </div>
          </section>
        </ToolPanel>

        <ToolPanel id="subtitles" number="02" title="字幕工程" detail="提取 SRT 字幕、统一 Noto Sans Bold 字体或显隐轨道" hiddenStage={stage !== 'subtitles'}>
          <label>
            <span>剪映草稿根目录</span>
            <div className="bos-jy-path">
              <input
                value={state.draftDir || ''}
                placeholder="选择或粘贴 Drafts 草稿根目录"
                onChange={(e: any) => {
                  const val = e.target.value;
                  setState((prev: any) => ({ ...prev, draftDir: val }));
                  void api?.jianyingAction?.('paths', { draftDir: val });
                }}
              />
              <button type="button" disabled={locked} onClick={() => choosePath('draftDir')}>浏览</button>
            </div>
          </label>
          <label>
            <span>字幕导出目录</span>
            <div className="bos-jy-path">
              <input
                value={state.subtitleOutput || ''}
                placeholder="选择或粘贴字幕导出位置（默认桌面）"
                onChange={(e: any) => {
                  const val = e.target.value;
                  setState((prev: any) => ({ ...prev, subtitleOutput: val }));
                  void api?.jianyingAction?.('paths', { subtitleOutput: val });
                }}
              />
              <button type="button" disabled={locked} onClick={() => choosePath('subtitleOutput')}>浏览</button>
            </div>
          </label>
          <div className="bos-jy-toolbar">
            <button type="button" className={`bos-script-primary${pendingAct === 'extract' ? ' is-loading' : ''}`} disabled={locked || !state.draftDir} onClick={() => run('extract')}>
              {pendingAct === 'extract' && <span className="bos-btn-spinner" aria-hidden="true" />}
              {pendingAct === 'extract' ? '提取字幕中…' : '提取字幕并隐藏轨道'}
            </button>
            <button type="button" className={pendingAct === 'fonts' ? 'is-loading' : ''} disabled={locked || !state.draftDir} onClick={() => run('fonts')}>
              {pendingAct === 'fonts' && <span className="bos-btn-spinner" aria-hidden="true" />}
              统一 Noto Sans Bold
            </button>
            <button type="button" className={pendingAct === 'restore_punctuation' ? 'is-loading' : ''} disabled={locked || !state.draftDir} onClick={() => run('restore_punctuation')}>
              {pendingAct === 'restore_punctuation' && <span className="bos-btn-spinner" aria-hidden="true" />}
              检查并还原标准标点
            </button>
            <button type="button" className={pendingAct === 'unhide' ? 'is-loading' : ''} disabled={locked || !state.draftDir} onClick={() => run('unhide')}>
              {pendingAct === 'unhide' && <span className="bos-btn-spinner" aria-hidden="true" />}
              恢复字幕显示
            </button>
            <button type="button" className={pendingAct === 'split_upper_lower' ? 'is-loading' : ''} disabled={locked || !state.draftDir} onClick={() => run('split_upper_lower')}>
              {pendingAct === 'split_upper_lower' && <span className="bos-btn-spinner" aria-hidden="true" />}
              检测「XXX上」复制为「XXX下」
            </button>
          </div>
          <small>检查并还原标准标点可将保护标点（․ ﹒ ‚ ﹐）还原为标准英文 . 与 , 且保持花字样式与时间轴不变。操作前请先退出剪映，写入前自动创建安全备份。</small>
        </ToolPanel>

        <ToolPanel id="rename" number="03" title="批量改名" detail="支持集数模板或 AI 语义对齐，先预览后执行" hiddenStage={stage !== 'rename'}>
          <div className="bos-source-choice">
            <button type="button" aria-pressed={!aiRename} disabled={locked} onClick={() => setAiRename(false)}>按集数模板</button>
            <button type="button" aria-pressed={aiRename} disabled={locked} onClick={() => setAiRename(true)}>AI 智能命名</button>
          </div>
          <label>
            <span>目标目录 {aiRename && '或文件'}</span>
            <div className="bos-jy-path">
              <input readOnly value={folder} placeholder={state.fileCount ? `已选 ${state.fileCount} 个文件` : '选择待改名文件夹'} />
              <button type="button" disabled={locked} onClick={() => perform(async () => { const value = await api.chooseDirectory(); if (value) setFolder(value); })}>文件夹</button>
              {aiRename && <button type="button" disabled={locked} onClick={chooseFiles}>选文件</button>}
            </div>
          </label>
          <label>
            <span>命名模板</span>
            <input maxLength={500} value={template} disabled={locked} onChange={(event: any) => setTemplate(event.target.value)} placeholder="例如：短剧名称_第1集" />
          </label>
          <div className="bos-jy-toolbar">
            <button type="button" className={pendingAct === 'preview' ? 'is-loading' : ''} disabled={locked || !state.ready || (aiRename && !connection)} onClick={() => run('preview', { folder, template, ai: aiRename })}>
              {pendingAct === 'preview' && <span className="bos-btn-spinner" aria-hidden="true" />}
              {pendingAct === 'preview' ? '生成预览中…' : (aiRename ? 'AI 生成预览' : '生成改名预览')}
            </button>
            <button type="button" className={`bos-script-primary${pendingAct === 'rename' ? ' is-loading' : ''}`} disabled={locked || !state.plan.length} onClick={() => run('rename')}>
              {pendingAct === 'rename' && <span className="bos-btn-spinner" aria-hidden="true" />}
              {pendingAct === 'rename' ? '执行改名中…' : `执行改名 (${state.plan.length})`}
            </button>
          </div>
          <div className="bos-jy-table">
            <table>
              <thead><tr><th>原文件名</th><th>新文件名</th></tr></thead>
              <tbody>
                {state.plan.map((item: any, index: number) => (
                  <tr key={index}><td>{item.old_name}</td><td>{item.new_name}</td></tr>
                ))}
              </tbody>
            </table>
            {!state.plan.length && <p>生成预览后在此核对文件名映射</p>}
          </div>
        </ToolPanel>

        <ToolPanel id="settings" number="AI" title="模型连接" detail="复用全局 Gemini 模型，供草稿识别与智能改名调用" hiddenStage={stage === 'subtitles'}>
          <label>
            <span>当前模型</span>
            <select
              value={connection?.key || ''}
              disabled={locked}
              onChange={(event: any) => { setModelKey(event.target.value); localStorage.setItem('xm.jianying.model', event.target.value); }}
            >
              {!models.length && <option value="">请先添加可用模型</option>}
              {models.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
            </select>
          </label>
          <div className="bos-jy-toolbar">
            <button type="button" onClick={() => onNavigate('providers')}>管理模型与连接 ↗</button>
          </div>
        </ToolPanel>
      </div>

      <WatermarkStudio active={active && stage === 'watermark'} />

      {stage !== 'watermark' && (
        <details className="bos-jy-log">
          <summary>运行日志 · {state.logs.length} 条记录</summary>
          <pre>{state.logs.join('\n') || '暂无运行记录'}</pre>
        </details>
      )}

      {state.modal && (
        <div className="bos-jy-modal-backdrop">
          <section className="bos-jy-modal" role="dialog" aria-modal="true" aria-labelledby="jy-modal-title">
            <h3 id="jy-modal-title">{state.modal.title}</h3>
            <p>{state.modal.message}</p>
            <div className="bos-jy-toolbar">
              <button type="button" disabled={pending} onClick={() => run('modal', { id: state.modal.id, confirmed: false })}>取消</button>
              <button type="button" className="bos-script-primary" disabled={pending} onClick={() => run('modal', { id: state.modal.id, confirmed: true })}>确认执行</button>
            </div>
          </section>
        </div>
      )}
      </div>
    </section>
  );
}

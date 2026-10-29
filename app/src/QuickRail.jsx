const readLayout = () => { try { return JSON.parse(localStorage.getItem('xm.layout.v1')) || {}; } catch { return {}; } };
function saveLayout(values) { try { localStorage.setItem('xm.layout.v1', JSON.stringify({ ...readLayout(), ...values })); } catch { /* current layout remains usable */ } }

export function SidebarResizer() {
  const [width, setWidth] = i.useState(() => Math.max(180, Math.min(360, Number(readLayout().sidebarWidth) || 260)));
  const clamp = value => Math.max(180, Math.min(360, window.innerWidth - 500, value));
  i.useEffect(() => { document.documentElement.style.setProperty('--xm-sidebar-width', width + 'px'); }, [width]);
  const commit = value => { const next = clamp(value); setWidth(next); saveLayout({ sidebarWidth: next }); };
  return <div className="bos-sidebar-resizer" role="separator" aria-label="调整左侧导航宽度" aria-orientation="vertical" aria-valuemin={180} aria-valuemax={360} aria-valuenow={width} tabIndex={0} title="拖动调整左栏宽度，双击恢复默认" onDoubleClick={() => commit(260)} onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); document.documentElement.dataset.resizing = 'true'; }} onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) setWidth(clamp(event.clientX)); }} onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); delete document.documentElement.dataset.resizing; saveLayout({ sidebarWidth: width }); }} onLostPointerCapture={() => { delete document.documentElement.dataset.resizing; }} onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) { event.preventDefault(); commit(event.key === 'Home' ? 260 : width + (event.key === 'ArrowRight' ? 10 : -10)); } }} />;
}

export function QuickRail() {
  const [state, setState] = i.useState({ folders: [], installs: [], selected: '' });
  const [autoHide, setAutoHide] = i.useState(() => !!readLayout().autoHideRail);
  const [compact, setCompact] = i.useState(() => !!globalThis.matchMedia?.('(max-width: 1050px)').matches);
  const [revealed, setRevealed] = i.useState(false);
  const restoreButton = i.useRef(null);
  const rail = i.useRef(null);
  const [scanning, setScanning] = i.useState(true);
  const [pending, setPending] = i.useState(false);
  const busy = i.useRef(false);
  const [error, setError] = i.useState('');
  const [dragging, setDragging] = i.useState(false);
  const [notice, setNotice] = i.useState('');
  const dragInside = i.useRef(false);
  const api = globalThis.blackObsidian;
  const overlay = autoHide || compact;
  const expanded = !overlay || revealed;
  const act = async (action, value) => {
    if (busy.current) return;
    busy.current = true; setPending(true); setError(''); setNotice('');
    try {
      if (!api?.quickLaunch) throw new Error('请使用更新后的桌面程序。');
      if (action === 'dropFolders' && !api.addQuickFolders) throw new Error('请更新桌面程序后拖入文件夹，也可以点击添加按钮。');
      const next = await (action === 'dropFolders' ? api.addQuickFolders(value) : api.quickLaunch(action, value));
      if (next) {
        setState(next);
        if (action === 'dropFolders') { const added = next.folders.length - state.folders.length; setNotice(added > 0 ? `已添加 ${added} 个文件夹，双击即可打开。` : '这些文件夹已经添加，无需重复添加。'); }
      }
    } catch (err) { setError(err.message); }
    finally { busy.current = false; setPending(false); }
  };
  const fileDrag = event => Array.from(event.dataTransfer?.types || []).includes('Files');
  const dropFolders = event => {
    if (!fileDrag(event)) return;
    event.preventDefault(); event.stopPropagation(); dragInside.current = false; setDragging(false);
    void act('dropFolders', Array.from(event.dataTransfer.files || []));
  };
  const scan = async () => { setScanning(true); await act('scan'); setScanning(false); };
  i.useEffect(() => { void scan(); }, []);
  i.useEffect(() => {
    const query = globalThis.matchMedia?.('(max-width: 1050px)');
    if (!query) return;
    const update = () => { setCompact(query.matches); setRevealed(false); };
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  i.useEffect(() => { document.documentElement.dataset.railAuto = String(autoHide); saveLayout({ autoHideRail: autoHide }); }, [autoHide]);
  i.useEffect(() => { if (!expanded && rail.current?.contains(document.activeElement)) restoreButton.current?.focus({ preventScroll: true }); }, [expanded]);
  const conceal = () => { if (overlay && !dragInside.current && !busy.current) setRevealed(false); };
  return <>
    {overlay && !revealed && <button ref={restoreButton} type="button" className="bos-rail-peek" aria-label="展开快捷栏" aria-controls="bos-quickrail-content" aria-expanded={false} title="展开剪映与文件夹快捷栏" onDragOver={event => { if (fileDrag(event)) { event.preventDefault(); setRevealed(true); } }} onClick={() => setRevealed(true)}>‹</button>}
    {autoHide && !revealed && <div className="bos-rail-edge" aria-hidden="true" onDragOver={event => { if (fileDrag(event)) { event.preventDefault(); setRevealed(true); } }} onPointerEnter={event => { if (event.pointerType === 'mouse') setRevealed(true); }} />}
    <aside ref={rail} className="bos-quickrail" aria-label="剪映与自定义文件夹" aria-busy={pending} data-expanded={expanded} onMouseLeave={conceal} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) conceal(); }} onKeyDown={event => { if (event.key === 'Escape' && overlay) { event.preventDefault(); setRevealed(false); } }}>
    <div className="bos-rail-inner" id="bos-quickrail-content" inert={!expanded} aria-hidden={!expanded}>
      <header><span>QUICK ACCESS</span><label title="隐藏整栏并释放工作区宽度；右上角按钮或窗口右边缘可重新展开"><input type="checkbox" checked={autoHide} onChange={event => { setAutoHide(event.target.checked); setRevealed(false); event.currentTarget.blur(); }} />自动隐藏</label>{overlay && revealed && <button type="button" className="bos-rail-close" aria-label="收起快捷栏" title="收起快捷栏" onClick={() => setRevealed(false)}>›</button>}</header>
      <section className="bos-launch-card"><span className="bos-launch-icon">剪</span><h2>剪映快捷启动</h2><p>{scanning ? '正在检测本机剪映…' : state.installs.length ? '已找到 ' + state.installs.length + ' 个启动项' : '未检测到剪映启动项'}</p>{!!state.installs.length && <select aria-label="剪映启动项" disabled={pending} value={state.selected} onChange={event => act('select', event.target.value)}>{state.installs.map(item => <option key={item.path} value={item.path}>{item.version} · {item.path}</option>)}</select>}<button type="button" className="bos-launch-primary" disabled={!state.selected || scanning || pending} onClick={() => act('launch')}>启动剪映 ↗</button><div className="bos-rail-tools"><button type="button" disabled={scanning || pending} onClick={scan}>重新检测</button><button type="button" disabled={pending} onClick={() => act('browse')}>手动定位</button></div></section>
      <section className={`bos-folder-card${dragging ? ' is-dragging' : ''}`} aria-label="自定义文件夹拖放区域" onDragEnter={event => { if (fileDrag(event)) { event.preventDefault(); dragInside.current = true; setDragging(true); } }} onDragOver={event => { if (fileDrag(event)) { event.preventDefault(); event.dataTransfer.dropEffect = pending ? 'none' : 'copy'; dragInside.current = true; setDragging(true); } }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) { dragInside.current = false; setDragging(false); } }} onDrop={dropFolders}><div className="bos-folder-heading"><h3>自定义文件夹</h3><span>{state.folders.length} / 8</span></div><p>{dragging ? '松开鼠标添加文件夹' : '拖入文件夹即可添加，双击打开。'}</p><div className="bos-folder-list">{state.folders.map(folder => <div className="bos-folder-item" key={folder.id}><button type="button" className="bos-folder-open" title={folder.path + '\n双击打开，或按 Enter'} onDoubleClick={() => act('openFolder', folder.id)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void act('openFolder', folder.id); } }}><span aria-hidden="true">▱</span><span><strong>{folder.name}</strong><small>{folder.path}</small></span></button><button type="button" className="bos-folder-remove" disabled={pending} aria-label={'移除快捷入口 ' + folder.name} title="仅移除入口，不删除文件夹" onClick={() => act('removeFolder', folder.id)}>×</button></div>)}</div><button type="button" className="bos-folder-add" disabled={state.folders.length >= 8 || pending} onClick={() => act('addFolder')}>{pending ? '正在处理…' : '＋ 添加自定义文件夹'}</button>{notice && <p className="bos-folder-notice" role="status">{notice}</p>}</section>
      {error && <p className="bos-rail-error" role="alert">{error}</p>}
      <footer>XM剪辑台 · 让创作更顺手</footer>
    </div>
  </aside>
  </>;
}

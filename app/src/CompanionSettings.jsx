const categories = { idle: '待机', turn: '转向', move: '移动', click: '点击互动', drag: '拖拽', random: '随机动作' };
const features = ['常规与显示', '动作与碰撞', '互动与音效', '菜单与快捷启动', '桌面组件与灵动岛', 'AI 对话与识屏', '自动化与待办', '语音与报时', '文件识别', '更新与角色管理'];
const toggles = [['no_move', '停止自主移动'], ['lock_position', '锁定位置'], ['shift_drag', '按住 Shift 拖动'], ['mouse_through', '鼠标穿透'], ['on_top', '始终置顶'], ['drag_physics', '拖拽惯性'], ['drop_gravity', '松手后下落'], ['click_sound_enabled', '点击音效'], ['auto_hide_fullscreen', '全屏时自动隐藏'], ['edge_probe_enabled', '屏幕边缘探头'], ['self_talk_enabled', '自言自语气泡']];
function PetSlider({ label, value, min, max, step, disabled, commit }) {
  const [draft, setDraft] = i.useState(value);
  const dragging = i.useRef(false);
  i.useEffect(() => { if (!dragging.current) setDraft(value); }, [value]);
  const save = () => { dragging.current = false; if (draft !== value) commit(draft); };
  return <label><span>{label} <small>{draft}</small></span><input type="range" aria-label={label} disabled={disabled} min={min} max={max} step={step} value={draft} onChange={event => { dragging.current = true; setDraft(Number(event.target.value)); }} onPointerUp={save} onKeyUp={save} onBlur={() => { if (dragging.current) save(); }} /></label>;
}
export function CompanionSettings() {
  const api = globalThis.blackObsidian;
  const [state, setState] = i.useState({ settings: {}, native: { settings: {} } });
  const [animations, setAnimations] = i.useState([]);
  const [selected, setSelected] = i.useState(null);
  const [filter, setFilter] = i.useState('all');
  const [search, setSearch] = i.useState('');
  const [name, setName] = i.useState('');
  const [busy, setBusy] = i.useState(false);
  const [error, setError] = i.useState('');
  const editingName = i.useRef(false);
  const mounted = i.useRef(true);
  const inFlight = i.useRef(false);
  const act = async (action, value) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setError('');
    try { if (!api?.companionAction) throw new Error('请在桌面程序中使用桌宠。'); const next = await api.companionAction(action, value); if (mounted.current && next) { setState(next); if (!editingName.current) setName(next.settings?.name || '大肥鱼'); } }
    catch (e) { if (mounted.current) setError(e.message || '操作失败。'); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  };
  i.useEffect(() => {
    mounted.current = true;
    const update = value => { if (mounted.current && value) { setState(value); if (!editingName.current) setName(value.settings?.name || '大肥鱼'); } };
    const off = api?.onCompanionState?.(update);
    api?.companionAction?.('sync').then(update).catch(e => { if (mounted.current) setError(e.message); });
    api?.companionAction?.('animations').then(items => { if (mounted.current) { setAnimations(items); setSelected(items.find(item => item.category === 'idle') || items[0]); } }).catch(e => { if (mounted.current) setError(e.message); });
    return () => { mounted.current = false; off?.(); };
  }, []);
  const native = state.native || {}, settings = native.settings || {};
  const update = state.update || {};
  const updating = ['checking', 'downloading', 'preparing', 'testing', 'installing'].includes(update.status);
  const updateLabel = { checking: '正在检查…', available: `发现新版 ${update.latestVersion}`, 'up-to-date': '桌宠已是最新版本', downloading: `正在下载 ${update.progress || 0}%`, preparing: '正在校验与准备组件…', testing: '正在验证新版桌宠…', installing: '正在切换新版桌宠…', updated: '桌宠更新完成', error: '更新未完成，可重试' }[update.status] || '可独立更新桌宠组件';
  i.useEffect(() => {
    if (!native.version) return;
    api?.companionAction?.('animations').then(items => { if (mounted.current) { setAnimations(items); setSelected(previous => items.find(item => item.id === previous?.id) || items[0]); } }).catch(() => {});
  }, [native.version]);
  const patch = values => act('native-update', values);
  const choices = [...new Set(animations.map(item => item.category))];
  const shown = animations.filter(item => (filter === 'all' || item.category === filter) && item.name.includes(search.trim()));
  return <section className="bos-pet-settings" aria-label="桌宠设置" aria-busy={busy}>
    <div className="bos-pet-toolbar"><div><strong>{state.settings?.name || '大肥鱼'}</strong><small>{native.ready ? (state.visible ? '正在陪伴' : '已隐藏，动画暂停') : '尚未开启'} · 原版完整组件 {native.version || '4.3.4'} · {animations.length || 106} 段动画</small></div>
      <button disabled={busy} onClick={() => act(state.visible ? 'hide' : 'show')}>{busy ? '处理中…' : state.visible ? '隐藏桌宠' : '开启桌宠'}</button>
      <button disabled={busy} className="bos-pet-primary" onClick={() => act('native-settings')}>打开原版完整设置 ↗</button>
    </div>
    {error && <p className="bos-script-warning" role="alert">{error}</p>}
    <div className="bos-pet-card bos-pet-update"><div><h3>桌宠更新 <small>v{update.currentVersion || native.version || '4.3.4'}</small></h3><p aria-live="polite">{updateLabel}</p><small>从官方 GitHub 下载，保留个人设置和已有动画。更新失败自动恢复。</small></div><div className="bos-pet-actions"><button disabled={busy || updating} onClick={() => act('check-update')}>检查更新</button>{update.hasUpdate && <button className="bos-pet-primary" disabled={busy || updating} onClick={() => act('install-update')}>下载并更新桌宠</button>}</div>{update.status === 'downloading' && <progress aria-label="桌宠下载进度" max="100" value={update.progress || 0} />}{update.error && <p className="bos-script-warning" role="alert">{update.error}</p>}</div>
    <div className="bos-pet-layout">
      <div className="bos-pet-card bos-pet-preview"><div className="bos-pet-video">{selected && <video key={selected.id} src={'/companion-assets/' + selected.id.split('/').map(encodeURIComponent).join('/')} autoPlay loop muted playsInline controls preload="metadata" />}</div><strong>{selected?.name || '正在加载动画'}</strong><small>原版透明动画 · 不裁切角色</small><div className="bos-pet-actions"><button disabled={busy || !selected} onClick={() => act('native-play', selected.id)}>让桌宠播放此动作</button><button disabled={busy} onClick={() => act('reset-position')}>找回桌宠位置</button></div></div>
      <div className="bos-pet-card"><h3>常用设置</h3>
        <form className="bos-pet-name" onSubmit={event => { event.preventDefault(); editingName.current = false; void act('update-settings', { name }); }}><label htmlFor="xm-pet-name">桌宠名字</label><input id="xm-pet-name" maxLength={40} value={name} onChange={event => { editingName.current = true; setName(event.target.value); }} /><button disabled={busy}>保存</button></form>
        <label className="bos-pet-switch"><span>显示名字</span><input type="checkbox" disabled={busy} checked={state.settings?.showName !== false} onChange={event => act('update-settings', { showName: event.target.checked })} /></label>
        <div className="bos-pet-controls">
          <label><span>显示大小</span><select disabled={busy} value={settings.scale ?? .72} onChange={event => patch({ scale: Number(event.target.value) })}>{[.4,.5,.65,.72,.85,1,1.25,1.5].map(n => <option value={n} key={n}>{Math.round(n*100)}%</option>)}</select></label>
          <label><span>播放速度</span><select disabled={busy} value={settings.playback_speed ?? 1} onChange={event => patch({ playback_speed: Number(event.target.value) })}>{[.5,.75,1,1.25,1.5,2,3,4].map(n => <option value={n} key={n}>{n}x</option>)}</select></label>
          <PetSlider label="桌宠不透明度" disabled={busy} min={10} max={100} step={5} value={settings.pet_opacity ?? 100} commit={value => patch({ pet_opacity: value })} />
          <PetSlider label="桌宠点击音量" disabled={busy} min={0} max={1} step={.1} value={settings.click_sound_volume ?? .7} commit={value => patch({ click_sound_volume: value })} />
        </div>
        <div className="bos-pet-switches">{toggles.map(([key, label]) => <label key={key} className="bos-pet-switch"><span>{label}</span><input type="checkbox" checked={!!settings[key]} disabled={busy} onChange={event => patch({ [key]: event.target.checked })} /></label>)}</div>
        <p className="bos-pet-hint">开启鼠标穿透后，可从本页或系统托盘恢复操作。新增设置会自动保存。</p>
      </div>
    </div>
    <div className="bos-pet-card"><h3>全部动画 <small>{animations.length} 段</small></h3><div className="bos-pet-filter"><input aria-label="搜索桌宠动画" placeholder="搜索动作名称" value={search} onChange={event => setSearch(event.target.value)} /><select aria-label="动画分类" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">全部分类</option>{choices.map(c => <option key={c} value={c}>{categories[c] || c}</option>)}</select></div><div className="bos-pet-animation-list">{shown.map(item => <button key={item.id} aria-pressed={selected?.id === item.id} onClick={() => setSelected(item)}><small>{categories[item.category] || item.category}</small><span>{item.name}</span></button>)}</div>{!shown.length && <p>没有匹配的动画。</p>}</div>
    <div className="bos-pet-card"><h3>完整功能</h3><p className="bos-pet-hint">以下功能均保留在原版设置和桌宠右键菜单中。AI 对话、语音等功能按原项目要求配置对应服务。</p><div className="bos-pet-features">{features.map(item => <button key={item} disabled={busy} onClick={() => act('native-settings')}>{item} ↗</button>)}</div><div className="bos-pet-actions"><button disabled={busy} onClick={() => act('spawn')}>生一只小肥鱼</button><button disabled={busy} onClick={() => act('chat')}>AI 对话</button><button disabled={busy} onClick={() => act('todo')}>待办提醒</button><button disabled={busy} onClick={() => act('panel', true)}>剪辑快捷面板</button></div></div>
    <p className="bos-pet-hint">完整组件来自 MerZlin/dsh-pet-indesktop。角色「溟月」素材仅限个人非商业使用；详细授权见第三方声明。</p>
  </section>;
}

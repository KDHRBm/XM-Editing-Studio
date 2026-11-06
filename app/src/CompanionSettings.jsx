const categories = { idle: '待机', turn: '转向', move: '移动', click: '点击', drag: '拖动', random: '随机', balance: '平衡' };

export function CompanionSettings() {
  const api = globalThis.blackObsidian;
  const [state, setState] = i.useState({ visible: false, settings: {} });
  const [animations, setAnimations] = i.useState([]);
  const [selected, setSelected] = i.useState('');
  const [busy, setBusy] = i.useState(false);
  const [error, setError] = i.useState('');
  const [phrasesDraft, setPhrasesDraft] = i.useState('');
  const [scaleDraft, setScaleDraft] = i.useState(100);
  const [bubbleDraft, setBubbleDraft] = i.useState({ x: 50, y: 0 });
  i.useEffect(() => {
    const off = api?.onCompanionState?.(setState);
    api?.companionAction?.('sync').then(value => { setState(value); setPhrasesDraft((value.settings?.phrases || []).join('\n')); }).catch(error => setError(error.message));
    api?.companionAction?.('animations').then(items => { setAnimations(items); setSelected(items.find(item => item.category === 'idle')?.id || items[0]?.id || ''); }).catch(error => setError(error.message));
    return () => off?.();
  }, []);
  i.useEffect(() => { setScaleDraft(Math.max(70, Math.min(250, Number(state.settings?.scale) || 100))); }, [state.settings?.scale]);
  i.useEffect(() => { setBubbleDraft({ x: Number(state.settings?.bubbleX ?? 50), y: Number(state.settings?.bubbleY ?? 0) }); }, [state.settings?.bubbleX, state.settings?.bubbleY]);
  const act = async (action, value) => {
    if (busy) return;
    setBusy(true); setError('');
    try { const next = await api.companionAction(action, value); if (next && !Array.isArray(next)) setState(next); }
    catch (error) { setError(error.message || '操作失败'); }
    finally { setBusy(false); }
  };
  const settings = state.settings || {};
  const borderColor = /^#[0-9a-fA-F]{6}$/.test(settings.bubbleBorderColor || '') ? settings.bubbleBorderColor : '#FFB6C1';
  const saveScale = event => {
    const scale = Number(event.currentTarget.value);
    if (scale !== Number(settings.scale || 100)) void act('update-settings', { scale });
  };
  const saveBubblePosition = (axis, event) => {
    const value = Number(event.currentTarget.value);
    const next = { bubbleX: axis === 'x' ? value : bubbleDraft.x, bubbleY: axis === 'y' ? value : bubbleDraft.y };
    if (next.bubbleX !== Number(settings.bubbleX ?? 50) || next.bubbleY !== Number(settings.bubbleY ?? 0)) void act('update-settings', next);
  };
  const previewBubblePosition = (axis, value) => {
    const next = { x: axis === 'x' ? value : bubbleDraft.x, y: axis === 'y' ? value : bubbleDraft.y };
    setBubbleDraft(next);
    void api?.companionAction?.('preview-bubble', { bubbleX: next.x, bubbleY: next.y })?.catch(error => setError(error.message || '气泡预览失败'));
  };
  return <section className="bos-pet-settings" aria-label="桌面动画设置">
    <div className="bos-pet-toolbar"><div><strong>大肥鱼桌面动画</strong><small>{state.visible ? '正在显示' : '已隐藏'} · {animations.length} 段本地动画</small></div><button type="button" disabled={busy} onClick={() => act(state.visible ? 'hide' : 'show')}>{state.visible ? '隐藏动画' : '显示动画'}</button><button type="button" disabled={busy} onClick={() => act('panel', true)}>打开 JianYing Pro 悬浮窗</button></div>
    {error && <p className="bos-script-warning" role="alert">{error}</p>}
    <div className="bos-pet-layout">
      <div className="bos-pet-card bos-pet-preview">
        <div className="bos-pet-video">{selected && <video key={selected} src={'/companion-animations/' + selected.split('/').map(encodeURIComponent).join('/')} autoPlay loop muted playsInline controls preload="metadata" />}<output className="bos-pet-bubble-sample" style={{ '--bubble-border': borderColor, left: `${bubbleDraft.x}%`, top: `${bubbleDraft.y}%`, transform: `translate(-${bubbleDraft.x}%, -${bubbleDraft.y}%)` }}>一起玩手机呀~</output></div>
        <strong>{animations.find(item => item.id === selected)?.name || '待机动画'}</strong>
        <button type="button" disabled={busy || !selected} onClick={() => act('play', selected)}>播放此动画</button>
      </div>
      <div className="bos-pet-card bos-pet-config">
        <h3>显示设置</h3>
        <div className="bos-pet-setting-grid">
          <div className="bos-pet-setting-row"><span>动画大小</span><div className="bos-pet-scale-control"><input type="range" aria-label="动画大小" min="70" max="250" step="5" value={scaleDraft} disabled={busy} onChange={event => setScaleDraft(Number(event.target.value))} onPointerUp={saveScale} onKeyUp={saveScale} onBlur={saveScale} /><output>{scaleDraft}%</output></div></div>
          <label className="bos-pet-setting-row"><span>自动播放随机动作</span><input type="checkbox" checked={settings.motion !== false} disabled={busy} onChange={event => act('update-settings', { motion: event.target.checked })} /></label>
          <div className="bos-pet-setting-row"><span>桌面位置</span><button type="button" disabled={busy} onClick={() => act('reset-position')}>找回动画位置</button></div>
        </div>
        <h3>自言自语</h3>
        <div className="bos-pet-setting-grid">
          <label className="bos-pet-setting-row"><span>显示气泡</span><input type="checkbox" checked={settings.selfTalk !== false} disabled={busy} onChange={event => act('update-settings', { selfTalk: event.target.checked })} /></label>
          <div className="bos-pet-setting-row"><span>气泡左右位置</span><div className="bos-pet-scale-control"><input type="range" aria-label="气泡左右位置" min="0" max="100" step="5" value={bubbleDraft.x} disabled={busy} onChange={event => previewBubblePosition('x', Number(event.target.value))} onPointerUp={event => saveBubblePosition('x', event)} onKeyUp={event => saveBubblePosition('x', event)} onBlur={event => saveBubblePosition('x', event)} /><output>{bubbleDraft.x}%</output></div></div>
          <div className="bos-pet-setting-row"><span>气泡上下位置</span><div className="bos-pet-scale-control"><input type="range" aria-label="气泡上下位置" min="0" max="100" step="5" value={bubbleDraft.y} disabled={busy} onChange={event => previewBubblePosition('y', Number(event.target.value))} onPointerUp={event => saveBubblePosition('y', event)} onKeyUp={event => saveBubblePosition('y', event)} onBlur={event => saveBubblePosition('y', event)} /><output>{bubbleDraft.y}%</output></div></div>
          <label className="bos-pet-setting-row"><span>间隔时间 / 秒</span><input type="number" min="15" max="600" value={settings.talkInterval || 90} disabled={busy} onChange={event => act('update-settings', { talkInterval: Number(event.target.value) })} /></label>
          <label className="bos-pet-setting-row"><span>气泡边缘颜色</span><input type="color" aria-label="气泡边缘颜色" value={borderColor} disabled={busy} onChange={event => act('update-settings', { bubbleBorderColor: event.target.value })} /></label>
        </div>
        <label className="bos-pet-phrases"><span>自定义台词，每行一句</span><textarea rows="5" maxLength="3000" value={phrasesDraft} disabled={busy} onChange={event => setPhrasesDraft(event.target.value)} /></label>
        <div className="bos-pet-config-actions"><button type="button" disabled={busy || !phrasesDraft.trim()} onClick={() => act('update-settings', { phrases: phrasesDraft.split(/\r?\n/) })}>保存台词</button></div>
      </div>
    </div>
    <div className="bos-pet-card"><h3>动画列表</h3><div className="bos-pet-animation-list">{animations.map(item => <button type="button" key={item.id} aria-pressed={selected === item.id} onClick={() => setSelected(item.id)}><small>{categories[item.category] || item.category}</small><span>{item.name}</span></button>)}</div></div>
    <p className="bos-pet-hint">角色动画仅限个人非商业使用。素材来源与授权详见第三方声明。</p>
  </section>;
}

import { PetNavIcon, UpdateNavIcon } from './NavigationIcons.jsx';

const idle = { status: 'idle', currentVersion: '1.4.1', progress: 0 };

export function TitleBar({ onNavigate }) {
  const [state, setState] = i.useState(idle);
  const [petName, setPetName] = i.useState('大肥鱼');
  const api = globalThis.blackObsidian;
  i.useEffect(() => {
    let alive = true;
    api?.getUpdaterStatus?.().then(value => { if (alive && value) setState(value); }).catch(() => {});
    const offUpdate = api?.onUpdaterState?.(value => { if (alive && value) setState(value); });
    const updatePet = value => { if (alive && value?.settings?.name) setPetName(value.settings.name); };
    const offPet = api?.onCompanionState?.(updatePet);
    api?.companionAction?.('sync').then(updatePet).catch(() => {});
    const offNavigate = api?.onTrayNavigate?.(target => {
      if (!target) return;
      if (target === 'watermark') {
        onNavigate?.('jianying');
        window.dispatchEvent(new CustomEvent('xm-jianying-stage', { detail: 'watermark' }));
      } else onNavigate?.(target);
    });
    return () => { alive = false; offUpdate?.(); offNavigate?.(); offPet?.(); };
  }, [onNavigate]);
  const action = state.status === 'available' ? 'download' : state.status === 'ready' ? 'install' : 'check';
  const busy = state.status === 'checking' || state.status === 'downloading';
  const label = state.status === 'checking' ? '检查中…'
    : state.status === 'available' ? `更新 v${state.latestVersion}`
    : state.status === 'downloading' ? `下载 ${state.progress}%`
    : state.status === 'ready' ? '安装更新'
    : state.status === 'up-to-date' ? `v${state.currentVersion} · 已是最新`
    : state.status === 'error' ? '重试更新' : `v${state.currentVersion} · 检查更新`;
  return <header className="bos-titlebar" aria-label="窗口标题栏">
    <div className="bos-titlebar-drag"><span className="bos-titlebar-dot" aria-hidden="true" /><span>XM剪辑台</span><span className="bos-titlebar-version">v{state.currentVersion}</span></div>
    <div className="bos-titlebar-actions">
      <button type="button" title={`打开或隐藏${petName}`} aria-label={`打开或隐藏${petName}`} onClick={() => api?.companionAction?.('toggle')}><PetNavIcon size={15} /></button>
      <button type="button" className={'bos-update-pill ' + (state.hasUpdate ? 'is-available' : '')} disabled={busy} title={state.error || label} onClick={() => api?.updaterAction?.(action)}><UpdateNavIcon size={14} /> {label}</button>
    </div>
  </header>;
}

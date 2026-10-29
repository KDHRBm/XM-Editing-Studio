import { PetNavIcon } from './NavigationIcons.jsx';



const idle = { status: 'idle', currentVersion: '1.4.4', progress: 0 };



export function TitleBar({ onNavigate }) {

  const [state, setState] = i.useState(idle);

  const [petBusy, setPetBusy] = i.useState(false);

  const [petError, setPetError] = i.useState('');

  const petStarting = i.useRef(false);

  const showPet = async () => {

    if (petStarting.current) return;

    petStarting.current = true; setPetBusy(true); setPetError('');

    try { if (!api?.companionAction) throw new Error('请在桌面程序中开启桌宠。'); await api.companionAction('show'); }

    catch (error) { setPetError(error.message || '桌宠启动失败，请重试。'); }

    finally { petStarting.current = false; setPetBusy(false); }

  };

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

      if (target === 'watermark' || target === 'jianying') {

        const stage = target === 'watermark' ? 'watermark' : 'export';

        localStorage.setItem('xm.jianying.stage', stage);

        onNavigate?.('jianying');

        window.dispatchEvent(new CustomEvent('xm-jianying-stage', { detail: stage }));

      } else if (target === 'period') {

        onNavigate?.('workspace');

        window.dispatchEvent(new Event('xm-focus-period'));

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

    <div className="bos-titlebar-drag"><span className="bos-titlebar-dot" aria-hidden="true" /><span>XM剪辑台</span></div>

    <div className="bos-titlebar-actions">

      <button type="button" className="bos-pet-entry" title={petError || (petBusy ? '桌宠启动中…' : `${petName} · 开启桌宠`)} aria-label="开启桌宠" disabled={petBusy} onClick={showPet}><PetNavIcon size={21} /></button>

      {petError && <span role="alert" className="bos-pet-start-error">{petError}</span>}

      <button type="button" className={'bos-update-pill ' + (state.hasUpdate ? 'is-available' : '')} disabled={busy} aria-busy={busy} title={state.error || label} onClick={() => api?.updaterAction?.(action).catch(error => setState(current => ({ ...current, status: 'error', error: error.message })))}>{busy && <span className="bos-btn-spinner" aria-hidden="true" />}<span>{label}</span></button>

    </div>

  </header>;

}

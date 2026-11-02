declare const i: any;

export interface UpdaterState {
  status: 'idle' | 'checking' | 'available' | 'up-to-date' | 'downloading' | 'ready' | 'error';
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
  progress: number;
  releaseUrl?: string;
  error?: string;
}

const DEFAULT_STATE: UpdaterState = {
  status: 'idle',
  currentVersion: '1.7.1',
  latestVersion: '1.7.1',
  hasUpdate: false,
  progress: 0,
};

export function TitleBar({ onNavigate }: { onNavigate?: (tab: string) => void } = {}) {
  const [state, setState] = i.useState(DEFAULT_STATE as UpdaterState);
  const [companionBusy, setCompanionBusy] = i.useState(false);
  const [companionOpen, setCompanionOpen] = i.useState(false);
  const api = (globalThis as any).blackObsidian;

  i.useEffect(() => {
    let alive = true;
    api?.getUpdaterStatus?.().then((s: UpdaterState) => {
      if (alive && s) setState(s);
    }).catch(() => {});
    api?.companionAction?.('sync').then((cs: any) => {
      if (alive && cs) setCompanionOpen(Boolean(cs.visible));
    }).catch(() => {});
    const off = api?.onUpdaterState?.((s: UpdaterState) => {
      if (alive && s) setState(s);
    });
    const offComp = api?.onCompanionState?.((cs: any) => {
      if (alive && cs) setCompanionOpen(Boolean(cs.visible));
    });
    const offNav = api?.onTrayNavigate?.((target: string) => {
      if (!alive || !target) return;
      if (target === 'script' || target === 'period') {
        onNavigate?.('workspace');
      } else if (target === 'watermark') {
        onNavigate?.('jianying');
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
          window.dispatchEvent(new CustomEvent('xm-jianying-stage', { detail: 'watermark' }));
        }
      } else {
        onNavigate?.(target);
      }
    });
    return () => {
      alive = false;
      if (typeof off === 'function') off();
      if (typeof offComp === 'function') offComp();
      if (typeof offNav === 'function') offNav();
    };
  }, [onNavigate]);

  const handleToggleCompanion = async () => {
    if (companionBusy || !api?.companionAction) return;
    setCompanionBusy(true);
    try {
      const res = await api.companionAction('toggle');
      if (res) setCompanionOpen(Boolean(res.visible));
    } catch {
      /* ignore */
    } finally {
      setTimeout(() => setCompanionBusy(false), 320);
    }
  };

  const handleAction = () => {
    if (!api?.updaterAction) return;
    if (state.status === 'available') {
      void api.updaterAction('download').catch(() => {});
    } else if (state.status === 'ready') {
      void api.updaterAction('install').catch(() => {});
    } else if (state.status !== 'checking' && state.status !== 'downloading') {
      void api.updaterAction('check').catch(() => {});
    }
  };

  let label = `v${state.currentVersion} · 检查更新`;
  let badgeClass = 'bos-update-pill';
  if (state.status === 'checking') {
    label = '正在检查更新…';
  } else if (state.status === 'up-to-date') {
    label = `v${state.currentVersion} · 已是最新`;
  } else if (state.status === 'available') {
    label = `发现新版本 v${state.latestVersion} · 一键更新`;
    badgeClass = 'bos-update-pill is-available';
  } else if (state.status === 'downloading') {
    label = `正在下载 v${state.latestVersion} (${state.progress}%)…`;
    badgeClass = 'bos-update-pill is-downloading';
  } else if (state.status === 'ready') {
    label = `v${state.latestVersion} 已就绪 · 立即重启安装`;
    badgeClass = 'bos-update-pill is-ready';
  } else if (state.status === 'error') {
    label = '检查更新失败 · 点击重试';
    badgeClass = 'bos-update-pill is-error';
  }

  return (
    <header className="bos-titlebar" aria-label="窗口标题栏">
      <div className="bos-titlebar-drag">
        <span className="bos-titlebar-dot" aria-hidden="true" />
        <span className="bos-titlebar-brand">XM剪辑台</span>
        <span className="bos-titlebar-version">v{state.currentVersion}</span>
      </div>
      <div className="bos-titlebar-actions">
        <button
          type="button"
          className={`bos-companion-pill${companionBusy ? ' is-loading' : ''}${companionOpen ? ' is-open' : ''}`}
          disabled={companionBusy}
          onClick={handleToggleCompanion}
          title="开启或关闭桌面悬浮窗（剪映自动化、字幕工程、拖放改名与样片水印）"
        >
          {companionBusy ? <span className="bos-btn-spinner" aria-hidden="true" /> : '🐱 '}
          {companionBusy ? '启动中…' : '悬浮窗'}
        </button>
        <button
          type="button"
          className={badgeClass}
          disabled={state.status === 'checking' || state.status === 'downloading'}
          onClick={handleAction}
          title={state.error || label}
        >
          {label}
        </button>
      </div>
    </header>
  );
}

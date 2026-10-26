export function MusicDragButton({ libraryId = '', url = '', filePath = '' }) {
  const api = globalThis.blackObsidian;
  const [state, setState] = i.useState({ ready: false, loading: true });
  const [revision, setRevision] = i.useState(0);
  i.useEffect(() => {
    let cancelled = false;
    setState({ ready: false, loading: true });
    if (!api?.prepareMusicDrag) { setState({ ready: false, reason: '请使用更新后的桌面程序。' }); return undefined; }
    api.prepareMusicDrag({ libraryId, url, filePath }).then(value => { if (!cancelled) setState(value); }).catch(error => { if (!cancelled) setState({ ready: false, error: error.message || '无法读取音频。' }); });
    return () => { cancelled = true; };
  }, [libraryId, url, filePath, revision]);
  i.useEffect(() => api?.onMusicDragError?.(event => { if (event.token === state.token) setState({ ready: false, error: event.message }); }), [state.token]);
  const start = event => {
    event.preventDefault();
    if (state.ready) api.startMusicDrag(state.token);
  };
  return <div className="bos-music-drag"><button type="button" draggable={!!state.ready} onDragStart={start} disabled={state.loading || (!state.ready && !state.error)} onClick={() => { if (state.error) setRevision(n => n + 1); }} title={state.ready ? `按住拖到剪映素材区，直接使用原文件：${state.path}` : state.error || state.reason || '正在检查本地音频'} aria-label={state.ready ? `拖入剪映：${state.name}` : '音乐拖入状态'}>{state.ready ? '⠿ 拖入剪映' : state.loading ? '准备拖动…' : state.error ? '重新准备拖动' : '未保存，暂不可拖入'}</button>{state.error && <small role="status">{state.error}</small>}</div>;
}

import { musicUsage } from './MusicUsage.mjs';
import { MUSIC_USAGE_LIMIT } from '../shared/library-usage.mjs';
import { MusicDragButton } from './MusicDragButton.jsx';
import { Pagination, usePages } from './Pagination.jsx';
import { usePanelCollapsed } from './PanelState.jsx';

export function MusicUsageHistory({ tracks, scope = 'workspace' }) {
  const usage = i.useSyncExternalStore(musicUsage.subscribe, musicUsage.snapshot);
  const [collapsed, toggle] = usePanelCollapsed(`music-usage-${scope}`);
  const pages = usePages(usage.history, 5);
  const bodyId = `bos-music-history-${scope}`;
  i.useEffect(() => { pages.setPage(1); }, [usage.history]);
  return <section className="bos-library bos-script-panel bos-music-history-panel" aria-label="历史使用音乐">
    <header className="bos-library-heading"><div><span className="bos-script-eyebrow">RECENTLY USED MUSIC</span><h3>历史使用音乐 <small>{usage.history.length} / {MUSIC_USAGE_LIMIT}</small></h3><p>两个分析页面共享最近十首使用记录。选用或标记后记录，试听不计入；下次检索与 AI 推荐自动避开。</p></div><button type="button" className="bos-panel-toggle" aria-expanded={!collapsed} aria-controls={bodyId} onClick={toggle}>{collapsed ? '展开历史' : '收起历史'}</button></header>
    <div id={bodyId} hidden={collapsed}>
      {usage.error && <p className="bos-script-warning" role="alert">{usage.error}</p>}
      {!usage.history.length && <p className="bos-library-empty">暂无使用记录。选用音乐或点击“标记已使用”后会显示在这里。</p>}
      {pages.visible.map(item => { const track = tracks.find(track => track.id === item.id); return <article className="bos-library-match" key={item.id}><div className="bos-library-match-title"><div><h4>{track?.title || item.title}</h4><small>{item.usedAt ? new Date(item.usedAt).toLocaleString() : '此前使用'} · {track?.relativePath || item.relativePath}</small></div><button type="button" aria-label={`取消使用标记 ${item.title}`} onClick={() => musicUsage.forget(item.id)}>取消标记</button></div>{track ? <><audio controls preload="none" src={`/local-music/${track.id}`} aria-label={`历史试听 ${track.title}`} /><MusicDragButton libraryId={track.id} /></> : <p className="bos-script-footnote">音乐当前未连接或已移除，使用记录仍保留。</p>}</article>; })}
      {usage.history.length > 5 && <Pagination {...pages} label="历史使用音乐页码" />}
    </div>
  </section>;
}

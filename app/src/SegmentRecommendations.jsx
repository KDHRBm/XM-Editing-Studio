import { MusicDragButton } from './MusicDragButton.jsx';
import { Pagination, usePages } from './Pagination.jsx';
import { analysisName } from '../shared/script-analyzers.mjs';
function Segment({ segment, tracks, current, lines, onUse, isSelected = () => false, onError, onGenerate, segmentJob, onViewJob, onMarkUsed, usedIds = [], analyzer }) {
  const pages = usePages(segment.matches || []);
  const job = segmentJob?.(segment);
  const missing = !segment.matches.some(match => tracks.some(track => track.id === match.id));
  const status = { queued: '等待生成', planning: `${analysisName(job?.gemini || analyzer)} 正在为本段策划`, ready: '本段提示词已就绪', submitting: '正在提交 Suno', pending: '正在生成本段音乐', complete: '本段音乐已完成', uncertain: '提交结果待核对', pausedQuery: '音乐查询已暂停', error: '本段任务需要处理' };
  return <section className="bos-segment-card"><h4>{segment.title} <small>原文第 {segment.startLine}–{segment.endLine} 行</small></h4><p>{segment.summary}</p><div className="bos-library-keywords">{segment.keywords.map(word => <span key={word}>{word}</span>)}</div>
    {segment.noMatchReason && <p className="bos-script-footnote">{segment.noMatchReason}</p>}
    {missing && <div className="bos-segment-generate"><p className="bos-script-footnote">此情节暂无可用的本地推荐，可直接为本段生成音乐。</p><div className="bos-script-actions">
      {(!job || ['queued', 'ready'].includes(job.status)) && <button type="button" className="bos-script-primary" disabled={!current || !onGenerate} onClick={async () => { try { await onGenerate(segment); } catch (error) { onError(error.message); } }}>{!current ? '请重新匹配' : job ? '继续本段任务' : '生成本段音乐'}</button>}
      {job && <><span role="status">{status[job.status] || '任务已保存'}</span><button type="button" onClick={() => onViewJob(job)}>查看本段任务</button></>}
    </div><small>仅为此情节使用 {analysisName(analyzer)} 策划，再提交 Suno 生成音乐；按各服务规则使用额度，其他情节推荐保留。</small></div>}
    {pages.visible.map(match => { const track = tracks.find(item => item.id === match.id); const selected = isSelected(track || { id: match.id }, segment); return <article className="bos-library-match" key={match.id}><div className="bos-library-match-title"><div><h4>{track?.title || match.title || '历史音乐（请连接原音乐库）'}</h4><small>{track?.relativePath}</small></div><button type="button" aria-pressed={selected} title={selected ? '再次点击取消本段选用' : '选用这首本段音乐'} disabled={!selected && (!track || !current)} onClick={async () => { try { await onUse(track || { id: match.id }, { summary: segment.summary, keywords: segment.keywords }, match.reason, lines.filter(line => line.sourceLine >= segment.startLine && line.sourceLine <= segment.endLine), segment); } catch (error) { onError(error.message); } }}>{selected ? '已选用 · 点击取消' : current ? '选用本段音乐' : '请重新匹配'}</button></div><p>{match.reason}</p>{track && <><audio controls preload="none" src={`/local-music/${track.id}`} aria-label={`${segment.title} 试听 ${track.title}`} /><div className="bos-library-use-tools"><MusicDragButton libraryId={track.id} /><button type="button" disabled={!onMarkUsed} aria-pressed={usedIds.includes(track.id)} title="再次点击可取消使用标记" onClick={() => onMarkUsed(track)}>{usedIds.includes(track.id) ? '已标记使用' : '标记已使用'}</button></div></>}</article>; })}
    {segment.matches.length > 5 && <Pagination {...pages} label={`${segment.title} 推荐页码`} />}
  </section>;
}
export function SegmentRecommendations(props) { return <div className="bos-segment-list">{props.segments.map(segment => <Segment key={segment.id} {...props} segment={segment} />)}</div>; }

export function usePages(items, pageSize = 5) {
  const [requested, setPage] = i.useState(1);
  const count = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.max(1, Math.min(requested, count));
  return { page, count, pageSize, setPage, visible: items.slice((page - 1) * pageSize, page * pageSize) };
}
export function Pagination({ page, count, setPage, label, pageSize = 5 }) {
  const first = Math.floor((page - 1) / 10) * 10 + 1;
  return <nav className="bos-pagination" aria-label={label}>
    <button type="button" disabled={page === 1} onClick={() => setPage(page - 1)}>上一页</button>
    {first > 1 && <button type="button" onClick={() => setPage(first - 1)} aria-label="前十页">…</button>}
    {Array.from({ length: Math.min(10, count - first + 1) }, (_, n) => first + n).map(n => <button type="button" key={n} aria-label={`第 ${n} 页`} aria-current={n === page ? 'page' : undefined} onClick={() => setPage(n)}>{n}</button>)}
    {first + 9 < count && <button type="button" onClick={() => setPage(first + 10)} aria-label="后十页">…</button>}
    <button type="button" disabled={page === count} onClick={() => setPage(page + 1)}>下一页</button>
    <small>第 {page} / {count} 页 · 每页 {pageSize} 首</small>
  </nav>;
}

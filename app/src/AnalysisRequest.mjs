import { webAnalyzer } from '../shared/script-analyzers.mjs';

export async function requestScriptAnalysis(purpose, body, signal) {
  const web = webAnalyzer(body.provider);
  if (!web) {
    const response = await fetch(`/api/script/${purpose}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || '剧本分析失败。');
    return value;
  }
  const api = globalThis.blackObsidian;
  if (!api?.analyzeWebScript) throw new Error('请更新桌面程序后使用内嵌网页分析。');
  signal?.throwIfAborted();
  const id = crypto.randomUUID();
  const cancel = () => { void api.webAnalysisAction(id, 'cancel').catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    const { provider, model, ...input } = body;
    return await api.analyzeWebScript({ id, provider: web.provider.webId, purpose, input });
  } finally { signal?.removeEventListener('abort', cancel); }
}

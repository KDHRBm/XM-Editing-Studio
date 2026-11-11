import { webAnalyzer } from '../shared/script-analyzers.mjs';

export async function requestScriptAnalysis(purpose, body, signal, onStage = () => {}) {
  const web = webAnalyzer(body.provider);
  if (!web) {
    const progressId = crypto.randomUUID();
    const stage = event => { if (event.detail?.id === progressId) onStage(event.detail.phase); };
    globalThis.window?.addEventListener('xm-batch-analysis-stage', stage);
    try {
      const response = await fetch(`/api/script/${purpose}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, progressId }), signal });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || '剧本分析失败。');
      return value;
    } finally { globalThis.window?.removeEventListener('xm-batch-analysis-stage', stage); }
  }
  onStage('web');
  const api = globalThis.blackObsidian;
  if (!api?.analyzeWebScript) throw new Error('请更新桌面程序后使用内嵌网页分析。');
  signal?.throwIfAborted();
  const id = crypto.randomUUID();
  const cancel = () => { void api.webAnalysisAction(id, 'cancel').catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    const { provider, model, manualWeb, ...input } = body;
    return await api.analyzeWebScript({ id, provider: web.provider.webId, purpose, input, manualWeb: !!manualWeb && web.provider.webId === 'deepseek' });
  } catch (error) {
    // Electron adds an IPC implementation prefix; display the actual provider failure.
    const message = error?.message;
    if (typeof message === 'string' && /^Error invoking remote method ['"]bos:web-analysis-start['"]:\s*(?:Error:\s*)?/.test(message)) {
      throw new Error(message.replace(/^Error invoking remote method ['"]bos:web-analysis-start['"]:\s*(?:Error:\s*)?/, ''));
    }
    throw error;
  } finally { signal?.removeEventListener('abort', cancel); }
}

import { setTimeout as wait } from 'node:timers/promises';

export function buildJianyingAIRequest(connection, input) {
  const { provider, model } = connection || {};
  if (!provider?.apiKey?.trim() || typeof model !== 'string' || !/gemini/i.test(model) || !['gemini', 'openai', 'custom'].includes(provider.protocol)) throw new Error('请在模型与连接中配置并选择 Gemini。');
  const url = new URL(provider.baseUrl);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('模型连接地址无效。');
  if (typeof input.prompt !== 'string' || input.prompt.length > 150000 || input.image && (typeof input.image !== 'string' || input.image.length > 12000000 || !/^[A-Za-z0-9+/=]+$/.test(input.image))) throw new Error('AI 分析资料格式无效或过大。');
  const headers = { 'Content-Type': 'application/json' };
  let body;
  if (provider.protocol === 'gemini') {
    headers['x-goog-api-key'] = provider.apiKey;
    url.pathname = url.pathname.replace(/\/+$/, '') + `/models/${encodeURIComponent(model)}:generateContent`;
    body = { contents: [{ role: 'user', parts: [{ text: input.prompt }, ...(input.image ? [{ inlineData: { mimeType: 'image/jpeg', data: input.image } }] : [])] }], generationConfig: { temperature: 0.1 } };
  } else {
    headers.Authorization = `Bearer ${provider.apiKey}`;
    if (!url.pathname.replace(/\/+$/, '').endsWith('/chat/completions')) url.pathname = url.pathname.replace(/\/+$/, '') + '/chat/completions';
    body = { model, temperature: 0.1, messages: [{ role: 'user', content: input.image ? [{ type: 'text', text: input.prompt }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + input.image } }] : input.prompt }] };
  }
  return { url, headers, body };
}

export async function requestJianyingAI(connection, input, signal, fetcher = fetch, { onRetry = () => {}, delay = (ms, signal) => wait(ms, undefined, { signal }), attemptTimeoutMs = 140000, totalTimeoutMs = 140000 } = {}) {
  const { url, headers, body } = buildJianyingAIRequest(connection, input);
  // All attempts, response reads and retry waits share the native worker's deadline.
  const total = signal ? AbortSignal.any([signal, AbortSignal.timeout(totalTimeoutMs)]) : AbortSignal.timeout(totalTimeoutMs);
  const transient = new Set([500, 502, 503, 504]);
  let attempt = 0;
  try {
    for (attempt = 1; attempt <= 3; attempt++) {
      total.throwIfAborted();
      const requestSignal = AbortSignal.any([total, AbortSignal.timeout(attemptTimeoutMs)]);
      let retry = false, failure;
      try {
        const response = await fetcher(url, { method: 'POST', headers, body: JSON.stringify(body), signal: requestSignal });
        const raw = await response.text();
        total.throwIfAborted();
        if (raw.length > 2000000) throw new Error('模型响应过大，请减少文件数量。');
        let data; try { data = JSON.parse(raw); } catch { /* Relays may return a text/HTML 5xx response. */ }
        if (!response.ok) {
          retry = transient.has(response.status);
          const detail = String(data?.error?.message || (data ? '请检查连接' : raw.replace(/<[^>]*>/g, ' '))).replace(/\s+/g, ' ').trim().slice(0, 180);
          failure = new Error(retry
            ? `Gemini 上游服务异常（${response.status}），已尝试 ${attempt} 次。请稍后重试或在模型与连接中更换可用的 Gemini 连接。${detail ? '接口信息：' + detail : ''}`
            : `AI 请求失败（${response.status}）：${detail || '请检查连接'}`);
        } else {
          if (!data) throw new Error('模型接口未返回有效 JSON。');
          const content = connection.provider.protocol === 'gemini' ? data?.candidates?.[0]?.content?.parts : data?.choices?.[0]?.message?.content;
          const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map(part => part.text || '').join('') : '';
          if (!text.trim()) throw new Error('模型返回空内容，请检查模型是否支持当前任务。');
          return text;
        }
      } catch (error) {
        total.throwIfAborted();
        retry = requestSignal.aborted || error instanceof TypeError && /fetch|network|socket/i.test(error.message);
        failure = retry ? new Error(requestSignal.aborted ? `Gemini 单次请求超时，已尝试 ${attempt} 次。请检查连接或稍后重试。` : `Gemini 网络连接失败，已尝试 ${attempt} 次。请检查网络或模型连接。`) : error;
      }
      if (!retry || attempt === 3) throw failure;
      onRetry(`Gemini 请求暂时失败，正在重试（${attempt + 1}/3），按 F10 可中断`);
      await delay(attempt * 1000, total);
    }
  } catch (error) {
    if (signal?.aborted) throw new Error('AI 任务已中断。');
    if (total.aborted) throw new Error(`Gemini 请求超时（已尝试 ${attempt} 次），请检查网络或更换可用的 Gemini 连接。`);
    throw new Error(String(error?.message || 'AI 请求失败').replaceAll(connection.provider.apiKey, '[密钥]').slice(0, 600));
  }
}

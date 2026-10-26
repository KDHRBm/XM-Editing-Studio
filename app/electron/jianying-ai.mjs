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

export async function requestJianyingAI(connection, input, signal, fetcher = fetch) {
  const { url, headers, body } = buildJianyingAIRequest(connection, input);
  try {
    const response = await fetcher(url, { method: 'POST', headers, body: JSON.stringify(body), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(140000)]) : AbortSignal.timeout(140000) });
    const raw = await response.text();
    if (raw.length > 2000000) throw new Error('模型响应过大，请减少文件数量。');
    let data; try { data = JSON.parse(raw); } catch { throw new Error('模型接口未返回有效 JSON。'); }
    if (!response.ok) throw new Error(`AI 请求失败（${response.status}）：${String(data?.error?.message || '请检查连接').slice(0, 500)}`);
    const content = connection.provider.protocol === 'gemini' ? data?.candidates?.[0]?.content?.parts : data?.choices?.[0]?.message?.content;
    const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map(part => part.text || '').join('') : '';
    if (!text.trim()) throw new Error('模型返回空内容，请检查模型是否支持当前任务。');
    return text;
  } catch (error) {
    throw new Error(String(error?.message || 'AI 请求失败').replaceAll(connection.provider.apiKey, '[密钥]').slice(0, 600));
  }
}

import { WEB_AI_PROVIDERS } from './web-ai.mjs';

export const WEB_ANALYZERS = WEB_AI_PROVIDERS.map(site => {
  const provider = { id: `webai:${site.id}`, name: site.name, protocol: 'official-web', baseUrl: site.url, webId: site.id };
  return { key: `${provider.id}::${site.name}`, providerId: provider.id, protocol: provider.protocol, baseUrl: provider.baseUrl, model: site.name, provider, label: `${site.name} 官方网页版 · 无需配置` };
});
export function webAnalyzer(value) {
  const id = typeof value === 'string' ? value : value?.providerId || value?.provider?.id || value?.id;
  return WEB_ANALYZERS.find(item => item.providerId === id);
}
export function analysisName(value) {
  const name = webAnalyzer(value)?.model || (typeof value === 'string' ? value : value?.model) || '';
  if (/gemini/i.test(name) || value?.protocol === 'gemini' || value?.provider?.protocol === 'gemini') return 'Gemini';
  return name || 'AI';
}
export function analysisReady(value) { return !!webAnalyzer(value) || !!value?.provider?.apiKey?.trim(); }
export function openWebAnalyzer(value) {
  const item = webAnalyzer(value);
  if (item) window.dispatchEvent(new CustomEvent('xm-open-web-ai', { detail: item.provider.webId }));
}

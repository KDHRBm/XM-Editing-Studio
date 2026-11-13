export const WEB_AI_PROVIDERS = [
  { id: 'deepseek', name: 'DeepSeek', url: 'https://chat.deepseek.com/', host: 'chat.deepseek.com', description: '使用官方网页提供的对话、深度思考等选项。' },
  { id: 'doubao', name: '豆包', url: 'https://www.doubao.com/chat/', host: 'www.doubao.com', description: '使用豆包官方网页提供的最新功能与模型选项。' },
  { id: 'qwen', name: '千问', url: 'https://www.qianwen.com/', host: 'www.qianwen.com', manualOnly: true, description: '登录千问官网，复制任务并手动导入回答，无需 API 密钥。' },
  { id: 'kimi', name: 'Kimi', url: 'https://www.kimi.com/', host: 'www.kimi.com', manualOnly: true, description: '登录 Kimi 官网，复制剧本任务并导入分析和配乐回答，无需 API 密钥。' },
];
export function webAIProvider(id) {
  const provider = WEB_AI_PROVIDERS.find(item => item.id === id);
  if (!provider) throw new Error('请选择 DeepSeek、豆包、千问或 Kimi。');
  return provider;
}
export function isSecureWebURL(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; }
  catch { return false; }
}
export function isWebAIPage(id, value) {
  if (!isSecureWebURL(value)) return false;
  const url = new URL(value), provider = webAIProvider(id);
  const domain = provider.id === 'deepseek' ? 'deepseek.com' : provider.id === 'qwen' ? 'qianwen.com' : provider.id === 'kimi' ? 'kimi.com' : 'doubao.com';
  return url.hostname === domain || url.hostname.endsWith('.' + domain);
}
export function fitWebAIBounds(bounds, viewport, zoom = 1) {
  if (!bounds || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(bounds[key])) || !Array.isArray(viewport) || viewport.length !== 2 || !viewport.every(n => Number.isFinite(n) && n >= 0) || !Number.isFinite(zoom) || zoom <= 0) throw new Error('网页显示区域无效。');
  const x = Math.max(0, Math.min(viewport[0], Math.round(bounds.x * zoom)));
  const y = Math.max(0, Math.min(viewport[1], Math.round(bounds.y * zoom)));
  return { x, y, width: Math.max(0, Math.min(viewport[0] - x, Math.round((bounds.x + bounds.width) * zoom) - x)), height: Math.max(0, Math.min(viewport[1] - y, Math.round((bounds.y + bounds.height) * zoom) - y)) };
}
export function clipWebAISlot(rect, viewport, scroll = viewport, railWidth = 0) {
  const x = Math.max(0, rect.left + 2, scroll.left), y = Math.max(0, rect.top + 2, scroll.top);
  return { x, y, width: Math.max(0, Math.min(rect.right - 2, scroll.right, viewport.right - railWidth) - x), height: Math.max(0, Math.min(rect.bottom - 2, scroll.bottom, viewport.bottom) - y) };
}

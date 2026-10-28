export const DEEPSEEK_SCAN = { key: 'webai:deepseek::DeepSeek', model: 'DeepSeek', provider: { id: 'webai:deepseek', protocol: 'official-web', webId: 'deepseek' } };
export function isDeepSeekScan(connection) {
  return connection?.provider?.protocol === 'official-web' && connection.provider.webId === 'deepseek' && connection.model === 'DeepSeek';
}

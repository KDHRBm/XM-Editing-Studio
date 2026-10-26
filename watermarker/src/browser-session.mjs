export function desktopBridge(host = window) {
  try { return host.parent.blackObsidian?.openWatermarkBrowser ? host.parent.blackObsidian : null; } catch { return null; }
}

export async function loadBrowserSession({ hash = location.hash, fetcher = fetch } = {}) {
  const token = new URLSearchParams(hash.slice(1)).get('session');
  if (!token) return null;
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('浏览器任务链接无效，请从软件重新打开。');
  async function request(url, signal) {
    const response = await fetcher(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || '本机素材连接中断，请保持 XM剪辑台运行并重新打开任务。');
    }
    return response;
  }
  const info = await (await request('/session/info')).json();
  return { ...info, files: info.files.map(item => ({ ...item,
    stream: async signal => (await request(`/session/file/${item.id}`, signal)).body,
    readBytes: async signal => new Uint8Array(await (await request(`/session/file/${item.id}`, signal)).arrayBuffer()),
  })), watermarkBlob: info.watermark ? await (await request('/session/watermark')).blob() : null };
}

export async function hardwarePreference(options, Encoder = globalThis.VideoEncoder) {
  if (!Encoder?.isConfigSupported) return 'no-preference';
  try {
    const { supported } = await Encoder.isConfigSupported({ codec: options.videoCodec, width: options.width, height: options.height, bitrate: options.bitrate, framerate: 30, hardwareAcceleration: 'prefer-hardware' });
    return supported ? 'prefer-hardware' : 'no-preference';
  } catch { return 'no-preference'; }
}

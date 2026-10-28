import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

export function compareSemver(a, b) {
  const parse = v => String(v || '').trim().replace(/^[vV]/, '').split(/[.-]/).map(part => {
    const n = Number.parseInt(part, 10);
    return Number.isFinite(n) ? n : 0;
  });
  const pa = parse(a);
  const pb = parse(b);
  const len = Math.max(pa.length, pb.length, 3);
  for (let i = 0; i < len; i++) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

export function createAutoUpdater({
  currentVersion = '1.4.0',
  repo = 'KDHRBm/XM-Editing-Studio',
  sideBySide = false,
  downloadDirectory,
  fetcher = globalThis.fetch,
  spawnInstaller = (file, args) => {
    const child = spawn(file, args, { detached: true, stdio: 'ignore', windowsHide: false });
    child.unref();
  },
  onQuit = () => {},
  notify = () => {},
} = {}) {
  let state = {
    status: 'idle',
    currentVersion,
    latestVersion: currentVersion,
    hasUpdate: false,
    progress: 0,
    releaseUrl: `https://github.com/${repo}/releases`,
    downloadUrl: '',
    assetName: '',
    expectedSha256: '',
    installerPath: '',
    error: '',
    sideBySide,
  };
  let activeDownload = null;

  const update = patch => {
    state = { ...state, ...patch };
    notify({ ...state });
    return { ...state };
  };

  async function fetchAssetWithFallback(url, options = {}) {
    try {
      const primary = await fetcher(url, options);
      if (primary && primary.ok) return primary;
      if (fetcher !== globalThis.fetch) return primary;
    } catch (primaryErr) {
      if (fetcher !== globalThis.fetch) throw primaryErr;
    }
    const mirrors = [
      `https://ghfast.top/${url}`,
      `https://gh-proxy.com/${url}`,
    ];
    let lastError = null;
    for (const mirrorUrl of mirrors) {
      try {
        const res = await fetcher(mirrorUrl, options);
        if (res && res.ok) return res;
      } catch (err) {
        lastError = err;
      }
    }
    if (lastError) throw lastError;
    return await fetcher(url, options);
  }

  async function check() {
    if (state.status === 'checking' || state.status === 'downloading') return { ...state };
    update({ status: 'checking', error: '' });
    try {
      const response = await fetcher(`https://api.github.com/repos/${repo}/releases/latest`, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': `XM-Editing-Studio/${currentVersion}`,
        },
      });
      if (!response.ok) {
        if (response.status === 404) {
          return update({ status: 'up-to-date', hasUpdate: false });
        }
        throw new Error(`检查更新失败 (HTTP ${response.status})`);
      }
      const data = await response.json();
      const latestVersion = String(data.tag_name || data.name || currentVersion).trim().replace(/^[vV]/, '');
      const assets = Array.isArray(data.assets) ? data.assets : [];
      const setupAsset = assets.find(a => typeof a?.name === 'string' && /Setup\.exe$/i.test(a.name));
      const shaAsset = assets.find(a => typeof a?.name === 'string' && /^SHA256SUMS\.txt$/i.test(a.name));

      let expectedSha256 = '';
      if (shaAsset?.browser_download_url && setupAsset?.name) {
        try {
          const shaResp = await fetchAssetWithFallback(shaAsset.browser_download_url);
          if (shaResp.ok) {
            const text = await shaResp.text();
            for (const line of text.split(/\r?\n/)) {
              const match = line.trim().match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/);
              if (match && match[2].trim() === setupAsset.name) {
                expectedSha256 = match[1].toLowerCase();
                break;
              }
            }
          }
        } catch { /* optional checksum */ }
      }

      const hasUpdate = compareSemver(latestVersion, currentVersion) > 0 && Boolean(setupAsset?.browser_download_url);
      return update({
        status: hasUpdate ? 'available' : 'up-to-date',
        latestVersion,
        hasUpdate,
        releaseUrl: data.html_url || `https://github.com/${repo}/releases`,
        downloadUrl: setupAsset?.browser_download_url || '',
        assetName: setupAsset?.name || '',
        expectedSha256,
        error: '',
      });
    } catch (err) {
      return update({
        status: 'error',
        error: err?.message || '无法连接更新服务器',
      });
    }
  }

  async function download() {
    if (sideBySide) throw new Error('并存版本不能使用官方安装包自动更新。');
    if (state.status === 'ready' && state.installerPath) return { ...state };
    if (activeDownload) return activeDownload;
    if (!state.downloadUrl || !state.assetName) {
      await check();
      if (!state.downloadUrl || !state.assetName) {
        throw new Error(state.error || '当前没有可下载的更新安装包。');
      }
    }
    if (!state.expectedSha256) throw new Error('发布页缺少安装包 SHA-256 校验值，已取消更新。');

    activeDownload = (async () => {
      await mkdir(downloadDirectory, { recursive: true });
      const targetPath = path.join(downloadDirectory, state.assetName);
      const tempPath = `${targetPath}.part-${Date.now()}`;
      update({ status: 'downloading', progress: 0, error: '' });

      try {
        const response = await fetchAssetWithFallback(state.downloadUrl, {
          headers: { 'User-Agent': `XM-Editing-Studio/${currentVersion}` },
        });
        if (!response.ok || !response.body) {
          throw new Error(`下载更新失败 (HTTP ${response.status})`);
        }
        const total = Number(response.headers?.get?.('content-length') || 0);
        const hasher = createHash('sha256');
        const out = createWriteStream(tempPath);
        let received = 0;

        for await (const chunk of response.body) {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          hasher.update(buf);
          received += buf.length;
          if (!out.write(buf)) {
            await new Promise(resolve => out.once('drain', resolve));
          }
          if (total > 0) {
            const pct = Math.min(99, Math.floor((received / total) * 100));
            if (pct !== state.progress) update({ progress: pct });
          }
        }
        await new Promise((resolve, reject) => {
          out.end(err => (err ? reject(err) : resolve()));
        });

        const digest = hasher.digest('hex').toLowerCase();
        if (state.expectedSha256 && digest !== state.expectedSha256) {
          await rm(tempPath, { force: true }).catch(() => {});
          throw new Error('安装包 SHA-256 校验不一致，已取消更新。');
        }

        await rm(targetPath, { force: true }).catch(() => {});
        await rename(tempPath, targetPath);
        return update({
          status: 'ready',
          progress: 100,
          installerPath: targetPath,
          error: '',
        });
      } catch (err) {
        await rm(tempPath, { force: true }).catch(() => {});
        update({ status: 'error', error: err?.message || '下载安装包失败' });
        throw err;
      } finally {
        activeDownload = null;
      }
    })();

    return activeDownload;
  }

  async function install() {
    if (sideBySide) throw new Error('并存版本不能使用官方安装包自动更新。');
    if (state.status !== 'ready' || !state.installerPath) {
      await download();
    }
    if (!state.installerPath) throw new Error('更新安装包尚未就绪。');
    const isLiteUpdate = /Update\.exe$/i.test(state.installerPath);
    spawnInstaller(state.installerPath, isLiteUpdate ? ['/S'] : []);
    setTimeout(() => onQuit(), 150);
    return { ok: true, installerPath: state.installerPath };
  }

  return {
    snapshot: () => ({ ...state }),
    check,
    download,
    install,
  };
}

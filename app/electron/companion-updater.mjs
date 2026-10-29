import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile, rename, rm, cp, access } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Transform, Readable } from 'node:stream';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { compareSemver } from './auto-updater.mjs';
import { createCompanionRuntime } from './companion-runtime.mjs';

const REPO = 'MerZlin/dsh-pet-indesktop';
const ASSET = 'dsh-pet-standalone-webm-chat-portable.zip';
const sha = async file => { const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest('hex'); };
const exists = file => access(file).then(() => true, () => false);
async function atomicJson(file, data) { const temporary = file + '.tmp'; await writeFile(temporary, JSON.stringify(data, null, 2)); await rename(temporary, file); }

export function selectPetRelease(release) {
  const version = String(release?.tag_name || '').replace(/^v/, '');
  const asset = release?.assets?.find(item => item.name === ASSET);
  if (release?.prerelease || release?.draft || !/^\d+\.\d+\.\d+$/.test(version) || !asset) throw new Error('未找到适用的 Windows 桌宠更新包。');
  const url = `https://github.com/${REPO}/releases/download/v${version}/${ASSET}`;
  if (asset.browser_download_url !== url || !/^sha256:[a-f0-9]{64}$/i.test(asset.digest || '') || !(asset.size > 0 && asset.size < 2 * 1024 ** 3)) throw new Error('桌宠更新包缺少可信校验信息，暂不能安装。');
  return { version, url, size: asset.size, sha256: asset.digest.slice(7).toLowerCase() };
}

function prepareWithNative(executable, requestFile) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['--xm-prepare-update', requestFile], { cwd: path.dirname(executable), windowsHide: true, stdio: 'ignore', env: { ...process.env, XM_COMPANION_DATA: path.dirname(requestFile) } });
    const timer = setTimeout(() => { child.kill(); reject(new Error('桌宠更新准备超时，原版未被替换。')); }, 240000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', async code => {
      clearTimeout(timer);
      if (code !== 0) {
        const detail = await readFile(path.join(path.dirname(requestFile), 'companion-startup-error.txt'), 'utf8').catch(() => '');
        reject(new Error('桌宠适配失败：' + (detail.trim().split('\n').at(-1) || `退出码 ${code}`)));
      } else resolve();
    });
  });
}

export function createCompanionUpdater({ runtime, baseDirectory, dataDirectory, notify = () => {}, fetcher = fetch, prepare = prepareWithNative, makeProbe = createCompanionRuntime }) {
  const root = path.join(dataDirectory, 'companion-updates');
  const pointer = path.join(root, 'active.json'), journal = path.join(root, 'transaction.json');
  let release, busy = null, ready, downloadAbort, closing = false;
  let state = { status: 'idle', currentVersion: '', latestVersion: '', progress: 0, hasUpdate: false, error: '' };
  const emit = patch => { state = { ...state, ...patch }; notify({ ...state }); return { ...state }; };
  const allowedDirectory = directory => path.resolve(directory) === path.resolve(baseDirectory) || path.dirname(path.resolve(directory)) === path.resolve(root) && /^runtime-[\w.-]+$/.test(path.basename(directory));
  const manifest = directory => readFile(path.join(directory, 'xm-manifest.json'), 'utf8').then(JSON.parse);
  async function verify(directory) {
    if (!allowedDirectory(directory)) throw new Error('桌宠更新目录无效。');
    const data = await manifest(directory);
    for (const [file, hash] of [['dsh-pet-standalone-webm-chat.exe', data.executableSha256], ['_internal/xm_companion_bridge.py', data.bridgeSha256], ['_internal/xm_companion_prepare.py', data.prepareSha256]]) {
      if (!hash || await sha(path.join(directory, file)) !== hash) throw new Error('桌宠组件校验失败。');
    }
    return data;
  }
  async function restoreConfig(transaction) {
    const cfg = path.join(dataDirectory, 'desktop-pet');
    if (transaction.hadConfig) {
      // Retain the attempted migration for recovery, then restore the exact pre-update data.
      if (await exists(cfg)) await rename(cfg, path.join(root, `failed-profile-${randomUUID()}`));
      await cp(path.join(transaction.backup, 'desktop-pet'), cfg, { recursive: true });
    } else if (await exists(cfg)) await rename(cfg, path.join(root, `failed-profile-${randomUUID()}`));
  }
  async function initialize() {
    await mkdir(root, { recursive: true });
    if (await exists(journal)) {
      const tx = JSON.parse(await readFile(journal, 'utf8'));
      if (!allowedDirectory(tx.previous) || path.dirname(tx.backup) !== root || !path.basename(tx.backup).startsWith('backup-')) throw new Error('桌宠恢复记录无效。');
      await restoreConfig(tx); await atomicJson(pointer, { directory: tx.previous }); await rm(journal);
      emit({ error: '上次桌宠更新未完成，已恢复原组件和设置。' });
    }
    let selected = baseDirectory;
    try { const saved = JSON.parse(await readFile(pointer, 'utf8')); await verify(saved.directory); selected = saved.directory; }
    catch (error) { if (error.code !== 'ENOENT') emit({ error: '更新组件不可用，已使用随软件安装的桌宠。' }); }
    runtime.setDirectory(selected);
    const data = await manifest(selected);
    emit({ currentVersion: data.version });
  }
  const init = () => ready ||= initialize();
  async function exclusive(action) {
    if (busy) return busy;
    busy = (async () => { await init(); try { return await action(); } catch (error) { return emit({ status: 'error', error: error.message }); } })().finally(() => { busy = null; });
    return busy;
  }
  const check = () => exclusive(async () => {
    emit({ status: 'checking', error: '' });
    let response;
    try { response = await fetcher(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'XM-Editing-Studio-Pet' }, signal: AbortSignal.timeout(25000) }); } catch {}
    if ((!response || [403,429].includes(response.status)) && compareSemver('4.4.0', state.currentVersion) > 0) {
      release = { version: '4.4.0', url: `https://github.com/${REPO}/releases/download/v4.4.0/${ASSET}`, size: 349295546, sha256: '3f31b8c9454702d114e539324137347ad3a0c7c264d8071e29b250becdc59ea6' };
      return emit({ status: 'available', latestVersion: release.version, hasUpdate: true, size: release.size, error: '在线检查暂不可用，可安装已验证的 4.4.0 版本。' });
    }
    if (!response) throw new Error('无法连接 GitHub，请检查网络后重试。');
    if (!response.ok) throw new Error(response.status === 403 || response.status === 429 ? 'GitHub 暂时限制访问，请稍后重试。' : `检查桌宠更新失败（${response.status}）。`);
    release = selectPetRelease(await response.json());
    const hasUpdate = compareSemver(release.version, state.currentVersion) > 0;
    return emit({ status: hasUpdate ? 'available' : 'up-to-date', latestVersion: release.version, hasUpdate, size: release.size });
  });
  const update = () => exclusive(async () => {
    if (!release || compareSemver(release.version, state.currentVersion) <= 0) throw new Error('请先检查桌宠更新。');
    const previous = runtime.getDirectory(), wasRunning = runtime.isRunning(), wasVisible = runtime.isVisible();
    const candidate = path.join(root, `runtime-${release.version}-${randomUUID()}`);
    const archive = path.join(root, `download-${release.version}.zip`), partial = archive + '.part';
    let tx, probe;
    try {
      emit({ status: 'downloading', error: '', progress: 0 });
      if (!await exists(archive) || await sha(archive) !== release.sha256) {
        downloadAbort = new AbortController();
        const response = await fetcher(release.url, { signal: AbortSignal.any([downloadAbort.signal, AbortSignal.timeout(15 * 60000)]) });
        if (!response.ok || !response.body) throw new Error(`桌宠下载失败（${response.status}）。`);
        let received = 0;
        const meter = new Transform({ transform(chunk, _encoding, callback) {
          received += chunk.length;
          if (received > release.size) return callback(new Error('桌宠下载大小异常。'));
          const progress = Math.floor(received / release.size * 100);
          if (progress !== state.progress) emit({ progress });
          callback(null, chunk);
        } });
        await pipeline(Readable.fromWeb(response.body), meter, createWriteStream(partial));
        if (received !== release.size || await sha(partial) !== release.sha256) throw new Error('桌宠更新包校验失败，请重新下载。');
        await rename(partial, archive);
      }
      if (closing) throw new Error('软件正在退出，已取消桌宠更新。');
      emit({ status: 'preparing', progress: 100 });
      const request = path.join(root, `prepare-${randomUUID()}.json`);
      await atomicJson(request, { archive, destination: candidate, previous, version: release.version, sha256: release.sha256 });
      // Always use the adapter bundled with XM: newer host fixes cannot be lost
      // by invoking an older previously-downloaded runtime's prepare script.
      await prepare(path.join(baseDirectory, 'dsh-pet-standalone-webm-chat.exe'), request);
      await verify(candidate);
      if (closing) throw new Error('软件正在退出，已取消桌宠更新。');
      emit({ status: 'testing' });
      const probeData = path.join(root, `probe-${randomUUID()}`);
      const cfg = path.join(dataDirectory, 'desktop-pet');
      // Use a fresh probe profile so existing automations/chat jobs cannot run twice.
      probe = makeProbe({ directory: candidate, dataDirectory: probeData });
      const tested = await probe.start();
      if (!tested.ready || tested.version !== release.version) throw new Error('新版桌宠启动验证未通过。');
      await probe.run('visible', false); await probe.stop(); probe = null;
      if (closing) throw new Error('软件正在退出，已取消桌宠更新。');
      emit({ status: 'installing' });
      await runtime.stop();
      const backup = path.join(root, `backup-${randomUUID()}`);
      await mkdir(backup);
      const transaction = { previous, candidate, backup, hadConfig: await exists(cfg) };
      if (transaction.hadConfig) await cp(cfg, path.join(backup, 'desktop-pet'), { recursive: true });
      await atomicJson(journal, transaction);
      tx = transaction;
      runtime.setDirectory(candidate);
      await runtime.start(); await runtime.run('visible', wasVisible);
      if (!wasRunning) await runtime.stop();
      await atomicJson(pointer, { directory: candidate, previous });
      await rm(journal);
      return emit({ status: 'updated', currentVersion: release.version, hasUpdate: false, error: '' });
    } catch (error) {
      await probe?.dispose().catch(() => {});
      if (tx) {
        await runtime.stop(); await restoreConfig(tx); runtime.setDirectory(previous);
        await atomicJson(pointer, { directory: previous }); await rm(journal, { force: true });
        if (wasRunning) { await runtime.start(); await runtime.run('visible', wasVisible); }
      } else if (wasRunning && !runtime.isRunning()) { await runtime.start(); await runtime.run('visible', wasVisible); }
      throw error;
    } finally { downloadAbort = null; await rm(partial, { force: true }); }
  });
  return { init, check, update, snapshot: () => ({ ...state }), isBusy: () => !!busy, settle: () => { closing = true; downloadAbort?.abort(); return busy || Promise.resolve(); } };
}

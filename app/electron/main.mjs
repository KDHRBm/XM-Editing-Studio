import { app, BrowserWindow, WebContentsView, Tray, Menu, dialog, ipcMain, shell, nativeImage, clipboard } from "electron";
import { appendFileSync, mkdirSync } from "node:fs";
import { mkdir, readFile, writeFile, stat, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDesktopServer } from "../server/desktop-server.mjs";
import { exportScriptMaterials } from "./material-export.mjs";
import { saveMusicAudio } from './audio-save.mjs';
import { createMusicLibrary } from "./music-library.mjs";
import { APP_PORT, resolveUserDataDirectory } from './profile-config.mjs';
import { createPeriodKeeper } from './period-keeper.mjs';
import { createMusicDrag } from './music-drag.mjs';
import { createWatermarkHost } from './watermark-host.mjs';
import { createJianyingHost } from './jianying-host.mjs';
import { createJianyingWebScan } from './jianying-web-scan.mjs';
import { createQuickLaunch } from './quick-launch.mjs';
import { createWebAIHost } from './web-ai-host.mjs';
import { webAIScriptPrompt } from '../shared/web-ai-prompts.mjs';
import { createWebAnalysis } from './web-ai-analysis.mjs';
import { createAutoUpdater } from './auto-updater.mjs';
import { createCompanionDock } from './companion-dock.mjs';

const APP_HOST = "127.0.0.1";
app.setName('XM剪辑台');
app.setAppUserModelId('com.xiaoma.editing-studio');
app.setPath('userData', resolveUserDataDirectory(app.getPath('appData'), app.commandLine.getSwitchValue('user-data-dir')));
app.commandLine.removeSwitch('remote-debugging-port');
app.commandLine.removeSwitch('remote-debugging-pipe');
const hasSingleInstance = app.requestSingleInstanceLock();
const startupLogPath = path.join(app.getPath("userData"), "startup.log");
const preloadPath = fileURLToPath(new URL("./preload.cjs", import.meta.url));
const musicLibrary = createMusicLibrary({ settingsFile: path.join(app.getPath('userData'), 'music-library.json') });
const periodKeeper = createPeriodKeeper(process.resourcesPath, { clipboard });
const musicDrag = createMusicDrag({ registryFile: path.join(app.getPath('userData'), 'saved-music-files.json'), resolveLocalTrack: musicLibrary.resolve });
let systemTray = null;
let companionDock = null;
const watermarkHost = createWatermarkHost({
  appDirectory: app.getAppPath(),
  dataDirectory: path.join(app.getPath('userData'), 'watermark'),
  onStateChange: state => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('bos:watermark-state', state);
    }
    void companionDock?.broadcastState?.();
    if (systemTray && !systemTray.isDestroyed()) {
      if (state.running) {
        systemTray.setToolTip(`XM剪辑台 · 批量水印处理中 ${state.completedCount}/${state.totalCount} (${state.overallProgress}%)`);
      } else {
        systemTray.setToolTip('XM剪辑台 · 视频批量水印与剪映智能工作台');
      }
    }
  },
  onBatchComplete: () => {
    void companionDock?.handleAction?.('wm-finished-notice', '已经输出在原目录下啦 ✨');
  },
});
const webAI = createWebAIHost({ View: WebContentsView, getWindow: () => mainWindow, shell });
const webAnalysis = createWebAnalysis({ driver: webAI, copy: text => periodKeeper.copyPlain(text), notify: task => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('bos:web-analysis-task', task); } });
const webScan = createJianyingWebScan({ BrowserWindow });
const jianying = createJianyingHost({ appDirectory: app.getAppPath(), dataDirectory: path.join(app.getPath('userData'), 'jianying-ai'), minimize: () => mainWindow?.minimize(), webScan });
const autoUpdater = createAutoUpdater({
  currentVersion: app.getVersion() || '1.7.2',
  downloadDirectory: path.join(app.getPath('userData'), 'updates'),
  onQuit: () => app.quit(),
  notify: state => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('bos:updater-state', state); },
});
const quickLaunch = createQuickLaunch({ settingsFile: path.join(app.getPath('userData'), 'quick-launch.json'), shell,
  chooseDirectory: async () => { const result = await dialog.showOpenDialog(mainWindow, { title: '添加自定义文件夹', properties: ['openDirectory'] }); return result.canceled ? null : result.filePaths[0]; },
  chooseExecutable: async () => { const result = await dialog.showOpenDialog(mainWindow, { title: '选择剪映 JianyingPro.exe', properties: ['openFile'], filters: [{ name: '剪映启动程序', extensions: ['exe'] }] }); return result.canceled ? null : result.filePaths[0]; },
});

function validDirectory(value) {
  if (typeof value !== "string" || !value.trim()) throw Object.assign(new Error("本地文件夹路径不能为空。"), { status: 400 });
  return path.resolve(value.trim());
}

function validFileName(value, fallback) {
  const name = typeof value === "string" && value.trim() ? value.trim() : fallback;
  if (name.includes("\\") || name.includes("/") || name === "." || name === "..") throw Object.assign(new Error("文件名无效。"), { status: 400 });
  return name.slice(0, 160);
}

function validHttpUrl(value) {
  let url;
  try { url = new URL(String(value || "")); } catch { throw Object.assign(new Error("下载地址无效。"), { status: 400 }); }
  if (!["http:", "https:"].includes(url.protocol)) throw Object.assign(new Error("只支持 http 或 https 音频地址。"), { status: 400 });
  return url;
}

function registerLocalFileHandlers() {
  const fromMainWindow = event => {
    if (event.senderFrame !== mainWindow?.webContents.mainFrame || event.senderFrame.url !== `http://${APP_HOST}:${APP_PORT}/`) throw new Error('此功能仅允许从主工作空间操作。');
  };
  ipcMain.handle('bos:web-ai-layout', (event, input) => { fromMainWindow(event); return webAI.layout(input); });
  ipcMain.handle('bos:web-ai-action', (event, id, action) => { fromMainWindow(event); return webAI.action(id, action); });
  ipcMain.handle('bos:web-ai-copy-task', (event, draft, purpose) => { fromMainWindow(event); return periodKeeper.copyPlain(webAIScriptPrompt(draft, purpose)); });
  ipcMain.handle('bos:web-analysis-start', (event, request) => { fromMainWindow(event); return webAnalysis.run(request); });
  ipcMain.handle('bos:web-analysis-status', event => { fromMainWindow(event); return webAnalysis.snapshot(); });
  ipcMain.handle('bos:web-analysis-action', (event, id, action, value) => { fromMainWindow(event); return webAnalysis.action(id, action, value); });
  ipcMain.handle('bos:watermark:get-state', event => { fromMainWindow(event); return watermarkHost.getState(); });
  ipcMain.handle('bos:watermark:choose-videos', async event => {
    fromMainWindow(event);
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择要添加水印的视频文件（支持多选）',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '视频文件', extensions: ['mp4', 'mov', 'mkv', 'avi', 'm4v', 'webm'] }],
    });
    if (result.canceled || !result.filePaths.length) return watermarkHost.getState();
    return watermarkHost.addVideos(result.filePaths);
  });
  ipcMain.handle('bos:watermark:add-videos', (event, filePaths) => {
    fromMainWindow(event);
    return watermarkHost.addVideos(filePaths);
  });
  ipcMain.handle('bos:watermark:choose-image', async event => {
    fromMainWindow(event);
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择水印透明 PNG / 图标文件',
      properties: ['openFile'],
      filters: [{ name: '图片文件', extensions: ['png', 'webp', 'bmp', 'jpg', 'jpeg'] }],
    });
    if (result.canceled || !result.filePaths[0]) return watermarkHost.getState();
    return watermarkHost.updateSettings({ mode: 'image', watermarkImage: result.filePaths[0] });
  });
  ipcMain.handle('bos:watermark:choose-output-dir', async event => {
    fromMainWindow(event);
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择水印视频输出文件夹',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled) return watermarkHost.getState();
    return watermarkHost.updateSettings({ outputDir: result.filePaths[0] || '' });
  });
  ipcMain.handle('bos:watermark:update-settings', (event, patch) => {
    fromMainWindow(event);
    return watermarkHost.updateSettings(patch);
  });
  ipcMain.handle('bos:watermark:remove-job', (event, jobId) => {
    fromMainWindow(event);
    return watermarkHost.removeJob(jobId);
  });
  ipcMain.handle('bos:watermark:clear-jobs', (event, mode) => {
    fromMainWindow(event);
    return watermarkHost.clearJobs(mode);
  });
  ipcMain.handle('bos:watermark:retry-failed', event => {
    fromMainWindow(event);
    return watermarkHost.retryFailed();
  });
  ipcMain.handle('bos:watermark:start', event => {
    fromMainWindow(event);
    return watermarkHost.startBatch();
  });
  ipcMain.handle('bos:watermark:cancel', event => {
    fromMainWindow(event);
    return watermarkHost.cancelBatch();
  });
  ipcMain.handle('bos:watermark:open-path', async (event, targetPath) => {
    fromMainWindow(event);
    if (!targetPath || typeof targetPath !== 'string') return { ok: false };
    const resolved = path.resolve(targetPath);
    try {
      shell.showItemInFolder(resolved);
      return { ok: true };
    } catch {
      await shell.openPath(path.dirname(resolved));
      return { ok: true };
    }
  });
  ipcMain.handle('bos:prepare-music-drag', (event, input) => { fromMainWindow(event); return musicDrag.prepare(input); });
  ipcMain.on('bos:start-music-drag', (event, token) => {
    try {
      fromMainWindow(event);
      const file = musicDrag.fileForToken(token);
      const icon = nativeImage.createFromPath(path.join(app.getAppPath(), 'build', 'app-icon.ico')).resize({ width: 32, height: 32 });
      event.sender.startDrag({ file, icon });
    } catch (error) { event.sender.send('bos:music-drag-error', { token, message: error.message || '拖动失败，请重新准备。' }); }
  });
  ipcMain.handle('bos:period-status', event => { fromMainWindow(event); return periodKeeper.status(); });
  ipcMain.handle('bos:period-probe', event => { fromMainWindow(event); return periodKeeper.probe(); });
  ipcMain.handle('bos:period-enabled', (event, enabled, mode) => { fromMainWindow(event); return periodKeeper.setEnabled(enabled, mode); });
  ipcMain.handle('bos:period-copy', (event, text) => { fromMainWindow(event); return periodKeeper.copy(text); });
  ipcMain.handle('bos:jianying-action', (event, action, args, connection) => { fromMainWindow(event); return jianying.run(action, args, connection); });
  ipcMain.handle('bos:updater-status', event => { fromMainWindow(event); return autoUpdater.snapshot(); });
  ipcMain.handle('bos:updater-action', (event, action) => {
    fromMainWindow(event);
    if (!['check', 'download', 'install'].includes(action)) throw new Error('无效的更新操作。');
    return autoUpdater[action]();
  });
  ipcMain.handle('bos:titlebar-theme', (event, scheme) => {
    fromMainWindow(event);
    try {
      mainWindow?.setTitleBarOverlay?.({
        color: '#00000000',
        symbolColor: scheme === 'light' ? '#334155' : '#a1a8a5',
        height: 36,
      });
    } catch { /* ignore on unsupported platforms */ }
    return { ok: true };
  });
  ipcMain.handle('bos:quick-launch', (event, action, value) => {
    fromMainWindow(event);
    if (!['scan', 'addFolder', 'removeFolder', 'openFolder', 'select', 'browse', 'launch'].includes(action)) throw new Error('无效的快捷栏操作。');
    return quickLaunch[action](value);
  });
  ipcMain.handle('bos:companion-action', (_event, action, value) => {
    return companionDock?.handleAction?.(action, value);
  });
  ipcMain.handle('bos:jianying-files', async event => {
    fromMainWindow(event);
    const result = await dialog.showOpenDialog(mainWindow, { title: '选择要改名的文件', properties: ['openFile', 'multiSelections'], filters: [{ name: '视频、音频和字幕', extensions: ['mp4', 'mov', 'avi', 'mkv', 'mp3', 'wav', 'srt', 'ass'] }] });
    return result.canceled ? null : result.filePaths;
  });
  ipcMain.handle("bos:export-script-materials", async (_event, payload) => {
    const result = await exportScriptMaterials(payload, { resolveLocalTrack: musicLibrary.resolve });
    if (result.kind === 'audio') await musicDrag.remember(payload.job.primary.audioUrl, result.path).catch(() => {});
    return result;
  });
  ipcMain.handle('bos:music-library-list', () => musicLibrary.getCatalog());
  ipcMain.handle('bos:music-library-refresh', () => musicLibrary.refresh());
  ipcMain.handle('bos:music-library-disconnect', (_event, id) => musicLibrary.disconnect(id));
  ipcMain.handle('bos:music-library-connect', async () => {
    const result = await dialog.showOpenDialog({ title: '连接本地音乐文件夹', properties: ['openDirectory'] });
    return result.canceled ? musicLibrary.getCatalog() : musicLibrary.connect(result.filePaths[0]);
  });
  ipcMain.handle("bos:choose-directory", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
    return result.canceled ? "" : result.filePaths[0] || "";
  });
  ipcMain.handle("bos:write-cache", async (_event, payload = {}) => {
    const directory = validDirectory(payload.directory);
    const fileName = validFileName(payload.fileName, "music-cache.json");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, fileName), JSON.stringify(payload.data ?? null, null, 2), "utf8");
    return { ok: true, path: path.join(directory, fileName) };
  });
  ipcMain.handle("bos:read-cache", async (_event, payload = {}) => {
    const directory = validDirectory(payload.directory);
    const fileName = validFileName(payload.fileName, "music-cache.json");
    try { return { ok: true, data: JSON.parse(await readFile(path.join(directory, fileName), "utf8")) }; }
    catch (error) { if (error?.code === "ENOENT") return { ok: true, data: null }; throw error; }
  });
  ipcMain.handle("bos:download-audio", async (_event, payload = {}) => {
    const url = validHttpUrl(payload.url);
    const directory = validDirectory(payload.directory);
    const fileName = validFileName(payload.fileName, "music.mp3");
    const result = await saveMusicAudio({ url: url.href, directory, name: fileName.replace(/\.(mp3|wav|m4a|ogg|flac|aac|webm)$/i, '') });
    await musicDrag.remember(url.href, result.path).catch(() => {});
    return result;
  });
}

function logStartup(message) {
  try {
    mkdirSync(path.dirname(startupLogPath), { recursive: true });
    appendFileSync(startupLogPath, `${new Date().toISOString()} ${message}\n`, "utf8");
  } catch { /* startup diagnostics must never prevent app launch */ }
}

logStartup(`main entry; single instance=${hasSingleInstance}`);
process.on("uncaughtException", (error) => logStartup(`uncaught exception: ${error?.stack || error?.message || error}`));
process.on("unhandledRejection", (error) => logStartup(`unhandled rejection: ${error?.stack || error?.message || error}`));

let localServer;
let mainWindow;

if (!hasSingleInstance) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  const createMainWindow = async () => {
    if (mainWindow) {
      mainWindow.focus();
      return;
    }

    mainWindow = new BrowserWindow({
      width: 1440,
      height: 940,
      minWidth: 920,
      minHeight: 680,
      backgroundColor: "#090b0c",
      title: "XM剪辑台",
      icon: path.join(app.getAppPath(), "build", "app-icon.ico"),
      autoHideMenuBar: true,
      titleBarStyle: "hidden",
      titleBarOverlay: {
        color: "#00000000",
        symbolColor: "#a1a8a5",
        height: 36,
      },
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        devTools: false,
        preload: preloadPath,
      },
    });

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith("https://") || url.startsWith("http://")) void shell.openExternal(url);
      return { action: "deny" };
    });
    mainWindow.on('close', event => {
      webAI.layout({ visible: false });
      if (!toolsStopped && systemTray && !systemTray.isDestroyed()) {
        event.preventDefault();
        mainWindow.hide();
        void companionDock?.show?.(false);
      }
    });
    mainWindow.on('minimize', () => {
      void companionDock?.show?.(false);
    });
    mainWindow.webContents.on('render-process-gone', () => webAI.layout({ visible: false }));
    mainWindow.webContents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => { if (mainFrame && !inPlace) webAI.layout({ visible: false }); });
    mainWindow.on("closed", () => { mainWindow = null; });
    await mainWindow.loadURL(`http://${APP_HOST}:${APP_PORT}/`);
  };

  const focusAndNavigate = targetTab => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      if (targetTab) {
        mainWindow.webContents.send('bos:tray-navigate', targetTab);
      }
    }
  };

  const SUPPORTED_DROP_EXTS = new Set(['.mp4', '.mov', '.mkv', '.avi', '.m4v', '.webm', '.mp3', '.wav', '.srt', '.ass']);
  const VIDEO_ONLY_EXTS = new Set(['.mp4', '.mov', '.mkv', '.avi', '.m4v', '.webm']);

  async function expandDroppedPaths(rawPaths = []) {
    const out = [];
    const seen = new Set();
    async function walk(p) {
      if (!p || typeof p !== 'string') return;
      const resolved = path.resolve(p);
      if (seen.has(resolved)) return;
      try {
        const st = await stat(resolved);
        if (st.isDirectory()) {
          const entries = await readdir(resolved, { withFileTypes: true });
          for (const entry of entries) {
            await walk(path.join(resolved, entry.name));
          }
        } else if (st.isFile()) {
          const ext = path.extname(resolved).toLowerCase();
          if (SUPPORTED_DROP_EXTS.has(ext) && !path.basename(resolved).endsWith('样片.mp4')) {
            seen.add(resolved);
            out.push(resolved);
          }
        }
      } catch {
        /* ignore inaccessible path */
      }
    }
    for (const item of (Array.isArray(rawPaths) ? rawPaths : [])) {
      await walk(item);
    }
    return out;
  }

  const setupCompanionDock = () => {
    companionDock = createCompanionDock({
      preloadPath,
      iconPath: path.join(app.getAppPath(), "build", "app-icon.ico"),
      baseUrl: `http://${APP_HOST}:${APP_PORT}`,
      getJianyingState: () => jianying.run('status', {}),
      getWatermarkState: () => watermarkHost.getState(),
      getPeriodStatus: () => periodKeeper.status(),
      onAction: async (action, value, ctx) => {
        if (action === 'navigate') {
          focusAndNavigate(String(value || ''));
        } else if (action === 'wm-finished-notice') {
          ctx?.notifyOrb?.(String(value || '已经输出在原目录下啦 ✨'));
        } else if (action === 'drop-paths') {
          const expanded = await expandDroppedPaths(value);
          if (!expanded.length) throw new Error('未在拖放内容中找到支持的视频或字幕文件。');
          ctx?.setPendingDrop?.(expanded);
          return { droppedFilesCount: expanded.length };
        } else if (action === 'drop-choice') {
          const pending = ctx?.getPendingDrop?.() || [];
          ctx?.setPendingDrop?.([]);
          if (value === 'cancel' || !pending.length) return;
          if (value === 'rename') {
            ctx?.setRenameFiles?.(pending);
            await jianying.run('files', { files: pending });
            await jianying.run('preview', { folder: '', template: '短剧名称_第1集', ai: false }).catch(() => {});
            ctx?.setStage?.('rename', true);
            await ctx?.openPanel?.();
          } else if (value === 'watermark') {
            const videos = pending.filter(f => VIDEO_ONLY_EXTS.has(path.extname(f).toLowerCase()));
            if (!videos.length) throw new Error('拖入的文件中没有可加水印的视频文件。');
            ctx?.setStage?.('watermark', false);
            await watermarkHost.addVideos(videos, { sameDirectory: true });
            await watermarkHost.startBatch({ sameDirectory: true });
          }
        } else if (action === 'jy-wizard') {
          await jianying.run('wizard', value && typeof value === 'object' ? value : {});
        } else if (action === 'jy-scan') {
          const connection = value?.connection || jianying.lastConnection?.();
          if (!connection) throw new Error('请先在左侧「API 与主题」配置 Gemini 模型连接。');
          await jianying.run('scan', {}, connection);
        } else if (action === 'jy-export') {
          await jianying.run('export', { index: Number(value?.index) || 0 });
        } else if (action === 'jy-settings') {
          await jianying.run('settings', value || {});
        } else if (action === 'jy-select-tpl') {
          await jianying.run('select_template', { id: String(value?.id || '') });
        } else if (action === 'jy-rename-tpl') {
          await jianying.run('rename_template', { id: String(value?.id || ''), name: String(value?.name || '') });
        } else if (action === 'jy-paths') {
          await jianying.run('paths', value || {});
        } else if (action === 'jy-pick-path') {
          const key = value === 'subtitleOutput' ? 'subtitleOutput' : 'draftDir';
          const result = await dialog.showOpenDialog({
            title: key === 'draftDir' ? '选择剪映草稿根目录 (JianyingPro Drafts)' : '选择 SRT 字幕导出目录',
            properties: ['openDirectory', 'createDirectory'],
          });
          if (!result.canceled && result.filePaths[0]) {
            await jianying.run('paths', { [key]: result.filePaths[0] });
          }
        } else if (action === 'jy-extract') {
          await jianying.run('extract', {});
        } else if (action === 'jy-fonts') {
          await jianying.run('fonts', {});
        } else if (action === 'jy-unhide') {
          await jianying.run('unhide', {});
        } else if (action === 'jy-pick-rename-dir') {
          const result = await dialog.showOpenDialog({
            title: '选择要批量改名的文件夹（含子文件夹）',
            properties: ['openDirectory'],
          });
          if (!result.canceled && result.filePaths[0]) {
            const expanded = await expandDroppedPaths([result.filePaths[0]]);
            if (expanded.length) {
              ctx?.setRenameFiles?.(expanded);
              await jianying.run('files', { files: expanded });
              await jianying.run('preview', { folder: '', template: '短剧名称_第1集', ai: false }).catch(() => {});
            }
            return { renameFolder: result.filePaths[0] };
          }
        } else if (action === 'jy-pick-rename-files') {
          const result = await dialog.showOpenDialog({
            title: '选择要批量改名的文件',
            properties: ['openFile', 'multiSelections'],
            filters: [{ name: '视频、音频和字幕', extensions: ['mp4', 'mov', 'avi', 'mkv', 'mp3', 'wav', 'srt', 'ass'] }],
          });
          if (!result.canceled && result.filePaths.length) {
            ctx?.setRenameFiles?.(result.filePaths);
            await jianying.run('files', { files: result.filePaths });
            await jianying.run('preview', { folder: '', template: '短剧名称_第1集', ai: false }).catch(() => {});
          }
        } else if (action === 'jy-clear-rename-files') {
          ctx?.setRenameFiles?.([]);
          await jianying.run('files', { files: [] });
        } else if (action === 'jy-preview-rename') {
          const connection = value?.connection || jianying.lastConnection?.();
          await jianying.run('preview', {
            folder: String(value?.folder || ''),
            template: String(value?.template || '短剧名称_第1集'),
            ai: Boolean(value?.ai),
          }, connection);
        } else if (action === 'jy-execute-rename') {
          await jianying.run('rename', {});
          ctx?.notifyOrb?.('✅ 批量改名已完成！✨');
        } else if (action === 'jy-stop') {
          await jianying.run('stop', {});
        } else if (action === 'jy-modal') {
          await jianying.run('modal', { id: String(value?.id || ''), confirmed: Boolean(value?.confirmed) });
        } else if (action === 'wm-add') {
          const result = await dialog.showOpenDialog({
            title: '选择要添加水印的视频文件（支持多选）',
            properties: ['openFile', 'multiSelections'],
            filters: [{ name: '视频文件', extensions: ['mp4', 'mov', 'mkv', 'avi', 'm4v', 'webm'] }],
          });
          if (!result.canceled && result.filePaths.length) {
            await watermarkHost.addVideos(result.filePaths, { sameDirectory: true });
          }
        } else if (action === 'wm-start') {
          await watermarkHost.startBatch({ sameDirectory: true });
        } else if (action === 'wm-clear') {
          await watermarkHost.clearJobs('all');
        } else if (action === 'wm-cancel') {
          await watermarkHost.cancelBatch();
        } else if (action === 'wm-open') {
          if (typeof value === 'string' && value) shell.showItemInFolder(path.resolve(value));
        } else if (action === 'toggle-period') {
          const cur = await periodKeeper.status();
          await periodKeeper.setEnabled(!cur?.enabled, cur?.mode || 'compatible');
        } else if (action === 'launch-jy') {
          await quickLaunch.scan().catch(() => {});
          await quickLaunch.launch();
        } else if (action === 'panel-drag') {
          /* handled by Electron -webkit-app-region: drag or native host */
        } else {
          throw new Error('未知的悬浮窗操作。');
        }
      },
    });
  };

  const setupSystemTray = () => {
    try {
      const iconPath = path.join(app.getAppPath(), "build", "app-icon.ico");
      const trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
      systemTray = new Tray(trayIcon);
      systemTray.setToolTip("XM剪辑台 · 视频批量水印与剪映智能工作台");
      const menu = Menu.buildFromTemplate([
        { label: "打开 XM剪辑台", click: () => focusAndNavigate("") },
        { label: "召唤/隐藏 月薪喵（剪映插件）", click: () => void companionDock?.toggle?.() },
        { type: "separator" },
        { label: "批量水印中心（原生硬件加速）", click: () => focusAndNavigate("watermark") },
        { label: "剪映智能工作台", click: () => focusAndNavigate("jianying") },
        { label: "文案拆解与智能配乐", click: () => focusAndNavigate("script") },
        { label: "剪贴板句号守护", click: () => focusAndNavigate("period") },
        { type: "separator" },
        { label: "检查版本更新", click: () => { focusAndNavigate(""); void autoUpdater.check?.(); } },
        { label: "彻底退出 XM剪辑台", click: () => { toolsStopped = true; app.quit(); } },
      ]);
      systemTray.setContextMenu(menu);
      systemTray.on("click", () => focusAndNavigate(""));
      systemTray.on("double-click", () => focusAndNavigate(""));
    } catch {
      /* ignore tray errors in headless environments */
    }
  };

  app.whenReady().then(async () => {
    await musicLibrary.init();
    registerLocalFileHandlers();
    logStartup(`app ready; appPath=${app.getAppPath()}`);
    localServer = await createDesktopServer({
      clientDirectory: path.join(app.getAppPath(), "dist", "client"),
      host: APP_HOST,
      port: APP_PORT,
      musicLibrary,
    });
    logStartup(`local service listening on ${APP_HOST}:${APP_PORT}`);
    setupCompanionDock();
    await createMainWindow();
    await companionDock.show(false).catch(() => {});
    setupSystemTray();
    logStartup("main window loaded");
    setTimeout(() => {
      void jianying.warm?.();
      void periodKeeper.status?.().catch(() => {});
      void autoUpdater.check?.().catch(() => {});
    }, 1500);
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) void createMainWindow();
    });
  }).catch((error) => {
    logStartup(`launch error: ${error?.stack || error?.message || error}`);
    dialog.showErrorBox("XM剪辑台无法启动", `本机服务启动失败：${error?.message || "未知错误"}`);
    app.quit();
  });

  let toolsStopped = false;
  app.on("before-quit", event => {
    if (!toolsStopped) {
      event.preventDefault();
      toolsStopped = true;
      try { systemTray?.destroy(); } catch { /* ignore */ }
      try { companionDock?.dispose(); } catch { /* ignore */ }
      void Promise.allSettled([webAnalysis.dispose(), periodKeeper.dispose(), watermarkHost.dispose(), jianying.dispose(), webAI.dispose()]).finally(() => app.quit());
      return;
    }
    if (localServer?.listening) localServer.close();
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}

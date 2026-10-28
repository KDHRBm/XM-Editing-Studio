import { app, BrowserWindow, WebContentsView, dialog, ipcMain, shell, nativeImage, clipboard, screen, Notification } from "electron";
import { appendFileSync, mkdirSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDesktopServer } from "../server/desktop-server.mjs";
import { exportScriptMaterials } from "./material-export.mjs";
import { saveMusicAudio } from './audio-save.mjs';
import { createMusicLibrary } from "./music-library.mjs";
import { APP_PORT, resolveUserDataDirectory } from './profile-config.mjs';
import { createPeriodKeeper } from './period-keeper.mjs';
import { createMusicDrag } from './music-drag.mjs';
import { createWatermarkBrowser } from './watermark-browser.mjs';
import { createWatermarkHost } from './watermark-host.mjs';
import { createJianyingHost } from './jianying-host.mjs';
import { createJianyingWebScan } from './jianying-web-scan.mjs';
import { createScanProgress } from './jianying-scan-progress.mjs';
import { createQuickLaunch } from './quick-launch.mjs';
import { createWebAIHost } from './web-ai-host.mjs';
import { webAIScriptPrompt } from '../shared/web-ai-prompts.mjs';
import { createWebAnalysis } from './web-ai-analysis.mjs';
import { createAutoUpdater } from './auto-updater.mjs';
import { createCompanionDock } from './companion-dock.mjs';

const APP_HOST = "127.0.0.1";
const titlebarColors = {
  obsidian: ['#101410', '#edf3eb'], ios: ['#f8faff', '#1d2a3d'],
  aurora: ['#10152c', '#f0efff'], graphite: ['#17181b', '#f0f1f4'],
  ocean: ['#0b2538', '#e5f7ff'], burgundy: ['#1d1016', '#f7eaf0'],
  midnight: ['#0e1625', '#eaf0fc'], plum: ['#1c1522', '#f2ebfa'],
  pine: ['#111d18', '#e9f2ec'], matcha: ['#eaf0e0', '#293d2d'],
  sunset: ['#f9e8df', '#4c302c'],
};
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
const watermarkBrowser = createWatermarkBrowser({ clientDirectory: path.join(app.getAppPath(), 'dist', 'client') });
const watermarkHost = createWatermarkHost({
  appDirectory: app.getAppPath(),
  dataDirectory: path.join(app.getPath('userData'), 'watermark'),
  onStateChange: state => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('bos:watermark-state', state);
  },
});
const webAI = createWebAIHost({ View: WebContentsView, getWindow: () => mainWindow, shell });
const notifyWebTask = task => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('bos:web-analysis-task', task); };
const webAnalysis = createWebAnalysis({ driver: webAI, copy: text => periodKeeper.copyPlain(text), notify: notifyWebTask });
const scanWeb = createJianyingWebScan({ driver: webAI, copy: text => periodKeeper.copyPlain(text), isBusy: () => !!webAnalysis.snapshot(), notify: task => {
  notifyWebTask(task);
  // The native worker has already captured the image before this task exists.
  if (task && mainWindow && !mainWindow.isDestroyed() && mainWindow.isMinimized()) { mainWindow.restore(); mainWindow.show(); }
} });
let scanProgress;
const jianying = createJianyingHost({
  webScan: scanWeb,
  appDirectory: app.getAppPath(), dataDirectory: path.join(app.getPath('userData'), 'jianying-ai'),
  minimize: () => mainWindow?.minimize(),
  onScanProgress: value => scanProgress?.update(value),
  onExportProgress: value => scanProgress?.update(value),
  onRecordingProgress: value => scanProgress?.update(value),
  beforeScanCapture: id => {
    if (!scanProgress) throw new Error('扫描进度窗口尚未准备好。');
    return scanProgress.beforeCapture(id);
  },
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
  ipcMain.handle('bos:updater-status', event => { fromMainWindow(event); return autoUpdater.snapshot(); });
  ipcMain.handle('bos:titlebar-theme', (event, theme) => {
    fromMainWindow(event);
    const colors = titlebarColors[theme];
    if (!colors) throw new Error('无效的界面主题。');
    mainWindow.setTitleBarOverlay({ color: colors[0], symbolColor: colors[1], height: 36 });
  });
  ipcMain.handle('bos:updater-action', (event, action) => {
    fromMainWindow(event);
    if (!['check', 'download', 'install'].includes(action)) throw new Error('无效的更新操作。');
    return autoUpdater[action]();
  });
  ipcMain.handle('bos:companion-action', (event, action, value) => {
    if (event.sender !== mainWindow?.webContents && !companionDock?.isSender(event.sender)) throw new Error('无效的桌宠窗口。');
    if (!companionDock) throw new Error('桌宠尚未准备好。');
    return companionDock.handleAction(action, value);
  });
  ipcMain.handle('bos:web-ai-layout', (event, input) => { fromMainWindow(event); return webAI.layout(input); });
  ipcMain.handle('bos:web-ai-action', (event, id, action) => { fromMainWindow(event); return webAI.action(id, action); });
  ipcMain.handle('bos:web-ai-copy-task', (event, draft, purpose) => { fromMainWindow(event); return periodKeeper.copyPlain(webAIScriptPrompt(draft, purpose)); });
  ipcMain.handle('bos:web-analysis-start', (event, request) => { fromMainWindow(event); if (scanWeb.snapshot()) throw new Error('正在识别草稿截图，请先完成或中断扫描。'); return webAnalysis.run(request); });
  ipcMain.handle('bos:web-analysis-status', event => { fromMainWindow(event); return scanWeb.snapshot() || webAnalysis.snapshot(); });
  ipcMain.handle('bos:web-analysis-action', (event, id, action, value) => {
    fromMainWindow(event);
    if (scanWeb.snapshot()?.id === id) return action === 'cancel' ? jianying.run('stop') : scanWeb.action(id, action, value);
    return webAnalysis.action(id, action, value);
  });
  ipcMain.handle('bos:watermark-browsers', event => { fromMainWindow(event); return watermarkBrowser.list(); });
  ipcMain.handle('bos:open-watermark-browser', (event, input) => { fromMainWindow(event); return watermarkBrowser.open(input); });
  ipcMain.handle('bos:watermark:get-state', event => { fromMainWindow(event); return watermarkHost.getState(); });
  ipcMain.handle('bos:watermark:choose-videos', async event => {
    fromMainWindow(event);
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择视频文件', properties: ['openFile', 'multiSelections'],
      filters: [{ name: '视频', extensions: ['mp4', 'mov', 'mkv', 'avi', 'm4v', 'webm'] }],
    });
    return result.canceled ? watermarkHost.getState() : watermarkHost.addVideos(result.filePaths);
  });
  ipcMain.handle('bos:watermark:add-videos', (event, filePaths) => { fromMainWindow(event); return watermarkHost.addVideos(filePaths); });
  ipcMain.handle('bos:watermark:choose-image', async event => {
    fromMainWindow(event);
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择水印图片', properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'webp', 'bmp', 'jpg', 'jpeg'] }],
    });
    return result.canceled ? watermarkHost.getState() : watermarkHost.updateSettings({ mode: 'image', watermarkImage: result.filePaths[0] });
  });
  ipcMain.handle('bos:watermark:choose-output-dir', async event => {
    fromMainWindow(event);
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择水印视频输出文件夹', properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? watermarkHost.getState() : watermarkHost.updateSettings({ outputDir: result.filePaths[0] });
  });
  ipcMain.handle('bos:watermark:update-settings', (event, patch) => { fromMainWindow(event); return watermarkHost.updateSettings(patch); });
  ipcMain.handle('bos:watermark:remove-job', (event, id) => { fromMainWindow(event); return watermarkHost.removeJob(id); });
  ipcMain.handle('bos:watermark:clear-jobs', (event, mode) => { fromMainWindow(event); return watermarkHost.clearJobs(mode); });
  ipcMain.handle('bos:watermark:retry-failed', event => { fromMainWindow(event); return watermarkHost.retryFailed(); });
  ipcMain.handle('bos:watermark:start', event => { fromMainWindow(event); return watermarkHost.startBatch(); });
  ipcMain.handle('bos:watermark:cancel', event => { fromMainWindow(event); return watermarkHost.cancelBatch(); });
  ipcMain.handle('bos:watermark:open-job', async (event, id) => {
    fromMainWindow(event);
    const job = (await watermarkHost.getState()).jobs.find(item => item.id === id && item.status === 'done');
    if (!job) throw new Error('找不到已完成的水印任务。');
    shell.showItemInFolder(job.outputPath);
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
  ipcMain.handle('bos:period-batch-enabled', (event, enabled) => { fromMainWindow(event); return periodKeeper.setBatchEnabled(enabled); });
  ipcMain.handle('bos:period-copy', (event, text, options) => { fromMainWindow(event); return periodKeeper.copy(text, options); });
  ipcMain.handle('bos:jianying-action', (event, action, args, connection) => { fromMainWindow(event); return jianying.run(action, args, connection); });
  ipcMain.handle('bos:quick-launch', (event, action, value) => {
    fromMainWindow(event);
    if (!['scan', 'addFolder', 'removeFolder', 'openFolder', 'select', 'browse', 'launch'].includes(action)) throw new Error('无效的快捷栏操作。');
    return quickLaunch[action](value);
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
let autoUpdater;
let companionDock;

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
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#17181b', symbolColor: '#f0f1f4', height: 36 },
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
    mainWindow.on('close', () => webAI.layout({ visible: false }));
    mainWindow.webContents.on('render-process-gone', () => webAI.layout({ visible: false }));
    mainWindow.webContents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => { if (mainFrame && !inPlace) webAI.layout({ visible: false }); });
    mainWindow.on("closed", () => { mainWindow = null; scanProgress?.dispose(); scanProgress = null; });
    await mainWindow.loadURL(`http://${APP_HOST}:${APP_PORT}/`);
  };

  app.whenReady().then(async () => {
    autoUpdater = createAutoUpdater({ currentVersion: app.getVersion(), downloadDirectory: path.join(app.getPath('userData'), 'updates'), onQuit: () => app.quit(), notify: state => mainWindow?.webContents.send('bos:updater-state', state) });
    await musicLibrary.init();
    registerLocalFileHandlers();
    scanProgress = createScanProgress({ Window: BrowserWindow, screen, ipcMain, Notification,
      appDirectory: app.getAppPath(), getMainWindow: () => mainWindow, cancelScan: () => jianying.run('stop') });
    logStartup(`app ready; appPath=${app.getAppPath()}`);
    localServer = await createDesktopServer({
      clientDirectory: path.join(app.getAppPath(), "dist", "client"),
      host: APP_HOST,
      port: APP_PORT,
      musicLibrary,
    });
    logStartup(`local service listening on ${APP_HOST}:${APP_PORT}`);
    companionDock = createCompanionDock({
      preloadPath, baseUrl: `http://${APP_HOST}:${APP_PORT}`,
      settingsFile: path.join(app.getPath('userData'), 'companion-settings.json'),
      getJianyingState: () => jianying.run('status'),
      getWatermarkState: () => watermarkHost.getState(),
      getPeriodStatus: () => periodKeeper.status(),
      onAction: async (action, value) => {
        if (action === 'navigate') {
          if (mainWindow?.isMinimized()) mainWindow.restore();
          mainWindow?.show(); mainWindow?.focus();
          if (value) mainWindow?.webContents.send('bos:tray-navigate', value);
        } else if (action === 'jy-scan') {
          const connection = jianying.lastConnection();
          if (!connection) throw new Error('请先在剪映自动化页面选择模型并扫描一次。');
          await jianying.run('scan', {}, connection);
        } else if (action === 'jy-export') await jianying.run('export', { index: 0 });
        else if (action === 'jy-extract') await jianying.run('extract');
        else if (action === 'jy-stop') await jianying.run('stop');
        else if (action === 'jy-modal') await jianying.run('modal', value);
        else if (action === 'launch-jy') { await quickLaunch.scan(); await quickLaunch.launch(); }
        else if (action === 'wm-add') {
          const result = await dialog.showOpenDialog({ title: '添加水印视频', properties: ['openFile', 'multiSelections'], filters: [{ name: '视频', extensions: ['mp4', 'mov', 'mkv', 'avi', 'm4v', 'webm'] }] });
          if (!result.canceled) await watermarkHost.addVideos(result.filePaths);
        } else if (action === 'wm-start') await watermarkHost.startBatch();
        else if (action === 'wm-cancel') await watermarkHost.cancelBatch();
        else if (action === 'wm-open') {
          const state = await watermarkHost.getState();
          const job = state.jobs?.find(item => item.status === 'done' && item.outputPath === value);
          if (!job) throw new Error('找不到已完成的水印视频。');
          const error = await shell.showItemInFolder(job.outputPath);
          if (error) throw new Error(error);
        }
        else if (action === 'toggle-period') {
          const current = await periodKeeper.status();
          await periodKeeper.setEnabled(!current.enabled, current.mode || 'compatible');
        } else throw new Error('未知的桌宠操作。');
      },
    });
    await createMainWindow();
    logStartup("main window loaded");
    setTimeout(() => { void autoUpdater.check(); }, 1800);
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
      scanProgress?.dispose(); scanProgress = null;
      companionDock?.dispose();
      void Promise.allSettled([webAnalysis.dispose(), periodKeeper.dispose(), watermarkBrowser.dispose(), watermarkHost.dispose(), jianying.dispose(), webAI.dispose()]).finally(() => app.quit());
      return;
    }
    if (localServer?.listening) localServer.close();
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}

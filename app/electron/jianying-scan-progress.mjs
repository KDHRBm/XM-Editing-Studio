import path from 'node:path';
import { pathToFileURL } from 'node:url';

const terminal = state => ['complete', 'error', 'cancelled'].includes(state?.stage);
const passiveTask = state => ['export', 'recording'].includes(state?.operation) && !terminal(state);
export function scanCardBounds(area, avoid = [], desiredHeight = 236) {
  const width = Math.min(366, area.width - 24), height = Math.min(desiredHeight, area.height - 24);
  const preferred = { width, height, x: area.x + area.width - width - 12, y: area.y + area.height - height - 12 };
  // Prefer bottom right; move up/left if the card would cover a click or recognition area.
  for (let x = preferred.x; x >= area.x + 12; x -= width + 12) {
    for (let y = preferred.y; y >= area.y + 12; y -= 48) {
      if (!avoid.some(point => point.x >= x - 120 && point.x <= x + width + 120 && point.y >= y - 80 && point.y <= y + height + 80)) return { width, height, x, y };
    }
  }
  return preferred;
}

export function createScanProgress({ Window, screen, ipcMain, Notification, appDirectory, getMainWindow, cancelScan, delay = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const page = path.join(appDirectory, 'dist', 'client', 'jianying-scan', 'index.html');
  const pageUrl = pathToFileURL(page).href;
  let window, state, ready = false, suppressed = false, dismissed = false, disposed = false, notification;
  const visible = () => {
    if (ready && window && !window.isDestroyed() && !suppressed && !dismissed) window.showInactive();
  };
  const place = () => {
    if (!window || window.isDestroyed()) return;
    const main = getMainWindow();
    const display = main && !main.isDestroyed() ? screen.getDisplayMatching(main.getBounds()) : screen.getPrimaryDisplay();
    const avoid = state?.operation === 'export' ? (state.avoid || []).map(([x, y]) => screen.screenToDipPoint({ x, y })) : [];
    window.setBounds(scanCardBounds(display.workArea, avoid, state?.operation === 'recording' ? 280 : state?.operation === 'export' ? 260 : 236));
  };
  const restoreMain = () => {
    if (passiveTask(state)) return;
    const main = getMainWindow();
    if (!main || main.isDestroyed()) return;
    dismissed = true; window?.hide();
    if (main.isMinimized()) main.restore();
    main.show(); main.focus();
    notification?.close();
  };
  const trusted = event => {
    if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== pageUrl) throw new Error('无效的扫描进度窗口。');
  };
  ipcMain.handle('bos:scan-card-state', event => { trusted(event); return state; });
  ipcMain.handle('bos:scan-card-action', async (event, action) => {
    trusted(event);
    if (action === 'dismiss') { dismissed = true; window.hide(); return; }
    if (action === 'open' && state?.stage !== 'preparing' && !passiveTask(state)) { restoreMain(); return; }
    if (action === 'stop' && state && !terminal(state)) { await cancelScan(); return; }
    throw new Error('当前扫描状态不支持此操作。');
  });
  const ensureWindow = () => {
    if (window && !window.isDestroyed()) return;
    ready = false;
    window = new Window({ width: 366, height: 236, frame: false, transparent: true, focusable: false, resizable: false, maximizable: false, minimizable: false, alwaysOnTop: true, skipTaskbar: true, show: false, title: 'XM剪辑台 · 任务进度', autoHideMenuBar: true,
      webPreferences: { preload: path.join(appDirectory, 'electron', 'jianying-scan-preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false } });
    const created = window;
    created.setContentProtection(true);
    created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    created.webContents.on('will-navigate', event => event.preventDefault());
    created.once('ready-to-show', () => { if (window !== created || disposed) return; ready = true; place(); created.webContents.send('bos:scan-card-progress', state); visible(); });
    created.on('closed', () => { if (window === created) { window = null; ready = false; } });
    place();
    void created.loadFile(page).catch(() => { if (!created.isDestroyed()) created.destroy(); });
  };
  const displayChanged = () => place();
  screen.on('display-metrics-changed', displayChanged);
  screen.on('display-removed', displayChanged);
  return {
    update(value) {
      if (disposed) return;
      const fresh = value.id !== state?.id;
      if (fresh) { dismissed = false; notification?.close(); }
      const wasTerminal = !fresh && terminal(state);
      state = { ...value, startedAt: fresh ? Date.now() : state.startedAt, ...(terminal(value) ? { finishedAt: Date.now() } : {}) };
      suppressed = false;
      if (terminal(state)) dismissed = false;
      ensureWindow();
      place();
      window.setIgnoreMouseEvents(passiveTask(state), { forward: true });
      if (ready) window.webContents.send('bos:scan-card-progress', state);
      visible();
      if (terminal(state) && !wasTerminal && (state.stage !== 'cancelled' || ['export', 'recording'].includes(state.operation)) && Notification.isSupported()) {
        try {
          const title = state.operation === 'recording' ? ({ complete: '坐标录制完成', error: '录制失败', cancelled: '录制已结束' })[state.stage] : state.operation === 'export' ? state.stage === 'complete' ? state.mode === 'return_home' ? '导出任务已提交' : '导出完成' : state.stage === 'cancelled' ? '导出运行已结束' : '导出已停止' : state.stage === 'complete' ? '扫描完成' : '扫描失败';
          notification = new Notification({ title: `XM剪辑台 · ${title}`, body: ['export', 'recording'].includes(state.operation) ? state.message : state.stage === 'complete' ? `${state.message}。点击查看结果。` : '请查看右下角进度卡，返回工作台后重试。', silent: false });
          notification.on('click', restoreMain); notification.show();
        } catch { /* The persistent card remains available if Windows notifications are disabled. */ }
      }
    },
    async beforeCapture(id) {
      if (disposed || !state || state.id !== id || terminal(state)) throw new Error('扫描已结束。');
      suppressed = true;
      window?.hide();
      // Allow the compositor to remove the overlay before the worker captures it.
      await delay(150);
    },
    dispose() {
      disposed = true; notification?.close();
      ipcMain.removeHandler('bos:scan-card-state'); ipcMain.removeHandler('bos:scan-card-action');
      screen.removeListener('display-metrics-changed', displayChanged); screen.removeListener('display-removed', displayChanged);
      if (window && !window.isDestroyed()) window.destroy();
    },
  };
}

import { webAIProvider, isSecureWebURL, isWebAIPage, fitWebAIBounds } from '../shared/web-ai.mjs';
import { webAIPageScript } from './web-ai-dom.mjs';

// Remote pages run as top-level sandboxed contents, without the desktop preload bridge.
export function createWebAIHost({ View, getWindow, shell }) {
  const entries = new Map(), popups = new Set();
  let attached = null, disposed = false;
  const detach = () => {
    const previous = attached, win = getWindow();
    attached = null;
    if (previous && win && !win.isDestroyed()) win.contentView.removeChildView(previous.view);
  };
  function restrict(contents, partition) {
    contents.setWindowOpenHandler(({ url }) => isSecureWebURL(url) ? {
      action: 'allow', overrideBrowserWindowOptions: { width: 960, height: 740, autoHideMenuBar: true, parent: getWindow(), webPreferences: { partition, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, devTools: false, preload: undefined } },
    } : { action: 'deny' });
    contents.on('will-navigate', (event, url) => { if (!isSecureWebURL(url)) event.preventDefault(); });
    contents.on('will-redirect', (event, url) => { if (!isSecureWebURL(url)) event.preventDefault(); });
    contents.on('will-attach-webview', event => event.preventDefault());
    contents.on('did-create-window', popup => {
      popups.add(popup); popup.on('closed', () => popups.delete(popup));
      restrict(popup.webContents, partition);
    });
  }
  function entry(id) {
    if (disposed) throw new Error('网页窗口已关闭。');
    const provider = webAIProvider(id);
    if (!entries.has(id)) {
      const partition = `persist:xm-official-ai-${id}`;
      const view = new View({ webPreferences: { partition, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, devTools: false, backgroundThrottling: true } });
      const value = { view, provider, loading: true, error: '', url: provider.url };
      entries.set(id, value);
      restrict(view.webContents, partition);
      // Keep web account sessions separate from the main app's keys, history and local-file APIs.
      view.webContents.session.setPermissionRequestHandler((_contents, permission, callback) => callback(permission === 'clipboard-sanitized-write'));
      view.webContents.session.setPermissionCheckHandler((_contents, permission) => permission === 'clipboard-sanitized-write');
      view.webContents.on('did-start-loading', () => { value.loading = true; value.error = ''; });
      view.webContents.on('did-stop-loading', () => { value.loading = false; });
      view.webContents.on('did-navigate', (_event, url) => { value.url = url; });
      view.webContents.on('did-navigate-in-page', (_event, url, main) => { if (main) value.url = url; });
      view.webContents.on('did-fail-load', (_event, code, description, _url, main) => { if (main && code !== -3) { value.loading = false; value.error = `网页加载失败：${description}。可刷新，或在系统浏览器中打开。`; } });
      view.webContents.on('render-process-gone', () => { value.loading = false; value.error = '网页进程已退出，请刷新重试。'; });
      void view.webContents.loadURL(provider.url).catch(error => { value.loading = false; value.error = `网页暂时无法打开：${error.message}`; });
    }
    return entries.get(id);
  }
  const snapshot = value => ({ provider: value.provider.id, loading: value.loading, error: value.error, official: isWebAIPage(value.provider.id, value.url), url: value.url });
  return {
    visible(id) { return !!attached && attached.provider.id === id; },
    async run(id, input) {
      const value = entry(id), contents = value.view.webContents;
      if (attached !== value || new URL(contents.getURL()).hostname !== value.provider.host) throw new Error('请在内嵌官方页面完成登录。');
      const result = await contents.executeJavaScript(webAIPageScript({ ...input, host: value.provider.host }), true);
      if (input.command === 'send' && result.state === 'enter') {
        contents.focus();
        contents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
        contents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
        return { state: 'sent' };
      }
      return result;
    },
    layout(input = {}) {
      if (!input.visible) { detach(); return null; }
      const win = getWindow();
      if (!win || win.isDestroyed()) throw new Error('主工作台已关闭。');
      webAIProvider(input.provider);
      const bounds = fitWebAIBounds(input.bounds, win.getContentSize(), win.webContents.getZoomFactor());
      if (bounds.width < 100 || bounds.height < 80) { detach(); return null; }
      const value = entry(input.provider);
      if (attached !== value) { detach(); win.contentView.addChildView(value.view); attached = value; }
      value.view.setBounds(bounds);
      return snapshot(value);
    },
    action(id, action) {
      if (disposed) throw new Error('网页窗口已关闭。');
      const provider = webAIProvider(id);
      if (action === 'external') return shell.openExternal(provider.url).then(() => ({ provider: id, external: true }));
      if (!['home', 'reload', 'status', 'page-status', 'login'].includes(action)) throw new Error('未知网页操作。');
      const value = entry(id);
      if (action === 'page-status' || action === 'login') {
        if (attached !== value || !isWebAIPage(id, value.view.webContents.getURL())) return snapshot(value);
        return value.view.webContents.executeJavaScript(webAIPageScript({ command: action === 'login' ? 'login' : 'probe', host: value.provider.host }), action === 'login').then(result => ({ ...snapshot(value), access: result.state, pageNotice: result.message })).catch(() => snapshot(value));
      }
      if (action === 'reload') value.view.webContents.reload();
      if (action === 'home') void value.view.webContents.loadURL(provider.url).catch(error => { value.error = error.message; });
      return snapshot(value);
    },
    dispose() {
      disposed = true; detach();
      for (const popup of popups) if (!popup.isDestroyed()) popup.destroy();
      for (const value of entries.values()) if (!value.view.webContents.isDestroyed()) value.view.webContents.close();
      entries.clear(); popups.clear();
    },
  };
}

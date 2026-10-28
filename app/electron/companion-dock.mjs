import { BrowserWindow, screen } from 'electron';
import { createCompanionSettingsStore, DEFAULT_COMPANION_SETTINGS } from './companion-settings.mjs';

const ORB = { width: 140, height: 146 };
const PANEL = { width: 330, height: 472 };
export function createCompanionDock({ preloadPath, baseUrl, settingsFile, getJianyingState, getWatermarkState, getPeriodStatus, onAction }) {
  let orb, panel, visible = false, panelOpen = false, autoDock = true, timer, moveTimer, lastRoam = Date.now(), reactionId = 0;
  let settings = { ...DEFAULT_COMPANION_SETTINGS };
  const settingsStore = createCompanionSettingsStore(settingsFile);
  async function loadSettings() {
    settings = await settingsStore.load();
  }
  const alive = window => window && !window.isDestroyed();
  const area = () => screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  function stopMotion() { if (moveTimer) clearInterval(moveTimer); moveTimer = null; }
  function moveTo(targetX, targetY, duration = 360) {
    if (!alive(orb)) return;
    stopMotion();
    const [startX, startY] = orb.getPosition();
    const start = Date.now();
    moveTimer = setInterval(() => {
      if (!alive(orb)) { stopMotion(); return; }
      const progress = Math.min(1, (Date.now() - start) / duration);
      const eased = 1 - (1 - progress) ** 3;
      orb.setPosition(Math.round(startX + (targetX - startX) * eased), Math.round(startY + (targetY - startY) * eased));
      if (progress >= 1) stopMotion();
    }, 24);
  }
  const options = { frame: false, resizable: false, skipTaskbar: true, alwaysOnTop: true,
    webPreferences: { preload: preloadPath, contextIsolation: true, sandbox: true, nodeIntegration: false, devTools: false } };

  function placePanel() {
    if (!alive(orb) || !alive(panel)) return;
    const [ox, oy] = orb.getPosition();
    const bounds = screen.getDisplayNearestPoint({ x: ox, y: oy }).workArea;
    const x = Math.max(bounds.x + 8, Math.min(ox - PANEL.width - 8, bounds.x + bounds.width - PANEL.width - 8));
    const y = Math.max(bounds.y + 8, Math.min(oy, bounds.y + bounds.height - PANEL.height - 8));
    panel.setBounds({ x, y, ...PANEL });
  }

  async function ensureWindows() {
    await loadSettings();
    if (!alive(orb)) {
      const bounds = area();
      orb = new BrowserWindow({ ...options, ...ORB, x: bounds.x + bounds.width - ORB.width - 24, y: bounds.y + bounds.height - ORB.height - 24, transparent: true, hasShadow: false });
      orb.setAlwaysOnTop(true, 'floating');
      orb.on('move', placePanel);
      orb.on('closed', () => { orb = null; visible = false; });
      await orb.loadURL(`${baseUrl}/companion-orb.html`);
    }
    if (!alive(panel)) {
      panel = new BrowserWindow({ ...options, ...PANEL, show: false, backgroundColor: '#191a1c', roundedCorners: true });
      panel.setAlwaysOnTop(true, 'floating');
      panel.on('closed', () => { panel = null; panelOpen = false; });
      await panel.loadURL(`${baseUrl}/companion-panel.html`);
    }
    placePanel();
  }

  async function snapshot() {
    await loadSettings();
    const [jy, wm, period] = await Promise.all([
      getJianyingState().catch(() => null), getWatermarkState().catch(() => null), getPeriodStatus().catch(() => null),
    ]);
    return { visible, panelOpen, autoDock, settings, reactionId,
      jianying: { ready: Boolean(jy?.ready), busy: Boolean(jy?.busy || jy?.exporting || jy?.recording), status: jy?.status || '引擎准备中', queueCount: jy?.queue?.length || 0, modal: jy?.modal || null, lastLog: jy?.logs?.at(-1) || '' },
      jianyingWindow: jy?.jianyingWindow || null,
      watermark: { running: Boolean(wm?.running), progress: wm?.overallProgress || 0,
        completed: wm?.completedCount || 0, jobs: wm?.jobs || [] },
      periodEnabled: Boolean(period?.enabled) };
  }

  async function broadcast() {
    const state = await snapshot();
    for (const window of [orb, panel]) if (alive(window)) window.webContents.send('bos:companion-state', state);
    return state;
  }

  async function tick() {
    if (!visible || !alive(orb)) return;
    const state = await broadcast();
    const window = state.jianyingWindow;
    if (autoDock && window?.found && !window.minimized && window.width > 300) {
      const target = { x: Math.round(window.x + window.width - ORB.width - 14), y: Math.round(window.y + 38) };
      const [x, y] = orb.getPosition();
      if (Math.abs(x - target.x) > 4 || Math.abs(y - target.y) > 4) moveTo(target.x, target.y, 280);
    } else if (settings.roam && settings.motion && !panelOpen && !state.jianying.busy && Date.now() - lastRoam >= settings.idleInterval * 1000) {
      lastRoam = Date.now();
      const [x, y] = orb.getPosition();
      const bounds = screen.getDisplayNearestPoint({ x, y }).workArea;
      const nextX = Math.max(bounds.x, Math.min(bounds.x + bounds.width - ORB.width, x + Math.round((Math.random() - 0.5) * 90)));
      const nextY = Math.max(bounds.y, Math.min(bounds.y + bounds.height - ORB.height, y + Math.round((Math.random() - 0.5) * 50)));
      moveTo(nextX, nextY, 950);
    }
  }

  async function show(openPanel = false) {
    await ensureWindows();
    visible = true;
    orb.showInactive();
    if (openPanel) { panelOpen = true; placePanel(); panel.show(); }
    if (!timer) timer = setInterval(() => { void tick(); }, 1800);
    return broadcast();
  }
  async function hide() {
    visible = false; panelOpen = false;
    stopMotion();
    if (timer) clearInterval(timer);
    timer = null;
    if (alive(panel)) panel.hide();
    if (alive(orb)) orb.hide();
    return snapshot();
  }
  async function handleAction(action, value) {
    if (action === 'sync') return broadcast();
    if (action === 'toggle') return visible ? hide() : show(true);
    if (action === 'panel') {
      if (!visible) await show();
      panelOpen = value === 'toggle' ? !panelOpen : Boolean(value);
      if (panelOpen) { placePanel(); panel.show(); panel.focus(); } else panel.hide();
      return broadcast();
    }
    if (action === 'move-by') {
      autoDock = false;
      stopMotion();
      if (alive(orb)) { const [x, y] = orb.getPosition(); orb.setPosition(x + Math.round(Number(value?.dx) || 0), y + Math.round(Number(value?.dy) || 0)); }
      return null;
    }
    if (action === 'toggle-dock') { autoDock = !autoDock; return broadcast(); }
    if (action === 'react') { reactionId += 1; return broadcast(); }
    if (action === 'update-settings') {
      settings = await settingsStore.update(value);
      return broadcast();
    }
    try { await onAction(action, value); return broadcast(); }
    catch (error) { return { ...await broadcast(), error: error.message || '操作失败' }; }
  }
  function dispose() {
    stopMotion();
    if (timer) clearInterval(timer);
    timer = null;
    for (const window of [panel, orb]) if (alive(window)) window.destroy();
  }
  return { show, hide, handleAction, dispose, isSender: sender => [orb, panel].some(window => alive(window) && window.webContents === sender) };
}

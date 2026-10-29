import { app, BrowserWindow, screen } from 'electron';
import path from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createCompanionSettingsStore, DEFAULT_COMPANION_SETTINGS } from './companion-settings.mjs';
import { createCompanionUpdater } from './companion-updater.mjs';
import { createCompanionRuntime } from './companion-runtime.mjs';

export function createCompanionDock({ preloadPath, baseUrl, settingsFile, runtimeDirectory, getJianyingState, getWatermarkState, getPeriodStatus, onAction, onState = () => {} }) {
  let panel, panelOpen = false, panelOpening, timer, polling = false, lastBusy = false, lastSnapshot, theme = 'graphite';
  const positionFile = path.join(path.dirname(settingsFile), 'companion-panel-position.json');
  let positionSave = Promise.resolve(), moveTimer;
  const savePosition = () => {
    if (!alive()) return;
    const { x, y } = panel.getBounds();
    positionSave = positionSave.catch(() => {}).then(async () => { await mkdir(path.dirname(positionFile), { recursive: true }); await writeFile(positionFile, JSON.stringify({ x, y })); });
  };
  let settings = { ...DEFAULT_COMPANION_SETTINGS };
  const store = createCompanionSettingsStore(settingsFile);
  const runtime = createCompanionRuntime({ directory: runtimeDirectory, dataDirectory: path.dirname(settingsFile), hostArgs: app.isPackaged ? [] : [app.getAppPath()], onEvent: action => action === 'open-panel' && openPanel() });
  const updater = createCompanionUpdater({ runtime, baseDirectory: runtimeDirectory, dataDirectory: path.dirname(settingsFile), notify: update => { if (lastSnapshot) { const value = { ...lastSnapshot, update }; onState(value); if (alive()) panel.webContents.send('bos:companion-state', value); } else void broadcast().catch(() => {}); } });
  const alive = () => panel && !panel.isDestroyed();
  async function snapshot() {
    await updater.init();
    settings = await store.load();
    const [jy, wm, period, native] = await Promise.all([getJianyingState().catch(() => null), getWatermarkState().catch(() => null), getPeriodStatus().catch(() => null), runtime.status()]);
    return lastSnapshot = { visible: native.visible, panelOpen, theme, settings, native, update: updater.snapshot(),
      jianying: { ready: !!jy?.ready, busy: !!(jy?.busy || jy?.exporting || jy?.recording), status: jy?.status || '引擎准备中', queueCount: jy?.queue?.length || 0, modal: jy?.modal || null, lastLog: jy?.logs?.at(-1) || '' },
      watermark: { running: !!wm?.running, progress: wm?.overallProgress || 0, completed: wm?.completedCount || 0, jobs: wm?.jobs || [] }, periodEnabled: !!period?.enabled };
  }
  async function broadcast() {
    const state = await snapshot();
    if (alive()) panel.webContents.send('bos:companion-state', state);
    onState(state); return state;
  }
  function monitor() {
    if (timer) return;
    timer = setInterval(async () => {
      if (polling) return;
      polling = true;
      try {
        const state = await broadcast();
        const busy = state.jianying.busy || state.watermark.running;
        if (state.native.ready && busy !== lastBusy) { lastBusy = busy; await runtime.run('task-state', busy); }
      } catch { /* Next poll recovers; user commands report their own errors. */ }
      finally { polling = false; }
    }, 2000);
  }
  async function openPanel() {
    if (panelOpening) return panelOpening;
    panelOpening = openPanelWindow();
    try { await panelOpening; } finally { panelOpening = null; }
  }
  async function openPanelWindow() {
    if (!alive()) {
      let saved; try { saved = JSON.parse(await readFile(positionFile, 'utf8')); } catch { /* First open uses the current display. */ }
      const point = Number.isFinite(saved?.x) && Number.isFinite(saved?.y) ? { x: Math.round(saved.x), y: Math.round(saved.y) } : screen.getCursorScreenPoint();
      const area = screen.getDisplayNearestPoint(point).workArea;
      const width = Math.min(350, area.width), height = Math.min(500, area.height);
      const x = Math.round(Math.max(area.x, Math.min(saved?.x ?? area.x + area.width - width - 20, area.x + area.width - width)));
      const y = Math.round(Math.max(area.y, Math.min(saved?.y ?? area.y + area.height - height - 20, area.y + area.height - height)));
      panel = new BrowserWindow({ width, height, x, y, frame: false, transparent: true, hasShadow: false, show: false, resizable: false, movable: true, skipTaskbar: true, alwaysOnTop: true, backgroundColor: '#00000000', webPreferences: { preload: preloadPath, contextIsolation: true, sandbox: true, nodeIntegration: false } });
      panel.on('move', () => { clearTimeout(moveTimer); moveTimer = setTimeout(savePosition, 200); });
      panel.on('closed', () => { panel = null; panelOpen = false; });
      await panel.loadURL(`${baseUrl}/companion-panel.html?v=${encodeURIComponent(app.getVersion())}-glass`);
    }
    panelOpen = true; panel.show(); monitor();
    await broadcast();
  }
  async function show(withPanel = false) {
    await updater.init();
    await runtime.run('visible', true); monitor();
    if (withPanel) await openPanel();
    return broadcast();
  }
  async function hide() {
    if (runtime.isRunning()) await runtime.run('visible', false);
    panelOpen = false; if (alive()) panel.hide();
    return broadcast();
  }
  async function handleAction(action, value) {
    await updater.init();
    if (action === 'sync') return broadcast();
    if (action === 'check-update') { await updater.check(); return broadcast(); }
    if (action === 'install-update') { await updater.update(); return broadcast(); }
    if (updater.isBusy() && action !== 'animations') throw new Error('桌宠正在更新，请稍后操作。');
    if (action === 'animations') return runtime.inventory();
    if (action === 'toggle') return runtime.isVisible() ? hide() : show();
    if (action === 'show') return show();
    if (action === 'hide') return hide();
    if (action === 'panel') { if (value === true || value === 'toggle' && !panelOpen) await openPanel(); else { panelOpen = false; if (alive()) panel.hide(); } return broadcast(); }
    if (action === 'update-settings') {
      settings = await store.update(value);
      const patch = {};
      if ('size' in value) patch.scale = { small: .5, normal: .72, large: 1 }[settings.size];
      if ('roam' in value) patch.no_move = !settings.roam;
      if ('sound' in value) patch.click_sound_enabled = settings.sound;
      if ('volume' in value) patch.click_sound_volume = settings.volume / 100;
      if ('idleInterval' in value) patch.animation_gap_seconds = settings.idleInterval;
      if (Object.keys(patch).length) await runtime.run('update', patch);
      return broadcast();
    }
    if (['native-settings', 'native-update', 'native-play', 'reset-position', 'spawn', 'chat', 'todo'].includes(action)) {
      const command = { 'native-settings': 'settings', 'native-update': 'update', 'native-play': 'play' }[action] || action;
      await runtime.run(command, value); monitor(); return broadcast();
    }
    if (action === 'react') { const clips = await runtime.inventory(); const clicks = clips.filter(item => item.category === 'click'); await runtime.run('play', clicks[Math.floor(Math.random() * clicks.length)].id); return broadcast(); }
    await onAction(action, value); return broadcast();
  }
  function setTheme(value) { theme = value; if (lastSnapshot) lastSnapshot.theme = value; if (alive()) panel.webContents.send('bos:companion-theme', value); }
  async function dispose() { await updater.settle(); clearInterval(timer); clearTimeout(moveTimer); savePosition(); await positionSave.catch(() => {}); if (alive()) panel.destroy(); await runtime.dispose(); }
  return { show, hide, handleAction, dispose, setTheme, getRuntimeDirectory: runtime.getDirectory, isVisible: runtime.isVisible, getName: () => settings.name, isSender: sender => alive() && panel.webContents === sender };
}

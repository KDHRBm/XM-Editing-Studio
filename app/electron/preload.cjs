const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("blackObsidian", {
  getUpdaterStatus: () => ipcRenderer.invoke('bos:updater-status'),
  setTitlebarTheme: theme => ipcRenderer.invoke('bos:titlebar-theme', theme),
  onCompanionTheme: callback => { const listener = (_event, value) => callback(value); ipcRenderer.on('bos:companion-theme', listener); return () => ipcRenderer.removeListener('bos:companion-theme', listener); },
  updaterAction: action => ipcRenderer.invoke('bos:updater-action', action),
  onUpdaterState: callback => { const listener = (_event, value) => callback(value); ipcRenderer.on('bos:updater-state', listener); return () => ipcRenderer.removeListener('bos:updater-state', listener); },
  onTrayNavigate: callback => { const listener = (_event, value) => callback(value); ipcRenderer.on('bos:tray-navigate', listener); return () => ipcRenderer.removeListener('bos:tray-navigate', listener); },
  companionAction: (action, value) => ipcRenderer.invoke('bos:companion-action', action, value),
  onCompanionState: callback => { const listener = (_event, value) => callback(value); ipcRenderer.on('bos:companion-state', listener); return () => ipcRenderer.removeListener('bos:companion-state', listener); },
  layoutWebAI: input => ipcRenderer.invoke('bos:web-ai-layout', input),
  webAIAction: (id, action) => ipcRenderer.invoke('bos:web-ai-action', id, action),
  copyWebAITask: (draft, purpose) => ipcRenderer.invoke('bos:web-ai-copy-task', draft, purpose),
  analyzeWebScript: request => ipcRenderer.invoke('bos:web-analysis-start', request),
  getWebAnalysisTask: () => ipcRenderer.invoke('bos:web-analysis-status'),
  webAnalysisAction: (id, action, value) => ipcRenderer.invoke('bos:web-analysis-action', id, action, value),
  onWebAnalysisTask: callback => { const listener = (_event, value) => callback(value); ipcRenderer.on('bos:web-analysis-task', listener); return () => ipcRenderer.removeListener('bos:web-analysis-task', listener); },
  getWatermarkBrowsers: () => ipcRenderer.invoke('bos:watermark-browsers'),
  openWatermarkBrowser: input => {
    if (!Array.isArray(input?.files) || input.files.length > 100) throw new Error('请选择最多 100 个本地视频。');
    const filePath = file => { const value = webUtils.getPathForFile(file); if (!value) throw new Error('无法读取素材原路径，请重新选择本地文件。'); return value; };
    return ipcRenderer.invoke('bos:open-watermark-browser', { browser: input.browser, files: input.files.map(filePath), watermark: input.watermark ? filePath(input.watermark) : null, settings: input.settings });
  },
  getWatermarkState: () => ipcRenderer.invoke('bos:watermark:get-state'),
  chooseWatermarkVideos: () => ipcRenderer.invoke('bos:watermark:choose-videos'),
  addWatermarkVideos: files => {
    if (!Array.isArray(files) || files.length > 100) throw new Error('一次最多添加 100 个视频。');
    return ipcRenderer.invoke('bos:watermark:add-videos', files.map(file => {
      const filePath = webUtils.getPathForFile(file);
      if (!filePath) throw new Error('无法读取视频路径，请使用选择文件按钮。');
      return filePath;
    }));
  },
  chooseWatermarkImage: () => ipcRenderer.invoke('bos:watermark:choose-image'),
  chooseWatermarkOutputDir: () => ipcRenderer.invoke('bos:watermark:choose-output-dir'),
  updateWatermarkSettings: patch => ipcRenderer.invoke('bos:watermark:update-settings', patch),
  removeWatermarkJob: id => ipcRenderer.invoke('bos:watermark:remove-job', id),
  clearWatermarkJobs: mode => ipcRenderer.invoke('bos:watermark:clear-jobs', mode),
  retryWatermarkJobs: () => ipcRenderer.invoke('bos:watermark:retry-failed'),
  startWatermarkBatch: () => ipcRenderer.invoke('bos:watermark:start'),
  cancelWatermarkBatch: () => ipcRenderer.invoke('bos:watermark:cancel'),
  openWatermarkJob: id => ipcRenderer.invoke('bos:watermark:open-job', id),
  onWatermarkState: callback => { const listener = (_event, value) => callback(value); ipcRenderer.on('bos:watermark-state', listener); return () => ipcRenderer.removeListener('bos:watermark-state', listener); },
  prepareMusicDrag: input => ipcRenderer.invoke('bos:prepare-music-drag', input),
  startMusicDrag: token => ipcRenderer.send('bos:start-music-drag', token),
  onMusicDragError: callback => { const listener = (_event, value) => callback(value); ipcRenderer.on('bos:music-drag-error', listener); return () => ipcRenderer.removeListener('bos:music-drag-error', listener); },
  getPeriodKeeperStatus: () => ipcRenderer.invoke('bos:period-status'),
  probePeriodKeeper: () => ipcRenderer.invoke('bos:period-probe'),
  setPeriodKeeperEnabled: (enabled, mode) => ipcRenderer.invoke('bos:period-enabled', enabled, mode),
  setBatchPunctuationEnabled: enabled => ipcRenderer.invoke('bos:period-batch-enabled', enabled),
  copySubtitleText: (text, options) => ipcRenderer.invoke('bos:period-copy', text, options),
  jianyingAction: (action, args, connection) => ipcRenderer.invoke('bos:jianying-action', action, args, connection),
  chooseJianyingFiles: () => ipcRenderer.invoke('bos:jianying-files'),
  quickLaunch: (action, value) => ipcRenderer.invoke('bos:quick-launch', action, value),
  chooseDirectory: () => ipcRenderer.invoke("bos:choose-directory"),
  writeCache: payload => ipcRenderer.invoke("bos:write-cache", payload),
  readCache: payload => ipcRenderer.invoke("bos:read-cache", payload),
  downloadAudio: payload => ipcRenderer.invoke("bos:download-audio", payload),
  exportScriptMaterials: payload => ipcRenderer.invoke("bos:export-script-materials", payload),
  getMusicLibrary: () => ipcRenderer.invoke('bos:music-library-list'),
  connectMusicLibrary: () => ipcRenderer.invoke('bos:music-library-connect'),
  refreshMusicLibrary: () => ipcRenderer.invoke('bos:music-library-refresh'),
  disconnectMusicLibrary: id => ipcRenderer.invoke('bos:music-library-disconnect', id),
});

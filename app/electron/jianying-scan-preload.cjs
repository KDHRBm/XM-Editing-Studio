const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('scanCard', {
  state: () => ipcRenderer.invoke('bos:scan-card-state'),
  action: action => ipcRenderer.invoke('bos:scan-card-action', action),
  subscribe: callback => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('bos:scan-card-progress', listener);
    return () => ipcRenderer.removeListener('bos:scan-card-progress', listener);
  },
});

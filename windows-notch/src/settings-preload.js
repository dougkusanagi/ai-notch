const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('settings', {
  get: () => ipcRenderer.invoke('settings:get'),
  set: s => ipcRenderer.invoke('settings:set', s),
  accounts: op => ipcRenderer.invoke('accounts:do', op),
  pick: () => ipcRenderer.invoke('accounts:pick'),
  onTab: cb => ipcRenderer.on('tab', (_e, t) => cb(t)),
});

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('settings', {
  get: () => ipcRenderer.invoke('settings:get'),
  set: s => ipcRenderer.invoke('settings:set', s),
  accounts: () => ipcRenderer.invoke('accounts:get'),
  pickFolder: () => ipcRenderer.invoke('accounts:pick'),
  setAccount: a => ipcRenderer.invoke('accounts:set', a),
});

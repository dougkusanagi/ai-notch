const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('notch', {
  onUsage: cb => ipcRenderer.on('usage', (_e, d) => cb(d)),
  onLoading: cb => ipcRenderer.on('loading', (_e, v) => cb(v)),
  notchSize: size => ipcRenderer.send('notch-size', size),
  interactive: on => ipcRenderer.send('interactive', on),
  platform: process.platform,
  openSettings: () => ipcRenderer.send('open-settings'),
  refresh: () => ipcRenderer.send('refresh'),
  menu: () => ipcRenderer.send('menu'),
  setTheme: t => ipcRenderer.send('theme', t),
  drag: dx => ipcRenderer.send('drag', dx),
  dragEnd: () => ipcRenderer.send('drag-end'),
  center: () => ipcRenderer.send('center'),
  onPin: cb => ipcRenderer.on('pin', (_e, v) => cb(v)),
  onPrefs: cb => ipcRenderer.on('prefs', (_e, p) => cb(p)),
  prefs: () => ipcRenderer.invoke('prefs'),
});

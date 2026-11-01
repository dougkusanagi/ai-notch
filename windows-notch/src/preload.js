const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('notch', {
  onUsage: cb => ipcRenderer.on('usage', (_e, d) => cb(d)),
  onLoading: cb => ipcRenderer.on('loading', (_e, v) => cb(v)),
  interactive: on => ipcRenderer.send('interactive', on),
  refresh: () => ipcRenderer.send('refresh'),
  menu: () => ipcRenderer.send('menu'),
  setTheme: t => ipcRenderer.send('theme', t),
  drag: dx => ipcRenderer.send('drag', dx),
  dragEnd: () => ipcRenderer.send('drag-end'),
  center: () => ipcRenderer.send('center'),
  prefs: () => ipcRenderer.invoke('prefs'),
});

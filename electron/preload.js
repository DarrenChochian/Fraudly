const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  setWindowMode: (mode) => ipcRenderer.invoke('set-window-mode', mode),
})

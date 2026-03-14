const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  setWindowMode: (mode, width, height) => ipcRenderer.invoke('set-window-mode', mode, width, height),
})

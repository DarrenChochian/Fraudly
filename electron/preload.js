const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  setOverlayInteractivity: (interactive) => ipcRenderer.send('overlay:set-interactive', interactive),
  initializeResearchChats: (chatIds) => ipcRenderer.invoke('research:initialize-chats', { chatIds }),
  runResearch: (payload) => ipcRenderer.invoke('research:run', payload),
  onResearchEvent: (callback) => {
    const listener = (_, payload) => callback(payload)
    ipcRenderer.on('research:event', listener)
    return () => ipcRenderer.removeListener('research:event', listener)
  },
  onOpenSettings: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('settings:open', listener)
    return () => ipcRenderer.removeListener('settings:open', listener)
  },
  getHotkey: () => ipcRenderer.invoke('settings:get-hotkey'),
  updateHotkey: (accelerator) => ipcRenderer.invoke('settings:update-hotkey', { accelerator }),
  getMainPanelHotkey: () => ipcRenderer.invoke('main-panel:get-hotkey'),
  updateMainPanelHotkey: (accelerator) => ipcRenderer.invoke('main-panel:update-hotkey', { accelerator }),
  onMainPanelOpen: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('main-panel:open', listener)
    return () => ipcRenderer.removeListener('main-panel:open', listener)
  },
})

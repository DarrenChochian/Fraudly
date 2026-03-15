const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  setOverlayInteractivity: (interactive) => ipcRenderer.send('overlay:set-interactive', interactive),
  listResearchChats: () => ipcRenderer.invoke('research:list-chats'),
  ensureResearchChat: (chatId) => ipcRenderer.invoke('research:ensure-chat', { chatId }),
  createAnalysisResearchChat: () => ipcRenderer.invoke('research:create-analysis-chat'),
  initializeResearchChats: (chatIds) => ipcRenderer.invoke('research:initialize-chats', { chatIds }),
  getChatHistory: (chatId) => ipcRenderer.invoke('research:get-history', { chatId }),
  resetResearchThread: (chatId) => ipcRenderer.invoke('research:reset-thread', { chatId }),
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
  onSuspiciousScanTrigger: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('suspicious-scan:trigger', listener)
    return () => ipcRenderer.removeListener('suspicious-scan:trigger', listener)
  },
  onHotkeyRegistrationResult: (callback) => {
    const listener = (_, payload) => callback(payload)
    ipcRenderer.on('hotkey:registration-result', listener)
    return () => ipcRenderer.removeListener('hotkey:registration-result', listener)
  },
  getMediaPermissionStatus: () => ipcRenderer.invoke('permissions:get-status'),
  requestMediaPermission: (kind) => ipcRenderer.invoke('permissions:request', { kind }),
  startTranscription: (sources) => ipcRenderer.invoke('transcription:start', { sources }),
  stopTranscription: () => ipcRenderer.invoke('transcription:stop'),
  sendTranscriptionAudioChunk: (source, chunk) => ipcRenderer.send('transcription:audio-chunk', { source, chunk }),
  onTranscriptionEvent: (callback) => {
    const listener = (_, payload) => callback(payload)
    ipcRenderer.on('transcription:event', listener)
    return () => ipcRenderer.removeListener('transcription:event', listener)
  },
  captureScreenshot: () => ipcRenderer.invoke('screen:capture-screenshot'),
})

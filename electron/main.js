const { app, BrowserWindow, screen, ipcMain, globalShortcut } = require('electron')
const path = require('path')
const { registerResearchAgentIpc } = require('./research-agent/ipc')

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

let mainWindow

function createWindow() {
  const display = screen.getPrimaryDisplay()
  const useDisplayBounds = process.platform === 'win32'
  const initialRect = useDisplayBounds ? display.bounds : display.workArea

  mainWindow = new BrowserWindow({
    x: initialRect.x,
    y: initialRect.y,
    width: initialRect.width,
    height: initialRect.height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  })

  mainWindow.setAlwaysOnTop(true, 'floating')
  // Click-through by default; renderer will opt-in interactive regions.
  mainWindow.setIgnoreMouseEvents(true, { forward: true })

  // Re-apply display metrics after first paint for platform-specific reliability.
  mainWindow.once('ready-to-show', () => {
    const nextDisplay = screen.getPrimaryDisplay()
    const nextRect = useDisplayBounds ? nextDisplay.bounds : nextDisplay.workArea
    const { width, height, x, y } = nextRect
    if (width > 100 && height > 100) {
      mainWindow.setBounds({ x, y, width, height })
    }
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

let currentSettingsAccelerator = 'Alt+K'
let currentMainPanelAccelerator = 'Alt+L'

function registerAllHotkeys() {
  globalShortcut.unregisterAll()
  const settingsOk = globalShortcut.register(currentSettingsAccelerator, () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show()
      mainWindow.focus()
      mainWindow.webContents.send('settings:open')
    }
  })
  const mainPanelOk = globalShortcut.register(currentMainPanelAccelerator, () => {
    if (mainWindow && !mainWindow.isDestroyed()) {  
      mainWindow.show()
      mainWindow.focus()
      mainWindow.webContents.send('main-panel:open')
    }
  })
  return { settingsOk, mainPanelOk }
}

app.whenReady().then(() => {
  registerResearchAgentIpc({
    ipcMain,
    projectRoot: app.getAppPath(),
    userDataPath: app.getPath('userData'),
  })

  createWindow()
  registerAllHotkeys()
})

ipcMain.handle('settings:get-hotkey', () => ({ accelerator: currentSettingsAccelerator }))

ipcMain.handle('settings:update-hotkey', (_, { accelerator }) => {
  const prev = currentSettingsAccelerator
  currentSettingsAccelerator = accelerator
  const { settingsOk } = registerAllHotkeys()
  if (!settingsOk) {
    currentSettingsAccelerator = prev
    registerAllHotkeys()
    return { ok: false, accelerator: currentSettingsAccelerator }
  }
  return { ok: true, accelerator: currentSettingsAccelerator }
})

ipcMain.handle('main-panel:get-hotkey', () => ({ accelerator: currentMainPanelAccelerator }))

ipcMain.handle('main-panel:update-hotkey', (_, { accelerator }) => {
  const prev = currentMainPanelAccelerator
  currentMainPanelAccelerator = accelerator
  const { mainPanelOk } = registerAllHotkeys()
  if (!mainPanelOk) {
    currentMainPanelAccelerator = prev
    registerAllHotkeys()
    return { ok: false, accelerator: currentMainPanelAccelerator }
  }
  return { ok: true, accelerator: currentMainPanelAccelerator }
})

ipcMain.on('overlay:set-interactive', (_, interactive) => {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const enabled = Boolean(interactive)
  // interactive=true => receive mouse; interactive=false => click-through.
  mainWindow.setIgnoreMouseEvents(!enabled, { forward: true })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

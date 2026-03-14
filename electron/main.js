const { app, BrowserWindow, screen, ipcMain } = require('electron')
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

app.whenReady().then(() => {
  registerResearchAgentIpc({
    ipcMain,
    projectRoot: app.getAppPath(),
    userDataPath: app.getPath('userData'),
  })

  createWindow()
})

ipcMain.on('overlay:set-interactive', (_, interactive) => {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const enabled = Boolean(interactive)
  // interactive=true => receive mouse; interactive=false => click-through.
  mainWindow.setIgnoreMouseEvents(!enabled, { forward: true })
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

const { app, BrowserWindow, screen, ipcMain } = require('electron')
const path = require('path')
const { registerResearchAgentIpc } = require('./research-agent/ipc')

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

const PADDING = 10
/** Modal size as decimal of screen (e.g. 0.9 = 90% of work area width and height) */
const MODAL_SCREEN_PERCENT = 0.98

/** Position a window of the given size at the top-right of the work area with padding. */
function getButtonBounds(width, height) {
  const work = screen.getPrimaryDisplay().workArea
  return {
    x: work.x + work.width - width - PADDING,
    y: work.y + PADDING,
    width,
    height,
  }
}

function getModalBounds() {
  const work = screen.getPrimaryDisplay().workArea
  const width = Math.floor(work.width * MODAL_SCREEN_PERCENT)
  const height = Math.floor(work.height * MODAL_SCREEN_PERCENT)
  return {
    x: work.x + Math.floor((work.width - width) / 2),
    y: work.y + Math.floor((work.height - height) / 2),
    width,
    height,
  }
}

function createWindow() {
  const initialWidth = 52
  const initialHeight = 52
  const bounds = getButtonBounds(initialWidth, initialHeight)

  mainWindow = new BrowserWindow({
    ...bounds,
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

  ipcMain.handle('set-window-mode', (_, mode, width, height) => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (mode === 'modal') {
      mainWindow.setBounds(getModalBounds())
      return
    }

    const w = Number(width)
    const h = Number(height)
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      mainWindow.setBounds(getButtonBounds(w, h))
    } else {
      mainWindow.setBounds(getButtonBounds(52, 52))
    }
  })

  createWindow()
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

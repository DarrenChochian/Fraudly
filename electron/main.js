const { app, BrowserWindow, screen, ipcMain } = require('electron')
const path = require('path')

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

const BUTTON_SIZE = 52
const PADDING = 10
/** Modal size as decimal of screen (e.g. 0.8 = 80% of work area width and height) */
const MODAL_SCREEN_PERCENT = 0.8

function getButtonBounds() {
  const work = screen.getPrimaryDisplay().workArea
  return {
    x: work.x + work.width - BUTTON_SIZE - PADDING,
    y: work.y + PADDING,
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
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
  const bounds = getButtonBounds()

  const mainWindow = new BrowserWindow({
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

  ipcMain.handle('set-window-mode', (_, mode) => {
    if (mainWindow.isDestroyed()) return
    const bounds = mode === 'modal' ? getModalBounds() : getButtonBounds()
    mainWindow.setBounds(bounds)
  })
}

app.whenReady().then(createWindow)

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

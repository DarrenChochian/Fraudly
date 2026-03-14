const {
  app,
  BrowserWindow,
  screen,
  ipcMain,
  globalShortcut,
  session,
  desktopCapturer,
  systemPreferences,
  shell,
} = require('electron')
const path = require('path')
const { registerResearchAgentIpc } = require('./research-agent/ipc')
const { registerTranscriptionIpc } = require('./transcription')

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

if (process.platform === 'darwin') {
  app.commandLine.appendSwitch('disable-features', 'MacCatapLoopbackAudioForScreenShare')
  console.log('[desktop-capture] macOS loopback fallback enabled (MacCatapLoopbackAudioForScreenShare disabled)')
}

let mainWindow
let transcriptionController = null
let overlayInteractive = false

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function normalizePermissionStatus(status) {
  if (!status) return 'unknown'
  return status
}

function getPermissionStatus(kind) {
  if (!systemPreferences?.getMediaAccessStatus) {
    if (kind === 'microphone') return 'unknown'
    return process.platform === 'darwin' ? 'unknown' : 'granted'
  }

  if (kind === 'microphone') {
    return normalizePermissionStatus(systemPreferences.getMediaAccessStatus('microphone'))
  }

  if (kind === 'screen' || kind === 'screenshot') {
    if (process.platform === 'darwin') {
      return normalizePermissionStatus(systemPreferences.getMediaAccessStatus('screen'))
    }
    return 'granted'
  }

  return 'unknown'
}

function setupDisplayMediaRequestHandler() {
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'] })
      const primaryDisplay = screen.getPrimaryDisplay()
      const primarySource = sources.find((source) => String(source.display_id) === String(primaryDisplay.id))

      callback({
        video: primarySource || sources[0],
        audio: 'loopback',
      })
    } catch (error) {
      console.error('[desktop-capture] Failed to get capture sources:', error)
      callback({ video: null, audio: null })
    }
  }, { useSystemPicker: false })
}

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
    mainWindow.webContents.once('did-finish-load', () => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      mainWindow.webContents.openDevTools({ mode: 'detach' })
    })
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

let currentSettingsAccelerator = 'Alt+K'
let currentMainPanelAccelerator = 'Alt+L'

// On macOS, Option+L (Alt+L) is intercepted by some IME/keyboard configurations
// before Electron can claim it. Provide a fallback chain specific to the platform.
const MACOS_FALLBACKS = {
  'Alt+L': ['Alt+Shift+L', 'Command+Shift+L'],
}

function tryRegister(accelerator, handler) {
  const ok = globalShortcut.register(accelerator, handler)
  console.log(`[hotkeys] register(${accelerator}) → ${ok ? 'OK' : 'FAILED'}`)
  return ok
}

function tryRegisterWithFallbacks(accelerator, handler, fallbacks) {
  if (tryRegister(accelerator, handler)) return { ok: true, registered: accelerator }
  for (const fb of fallbacks) {
    if (tryRegister(fb, handler)) return { ok: true, registered: fb }
  }
  console.warn(`[hotkeys] All candidates failed for desired accelerator: ${accelerator}`)
  return { ok: false, registered: null }
}

function registerAllHotkeys() {
  globalShortcut.unregisterAll()

  // Helper to bring window to front and send IPC
  const handleHotkey = (channel) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (process.platform === 'darwin') {
        app.focus({ steal: true }) // Force focus on Mac
      }
      mainWindow.show()
      mainWindow.focus()
      mainWindow.setIgnoreMouseEvents(false)
      mainWindow.webContents.send(channel)
    }
  }

  const settingsResult = tryRegisterWithFallbacks(
    currentSettingsAccelerator,
    () => handleHotkey('settings:open'), // Uses the helper now
    []
  )
  if (settingsResult.ok) currentSettingsAccelerator = settingsResult.registered

  const macFallbacks = process.platform === 'darwin'
    ? (MACOS_FALLBACKS[currentMainPanelAccelerator] ?? ['Alt+Shift+L', 'Command+Shift+L'])
    : []
    
  const mainPanelResult = tryRegisterWithFallbacks(
    currentMainPanelAccelerator,
    () => handleHotkey('main-panel:open'),
    macFallbacks
  )
  if (mainPanelResult.ok) currentMainPanelAccelerator = mainPanelResult.registered

  const notify = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.webContents.send('hotkey:registration-result', {
      settings: { accelerator: currentSettingsAccelerator, ok: settingsResult.ok },
      mainPanel: { accelerator: currentMainPanelAccelerator, ok: mainPanelResult.ok },
    })
  }

  if (mainWindow?.webContents?.isLoading()) {
    mainWindow.webContents.once('did-finish-load', notify)
  } else {
    setImmediate(notify)
  }

  return { settingsOk: settingsResult.ok, mainPanelOk: mainPanelResult.ok }
}

app.whenReady().then(() => {
  setupDisplayMediaRequestHandler()

  registerResearchAgentIpc({
    ipcMain,
    projectRoot: app.getAppPath(),
    userDataPath: app.getPath('userData'),
  })

  transcriptionController = registerTranscriptionIpc({
    ipcMain,
    projectRoot: app.getAppPath(),
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
  overlayInteractive = enabled
  // interactive=true => receive mouse; interactive=false => click-through.
  mainWindow.setIgnoreMouseEvents(!enabled, { forward: true })
})

ipcMain.handle('permissions:get-status', () => ({
  microphone: getPermissionStatus('microphone'),
  screen: getPermissionStatus('screen'),
  screenshot: getPermissionStatus('screenshot'),
}))

ipcMain.handle('permissions:request', async (_, { kind }) => {
  const requestedKind = String(kind || '').toLowerCase()

  if (requestedKind === 'microphone') {
    if (systemPreferences?.askForMediaAccess) {
      const granted = await systemPreferences.askForMediaAccess('microphone')
      return {
        ok: granted,
        status: getPermissionStatus('microphone'),
      }
    }
    return {
      ok: getPermissionStatus('microphone') === 'granted',
      status: getPermissionStatus('microphone'),
    }
  }

  if (requestedKind === 'screen' || requestedKind === 'screenshot') {
    if (process.platform === 'darwin') {
      const status = getPermissionStatus('screen')
      if (status === 'granted') {
        return { ok: true, status }
      }

      let settingsOpened = false
      try {
        await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture')
        settingsOpened = true
      } catch {
        settingsOpened = false
      }

      return {
        ok: false,
        status,
        needsDisplayMediaPrompt: true,
        settingsOpened,
      }
    }

    return {
      ok: true,
      status: 'granted',
    }
  }

  return {
    ok: false,
    status: 'unknown',
  }
})

ipcMain.handle('screen:capture-screenshot', async () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { ok: false, error: 'Main window is unavailable' }
  }

  const primaryDisplay = screen.getPrimaryDisplay()
  const wasVisible = mainWindow.isVisible()
  const previousOpacity = mainWindow.getOpacity()

  try {
    if (wasVisible) {
      mainWindow.setOpacity(0)
      mainWindow.setIgnoreMouseEvents(true, { forward: true })
      await delay(120)
    }

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: primaryDisplay.size.width,
        height: primaryDisplay.size.height,
      },
    })

    const source =
      sources.find((item) => String(item.display_id) === String(primaryDisplay.id)) ||
      sources[0]

    if (!source || source.thumbnail.isEmpty()) {
      return { ok: false, error: 'No screen source available' }
    }

    return {
      ok: true,
      dataUrl: source.thumbnail.toDataURL(),
      width: source.thumbnail.getSize().width,
      height: source.thumbnail.getSize().height,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to capture screenshot'
    return { ok: false, error: message }
  } finally {
    if (wasVisible) {
      mainWindow.setOpacity(previousOpacity)
      if (!mainWindow.isVisible()) {
        mainWindow.showInactive()
      }
      mainWindow.setIgnoreMouseEvents(!overlayInteractive, { forward: true })
    }
  }
})

app.on('will-quit', () => {
  transcriptionController?.stopAllSessions?.()
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

import { useEffect, useState } from 'react'

const PINK_LIGHT = '#ff8ec8'
const BORDER_PINK = 'rgba(255, 132, 198, 0.32)'
const BG_PANEL = 'rgba(10, 12, 18, 0.82)'
const GLASS_BACKDROP = 'blur(18px) saturate(150%)'
const NEUTRAL_PANEL_FILL =
  'radial-gradient(180% 140% at 45% -25%, rgba(82, 94, 122, 0.15) 0%, rgba(18, 22, 33, 0.9) 52%, rgba(7, 9, 15, 0.97) 100%)'
const NEUTRAL_PANEL_HEADER =
  'linear-gradient(180deg, rgba(98, 112, 143, 0.16), rgba(22, 27, 39, 0.84) 68%, rgba(9, 12, 19, 0.94))'
const NEUTRAL_PANEL_SHADOW =
  '0 0 0 1px rgba(116, 128, 158, 0.16), inset 0 -1.2px rgba(5, 7, 12, 0.92), inset 0 0.7px rgba(154, 167, 198, 0.2), 0 20px 44px rgba(0, 0, 0, 0.54), 0 8px 22px rgba(2, 4, 10, 0.56)'
const NEUTRAL_CARD_FILL =
  'radial-gradient(170% 130% at 46% -20%, rgba(124, 138, 172, 0.14) 0%, rgba(25, 30, 43, 0.82) 56%, rgba(8, 11, 17, 0.95) 100%)'
const PINK_GLOSS_FILL =
  'radial-gradient(179.05% 132.83% at 46.18% -23.44%, #ff9bd8 0%, #ff5aa8 35%, #bb2f7a 72%, #6b1b4a 100%)'
const PINK_GLOSS_SHADOW =
  '0 0 0 0.7px rgba(255, 133, 199, 0.95), inset 0 -1.35px rgba(93, 10, 57, 0.9), inset 0 0.7px rgba(255, 205, 233, 0.8), 0 9px 28px rgba(134, 25, 90, 0.56), 0 30px 45px rgba(0, 0, 0, 0.28)'

const MODIFIER_KEYS = new Set(['Alt', 'Control', 'Shift', 'Meta', 'AltGraph'])

function formatPermissionStatus(status) {
  const value = String(status || 'unknown').toLowerCase()
  if (value === 'granted') return 'Granted'
  if (value === 'denied' || value === 'restricted') return 'Denied'
  if (value === 'not-determined' || value === 'prompt') return 'Not granted'
  if (value === 'no-audio-track') return 'No audio track'
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function buildAccelerator(e) {
  const parts = []
  if (e.ctrlKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  if (e.metaKey) parts.push('Super')

  const key = e.key
  if (!MODIFIER_KEYS.has(key)) {
    if (key.length === 1) {
      parts.push(key.toUpperCase())
    } else {
      // Map common special keys to Electron accelerator names
      const specialKeys = {
        ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
        Escape: 'Escape', Enter: 'Return', Tab: 'Tab', Backspace: 'Backspace',
        Delete: 'Delete', Home: 'Home', End: 'End', PageUp: 'PageUp',
        PageDown: 'PageDown', ' ': 'Space', F1: 'F1', F2: 'F2', F3: 'F3',
        F4: 'F4', F5: 'F5', F6: 'F6', F7: 'F7', F8: 'F8', F9: 'F9',
        F10: 'F10', F11: 'F11', F12: 'F12',
      }
      const mapped = specialKeys[key]
      if (mapped) parts.push(mapped)
    }
  }

  return parts.length > 1 ? parts.join('+') : null
}

export default function SettingsPanel({ currentHotkey: propHotkey = 'Alt+K', onHotkeyChange, settingsHotkeyFailed = false, mainPanelHotkey: propMainPanelHotkey = 'Alt+L', onMainPanelHotkeyChange, mainPanelHotkeyFailed = false, permissionStatus = { microphone: 'unknown', screen: 'unknown', screenshot: 'unknown' }, onRequestPermission, onClose, onInteractiveEnter, onInteractiveLeave }) {
  const [currentHotkey, setCurrentHotkey] = useState(propHotkey)
  const [mainPanelHotkey, setMainPanelHotkey] = useState(propMainPanelHotkey)
  const [recording, setRecording] = useState(false)
  const [mainPanelRecording, setMainPanelRecording] = useState(false)
  const [status, setStatus] = useState(null) // 'saved' | 'error' | null
  const [mainPanelStatus, setMainPanelStatus] = useState(null)
  const [permissionBusy, setPermissionBusy] = useState({ microphone: false, screen: false, screenshot: false })

  useEffect(() => {
    setCurrentHotkey(propHotkey)
    setMainPanelHotkey(propMainPanelHotkey)
  }, [propHotkey, propMainPanelHotkey])

  // Fetch current hotkeys when panel opens
  useEffect(() => {
    window.electronAPI?.getHotkey?.().then((res) => {
      if (res?.accelerator) setCurrentHotkey(res.accelerator)
    })
    window.electronAPI?.getMainPanelHotkey?.().then((res) => {
      if (res?.accelerator) setMainPanelHotkey(res.accelerator)
    })
  }, [])

  useEffect(() => {
    if (!recording) return

    const handleKeyDown = async (e) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setRecording(false)
        return
      }
      if (MODIFIER_KEYS.has(e.key)) return
      const accelerator = buildAccelerator(e)
      if (!accelerator) return
      setRecording(false)
      if (window.electronAPI?.updateHotkey) {
        try {
          const result = await window.electronAPI.updateHotkey(accelerator)
          if (result?.ok) {
            setCurrentHotkey(accelerator)
            onHotkeyChange?.(accelerator)
            setStatus('saved')
          } else {
            setStatus('error')
          }
        } catch {
          setStatus('error')
        }
      } else {
        setCurrentHotkey(accelerator)
        onHotkeyChange?.(accelerator)
        setStatus('saved')
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [recording])

  useEffect(() => {
    if (!mainPanelRecording) return

    const handleKeyDown = async (e) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setMainPanelRecording(false)
        return
      }
      if (MODIFIER_KEYS.has(e.key)) return
      const accelerator = buildAccelerator(e)
      if (!accelerator) return
      setMainPanelRecording(false)
      if (window.electronAPI?.updateMainPanelHotkey) {
        try {
          const result = await window.electronAPI.updateMainPanelHotkey(accelerator)
          if (result?.ok) {
            setMainPanelHotkey(accelerator)
            onMainPanelHotkeyChange?.(accelerator)
            setMainPanelStatus('saved')
          } else {
            setMainPanelStatus('error')
          }
        } catch {
          setMainPanelStatus('error')
        }
      } else {
        setMainPanelHotkey(accelerator)
        onMainPanelHotkeyChange?.(accelerator)
        setMainPanelStatus('saved')
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [mainPanelRecording])

  useEffect(() => {
    if (!status) return
    const t = setTimeout(() => setStatus(null), 2000)
    return () => clearTimeout(t)
  }, [status])

  useEffect(() => {
    if (!mainPanelStatus) return
    const t = setTimeout(() => setMainPanelStatus(null), 2000)
    return () => clearTimeout(t)
  }, [mainPanelStatus])

  const handlePermissionRequest = async (kind) => {
    if (!onRequestPermission) return

    setPermissionBusy((prev) => ({ ...prev, [kind]: true }))
    try {
      await onRequestPermission(kind)
    } finally {
      setPermissionBusy((prev) => ({ ...prev, [kind]: false }))
    }
  }

  return (
    <div
      onMouseEnter={onInteractiveEnter}
      onMouseLeave={onInteractiveLeave}
      className="overlay-interactive absolute right-4 top-[130px] w-80 rounded-2xl border-2 overflow-hidden z-20"
      style={{
        backgroundColor: BG_PANEL,
        backgroundImage: NEUTRAL_PANEL_FILL,
        borderColor: BORDER_PINK,
        boxShadow: NEUTRAL_PANEL_SHADOW,
        backdropFilter: GLASS_BACKDROP,
        WebkitBackdropFilter: GLASS_BACKDROP,
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b shrink-0"
        style={{
          background: NEUTRAL_PANEL_HEADER,
          borderColor: 'rgba(124, 136, 168, 0.22)',
        }}
      >
        <span className="text-sm font-semibold" style={{ color: PINK_LIGHT }}>
          Settings
        </span>
        <button
          type="button"
          onClick={onClose}
          className="w-8 h-8 flex items-center justify-center text-xl leading-none rounded-lg cursor-pointer transition-colors border border-transparent hover:border-pink-500/50"
          style={{
            color: 'rgba(228, 236, 255, 0.9)',
            background: NEUTRAL_CARD_FILL,
            borderColor: 'rgba(123, 136, 168, 0.3)',
            boxShadow: 'inset 0 1px rgba(159, 173, 205, 0.2)',
          }}
          title="Close settings"
        >
          ×
        </button>
      </div>

      {/* Body */}
      <div
        className="p-4 space-y-4"
        style={{ background: 'linear-gradient(180deg, rgba(18, 23, 34, 0.84), rgba(8, 11, 18, 0.94))' }}
      >
        {/* Hotkey section */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wider" style={{ color: PINK_LIGHT }}>
            Settings Hotkey
          </label>
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>
            Press this combo anywhere to open the settings panel.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setStatus(null)
                setRecording((v) => !v)
              }}
              className="flex-1 px-3 py-2 rounded-lg border text-sm font-mono text-center cursor-pointer transition-colors hover:opacity-90"
              style={{
                background: recording
                  ? PINK_GLOSS_FILL
                  : NEUTRAL_CARD_FILL,
                borderColor: recording ? 'rgba(255, 191, 229, 0.9)' : 'rgba(123, 136, 168, 0.32)',
                color: recording ? '#ffe9f7' : 'rgba(226, 234, 255, 0.92)',
                boxShadow: recording
                  ? PINK_GLOSS_SHADOW
                  : '0 0 0 1px rgba(121, 134, 166, 0.18), inset 0 1px rgba(158, 172, 205, 0.18)',
              }}
            >
              {recording ? 'Press keys…' : currentHotkey}
            </button>
            <button
              type="button"
              onClick={() => {
                setStatus(null)
                setRecording((v) => !v)
              }}
              className="px-3 py-2 text-xs font-semibold rounded-lg border cursor-pointer transition-all hover:opacity-90 active:scale-95"
              style={{
                background: recording
                  ? NEUTRAL_CARD_FILL
                  : PINK_GLOSS_FILL,
                borderColor: recording ? 'rgba(123, 136, 168, 0.34)' : 'rgba(255, 182, 224, 0.86)',
                color: recording ? 'rgba(226, 234, 255, 0.9)' : '#ffeaf7',
                boxShadow: recording
                  ? 'inset 0 1px rgba(158, 172, 205, 0.18)'
                  : 'inset 0 1px rgba(255, 214, 236, 0.7), 0 6px 14px rgba(130, 24, 88, 0.36)',
              }}
            >
              {recording ? 'Cancel' : 'Change'}
            </button>
          </div>

          {settingsHotkeyFailed && status === null && (
            <p className="text-xs" style={{ color: '#f87171' }}>
              Failed to register — this combo may be taken by the OS. Try a different one.
            </p>
          )}
          {status === 'saved' && (
            <p className="text-xs" style={{ color: '#4ade80' }}>
              Hotkey updated successfully.
            </p>
          )}
          {status === 'error' && (
            <p className="text-xs" style={{ color: '#f87171' }}>
              Could not register that hotkey. Try a different combo.
            </p>
          )}
          {recording && (
            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
              ESC to cancel — requires at least one modifier key (Alt, Ctrl, Shift).
            </p>
          )}
        </div>

        {/* Main Panel Hotkey section */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wider" style={{ color: PINK_LIGHT }}>
            Main Panel Hotkey
          </label>
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>
            Press this combo anywhere to open or close the main panel (history, chat, transcribe).
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setMainPanelStatus(null)
                setMainPanelRecording((v) => !v)
              }}
              className="flex-1 px-3 py-2 rounded-lg border text-sm font-mono text-center cursor-pointer transition-colors hover:opacity-90"
              style={{
                background: mainPanelRecording
                  ? PINK_GLOSS_FILL
                  : NEUTRAL_CARD_FILL,
                borderColor: mainPanelRecording ? 'rgba(255, 191, 229, 0.9)' : 'rgba(123, 136, 168, 0.32)',
                color: mainPanelRecording ? '#ffe9f7' : 'rgba(226, 234, 255, 0.92)',
                boxShadow: mainPanelRecording
                  ? PINK_GLOSS_SHADOW
                  : '0 0 0 1px rgba(121, 134, 166, 0.18), inset 0 1px rgba(158, 172, 205, 0.18)',
              }}
            >
              {mainPanelRecording ? 'Press keys…' : mainPanelHotkey}
            </button>
            <button
              type="button"
              onClick={() => {
                setMainPanelStatus(null)
                setMainPanelRecording((v) => !v)
              }}
              className="px-3 py-2 text-xs font-semibold rounded-lg border cursor-pointer transition-all hover:opacity-90 active:scale-95"
              style={{
                background: mainPanelRecording
                  ? NEUTRAL_CARD_FILL
                  : PINK_GLOSS_FILL,
                borderColor: mainPanelRecording ? 'rgba(123, 136, 168, 0.34)' : 'rgba(255, 182, 224, 0.86)',
                color: mainPanelRecording ? 'rgba(226, 234, 255, 0.9)' : '#ffeaf7',
                boxShadow: mainPanelRecording
                  ? 'inset 0 1px rgba(158, 172, 205, 0.18)'
                  : 'inset 0 1px rgba(255, 214, 236, 0.7), 0 6px 14px rgba(130, 24, 88, 0.36)',
              }}
            >
              {mainPanelRecording ? 'Cancel' : 'Change'}
            </button>
          </div>
          {mainPanelHotkeyFailed && mainPanelStatus === null && (
            <p className="text-xs" style={{ color: '#f87171' }}>
              Failed to register — this combo may be taken by the OS. Try a different one.
            </p>
          )}
          {!mainPanelHotkeyFailed && mainPanelStatus === null && mainPanelHotkey !== propMainPanelHotkey && (
            <p className="text-xs" style={{ color: '#fbbf24' }}>
              Auto-changed to {mainPanelHotkey} (original combo unavailable on this OS).
            </p>
          )}
          {mainPanelStatus === 'saved' && (
            <p className="text-xs" style={{ color: '#4ade80' }}>
              Hotkey updated successfully.
            </p>
          )}
          {mainPanelStatus === 'error' && (
            <p className="text-xs" style={{ color: '#f87171' }}>
              Could not register that hotkey. Try a different combo.
            </p>
          )}
          {mainPanelRecording && (
            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
              ESC to cancel — requires at least one modifier key (Alt, Ctrl, Shift).
            </p>
          )}
        </div>

        {/* Divider */}
        <div style={{ borderTop: '1px solid rgba(255, 90, 168, 0.15)' }} />

        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wider" style={{ color: PINK_LIGHT }}>
            Permissions
          </label>
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>
            Permission-only controls (no auto-start).
          </p>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs" style={{ color: 'rgba(226, 234, 255, 0.92)' }}>
                Microphone: {formatPermissionStatus(permissionStatus.microphone)}
              </div>
              <button
                type="button"
                onClick={() => handlePermissionRequest('microphone')}
                disabled={permissionBusy.microphone}
                className="px-2 py-1 text-xs font-semibold rounded-lg border cursor-pointer transition-opacity hover:opacity-90 disabled:opacity-60"
                style={{
                  background: PINK_GLOSS_FILL,
                  borderColor: 'rgba(255, 182, 224, 0.86)',
                  color: '#ffeaf7',
                }}
              >
                {permissionBusy.microphone ? 'Checking…' : 'Enable'}
              </button>
            </div>

            <div className="flex items-center justify-between gap-2">
              <div className="text-xs" style={{ color: 'rgba(226, 234, 255, 0.92)' }}>
                Screen audio/capture: {formatPermissionStatus(permissionStatus.screen)}
              </div>
              <button
                type="button"
                onClick={() => handlePermissionRequest('screen')}
                disabled={permissionBusy.screen}
                className="px-2 py-1 text-xs font-semibold rounded-lg border cursor-pointer transition-opacity hover:opacity-90 disabled:opacity-60"
                style={{
                  background: PINK_GLOSS_FILL,
                  borderColor: 'rgba(255, 182, 224, 0.86)',
                  color: '#ffeaf7',
                }}
              >
                {permissionBusy.screen ? 'Checking…' : 'Enable'}
              </button>
            </div>

            <div className="flex items-center justify-between gap-2">
              <div className="text-xs" style={{ color: 'rgba(226, 234, 255, 0.92)' }}>
                Screenshot: {formatPermissionStatus(permissionStatus.screenshot)}
              </div>
              <button
                type="button"
                onClick={() => handlePermissionRequest('screenshot')}
                disabled={permissionBusy.screenshot}
                className="px-2 py-1 text-xs font-semibold rounded-lg border cursor-pointer transition-opacity hover:opacity-90 disabled:opacity-60"
                style={{
                  background: PINK_GLOSS_FILL,
                  borderColor: 'rgba(255, 182, 224, 0.86)',
                  color: '#ffeaf7',
                }}
              >
                {permissionBusy.screenshot ? 'Checking…' : 'Enable'}
              </button>
            </div>
          </div>
        </div>

        <p className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>
          Default: Settings Alt+K · Main Panel Alt+L
        </p>
      </div>
    </div>
  )
}

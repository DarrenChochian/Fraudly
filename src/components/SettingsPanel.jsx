import { useEffect, useState } from 'react'

const PINK = '#ff5aa8'
const PINK_LIGHT = '#ff8ec8'
const PINK_GLOW = 'rgba(255, 90, 168, 0.25)'
const BORDER_PINK = 'rgba(255, 90, 168, 0.4)'
const BG_PANEL = 'rgba(10, 10, 12, 0.5)'

const MODIFIER_KEYS = new Set(['Alt', 'Control', 'Shift', 'Meta', 'AltGraph'])

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

export default function SettingsPanel({ currentHotkey: propHotkey = 'Alt+K', onHotkeyChange, mainPanelHotkey: propMainPanelHotkey = 'Alt+L', onMainPanelHotkeyChange, onClose, onInteractiveEnter, onInteractiveLeave }) {
  const [currentHotkey, setCurrentHotkey] = useState(propHotkey)
  const [mainPanelHotkey, setMainPanelHotkey] = useState(propMainPanelHotkey)
  const [recording, setRecording] = useState(false)
  const [mainPanelRecording, setMainPanelRecording] = useState(false)
  const [status, setStatus] = useState(null) // 'saved' | 'error' | null
  const [mainPanelStatus, setMainPanelStatus] = useState(null)

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

  return (
    <div
      onMouseEnter={onInteractiveEnter}
      onMouseLeave={onInteractiveLeave}
      className="overlay-interactive absolute top-24 left-1/2 -translate-x-1/2 w-80 rounded-2xl border-2 overflow-hidden z-20"
      style={{
        backgroundColor: BG_PANEL,
        borderColor: BORDER_PINK,
        boxShadow: `0 0 24px ${PINK_GLOW}`,
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b shrink-0"
        style={{
          backgroundColor: 'rgba(255, 90, 168, 0.08)',
          borderColor: 'rgba(255, 90, 168, 0.3)',
        }}
      >
        <span className="text-sm font-semibold" style={{ color: PINK_LIGHT }}>
          Settings
        </span>
        <button
          type="button"
          onClick={onClose}
          className="w-8 h-8 flex items-center justify-center text-xl leading-none rounded-lg cursor-pointer transition-colors border border-transparent hover:border-pink-500/50"
          style={{ color: PINK_LIGHT }}
          title="Close settings"
        >
          ×
        </button>
      </div>

      {/* Body */}
      <div className="p-4 space-y-4">
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
                backgroundColor: recording ? 'rgba(255, 90, 168, 0.1)' : 'rgba(0,0,0,0.3)',
                borderColor: recording ? PINK : 'rgba(255, 90, 168, 0.3)',
                color: recording ? PINK_LIGHT : 'rgba(255,255,255,0.85)',
                boxShadow: recording ? `0 0 8px ${PINK_GLOW}` : 'none',
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
                backgroundColor: recording ? 'rgba(255, 90, 168, 0.15)' : PINK,
                borderColor: recording ? PINK : 'transparent',
                color: 'white',
              }}
            >
              {recording ? 'Cancel' : 'Change'}
            </button>
          </div>

          {/* Status feedback */}
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
                backgroundColor: mainPanelRecording ? 'rgba(255, 90, 168, 0.1)' : 'rgba(0,0,0,0.3)',
                borderColor: mainPanelRecording ? PINK : 'rgba(255, 90, 168, 0.3)',
                color: mainPanelRecording ? PINK_LIGHT : 'rgba(255,255,255,0.85)',
                boxShadow: mainPanelRecording ? `0 0 8px ${PINK_GLOW}` : 'none',
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
                backgroundColor: mainPanelRecording ? 'rgba(255, 90, 168, 0.15)' : PINK,
                borderColor: mainPanelRecording ? PINK : 'transparent',
                color: 'white',
              }}
            >
              {mainPanelRecording ? 'Cancel' : 'Change'}
            </button>
          </div>
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

        <p className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>
          Default: Settings Alt+K, Main Panel Alt+L
        </p>
      </div>
    </div>
  )
}

import { useState, useEffect, useRef } from 'react'
import TopBar from './components/TopBar'
import ChatPanel from './components/ChatPanel'
import TranscriptionDebug from './components/TranscriptionDebug'
import SettingsPanel from './components/SettingsPanel'
import { useInteractivity } from './hooks/useInteractivity'
import { usePermissions } from './hooks/usePermissions'
import { useHotkeys } from './hooks/useHotkeys'
import { useMediaCapture } from './hooks/useMediaCapture'
import { useTranscription } from './hooks/useTranscription'
import { useResearch } from './hooks/useResearch'
import { SUSPICIOUS_SCAN_CHAT_ID, CHAT_DEFINITIONS } from './utils/constants'
import { buildSuspiciousScanPrompt, truncate, previewForHistory } from './utils/chat'

export default function App() {
  const isMac = window.electronAPI?.platform === 'darwin'
  const [isListening, setIsListening] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [selectedChatId, setSelectedChatId] = useState(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [screenshotStatus, setScreenshotStatus] = useState('idle')
  const [lastScreenshotAt, setLastScreenshotAt] = useState('')
  const latestTranscriptsRef = useRef({ caller: '', user: '' })
  const suspiciousScanHandlerRef = useRef(async () => {})
  const suspiciousScanInFlightRef = useRef(false)
  
  const { handleInteractiveEnter, handleInteractiveLeave, resetOverlayInteractivity } = useInteractivity()
  const { permissionStatus, requestPermission, refreshPermissionStatus } = usePermissions()
  const { hotkey, setHotkey, mainPanelHotkey, setMainPanelHotkey, mainPanelHotkeyFailed, settingsHotkeyFailed } = useHotkeys()
  const { sourceAudioLevels, startMediaCapture, cleanupMediaCapture } = useMediaCapture()
  const {
    transcriptionSessionState,
    setTranscriptionSessionState,
    sourceStates,
    setSourceStates,
    sourceChunkCounts,
    latestTranscripts,
    transcriptKinds,
    transcriptionError,
    setTranscriptionError,
    transcriptionWarning,
    setTranscriptionWarning,
    lastTranscriptionActivityAt,
    resetTranscriptionState,
  } = useTranscription({ sourceAudioLevels, isListening })
  
  const {
    chatMessages,
    runningByChat,
    runningByChatRef,
    toggleToolCard,
    runResearchPrompt,
  } = useResearch()

  useEffect(() => {
    latestTranscriptsRef.current = latestTranscripts
  }, [latestTranscripts])

  const stopListeningSession = async ({ reason } = {}) => {
    cleanupMediaCapture()
    try {
      await window.electronAPI?.stopTranscription?.()
    } catch {
      // Ignore stop errors.
    }

    setIsListening(false)
    setSourceStates({
      caller: sourceStates.caller === 'error' ? 'error' : 'idle',
      user: sourceStates.user === 'error' ? 'error' : 'idle',
    })

    if (reason) {
      setTranscriptionError(reason)
      setTranscriptionSessionState('error')
    } else {
      setTranscriptionSessionState('idle')
    }
  }

  const startListeningSession = async () => {
    if (isListening || transcriptionSessionState === 'connecting') return

    resetTranscriptionState()

    let captureResult
    try {
      captureResult = await startMediaCapture({
        onDesktopEnded: () => {
          stopListeningSession({ reason: 'Desktop capture stopped.' })
        },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Media capture failed'
      setTranscriptionError(message)
      setTranscriptionSessionState('error')
      const isCallerError = message.includes('Desktop')
      const isUserError = message.includes('Microphone')
      setSourceStates({
        caller: isCallerError ? 'error' : 'idle',
        user: isUserError ? 'error' : 'idle',
      })
      await refreshPermissionStatus()
      return
    }

    const { activeSources, callerStream, userStream, recorderFailures } = captureResult

    if (!callerStream) {
      setTranscriptionWarning('Desktop audio track is unavailable. Grant screen recording + system audio and retry.')
      setSourceStates((prev) => ({ ...prev, caller: 'no-audio-track' }))
    }
    if (!userStream) {
      setTranscriptionWarning((prev) => (prev ? `${prev} Microphone track missing.` : 'Microphone track missing.'))
      setSourceStates((prev) => ({ ...prev, user: 'no-audio-track' }))
    }

    if (activeSources.length === 0) {
      cleanupMediaCapture()
      const extra = recorderFailures.length ? ` ${recorderFailures.join(' | ')}` : ''
      setTranscriptionError(`Unable to initialize audio recorders.${extra}`)
      setTranscriptionSessionState('error')
      return
    }

    const startResult = await window.electronAPI?.startTranscription?.(activeSources)
    if (!startResult?.ok) {
      cleanupMediaCapture()
      setTranscriptionError(startResult?.error || 'Unable to start transcription session.')
      setTranscriptionSessionState('error')
      setSourceStates({ caller: 'error', user: 'error' })
      return
    }

    setIsListening(true)
    setTranscriptionSessionState('listening')
    await refreshPermissionStatus()
  }

  const toggleListeningSession = () => {
    if (isListening) {
      stopListeningSession()
      return
    }
    startListeningSession()
  }

  const captureScreenshot = async () => {
    setScreenshotStatus('capturing')
    try {
      const result = await window.electronAPI?.captureScreenshot?.()
      if (!result?.ok) {
        setScreenshotStatus('error')
        setTranscriptionError(result?.error || 'Failed to capture screenshot.')
        return null
      }

      setScreenshotStatus('captured')
      setLastScreenshotAt(new Date().toLocaleTimeString())
      return result
    } catch {
      setScreenshotStatus('error')
      setTranscriptionError('Failed to capture screenshot.')
      return null
    }
  }

  const handleSuspiciousScanHotkey = async () => {
    if (suspiciousScanInFlightRef.current || runningByChatRef.current[SUSPICIOUS_SCAN_CHAT_ID]) return

    suspiciousScanInFlightRef.current = true
    setChatOpen(true)
    setSelectedChatId(SUSPICIOUS_SCAN_CHAT_ID)

    try {
      const screenshotResult = await captureScreenshot()
      if (!screenshotResult?.ok) return

      const prompt = buildSuspiciousScanPrompt({
        screenshotResult,
        callerTranscript: latestTranscriptsRef.current.caller,
        userTranscript: latestTranscriptsRef.current.user,
      })

      await runResearchPrompt({
        chatId: SUSPICIOUS_SCAN_CHAT_ID,
        text: prompt,
        resetThread: true,
        replaceChatMessages: true,
        attachmentFilePaths: [screenshotResult.filePath],
      })
    } finally {
      suspiciousScanInFlightRef.current = false
    }
  }

  suspiciousScanHandlerRef.current = handleSuspiciousScanHotkey

  useEffect(() => {
    const unsubSettings = window.electronAPI?.onOpenSettings?.(() => {
      setSettingsOpen((v) => {
        if (v) resetOverlayInteractivity()
        return !v
      })
    })
    const unsubSuspiciousScan = window.electronAPI?.onSuspiciousScanTrigger?.(() => {
      console.log('[renderer] suspicious-scan:trigger received')
      suspiciousScanHandlerRef.current?.().catch((error) => {
        console.error('Suspicious scan hotkey failed:', error)
      })
    })
    return () => {
      unsubSettings?.()
      unsubSuspiciousScan?.()
    }
  }, [])

  useEffect(() => {
    return () => {
      cleanupMediaCapture()
      window.electronAPI?.stopTranscription?.()
    }
  }, [])

  const handleChatSend = async (text) => {
    await runResearchPrompt({ chatId: selectedChatId, text })
  }

  const handleToggleTool = (messageId) => {
    toggleToolCard(selectedChatId, messageId)
  }

  const historyWithPreview = CHAT_DEFINITIONS.map((chat) => {
    const messagesForChat = chatMessages[chat.id] || []
    const lastMessage = messagesForChat[messagesForChat.length - 1]
    return {
      ...chat,
      preview: truncate(previewForHistory(lastMessage)),
    }
  })

  const messages = selectedChatId ? (chatMessages[selectedChatId] || []) : []
  const selectedChatIsRunning = selectedChatId ? Boolean(runningByChat[selectedChatId]) : false

  return (
    <div className="relative w-screen h-screen overflow-hidden">
      <TopBar
        isListening={isListening}
        onToggleListen={toggleListeningSession}
        transcriptionState={transcriptionSessionState}
        chatOpen={chatOpen}
        onChatToggle={() => setChatOpen((v) => !v)}
        onMouseEnter={handleInteractiveEnter}
        onMouseLeave={handleInteractiveLeave}
      />

      <ChatPanel
        open={chatOpen}
        history={historyWithPreview}
        selectedChatId={selectedChatId}
        onSelectChat={setSelectedChatId}
        messages={messages}
        onSend={handleChatSend}
        isRunning={selectedChatIsRunning}
        onToggleTool={handleToggleTool}
        onScreenshot={captureScreenshot}
        onMouseEnter={handleInteractiveEnter}
        onMouseLeave={handleInteractiveLeave}
      />

      <TranscriptionDebug
        transcriptionSessionState={transcriptionSessionState}
        sourceStates={sourceStates}
        sourceChunkCounts={sourceChunkCounts}
        sourceAudioLevels={sourceAudioLevels}
        latestTranscripts={latestTranscripts}
        transcriptKinds={transcriptKinds}
        lastTranscriptionActivityAt={lastTranscriptionActivityAt}
        screenshotStatus={screenshotStatus}
        lastScreenshotAt={lastScreenshotAt}
        transcriptionWarning={transcriptionWarning}
        transcriptionError={transcriptionError}
        isMac={isMac}
        onMouseEnter={handleInteractiveEnter}
        onMouseLeave={handleInteractiveLeave}
      />

      {settingsOpen && (
        <SettingsPanel
          currentHotkey={hotkey}
          onHotkeyChange={setHotkey}
          settingsHotkeyFailed={settingsHotkeyFailed}
          mainPanelHotkey={mainPanelHotkey}
          onMainPanelHotkeyChange={setMainPanelHotkey}
          mainPanelHotkeyFailed={mainPanelHotkeyFailed}
          permissionStatus={permissionStatus}
          onRequestPermission={requestPermission}
          onClose={() => {
            setSettingsOpen(false)
            resetOverlayInteractivity()
          }}
          onInteractiveEnter={handleInteractiveEnter}
          onInteractiveLeave={handleInteractiveLeave}
        />
      )}

      {/* Settings gear button */}
      <button
        type="button"
        onClick={() => setSettingsOpen((v) => {
          if (v) resetOverlayInteractivity()
          return !v
        })}
        onMouseEnter={handleInteractiveEnter}
        onMouseLeave={handleInteractiveLeave}
        className="overlay-interactive absolute right-6 top-6 w-10 h-10 flex items-center justify-center rounded-xl border cursor-pointer transition-all hover:scale-110 active:scale-95 z-20"
        style={{
          background: settingsOpen
            ? 'radial-gradient(179.05% 132.83% at 46.18% -23.44%, #ff9bd8 0%, #ff5aa8 35%, #bb2f7a 72%, #6b1b4a 100%)'
            : 'radial-gradient(170% 130% at 46% -20%, rgba(124, 138, 172, 0.14) 0%, rgba(25, 30, 43, 0.82) 56%, rgba(8, 11, 17, 0.95) 100%)',
          borderColor: settingsOpen ? 'rgba(255, 190, 229, 0.9)' : 'rgba(123, 136, 168, 0.3)',
          color: settingsOpen ? '#ffe7f5' : 'rgba(224, 232, 255, 0.9)',
          boxShadow: settingsOpen
            ? '0 0 0 0.7px rgba(255, 133, 199, 0.95), inset 0 -1.35px rgba(93, 10, 57, 0.9), inset 0 0.7px rgba(255, 205, 233, 0.8), 0 9px 28px rgba(134, 25, 90, 0.56), 0 30px 45px rgba(0, 0, 0, 0.28)'
            : '0 0 0 1px rgba(116, 128, 158, 0.16), inset 0 -1.2px rgba(5, 7, 12, 0.92), inset 0 0.7px rgba(154, 167, 198, 0.2), 0 20px 44px rgba(0, 0, 0, 0.54), 0 8px 22px rgba(2, 4, 10, 0.56)',
          backdropFilter: 'blur(18px) saturate(150%)',
          WebkitBackdropFilter: 'blur(18px) saturate(150%)',
        }}
        title={`Settings (${hotkey})`}
      >
        ⚙
      </button>
    </div>
  )
}

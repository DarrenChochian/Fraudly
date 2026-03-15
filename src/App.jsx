import { useState, useEffect, useRef, useCallback } from 'react'
import TopBar from './components/TopBar'
import ChatPanel from './components/ChatPanel'
import TranscriptionDebug from './components/TranscriptionDebug'
import Notification from './components/Notification'
import SettingsPanel from './components/SettingsPanel'
import { useInteractivity } from './hooks/useInteractivity'
import { usePermissions } from './hooks/usePermissions'
import { useHotkeys } from './hooks/useHotkeys'
import { useMediaCapture } from './hooks/useMediaCapture'
import { useTranscription } from './hooks/useTranscription'
import { useResearch } from './hooks/useResearch'
import { useHiveDetection } from './hooks/useHiveDetection'
import { SHOW_TRANSCRIPTION_DEBUG, SUSPICIOUS_SCAN_CHAT_ID } from './utils/constants'
import { buildBackgroundMonitorPrompt, buildSuspiciousScanPrompt, truncate, previewForHistory } from './utils/chat'
import {
  buildIncidentAlertTitle,
  buildIncidentChatSummary,
  buildMonitorVerdictLog,
  hasMeaningfulIncidentChange,
  isSameIncident,
  isSuspiciousMonitorResult,
  parseMonitorSummary,
} from './utils/monitoring'

const MONITOR_INTERVAL_MS = 3000
const ACTIVE_INCIDENT_NOTIFICATION_ID = 'active-monitor-incident'
const SAFE_MONITOR_CLEAR_STREAK = 2

export default function App() {
  const isMac = window.electronAPI?.platform === 'darwin'
  const [isListening, setIsListening] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [selectedChatId, setSelectedChatId] = useState(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [screenshotStatus, setScreenshotStatus] = useState('idle')
  const [lastScreenshotAt, setLastScreenshotAt] = useState('')
  const [lastAnalysisAt, setLastAnalysisAt] = useState('')
  const [monitorLogs, setMonitorLogs] = useState([])
  const [notifications, setNotifications] = useState([{ id: Date.now(), message: 'Welcome to Fraudly' }])
  const [callerStream, setCallerStream] = useState(null)
  const latestTranscriptsRef = useRef({ caller: '', user: '' })
  const transcriptWindowRef = useRef([])
  const isListeningRef = useRef(false)
  const chatOpenRef = useRef(false)
  const incidentNotificationOpenRef = useRef(false)
  const previousChatOpenRef = useRef(false)
  const suspiciousScanHandlerRef = useRef(async () => {})
  const monitorHandlerRef = useRef(async () => {})
  const suspiciousScanInFlightRef = useRef(false)
  const monitorBusyRef = useRef(false)
  const monitorIntervalRef = useRef(null)
  const safeMonitorStreakRef = useRef(0)
  const activeIncidentRef = useRef(null)
  
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
    transcriptWindow,
    transcriptKinds,
    transcriptionError,
    setTranscriptionError,
    transcriptionWarning,
    setTranscriptionWarning,
    lastTranscriptionActivityAt,
    resetTranscriptionState,
  } = useTranscription({ sourceAudioLevels, isListening })
  
  const {
    chats,
    chatMessages,
    runningByChat,
    runningByChatRef,
    toggleToolCard,
    appendStoredAssistantMessage,
    importRunToChat,
    ensureChat,
    createAnalysisChat,
    setChatTitle,
    runResearchPrompt,
  } = useResearch()

  const { hiveResult, hiveStatus } = useHiveDetection({ callerStream, isListening })

  const handleChatToggle = useCallback(() => {
    setChatOpen((v) => {
      const next = !v
      if (!next) resetOverlayInteractivity()
      return next
    })
  }, [resetOverlayInteractivity])

  useEffect(() => {
    latestTranscriptsRef.current = latestTranscripts
  }, [latestTranscripts])

  useEffect(() => {
    transcriptWindowRef.current = transcriptWindow
  }, [transcriptWindow])

  useEffect(() => {
    isListeningRef.current = isListening
  }, [isListening])

  useEffect(() => {
    chatOpenRef.current = chatOpen
    if (previousChatOpenRef.current && !chatOpen && activeIncidentRef.current) {
      activeIncidentRef.current = {
        ...activeIncidentRef.current,
        awaitingRenotify: true,
      }
    }
    previousChatOpenRef.current = chatOpen
  }, [chatOpen])

  useEffect(() => {
    incidentNotificationOpenRef.current = notifications.some((item) => item.id === ACTIVE_INCIDENT_NOTIFICATION_ID)
  }, [notifications])

  const focusIncidentChat = (chatId) => {
    if (!chatId) return
    setChatOpen(true)
    setSelectedChatId(chatId)
  }

  const upsertIncidentNotification = ({ title, message, chatId }) => {
    const nextNotification = {
      id: ACTIVE_INCIDENT_NOTIFICATION_ID,
      title,
      message,
      chatId,
    }

    setNotifications((prev) => [
      ...prev.filter((item) => item.id !== ACTIVE_INCIDENT_NOTIFICATION_ID),
      nextNotification,
    ])
  }

  const clearIncidentNotification = ({ armRenotify = false } = {}) => {
    if (armRenotify && activeIncidentRef.current) {
      activeIncidentRef.current = {
        ...activeIncidentRef.current,
        awaitingRenotify: true,
      }
    }
    setNotifications((prev) => prev.filter((item) => item.id !== ACTIVE_INCIDENT_NOTIFICATION_ID))
  }

  const shouldSuppressAutoIncidentUpdate = () => incidentNotificationOpenRef.current || chatOpenRef.current

  const appendMonitorLog = (message) => {
    const nextEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      at: new Date().toLocaleTimeString(),
      message,
    }

    setMonitorLogs((prev) => [...prev.slice(-7), nextEntry])
  }

  const resetBackgroundMonitorState = ({ clearNotification = false } = {}) => {
    monitorBusyRef.current = false
    safeMonitorStreakRef.current = 0
    activeIncidentRef.current = null
    setLastAnalysisAt('')
    setMonitorLogs([])
    if (clearNotification) {
      clearIncidentNotification()
    }
  }

  const stopListeningSession = async ({ reason } = {}) => {
    isListeningRef.current = false
    if (monitorIntervalRef.current) {
      clearInterval(monitorIntervalRef.current)
      monitorIntervalRef.current = null
    }
    resetBackgroundMonitorState()
    cleanupMediaCapture()
    setCallerStream(null)
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

    const { activeSources, callerStream: capturedCallerStream, userStream, recorderFailures } = captureResult
    if (capturedCallerStream) setCallerStream(capturedCallerStream)

    if (!capturedCallerStream) {
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
    isListeningRef.current = true
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

  const captureScreenshot = async ({ silent = false } = {}) => {
    setScreenshotStatus('capturing')
    try {
      const result = await window.electronAPI?.captureScreenshot?.()
      if (!result?.ok) {
        setScreenshotStatus('error')
        if (!silent) {
          setTranscriptionError(result?.error || 'Failed to capture screenshot.')
        }
        return null
      }

      setScreenshotStatus('captured')
      setLastScreenshotAt(new Date().toLocaleTimeString())
      return result
    } catch {
      setScreenshotStatus('error')
      if (!silent) {
        setTranscriptionError('Failed to capture screenshot.')
      }
      return null
    }
  }

  const handleSafeMonitorResult = () => {
    setLastAnalysisAt(new Date().toLocaleTimeString())
    if (!activeIncidentRef.current) return

    safeMonitorStreakRef.current += 1
    appendMonitorLog(`Safe scan (${safeMonitorStreakRef.current}/${SAFE_MONITOR_CLEAR_STREAK}) while incident is active`)
    if (safeMonitorStreakRef.current >= SAFE_MONITOR_CLEAR_STREAK) {
      appendMonitorLog('Cleared active incident after consecutive safe scans')
      resetBackgroundMonitorState({ clearNotification: true })
    }
  }

  const handleSuspiciousMonitorResult = async ({ monitorResult, runResult }) => {
    const currentIncident = activeIncidentRef.current
    const sameIncident = isSameIncident(currentIncident, monitorResult)
    const shouldAppendUpdate = !sameIncident || hasMeaningfulIncidentChange(currentIncident, monitorResult)
    const quickDebrief = monitorResult.quickDebrief || truncate(monitorResult.displaySummary, 140)

    safeMonitorStreakRef.current = 0
    setLastAnalysisAt(new Date().toLocaleTimeString())

    if (!sameIncident) {
      const provisionalTitle = monitorResult.incidentTitle || 'Possible fraud detected'
      const chat = await createAnalysisChat({ title: provisionalTitle })
      if (!chat?.id) return

      upsertIncidentNotification({
        title: buildIncidentAlertTitle(monitorResult),
        message: quickDebrief,
        chatId: chat.id,
      })

      const importedChat = runResult?.run ? await importRunToChat({ chatId: chat.id, run: runResult.run }) : null

      const finalMonitorResult = monitorResult
      const finalQuickDebrief = finalMonitorResult.quickDebrief || truncate(finalMonitorResult.displaySummary, 140)

      if (finalMonitorResult.incidentTitle) {
        await setChatTitle(chat.id, finalMonitorResult.incidentTitle)
      }

      activeIncidentRef.current = {
        chatId: chat.id,
        title: finalMonitorResult.incidentTitle,
        quickDebrief: finalQuickDebrief,
        fingerprint: finalMonitorResult.fingerprint,
        riskLevel: finalMonitorResult.riskLevel,
        lastSummary: finalMonitorResult.displaySummary,
        lastSeenAt: new Date().toISOString(),
        awaitingRenotify: false,
      }

      if (!importedChat) {
        await appendStoredAssistantMessage({
          chatId: chat.id,
          text: buildIncidentChatSummary(finalMonitorResult),
        })
      }

      upsertIncidentNotification({
        title: buildIncidentAlertTitle(finalMonitorResult),
        message: finalQuickDebrief,
        chatId: chat.id,
      })
      appendMonitorLog(`New incident detected: ${finalMonitorResult.incidentTitle || 'Possible fraud detected'}`)
      return
    }

    activeIncidentRef.current = {
      ...currentIncident,
      title: monitorResult.incidentTitle || currentIncident.title,
      quickDebrief: quickDebrief || currentIncident.quickDebrief,
      fingerprint: monitorResult.fingerprint || currentIncident.fingerprint,
      riskLevel: monitorResult.riskLevel || currentIncident.riskLevel,
      lastSummary: monitorResult.displaySummary || currentIncident.lastSummary,
      lastSeenAt: new Date().toISOString(),
    }

    if (shouldSuppressAutoIncidentUpdate()) {
      appendMonitorLog(`Auto-update suppressed while notification or chat is open for ${monitorResult.incidentTitle || currentIncident.title || 'active incident'}`)
      return
    }

    if (!shouldAppendUpdate && !currentIncident.awaitingRenotify) {
      appendMonitorLog(`Same incident still visible: ${monitorResult.incidentTitle || currentIncident.title || 'active incident'}`)
      return
    }

    activeIncidentRef.current = {
      ...activeIncidentRef.current,
      awaitingRenotify: false,
    }

    if (runResult?.run) {
      await importRunToChat({ chatId: currentIncident.chatId, run: runResult.run })
    }

    upsertIncidentNotification({
      title: buildIncidentAlertTitle(monitorResult),
      message: quickDebrief,
      chatId: currentIncident.chatId,
    })
    appendMonitorLog(`Incident updated: ${monitorResult.incidentTitle || currentIncident.title || 'active incident'}`)
  }

  const runBackgroundMonitorPass = async () => {
    if (!isListeningRef.current || !window.electronAPI?.runBackgroundResearch) return
    if (monitorBusyRef.current) {
      appendMonitorLog('Skipped monitor cycle because previous analysis is still running')
      return
    }

    monitorBusyRef.current = true
    try {
      appendMonitorLog('Capturing screenshot for background monitor')
      const screenshotResult = await captureScreenshot({ silent: true })
      if (!screenshotResult?.ok || !isListeningRef.current) return

      const prompt = buildBackgroundMonitorPrompt({
        screenshotResult,
        callerTranscript: latestTranscriptsRef.current.caller,
        userTranscript: latestTranscriptsRef.current.user,
        transcriptWindow: transcriptWindowRef.current,
        activeIncident: activeIncidentRef.current,
      })
      const attachmentFilePaths = [screenshotResult.filePath]
      const monitorThreadChatId = `background-monitor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

      appendMonitorLog('Running fraud analysis on latest screenshot')
      const result = await window.electronAPI.runBackgroundResearch({
        chatId: monitorThreadChatId,
        historyChatId: '',
        prompt,
        displayPrompt: 'Background fraud check',
        resetThread: true,
        attachmentFilePaths,
      })
      if (!isListeningRef.current) return

      const monitorResult = parseMonitorSummary(result?.summary || '')
      if (!monitorResult.rawSummary.includes('```fraud-monitor')) {
        appendMonitorLog('Monitor response missing structured fraud-monitor block; treating result as incomplete')
        return
      }
      appendMonitorLog(buildMonitorVerdictLog(monitorResult))
      if (isSuspiciousMonitorResult(monitorResult)) {
        await handleSuspiciousMonitorResult({ monitorResult, runResult: result })
      } else {
        handleSafeMonitorResult()
      }
    } catch (error) {
      appendMonitorLog(`Monitor error: ${error instanceof Error ? error.message : 'Unknown error'}`)
      console.error('Background fraud monitor failed:', error)
    } finally {
      monitorBusyRef.current = false
    }
  }

  const handleSuspiciousScanHotkey = async () => {
    if (suspiciousScanInFlightRef.current || runningByChatRef.current[SUSPICIOUS_SCAN_CHAT_ID]) return

    suspiciousScanInFlightRef.current = true
    setChatOpen(true)
    await ensureChat(SUSPICIOUS_SCAN_CHAT_ID)
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
        displayText: 'Analyze this screenshot for scam risk and compare it with the company\'s official fraud/contact policies.',
        resetThread: true,
        replaceChatMessages: true,
        attachmentFilePaths: [screenshotResult.filePath],
      })
    } finally {
      suspiciousScanInFlightRef.current = false
    }
  }

  suspiciousScanHandlerRef.current = handleSuspiciousScanHotkey
  monitorHandlerRef.current = runBackgroundMonitorPass

  useEffect(() => {
    const unsubSettings = window.electronAPI?.onOpenSettings?.(() => {
      setSettingsOpen((v) => {
        if (v) resetOverlayInteractivity()
        return !v
      })
    })
    const unsubMainPanel = window.electronAPI?.onMainPanelOpen?.(() => {
      console.log('[renderer] main-panel:open received')
      handleChatToggle()
    })
    const unsubSuspiciousScan = window.electronAPI?.onSuspiciousScanTrigger?.(() => {
      console.log('[renderer] suspicious-scan:trigger received')
      suspiciousScanHandlerRef.current?.().catch((error) => {
        console.error('Suspicious scan hotkey failed:', error)
      })
    })
    return () => {
      unsubSettings?.()
      unsubMainPanel?.()
      unsubSuspiciousScan?.()
    }
  }, [handleChatToggle, resetOverlayInteractivity])

  useEffect(() => {
    if (!isListening) return undefined

    monitorHandlerRef.current?.().catch((error) => {
      console.error('Initial background fraud monitor pass failed:', error)
    })

    monitorIntervalRef.current = setInterval(() => {
      monitorHandlerRef.current?.().catch((error) => {
        console.error('Background fraud monitor pass failed:', error)
      })
    }, MONITOR_INTERVAL_MS)

    return () => {
      if (monitorIntervalRef.current) {
        clearInterval(monitorIntervalRef.current)
        monitorIntervalRef.current = null
      }
      monitorBusyRef.current = false
    }
  }, [isListening])

  useEffect(() => {
    return () => {
      if (monitorIntervalRef.current) {
        clearInterval(monitorIntervalRef.current)
        monitorIntervalRef.current = null
      }
      cleanupMediaCapture()
      window.electronAPI?.stopTranscription?.()
    }
  }, [])

  const handleChatSend = async (text) => {
    let prompt = text
    let attachmentFilePaths = []

    const screenshotResult = await captureScreenshot({ silent: true })
    if (screenshotResult?.ok) {
      attachmentFilePaths = [screenshotResult.filePath]
      prompt = `${text}\n\nA fresh screenshot is attached for current on-screen context. Use it when answering this follow-up.`
    }

    await runResearchPrompt({
      chatId: selectedChatId,
      text: prompt,
      displayText: text,
      attachmentFilePaths,
    })
  }

  const handleCreateAnalysisChat = async () => {
    const chat = await createAnalysisChat()
    if (!chat?.id) return

    setChatOpen(true)
    setSelectedChatId(chat.id)
  }

  const handleToggleTool = (messageId) => {
    toggleToolCard(selectedChatId, messageId)
  }

  const historyWithPreview = chats.map((chat) => {
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
        onChatToggle={handleChatToggle}
        onMouseEnter={handleInteractiveEnter}
        onMouseLeave={handleInteractiveLeave}
        hiveResult={hiveResult}
        hiveStatus={hiveStatus}
      />

      <ChatPanel
        open={chatOpen}
        history={historyWithPreview}
        selectedChatId={selectedChatId}
        onSelectChat={setSelectedChatId}
        onCreateChat={handleCreateAnalysisChat}
        messages={messages}
        onSend={handleChatSend}
        isRunning={selectedChatIsRunning}
        onToggleTool={handleToggleTool}
        onScreenshot={captureScreenshot}
        onMouseEnter={handleInteractiveEnter}
        onMouseLeave={handleInteractiveLeave}
      />

      {SHOW_TRANSCRIPTION_DEBUG && (
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
          lastAnalysisAt={lastAnalysisAt}
          monitorLogs={monitorLogs}
          transcriptionWarning={transcriptionWarning}
          transcriptionError={transcriptionError}
          isMac={isMac}
          onMouseEnter={handleInteractiveEnter}
          onMouseLeave={handleInteractiveLeave}
        />
      )}

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
      
      {/* Notifications container */}
      <div className="absolute top-[88px] left-0 right-0 z-50 flex flex-col items-center pointer-events-none gap-2">
        {notifications.map((n) => (
          <Notification
            key={n.id}
            title={n.title}
            message={n.message}
            onClick={n.chatId ? () => focusIncidentChat(n.chatId) : undefined}
            onClose={() => {
              if (n.id === ACTIVE_INCIDENT_NOTIFICATION_ID) {
                clearIncidentNotification({ armRenotify: true })
                return
              }
              setNotifications((prev) => prev.filter((item) => item.id !== n.id))
            }}
            onMouseEnter={handleInteractiveEnter}
            onMouseLeave={handleInteractiveLeave}
          />
        ))}
      </div>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import CircularText from './components/CircularText'
import SettingsPanel from './components/SettingsPanel'

function WaveformIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M4 14v-4h2v4H4zm4 2v-8h2v8H8zm4-4V6h2v6h-2zm4 2V4h2v8h-2zm4 4V2h2v14h-2z" />
    </svg>
  )
}

const BUTTON_WIDTH = 64
const BUTTON_HEIGHT = 64

const PINK = '#ff5aa8'
const PINK_LIGHT = '#ff8ec8'
const PINK_GLOW = 'rgba(255, 90, 168, 0.25)'
const BORDER_PINK = 'rgba(255, 90, 168, 0.4)'
const BG_PANEL = 'rgba(10, 10, 12, 0.5)'

const CHAT_DEFINITIONS = [
  { id: '1', title: 'Chat 1' },
  { id: '2', title: 'Chat 2' },
  { id: '3', title: 'Chat 3' },
]

const CHAT_IDS = CHAT_DEFINITIONS.map((chat) => chat.id)

function createMessageId(prefix = 'msg') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function truncate(text, max = 90) {
  const value = String(text ?? '')
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

function initialMessagesForChat(chatId) {
  return [
    {
      id: `${chatId}-welcome`,
      type: 'text',
      role: 'assistant',
      text: 'Hello! How can I help you today?',
    },
  ]
}

function buildInitialChatMessages() {
  return Object.fromEntries(CHAT_DEFINITIONS.map((chat) => [chat.id, initialMessagesForChat(chat.id)]))
}

function statusStyles(status) {
  if (status === 'success') {
    return {
      borderColor: 'rgba(34, 197, 94, 0.35)',
      textColor: 'rgb(134 239 172)',
      badgeBg: 'rgba(34, 197, 94, 0.15)',
      badgeText: 'rgb(134 239 172)',
    }
  }
  if (status === 'error') {
    return {
      borderColor: 'rgba(239, 68, 68, 0.4)',
      textColor: 'rgb(252 165 165)',
      badgeBg: 'rgba(239, 68, 68, 0.15)',
      badgeText: 'rgb(252 165 165)',
    }
  }
  return {
    borderColor: 'rgba(255, 90, 168, 0.45)',
    textColor: PINK_LIGHT,
    badgeBg: 'rgba(255, 90, 168, 0.15)',
    badgeText: PINK_LIGHT,
  }
}

function previewForHistory(message) {
  if (!message) return 'No activity yet'
  if (message.type === 'tool') {
    return `${message.toolName || 'tool'} (${message.status || 'running'}) • ${message.argsPreview || 'no args'}`
  }
  return message.text || 'No activity yet'
}

function toolEntryIdFromEvent(payload) {
  const runId = payload?.runId || 'run'
  const toolCallId = payload?.toolCallId || `${payload?.toolName || 'tool'}-${payload?.argsPreview || 'args'}`
  return `tool-${runId}-${toolCallId}`
}

export default function App() {
  const [modalOpen, setModalOpen] = useState(false)
  const [sidebarExpanded, setSidebarExpanded] = useState(true)
  const [isListening, setIsListening] = useState(false)
  const [chatMessages, setChatMessages] = useState(() => buildInitialChatMessages())
  const [input, setInput] = useState('')
  const [selectedChatId, setSelectedChatId] = useState(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [hotkey, setHotkey] = useState('Alt+K')
  const [mainPanelHotkey, setMainPanelHotkey] = useState('Alt+L')
  const [runningByChat, setRunningByChat] = useState({})
  const interactiveHoverCountRef = useRef(0)

  useEffect(() => {
    window.electronAPI?.getHotkey?.().then((res) => {
      if (res?.accelerator) setHotkey(res.accelerator)
    })
    window.electronAPI?.getMainPanelHotkey?.().then((res) => {
      if (res?.accelerator) setMainPanelHotkey(res.accelerator)
    })
  }, [])

  const setOverlayInteractivity = (interactive) => {
    window.electronAPI?.setOverlayInteractivity?.(interactive)
  }

  const resetOverlayInteractivity = () => {
    interactiveHoverCountRef.current = 0
    setOverlayInteractivity(false)
  }

  const handleInteractiveEnter = () => {
    interactiveHoverCountRef.current += 1
    if (interactiveHoverCountRef.current === 1) {
      setOverlayInteractivity(true)
    }
  }

  const handleInteractiveLeave = () => {
    interactiveHoverCountRef.current = Math.max(0, interactiveHoverCountRef.current - 1)
    if (interactiveHoverCountRef.current === 0) {
      setOverlayInteractivity(false)
    }
  }

  const appendMessage = (chatId, message) => {
    setChatMessages((prev) => ({
      ...prev,
      [chatId]: [...(prev[chatId] || []), message],
    }))
  }

  const toggleToolCard = (chatId, messageId) => {
    setChatMessages((prev) => ({
      ...prev,
      [chatId]: (prev[chatId] || []).map((message) =>
        message.id === messageId ? { ...message, expanded: !message.expanded } : message,
      ),
    }))
  }

  useEffect(() => {
    setOverlayInteractivity(false)
    return () => setOverlayInteractivity(false)
  }, [])

  useEffect(() => {
    const unsubSettings = window.electronAPI?.onOpenSettings?.(() => {
      setSettingsOpen((v) => {
        // When closing via hotkey, reset interactivity so the window goes back to click-through.
        if (v) resetOverlayInteractivity()
        return !v
      })
    })
    const unsubMainPanel = window.electronAPI?.onMainPanelOpen?.(() => {
      setModalOpen((prev) => {
        if (prev) {
          // Closing — reset interactivity.
          setSelectedChatId(null)
          resetOverlayInteractivity()
        } else {
          setSelectedChatId(CHAT_DEFINITIONS[0]?.id ?? null)
        }
        return !prev
      })
    })
    return () => {
      unsubSettings?.()
      unsubMainPanel?.()
    }
  }, [])

  useEffect(() => {
    window.electronAPI
      ?.initializeResearchChats?.(CHAT_IDS)
      .catch((error) => console.error('Failed to initialize research chats:', error))
  }, [])

  useEffect(() => {
    const unsubscribe = window.electronAPI?.onResearchEvent?.((payload) => {
      const chatId = String(payload?.chatId || '').trim()
      if (!chatId) return

      if (payload.type === 'tool_call_started' || payload.type === 'tool_call_finished') {
        setChatMessages((prev) => {
          const nextChatMessages = [...(prev[chatId] || [])]
          const messageId = toolEntryIdFromEvent(payload)
          const existingIndex = nextChatMessages.findIndex((message) => message.id === messageId)
          const existing = existingIndex >= 0 ? nextChatMessages[existingIndex] : null

          const nextMessage = {
            id: messageId,
            type: 'tool',
            role: 'assistant',
            toolCallId: payload.toolCallId || '',
            toolName: payload.toolName || 'tool',
            argsPreview: payload.argsPreview || existing?.argsPreview || 'no args',
            status:
              payload.status || (payload.type === 'tool_call_started' ? 'running' : existing?.status || 'success'),
            outputPreview: payload.outputPreview || existing?.outputPreview || '',
            error: payload.error || existing?.error || '',
            expanded: existing?.expanded || false,
          }

          if (existingIndex >= 0) {
            nextChatMessages[existingIndex] = nextMessage
          } else {
            nextChatMessages.push(nextMessage)
          }

          return {
            ...prev,
            [chatId]: nextChatMessages,
          }
        })
      } else if (payload.type === 'started' || payload.type === 'progress') {
        appendMessage(chatId, {
          id: createMessageId('progress'),
          type: 'progress',
          role: 'assistant',
          text: payload.message || 'Working...',
        })
      } else if (payload.type === 'completed') {
        if (payload.summary) {
          appendMessage(chatId, {
            id: createMessageId('assistant'),
            type: 'text',
            role: 'assistant',
            text: payload.summary,
          })
        }
        setRunningByChat((prev) => {
          const next = { ...prev }
          delete next[chatId]
          return next
        })
      } else if (payload.type === 'error') {
        appendMessage(chatId, {
          id: createMessageId('error'),
          type: 'text',
          role: 'assistant',
          text: `Research failed: ${payload.message || 'Unknown error'}`,
        })
        setRunningByChat((prev) => {
          const next = { ...prev }
          delete next[chatId]
          return next
        })
      }
    })

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe()
      }
    }
  }, [])

  const handleOverlayClose = () => {
    setModalOpen(false)
    setSelectedChatId(null)
    resetOverlayInteractivity()
  }

  const handleChatClose = () => {
    setSelectedChatId(null)
    resetOverlayInteractivity()
  }

  const handleToggle = () => {
    if (modalOpen) {
      handleOverlayClose()
      return
    }
    setModalOpen(true)
    setSelectedChatId(CHAT_DEFINITIONS[0]?.id ?? null)
  }

  const handleSend = async (event) => {
    event.preventDefault()

    const chatId = selectedChatId
    const text = input.trim()
    if (!chatId || !text || runningByChat[chatId]) return

    setInput('')
    appendMessage(chatId, {
      id: createMessageId('user'),
      type: 'text',
      role: 'user',
      text,
    })

    if (!window.electronAPI?.runResearch) {
      appendMessage(chatId, {
        id: createMessageId('error'),
        type: 'text',
        role: 'assistant',
        text: 'Research backend is unavailable.',
      })
      return
    }

    setRunningByChat((prev) => ({
      ...prev,
      [chatId]: true,
    }))

    try {
      await window.electronAPI.runResearch({
        chatId,
        prompt: text,
      })
    } catch {
      setRunningByChat((prev) => {
        const next = { ...prev }
        delete next[chatId]
        return next
      })
    }
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
      <button
        type="button"
        onClick={handleToggle}
        onMouseEnter={handleInteractiveEnter}
        onMouseLeave={handleInteractiveLeave}
        style={{
          width: BUTTON_WIDTH,
          height: BUTTON_HEIGHT,
          backgroundColor: PINK,
          boxShadow: `0 4px 20px ${PINK_GLOW}`,
        }}
        className="overlay-interactive absolute top-5 right-5 text-sm font-semibold text-white border-0 rounded-xl cursor-pointer transition-transform hover:scale-105 active:scale-95 z-20"
        title={modalOpen ? `Close (${mainPanelHotkey})` : `Open (${mainPanelHotkey})`}
      >
        <CircularText text="FRAUDLY" onHover="speedUp" spinDuration={20} className="custom-class" />
      </button>

      {/* Settings gear button - below FRAUDLY button */}
      <button
        type="button"
        onClick={() => setSettingsOpen((v) => { if (v) resetOverlayInteractivity(); return !v })}
        onMouseEnter={handleInteractiveEnter}
        onMouseLeave={handleInteractiveLeave}
        className="overlay-interactive absolute right-6 top-[90px] w-8 h-8 flex items-center justify-center rounded-lg border cursor-pointer transition-all hover:scale-110 active:scale-95 z-20"
        style={{
          backgroundColor: settingsOpen ? 'rgba(255, 90, 168, 0.2)' : 'rgba(10, 10, 12, 0.5)',
          borderColor: settingsOpen ? PINK : 'rgba(255, 90, 168, 0.4)',
          color: PINK_LIGHT,
          boxShadow: settingsOpen ? `0 0 10px ${PINK_GLOW}` : 'none',
        }}
        title={`Settings (${hotkey})`}
      >
        ⚙
      </button>

      {modalOpen && (
        <>
          <button
            type="button"
            onClick={() => setIsListening((v) => !v)}
            onMouseEnter={handleInteractiveEnter}
            onMouseLeave={handleInteractiveLeave}
            className={`overlay-interactive absolute top-4 left-1/2 -translate-x-1/2 z-10 rounded-2xl border-2 cursor-pointer overflow-hidden
              transition-all duration-300 ease-out
              hover:scale-[1.02] active:scale-[0.98]
              ${isListening
                ? 'flex flex-col items-center justify-center w-[200px] min-h-[72px] py-2 px-5 bg-[#ff5aa8] border-[#ff8ec8] shadow-[0_0_24px_rgba(255,90,168,0.5)] gap-1'
                : 'flex flex-row items-center justify-center min-w-[160px] min-h-[48px] py-2.5 px-4 gap-3 bg-[#ff5aa8]/25 border-[#ff8ec8]/60'
              }`}
            title={isListening ? 'Stop listening' : 'Start listening'}
          >
            {isListening ? (
              <>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-white/90 shrink-0">
                  Transcribe
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  <WaveformIcon className="w-5 h-5 text-white animate-pulse" />
                  <span className="text-sm font-medium text-white whitespace-nowrap">Listening…</span>
                </div>
              </>
            ) : (
              <>
                <WaveformIcon className="w-5 h-5 text-white flex-shrink-0" />
                <span className="text-sm font-medium text-white whitespace-nowrap">Start listening</span>
              </>
            )}
          </button>

          <div className="absolute left-4 top-24 bottom-4 flex items-stretch gap-6 z-10">
            <div
              onMouseEnter={handleInteractiveEnter}
              onMouseLeave={handleInteractiveLeave}
              className="overlay-interactive shrink-0 flex flex-col rounded-2xl border-2 overflow-hidden transition-[width] duration-200"
              style={{
                width: sidebarExpanded ? 220 : 56,
                backgroundColor: BG_PANEL,
                borderColor: BORDER_PINK,
                boxShadow: `0 0 16px ${PINK_GLOW}`,
              }}
            >
              <div
                className="flex items-center justify-between gap-2 px-2 py-2 border-b shrink-0"
                style={{
                  backgroundColor: 'rgba(255, 90, 168, 0.08)',
                  borderColor: 'rgba(255, 90, 168, 0.3)',
                  color: PINK_LIGHT,
                }}
              >
                <button
                  type="button"
                  onClick={() => setSidebarExpanded((v) => !v)}
                  className="flex items-center justify-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:opacity-90 transition-opacity shrink-0"
                  style={{ color: PINK_LIGHT }}
                >
                  <span className="text-sm font-medium">{sidebarExpanded ? '◀ History' : '▶'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleOverlayClose}
                  className="w-7 h-7 p-0 flex items-center justify-center rounded cursor-pointer hover:opacity-90 transition-opacity shrink-0"
                  style={{ color: PINK_LIGHT }}
                  title="Close overlay"
                >
                  ×
                </button>
              </div>

              {sidebarExpanded && (
                <div className="flex-1 overflow-y-auto p-2 space-y-1 min-h-0">
                  {historyWithPreview.map((chat) => (
                    <button
                      key={chat.id}
                      type="button"
                      onClick={() => setSelectedChatId((current) => (current === chat.id ? null : chat.id))}
                      className={`w-full text-left px-3 py-2 rounded-lg cursor-pointer transition-colors border ${
                        selectedChatId === chat.id
                          ? 'border-pink-500/50'
                          : 'border-transparent hover:border-pink-500/20'
                      }`}
                      style={{
                        backgroundColor:
                          selectedChatId === chat.id ? 'rgba(255, 90, 168, 0.12)' : 'transparent',
                        color: selectedChatId === chat.id ? PINK_LIGHT : 'rgba(255,255,255,0.7)',
                      }}
                    >
                      <div className="text-sm font-medium truncate">{chat.title}</div>
                      <div className="text-xs opacity-70 truncate">{chat.preview}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {selectedChatId && (
              <div
                onMouseEnter={handleInteractiveEnter}
                onMouseLeave={handleInteractiveLeave}
                className="overlay-interactive ml-1 w-[28rem] shrink-0 flex flex-col rounded-2xl border-2 overflow-hidden"
                style={{
                  backgroundColor: BG_PANEL,
                  borderColor: BORDER_PINK,
                  boxShadow: `0 0 24px ${PINK_GLOW}`,
                }}
              >
                <div
                  className="flex items-center justify-end gap-2 px-4 py-3 shrink-0 border-b"
                  style={{
                    backgroundColor: 'rgba(255, 90, 168, 0.08)',
                    borderColor: 'rgba(255, 90, 168, 0.3)',
                  }}
                >
                  <button
                    type="button"
                    onClick={handleChatClose}
                    className="w-8 h-8 p-0 text-xl leading-none rounded-lg cursor-pointer transition-colors border border-transparent hover:border-pink-500/50 shrink-0"
                    style={{ color: PINK_LIGHT }}
                    title="Close chat"
                  >
                    ×
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0" style={{ backgroundColor: 'rgba(0,0,0,0.15)' }}>
                  {messages.map((message) => {
                    if (message.type === 'progress') {
                      return (
                        <div key={message.id} className="flex justify-start">
                          <div
                            className="max-w-[95%] rounded-lg px-3 py-2 border text-xs"
                            style={{
                              backgroundColor: 'rgba(255,255,255,0.04)',
                              borderColor: 'rgba(255,255,255,0.1)',
                              color: 'rgba(226, 232, 240, 0.9)',
                            }}
                          >
                            {message.text}
                          </div>
                        </div>
                      )
                    }

                    if (message.type === 'tool') {
                      const style = statusStyles(message.status)
                      return (
                        <div key={message.id} className="flex justify-start">
                          <div
                            className="w-full max-w-[95%] rounded-xl border overflow-hidden"
                            style={{
                              borderColor: style.borderColor,
                              backgroundColor: 'rgba(255,255,255,0.03)',
                            }}
                          >
                            <button
                              type="button"
                              onClick={() => toggleToolCard(selectedChatId, message.id)}
                              className="w-full px-3 py-2 text-left flex items-start gap-2 cursor-pointer"
                              style={{ color: '#e2e8f0' }}
                            >
                              <span className="text-xs mt-0.5" style={{ color: style.textColor }}>
                                {message.expanded ? '▾' : '▸'}
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="text-xs font-semibold truncate" style={{ color: style.textColor }}>
                                  {message.toolName || 'tool'}
                                </div>
                                <div className="text-xs opacity-85 truncate">{message.argsPreview || 'no args'}</div>
                              </div>
                              <span
                                className="text-[10px] px-2 py-1 rounded-full shrink-0 uppercase"
                                style={{
                                  backgroundColor: style.badgeBg,
                                  color: style.badgeText,
                                }}
                              >
                                {message.status || 'running'}
                              </span>
                            </button>

                            {message.expanded && (
                              <div
                                className="px-3 py-2 border-t text-xs whitespace-pre-wrap"
                                style={{
                                  borderColor: 'rgba(255,255,255,0.08)',
                                  color: 'rgba(226, 232, 240, 0.92)',
                                }}
                              >
                                {message.error || message.outputPreview || 'No output preview'}
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    }

                    return (
                      <div
                        key={message.id}
                        className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                      >
                        <div
                          className={`max-w-[85%] rounded-2xl px-4 py-2.5 border ${
                            message.role === 'user' ? 'rounded-br-md' : 'rounded-bl-md'
                          }`}
                          style={{
                            backgroundColor:
                              message.role === 'user' ? 'rgba(255, 90, 168, 0.2)' : 'rgba(255,255,255,0.06)',
                            borderColor:
                              message.role === 'user' ? 'rgba(255, 90, 168, 0.4)' : 'rgba(255,255,255,0.1)',
                            color: '#e2e8f0',
                          }}
                        >
                          <span className="text-sm whitespace-pre-wrap">{message.text}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>

                <form
                  onSubmit={handleSend}
                  className="p-4 border-t shrink-0"
                  style={{
                    backgroundColor: 'rgba(255, 90, 168, 0.06)',
                    borderColor: 'rgba(255, 90, 168, 0.25)',
                  }}
                >
                  <div className="flex gap-2 rounded-xl border overflow-hidden" style={{ borderColor: 'rgba(255, 90, 168, 0.3)' }}>
                    <input
                      type="text"
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      placeholder={selectedChatIsRunning ? 'Researching...' : 'Type a message...'}
                      disabled={selectedChatIsRunning}
                      className="flex-1 min-w-0 px-4 py-3 text-sm text-white placeholder-zinc-500 bg-transparent border-0 outline-none disabled:opacity-60"
                    />
                    <button
                      type="submit"
                      disabled={selectedChatIsRunning || !input.trim()}
                      className="px-4 py-3 text-sm font-medium text-white cursor-pointer transition-opacity hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
                      style={{ backgroundColor: PINK }}
                    >
                      {selectedChatIsRunning ? 'Running' : 'Send'}
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>
        </>
      )}
      {settingsOpen && (
        <SettingsPanel
          currentHotkey={hotkey}
          onHotkeyChange={setHotkey}
          mainPanelHotkey={mainPanelHotkey}
          onMainPanelHotkeyChange={setMainPanelHotkey}
          onClose={() => { setSettingsOpen(false); resetOverlayInteractivity() }}
          onInteractiveEnter={handleInteractiveEnter}
          onInteractiveLeave={handleInteractiveLeave}
        />
      )}
    </div>
  )
}

import { useState, useEffect } from 'react'
import CircularText from './components/CircularText'

function WaveformIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M4 14v-4h2v4H4zm4 2v-8h2v8H8zm4-4V6h2v6h-2zm4 2V4h2v8h-2zm4 4V2h2v14h-2z" />
    </svg>
  )
}

const BUTTON_WIDTH = 64
const BUTTON_HEIGHT = 64
const COMPACT_HEIGHT = 320
const COMPACT_WIDTH_EXPANDED = 460
const COMPACT_WIDTH_COLLAPSED = 280

const PINK = '#ff5aa8'
const PINK_LIGHT = '#ff8ec8'
const PINK_GLOW = 'rgba(255, 90, 168, 0.25)'
const BORDER_PINK = 'rgba(255, 90, 168, 0.4)'
const BG_PANEL = 'rgba(10, 10, 12, 0.5)'

const placeholderHistory = [
  { id: '1', title: 'Chat 1', preview: 'Last message...' },
  { id: '2', title: 'Chat 2', preview: 'Another message' },
  { id: '3', title: 'Chat 3', preview: 'Preview text' },
]

const initialMessagesForChat = (chatId) => [
  { id: `${chatId}-welcome`, role: 'assistant', text: 'Hello! How can I help you today?' },
]

export default function App() {
  const [modalOpen, setModalOpen] = useState(false)
  const [sidebarExpanded, setSidebarExpanded] = useState(true)
  const [isListening, setIsListening] = useState(false)
  const [chatMessages, setChatMessages] = useState(() =>
    Object.fromEntries(placeholderHistory.map((c) => [c.id, initialMessagesForChat(c.id)]))
  )
  const [input, setInput] = useState('')
  const [selectedChatId, setSelectedChatId] = useState(null)

  useEffect(() => {
    if (!modalOpen && window.electronAPI?.setWindowMode) {
      window.electronAPI.setWindowMode('button', BUTTON_WIDTH, BUTTON_HEIGHT)
    }
  }, [modalOpen])

  const handleOpen = () => {
    setModalOpen(true)
    window.electronAPI?.setWindowMode?.('modal')
  }

  const handleClose = () => {
    setModalOpen(false)
    window.electronAPI?.setWindowMode?.('button', BUTTON_WIDTH, BUTTON_HEIGHT)
  }

  const handleSend = (e) => {
    e.preventDefault()
    if (!input.trim() || !selectedChatId) return
    const text = input.trim()
    setInput('')
    setChatMessages((prev) => ({
      ...prev,
      [selectedChatId]: [...(prev[selectedChatId] || []), { id: Date.now(), role: 'user', text }],
    }))
  }

  const messages = selectedChatId ? (chatMessages[selectedChatId] || []) : []

  return (
    <div className="w-full min-h-full flex items-start justify-end relative">
      {!modalOpen && (
        <button
          type="button"
          onClick={handleOpen}
          style={{
            width: BUTTON_WIDTH,
            height: BUTTON_HEIGHT,
            backgroundColor: PINK,
            boxShadow: `0 4px 20px ${PINK_GLOW}`,
          }}
          className="text-sm font-semibold text-white border-0 rounded-xl cursor-pointer transition-transform hover:scale-105 active:scale-95 shrink-0"
          title="Open"
        >
          <CircularText
            text="FRAUDLY"
            onHover="speedUp"
            spinDuration={20}
            className="custom-class"
          />
        </button>
      )}

      {modalOpen && (
        <div
          className="fixed inset-0 flex z-10 bg-black/10 p-6"
          onClick={handleClose}
        >
          <div
            className="flex flex-1 gap-6 min-h-0 max-w-full overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Left column: chat history only */}
            <div
              className={`flex flex-col rounded-2xl border-2 overflow-hidden transition-[width] duration-200 shrink-0 self-stretch`}
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
                  <span className="text-sm font-medium">
                    {sidebarExpanded ? '◀ History' : '▶'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {}}
                  className="w-7 h-7 p-0 flex items-center justify-center rounded cursor-pointer hover:opacity-90 transition-opacity shrink-0"
                  style={{ color: PINK_LIGHT }}
                  title="No action"
                >
                  ×
                </button>
              </div>
              {sidebarExpanded && (
                <div className="flex-1 overflow-y-auto p-2 space-y-1 min-h-0">
                  {placeholderHistory.map((chat) => (
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
                          selectedChatId === chat.id
                            ? 'rgba(255, 90, 168, 0.12)'
                            : 'transparent',
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

            {/* Right column: Transcribe always; chat panel only when a chat is selected */}
            <div
              className={`flex flex-col gap-4 ${selectedChatId ? 'flex-1 min-w-0 min-h-0' : 'shrink-0'}`}
            >
              {/* Top controls row */}
              <div className="flex items-center justify-end gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleClose}
                  style={{
                    width: BUTTON_WIDTH,
                    height: BUTTON_HEIGHT,
                    backgroundColor: PINK,
                    boxShadow: `0 4px 20px ${PINK_GLOW}`,
                  }}
                  className="text-sm font-semibold text-white border-0 rounded-xl cursor-pointer transition-transform hover:scale-105 active:scale-95 shrink-0"
                  title="Close overlay"
                >
                  <CircularText
                    text="FRAUDLY"
                    onHover="speedUp"
                    spinDuration={20}
                    className="custom-class"
                  />
                </button>
                <button
                  type="button"
                  onClick={() => setIsListening((v) => !v)}
                  className={`rounded-2xl border-2 cursor-pointer overflow-hidden
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
                        <span className="text-sm font-medium text-white whitespace-nowrap">
                          Listening…
                        </span>
                      </div>
                    </>
                  ) : (
                    <>
                      <WaveformIcon className="w-5 h-5 text-white flex-shrink-0" />
                      <span className="text-sm font-medium text-white whitespace-nowrap">
                        Start listening
                      </span>
                    </>
                  )}
                </button>
              </div>

              {/* Chat panel — conditional render, no wrapper when hidden */}
              {selectedChatId && (
                <div
                  className="flex flex-col flex-1 min-h-0 rounded-2xl border-2 overflow-hidden"
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
                      onClick={() => setSelectedChatId(null)}
                      className="w-8 h-8 p-0 text-xl leading-none rounded-lg cursor-pointer transition-colors border border-transparent hover:border-pink-500/50 shrink-0"
                      style={{ color: PINK_LIGHT }}
                      title="Close chat"
                    >
                      ×
                    </button>
                  </div>
                  <div
                    className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0"
                    style={{ backgroundColor: 'rgba(0,0,0,0.15)' }}
                  >
                    {messages.map((m) => (
                      <div
                        key={m.id}
                        className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                      >
                        <div
                          className={`max-w-[85%] rounded-2xl px-4 py-2.5 border ${
                            m.role === 'user' ? 'rounded-br-md' : 'rounded-bl-md'
                          }`}
                          style={{
                            backgroundColor:
                              m.role === 'user'
                                ? 'rgba(255, 90, 168, 0.2)'
                                : 'rgba(255,255,255,0.06)',
                            borderColor:
                              m.role === 'user'
                                ? 'rgba(255, 90, 168, 0.4)'
                                : 'rgba(255,255,255,0.1)',
                            color: '#e2e8f0',
                          }}
                        >
                          <span className="text-sm">{m.text}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <form
                    onSubmit={handleSend}
                    className="p-4 border-t shrink-0"
                    style={{
                      backgroundColor: 'rgba(255, 90, 168, 0.06)',
                      borderColor: 'rgba(255, 90, 168, 0.25)',
                    }}
                  >
                    <div
                      className="flex gap-2 rounded-xl border overflow-hidden"
                      style={{ borderColor: 'rgba(255, 90, 168, 0.3)' }}
                    >
                      <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="Type a message..."
                        className="flex-1 min-w-0 px-4 py-3 text-sm text-white placeholder-zinc-500 bg-transparent border-0 outline-none"
                      />
                      <button
                        type="submit"
                        className="px-4 py-3 text-sm font-medium text-white cursor-pointer transition-opacity hover:opacity-90"
                        style={{ backgroundColor: PINK }}
                      >
                        Send
                      </button>
                    </div>
                  </form>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { BORDER_PINK, NEUTRAL_CARD_FILL, PINK_GLOSS_FILL } from '../utils/constants'
import MessageBubble from './MessageBubble'
import ToolCard from './ToolCard'
import Dither from './art/Dither'

export default function ChatPanel({
  open,
  history,
  selectedChatId,
  onSelectChat,
  messages,
  onSend,
  isRunning,
  onToggleTool,
  onScreenshot,
  onMouseEnter,
  onMouseLeave,
}) {
  const [input, setInput] = useState('')
  const messagesContainerRef = useRef(null)

  useEffect(() => {
    if (selectedChatId === null) return
    const container = messagesContainerRef.current
    if (!container) return
    container.scrollTop = container.scrollHeight
  }, [selectedChatId, messages])

  const handleSubmit = async (e) => {
    e.preventDefault()
    const text = input.trim()
    if (!text || isRunning) return
    setInput('')
    await onSend(text)
  }

  if (!open) return null

  return (
    <div 
      className="overlay-interactive absolute top-[56px] left-1/2 -translate-x-1/2 z-10 pt-6 pb-4"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div
        className="w-[34rem] max-h-[32rem] flex flex-col rounded-2xl border-2 overflow-hidden animate-in slide-in-from-top-4 duration-300 relative"
        style={{
          background: 'rgba(10, 12, 18, 0.65)',
          backdropFilter: 'blur(24px) saturate(180%)',
          WebkitBackdropFilter: 'blur(24px) saturate(180%)',
          borderColor: BORDER_PINK,
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.37), inset 0 1px rgba(255, 255, 255, 0.1)',
        }}
      >
        {/* Dither Background layer */}
        <div className="absolute inset-0 z-0 opacity-40 pointer-events-none mix-blend-screen" style={{ borderRadius: 'inherit' }}>
          <Dither waveColor={[1.0, 0.557, 0.784]} colorNum={4} pixelSize={3} waveAmplitude={0.4} />
        </div>

        {selectedChatId === null ? (
          <div className="flex-1 overflow-y-auto p-4 space-y-2 min-h-0 relative z-10 flex flex-col">
            <h3 className="text-pink-300 text-xs font-bold mb-2 px-1 uppercase tracking-wider">Recent Detections</h3>
            {history?.map((chat) => (
              <button
                key={chat.id}
                type="button"
                onClick={() => onSelectChat(chat.id)}
                className="w-full text-left px-4 py-3 rounded-xl cursor-pointer transition-all border border-transparent hover:border-pink-500/40 group"
                style={{
                  background: 'rgba(11, 14, 23, 0.5)',
                  color: 'rgba(226, 233, 255, 0.9)',
                  boxShadow: 'inset 0 1px rgba(255, 255, 255, 0.05)',
                  backdropFilter: 'blur(12px)',
                }}
              >
                <div className="text-sm font-semibold text-pink-50 group-hover:text-pink-200 transition-colors">{chat.title}</div>
                <div className="text-xs opacity-70 truncate mt-1">{chat.preview}</div>
              </button>
            ))}
          </div>
        ) : (
          <div className="flex flex-col flex-1 min-h-0 relative z-10">
            {/* Chat Header with Back Button */}
            <div className="flex items-center gap-3 px-4 py-3 border-b shrink-0" style={{ borderColor: 'rgba(255, 132, 198, 0.15)', background: 'rgba(10, 12, 18, 0.3)' }}>
              <button
                type="button"
                onClick={() => onSelectChat(null)}
                className="w-8 h-8 flex items-center justify-center rounded-lg cursor-pointer transition-colors hover:bg-white/10 text-pink-200 hover:text-white shrink-0"
                title="Back to History"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <div className="text-sm font-semibold text-white/90 truncate">
                {history?.find(h => h.id === selectedChatId)?.title || 'Chat'}
              </div>
            </div>

            <div
              ref={messagesContainerRef}
              className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0"
              style={{
                background: 'transparent',
              }}
            >
              {messages.map((message) => {
                if (message.type === 'tool') {
                  return <ToolCard key={message.id} message={message} onToggle={() => onToggleTool(message.id)} />
                }
                return <MessageBubble key={message.id} message={message} />
              })}
            </div>

            <form
              onSubmit={handleSubmit}
              className="p-4 border-t shrink-0"
              style={{
                background: 'transparent',
                borderColor: 'rgba(121, 134, 167, 0.26)',
              }}
            >
              <div
                className="flex gap-2 rounded-xl border overflow-hidden"
                style={{
                  borderColor: 'rgba(122, 136, 170, 0.32)',
                  background: 'rgba(11, 14, 23, 0.5)',
                  backdropFilter: 'blur(12px)',
                  WebkitBackdropFilter: 'blur(12px)',
                  boxShadow: 'inset 0 1px rgba(155, 169, 202, 0.2)',
                }}
              >
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={isRunning ? 'Researching...' : 'Type a message...'}
                  disabled={isRunning}
                  className="flex-1 min-w-0 px-4 py-3 text-sm text-white placeholder-zinc-500 bg-transparent border-0 outline-none disabled:opacity-60"
                />
                <button
                  type="button"
                  onClick={onScreenshot}
                  className="px-3 py-3 text-xs font-semibold text-white/90 cursor-pointer transition-opacity hover:opacity-90"
                  style={{
                    background: NEUTRAL_CARD_FILL,
                    borderLeft: '1px solid rgba(120, 134, 168, 0.42)',
                  }}
                  title="Capture screenshot"
                >
                  Shot
                </button>
                <button
                  type="submit"
                  disabled={isRunning || !input.trim()}
                  className="px-4 py-3 text-sm font-medium text-white cursor-pointer transition-opacity hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
                  style={{
                    background: PINK_GLOSS_FILL,
                    borderLeft: '1px solid rgba(255, 165, 218, 0.65)',
                    boxShadow: 'inset 0 1px rgba(255, 208, 234, 0.66)',
                  }}
                >
                  {isRunning ? 'Running' : 'Send'}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}

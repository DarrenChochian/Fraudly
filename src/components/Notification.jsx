import { useEffect, useState } from 'react'
import { BORDER_PINK, GLASS_BACKDROP } from '../utils/constants'

export default function Notification({ message, onClose, onMouseEnter, onMouseLeave }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    // Small delay to trigger the enter animation
    const t = setTimeout(() => setVisible(true), 10)
    return () => clearTimeout(t)
  }, [])

  const handleClose = () => {
    setVisible(false)
    // Decrement interactivity counter immediately to avoid stuck state if mouse doesn't leave before unmount
    onMouseLeave?.()
    // Wait for exit animation
    setTimeout(onClose, 300)
  }

  if (!message) return null

  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={`pointer-events-auto overlay-interactive transition-all duration-500 cubic-bezier(0.16, 1, 0.3, 1) transform ${
        visible ? 'opacity-100 translate-y-0 scale-100 mb-2' : 'opacity-0 -translate-y-4 scale-95 mb-0'
      }`}
      style={{
        maxWidth: '90vw',
        width: 'fit-content', // Dynamic width
      }}
    >
      <div
        className="flex items-center gap-3 px-4 py-2.5 rounded-full border backdrop-blur-xl"
        style={{
          background: 'rgba(10, 12, 18, 0.75)',
          borderColor: BORDER_PINK,
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.25), inset 0 1px rgba(255, 255, 255, 0.1)',
          backdropFilter: GLASS_BACKDROP,
          WebkitBackdropFilter: GLASS_BACKDROP,
        }}
      >
        <div className="w-2 h-2 rounded-full bg-pink-500 shadow-[0_0_10px_rgba(236,72,153,0.8)] animate-pulse shrink-0" />
        <span className="text-xs font-medium text-pink-50/90 tracking-wide">{message}</span>
        <button
          onClick={handleClose}
          className="ml-1 w-5 h-5 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors text-white/50 hover:text-white shrink-0 cursor-pointer"
        >
          ×
        </button>
      </div>
    </div>
  )
}

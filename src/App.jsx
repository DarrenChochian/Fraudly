import { useState, useEffect } from 'react'

const BUTTON_WIDTH = 52
const BUTTON_HEIGHT = 52

export default function App() {
  const [modalOpen, setModalOpen] = useState(false)

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

  return (
    <div className="w-full min-h-full flex items-start justify-end relative">
      {!modalOpen && (
        <button
          type="button"
          onClick={handleOpen}
          style={{ width: BUTTON_WIDTH, height: BUTTON_HEIGHT }}
          className="text-sm font-semibold text-white bg-[#ff5aa8] border-0 rounded-xl cursor-pointer shadow-[0_4px_20px_rgba(255,90,168,0.4)] transition-transform hover:bg-[#ff8ec8] hover:scale-105 active:scale-95 shrink-0"
          title="Open"
        >
          Open
        </button>
      )}

      {modalOpen && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-10"
          onClick={handleClose}
        >
          <div
            className="w-full h-full max-w-full max-h-full bg-[#1a1a1a] rounded-2xl border border-zinc-700 shadow-2xl overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-700 shrink-0">
              <h2 className="m-0 text-lg font-semibold text-white">Modal</h2>
              <button
                type="button"
                onClick={handleClose}
                className="w-8 h-8 p-0 text-2xl leading-none text-zinc-500 bg-transparent border-0 rounded-lg cursor-pointer transition-colors hover:text-white hover:bg-zinc-700"
                title="Close"
              >
                ×
              </button>
            </div>
            <div className="p-5 text-zinc-400 text-sm overflow-y-auto flex-1 min-h-0">
              <p className="m-0">Content goes here. Close with the button or click outside.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

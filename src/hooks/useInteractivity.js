import { useRef, useEffect } from 'react'

export function useInteractivity() {
  const interactiveHoverCountRef = useRef(0)

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

  useEffect(() => {
    const handleWindowBlur = () => {
      resetOverlayInteractivity()
    }

    setOverlayInteractivity(false)
    window.addEventListener('blur', handleWindowBlur)

    return () => {
      window.removeEventListener('blur', handleWindowBlur)
      setOverlayInteractivity(false)
    }
  }, [])

  return {
    handleInteractiveEnter,
    handleInteractiveLeave,
    resetOverlayInteractivity,
  }
}

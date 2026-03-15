import { useRef, useEffect } from 'react'

export function useInteractivity() {
  const leaveCheckFrameRef = useRef(null)

  const setOverlayInteractivity = (interactive) => {
    window.electronAPI?.setOverlayInteractivity?.(interactive)
  }

  const cancelPendingLeaveCheck = () => {
    if (leaveCheckFrameRef.current !== null) {
      window.cancelAnimationFrame(leaveCheckFrameRef.current)
      leaveCheckFrameRef.current = null
    }
  }

  const hasHoveredOverlay = () => Boolean(document.querySelector('.overlay-interactive:hover'))

  const resetOverlayInteractivity = () => {
    cancelPendingLeaveCheck()
    setOverlayInteractivity(false)
  }

  const handleInteractiveEnter = () => {
    cancelPendingLeaveCheck()
    setOverlayInteractivity(true)
  }

  const handleInteractiveLeave = () => {
    cancelPendingLeaveCheck()
    leaveCheckFrameRef.current = window.requestAnimationFrame(() => {
      leaveCheckFrameRef.current = window.requestAnimationFrame(() => {
        leaveCheckFrameRef.current = null
        if (!hasHoveredOverlay()) {
          setOverlayInteractivity(false)
        }
      })
    })
  }

  useEffect(() => {
    const handleWindowBlur = () => {
      resetOverlayInteractivity()
    }

    setOverlayInteractivity(false)
    window.addEventListener('blur', handleWindowBlur)

    return () => {
      cancelPendingLeaveCheck()
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

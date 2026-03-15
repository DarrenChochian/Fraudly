import { useState, useRef, useEffect, useCallback } from 'react'
import { AUDIO_MIME_CANDIDATES } from '../utils/constants'

const SEGMENT_DURATION_MS = 5000

function getRecorderOptions() {
  if (typeof MediaRecorder === 'undefined') return undefined
  if (typeof MediaRecorder.isTypeSupported === 'function') {
    for (const candidate of AUDIO_MIME_CANDIDATES) {
      if (MediaRecorder.isTypeSupported(candidate)) {
        return { mimeType: candidate }
      }
    }
  }
  return undefined
}

export function useHiveDetection({ callerStream, isListening }) {
  const [hiveResult, setHiveResult] = useState(null)
  const [hiveStatus, setHiveStatus] = useState('idle')
  const recorderRef = useRef(null)
  const intervalRef = useRef(null)
  const activeRef = useRef(false)

  const stopDetection = useCallback(() => {
    activeRef.current = false
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    if (recorderRef.current) {
      try {
        if (recorderRef.current.state !== 'inactive') recorderRef.current.stop()
      } catch {
        // Ignore stop errors.
      }
      recorderRef.current = null
    }
    setHiveStatus('idle')
  }, [])

  const startSegmentCycle = useCallback((stream) => {
    if (!stream || !window.electronAPI?.analyzeHiveAudio) return

    activeRef.current = true
    setHiveStatus('detecting')

    const createAndStartRecorder = () => {
      if (!activeRef.current) return

      const options = getRecorderOptions()
      let recorder
      try {
        recorder = options ? new MediaRecorder(stream, options) : new MediaRecorder(stream)
      } catch {
        console.error('[hive-detection] Failed to create MediaRecorder')
        setHiveStatus('error')
        return
      }

      const chunks = []
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data)
      }

      recorder.onstop = async () => {
        if (!activeRef.current) return
        if (chunks.length === 0) return

        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
        try {
          const arrayBuffer = await blob.arrayBuffer()
          const result = await window.electronAPI.analyzeHiveAudio(arrayBuffer)
          if (result?.ok) {
            setHiveResult({ score: result.score, label: result.label, timestamp: result.timestamp })
          } else {
            console.warn('[hive-detection]', result?.error)
          }
        } catch (err) {
          console.error('[hive-detection] IPC error:', err)
        }
      }

      recorder.start()
      recorderRef.current = recorder
    }

    createAndStartRecorder()

    intervalRef.current = setInterval(() => {
      if (!activeRef.current) return

      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        try {
          recorderRef.current.stop()
        } catch {
          // Ignore stop errors.
        }
      }

      setTimeout(() => {
        if (activeRef.current) createAndStartRecorder()
      }, 50)
    }, SEGMENT_DURATION_MS)
  }, [])

  useEffect(() => {
    if (isListening && callerStream) {
      startSegmentCycle(callerStream)
    } else {
      stopDetection()
      if (!isListening) setHiveResult(null)
    }
    return () => stopDetection()
  }, [isListening, callerStream, startSegmentCycle, stopDetection])

  return { hiveResult, hiveStatus }
}

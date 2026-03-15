import { useState, useEffect, useRef } from 'react'

const TRANSCRIPT_WINDOW_MS = 60 * 1000

function pruneTranscriptWindow(entries, now = Date.now()) {
  return entries.filter((entry) => {
    const ts = Date.parse(entry?.ts || '')
    return Number.isFinite(ts) && now - ts <= TRANSCRIPT_WINDOW_MS
  })
}

function updateTranscriptWindow(entries, payload) {
  const now = Date.now()
  const nextEntries = pruneTranscriptWindow(entries, now)
  const transcript = String(payload?.transcript || '').trim()
  const source = payload?.source

  if (!source || !transcript || transcript === '(silence)') {
    return nextEntries
  }

  const nextEntry = {
    id: `${source}-${payload?.ts || new Date(now).toISOString()}-${payload?.isFinal ? 'final' : 'live'}`,
    source,
    transcript,
    isFinal: Boolean(payload?.isFinal),
    ts: payload?.ts || new Date(now).toISOString(),
  }

  const withoutLiveEntryForSource = nextEntries.filter((entry) => !(entry.source === source && !entry.isFinal))
  const lastEntry = withoutLiveEntryForSource[withoutLiveEntryForSource.length - 1]

  if (
    payload?.isFinal
    && lastEntry
    && lastEntry.source === source
    && lastEntry.isFinal
    && lastEntry.transcript === transcript
  ) {
    return withoutLiveEntryForSource
  }

  return [...withoutLiveEntryForSource, nextEntry]
}

export function useTranscription({ onStopSession, sourceAudioLevels, isListening }) {
  const [transcriptionSessionState, setTranscriptionSessionState] = useState('idle')
  const [sourceStates, setSourceStates] = useState({ caller: 'idle', user: 'idle' })
  const [sourceChunkCounts, setSourceChunkCounts] = useState({ caller: 0, user: 0 })
  const [latestTranscripts, setLatestTranscripts] = useState({ caller: '', user: '' })
  const [transcriptWindow, setTranscriptWindow] = useState([])
  const [transcriptKinds, setTranscriptKinds] = useState({ caller: 'none', user: 'none' })
  const [transcriptionError, setTranscriptionError] = useState('')
  const [transcriptionWarning, setTranscriptionWarning] = useState('')
  const [lastTranscriptionActivityAt, setLastTranscriptionActivityAt] = useState('')
  const callerSilentSinceRef = useRef(null)

  useEffect(() => {
    if (!isListening) {
      callerSilentSinceRef.current = null
      return
    }

    if ((sourceAudioLevels.caller || 0) > 0.5) {
      callerSilentSinceRef.current = null
      return
    }

    if (!callerSilentSinceRef.current) {
      callerSilentSinceRef.current = Date.now()
      return
    }

    const silentMs = Date.now() - callerSilentSinceRef.current
    if (silentMs < 8000) return

    const warning = 'Desktop audio stream is connected but appears silent. Confirm system audio is shared in the screen picker and macOS Screen Recording/System Audio permissions are granted.'
    setTranscriptionWarning((prev) => (prev?.includes('appears silent') ? prev : (prev ? `${prev} ${warning}` : warning)))
  }, [isListening, sourceAudioLevels.caller])

  useEffect(() => {
    const unsubscribe = window.electronAPI?.onTranscriptionEvent?.((payload) => {
      if (!payload || typeof payload !== 'object') return

      if (payload.type === 'session_state') {
        if (payload.state === 'error') {
          console.error('[transcription][session]', payload)
        } else {
          console.log('[transcription][session]', payload)
        }
        setTranscriptionSessionState(payload.state || 'idle')
        if (payload.state === 'error' && payload.message) {
          setTranscriptionError(payload.message)
        }
      }

      if (payload.type === 'source_state' && payload.source) {
        if (payload.state === 'error') {
          console.error(`[transcription][${payload.source}]`, payload)
        } else if (payload.state === 'reconnecting' || payload.state === 'closed') {
          console.warn(`[transcription][${payload.source}]`, payload)
        } else {
          console.log(`[transcription][${payload.source}]`, payload)
        }
        setSourceStates((prev) => ({
          ...prev,
          [payload.source]: payload.state || 'idle',
        }))

        if (payload.state === 'error' && payload.message) {
          setTranscriptionError(payload.message)
        }
      }

      if (payload.type === 'source_chunk' && payload.source) {
        setSourceChunkCounts((prev) => ({
          ...prev,
          [payload.source]: Number(payload.count || 0),
        }))
      }

      if (payload.type === 'transcript' && payload.source) {
        setLatestTranscripts((prev) => ({
          ...prev,
          [payload.source]: payload.transcript || '(silence)',
        }))
        setTranscriptWindow((prev) => updateTranscriptWindow(prev, payload))
        setTranscriptKinds((prev) => ({
          ...prev,
          [payload.source]: payload.isFinal ? 'final' : 'interim',
        }))
      }

      setLastTranscriptionActivityAt(payload.ts || new Date().toISOString())
    })

    return () => {
      unsubscribe?.()
    }
  }, [])

  const resetTranscriptionState = () => {
    setTranscriptionError('')
    setTranscriptionWarning('')
    setTranscriptionSessionState('connecting')
    setSourceStates({ caller: 'connecting', user: 'connecting' })
    setSourceChunkCounts({ caller: 0, user: 0 })
    setLatestTranscripts({ caller: '', user: '' })
    setTranscriptWindow([])
    setTranscriptKinds({ caller: 'none', user: 'none' })
  }

  const updateSourceStates = (updates) => {
    setSourceStates((prev) => ({ ...prev, ...updates }))
  }

  const updateTranscriptionWarning = (warning) => {
    setTranscriptionWarning((prev) => (prev ? `${prev} ${warning}` : warning))
  }

  return {
    transcriptionSessionState,
    setTranscriptionSessionState,
    sourceStates,
    setSourceStates: updateSourceStates,
    sourceChunkCounts,
    latestTranscripts,
    transcriptWindow,
    transcriptKinds,
    transcriptionError,
    setTranscriptionError,
    transcriptionWarning,
    setTranscriptionWarning: updateTranscriptionWarning,
    lastTranscriptionActivityAt,
    resetTranscriptionState,
  }
}

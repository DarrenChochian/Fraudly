const fs = require('fs')
const path = require('path')

const DEEPGRAM_URL =
  'wss://api.deepgram.com/v1/listen?model=nova-3&interim_results=true&smart_format=true&punctuate=true'
const SOURCE_KEYS = new Set(['caller', 'user'])
const RECONNECT_DELAYS_MS = [500, 1500, 3000]
const CONNECT_TIMEOUT_MS = 10000
const MAX_QUEUED_CHUNKS = 80

function parseEnvContent(content) {
  const result = {}
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const eqIndex = line.indexOf('=')
    if (eqIndex <= 0) continue

    const key = line.slice(0, eqIndex).trim()
    let value = line.slice(eqIndex + 1).trim()

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    result[key] = value
  }
  return result
}

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {}
  const content = fs.readFileSync(filePath, 'utf8')
  return parseEnvContent(content)
}

function toBuffer(data) {
  if (!data) return null
  if (Buffer.isBuffer(data)) return data
  if (data instanceof ArrayBuffer) return Buffer.from(data)
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  return null
}

function toText(data) {
  if (typeof data === 'string') return data
  const buf = toBuffer(data)
  if (!buf) return ''
  return buf.toString('utf8')
}

function normalizeSource(source) {
  const value = String(source || '').trim().toLowerCase()
  return SOURCE_KEYS.has(value) ? value : null
}

function normalizeSources(sources) {
  if (!Array.isArray(sources)) return [...SOURCE_KEYS]
  const normalized = []
  for (const item of sources) {
    const source = normalizeSource(item)
    if (!source) continue
    if (normalized.includes(source)) continue
    normalized.push(source)
  }
  return normalized
}

function registerTranscriptionIpc({ ipcMain, projectRoot }) {
  const sessions = new Map()

  const env = {
    ...readEnvFile(path.join(projectRoot, '.env.example')),
    ...readEnvFile(path.join(projectRoot, '.env')),
    ...process.env,
  }

  function emit(sender, payload) {
    if (!sender || sender.isDestroyed()) return
    sender.send('transcription:event', {
      ...payload,
      ts: new Date().toISOString(),
    })
  }

  function createConnection({ sender, source, apiKey }) {
    const WebSocketImpl = globalThis.WebSocket
    if (!WebSocketImpl) {
      throw new Error('WebSocket is unavailable in this Electron runtime')
    }

    let socket = null
    let keepAliveTimer = null
    let connectTimeout = null
    let reconnectTimer = null
    let reconnectAttempt = 0
    let stopping = false
    const queuedChunks = []

    const logPrefix = `[deepgram:${source}]`

    const connection = {
      source,
      socket,
      opened: false,
      chunkCount: 0,
      queueSize: 0,
      stop() {
        stopping = true
        if (keepAliveTimer) {
          clearInterval(keepAliveTimer)
          keepAliveTimer = null
        }
        if (connectTimeout) {
          clearTimeout(connectTimeout)
          connectTimeout = null
        }
        if (reconnectTimer) {
          clearTimeout(reconnectTimer)
          reconnectTimer = null
        }
        if (socket && socket.readyState === WebSocketImpl.OPEN) {
          try {
            socket.send(JSON.stringify({ type: 'CloseStream' }))
          } catch {
            // Ignore shutdown send errors.
          }
        }
        if (socket && (socket.readyState === WebSocketImpl.OPEN || socket.readyState === WebSocketImpl.CONNECTING)) {
          try {
            socket.close(1000, 'client-stop')
          } catch {
            // Ignore close errors.
          }
        }
      },
      sendAudio(chunk) {
        if (!chunk || !chunk.length) return false

        const sendBinary = (payload) => {
          if (!socket || socket.readyState !== WebSocketImpl.OPEN) return false
          try {
            socket.send(payload)
            connection.chunkCount += 1
            emit(sender, {
              type: 'source_chunk',
              source,
              count: connection.chunkCount,
            })
            return true
          } catch (error) {
            console.error(`${logPrefix} failed to send audio chunk`, error)
            return false
          }
        }

        const flushQueue = () => {
          while (queuedChunks.length > 0) {
            const next = queuedChunks.shift()
            connection.queueSize = queuedChunks.length
            if (!next) continue
            const sent = sendBinary(next)
            if (!sent) {
              queuedChunks.unshift(next)
              connection.queueSize = queuedChunks.length
              break
            }
          }
        }

        const scheduleReconnect = (reason) => {
          if (stopping) return
          if (reconnectTimer) return
          if (reconnectAttempt >= RECONNECT_DELAYS_MS.length) {
            const message = `Reconnect exhausted after ${reconnectAttempt} attempts (${reason})`
            console.error(`${logPrefix} ${message}`)
            emit(sender, {
              type: 'source_state',
              source,
              state: 'error',
              message,
            })
            return
          }

          const delay = RECONNECT_DELAYS_MS[reconnectAttempt]
          reconnectAttempt += 1
          console.warn(`${logPrefix} reconnect scheduled in ${delay}ms (${reason})`)
          emit(sender, {
            type: 'source_state',
            source,
            state: 'reconnecting',
            attempt: reconnectAttempt,
            delayMs: delay,
            message: reason,
          })

          reconnectTimer = setTimeout(() => {
            reconnectTimer = null
            openSocket('reconnect')
          }, delay)
        }

        const openSocket = (reason) => {
          if (stopping) return
          if (socket && (socket.readyState === WebSocketImpl.OPEN || socket.readyState === WebSocketImpl.CONNECTING)) {
            return
          }

          socket = new WebSocketImpl(DEEPGRAM_URL, ['token', apiKey])
          connection.socket = socket
          connection.opened = false

          console.log(`${logPrefix} opening websocket (${reason})`)
          connectTimeout = setTimeout(() => {
            connectTimeout = null
            if (!socket || socket.readyState === WebSocketImpl.OPEN || stopping) return
            console.error(`${logPrefix} connect timeout after ${CONNECT_TIMEOUT_MS}ms`)
            try {
              socket.close()
            } catch {
              // Ignore timeout close errors.
            }
          }, CONNECT_TIMEOUT_MS)

          socket.onopen = () => {
            if (connectTimeout) {
              clearTimeout(connectTimeout)
              connectTimeout = null
            }

            connection.opened = true
            reconnectAttempt = 0
            console.log(`${logPrefix} websocket open`)
            emit(sender, {
              type: 'source_state',
              source,
              state: 'connected',
            })

            keepAliveTimer = setInterval(() => {
              if (!socket || socket.readyState !== WebSocketImpl.OPEN || stopping) return
              try {
                socket.send(JSON.stringify({ type: 'KeepAlive' }))
              } catch (error) {
                console.error(`${logPrefix} keepalive send failed`, error)
              }
            }, 5000)

            flushQueue()
          }

          socket.onclose = (event) => {
            if (connectTimeout) {
              clearTimeout(connectTimeout)
              connectTimeout = null
            }
            if (keepAliveTimer) {
              clearInterval(keepAliveTimer)
              keepAliveTimer = null
            }

            const code = Number(event?.code || 0)
            const reasonText = event?.reason || ''
            const isErrorClose = code !== 1000 && code !== 1005

            if (isErrorClose) {
              console.error(`${logPrefix} closed abnormally`, { code, reason: reasonText })
            } else {
              console.log(`${logPrefix} closed`, { code, reason: reasonText })
            }

            emit(sender, {
              type: 'source_state',
              source,
              state: isErrorClose ? 'error' : 'closed',
              code,
              reason: reasonText,
              message: isErrorClose ? `Deepgram closed (${code}${reasonText ? `: ${reasonText}` : ''})` : '',
            })

            if (isErrorClose && !stopping) {
              scheduleReconnect(`close ${code}${reasonText ? `: ${reasonText}` : ''}`)
            }
          }

          socket.onerror = (event) => {
            console.error(`${logPrefix} websocket error`, event)
            emit(sender, {
              type: 'source_state',
              source,
              state: 'error',
              message: event?.message || 'Deepgram websocket transport error',
            })
          }

          socket.onmessage = (event) => {
            const text = toText(event?.data)
            if (!text) return

            let parsed
            try {
              parsed = JSON.parse(text)
            } catch {
              return
            }

            if (parsed?.type !== 'Results') {
              if (parsed?.type === 'Metadata') {
                console.log(`${logPrefix} metadata`, { requestId: parsed?.request_id || '' })
                emit(sender, {
                  type: 'source_metadata',
                  source,
                  requestId: parsed?.request_id || '',
                })
              }
              return
            }

            const transcript = parsed?.channel?.alternatives?.[0]?.transcript || ''
            const confidence = parsed?.channel?.alternatives?.[0]?.confidence
            if (!transcript && !parsed?.is_final) return

            emit(sender, {
              type: 'transcript',
              source,
              transcript,
              isFinal: Boolean(parsed?.is_final),
              speechFinal: Boolean(parsed?.speech_final),
              confidence: typeof confidence === 'number' ? confidence : null,
            })
          }
        }

        if (socket && socket.readyState === WebSocketImpl.OPEN) {
          return sendBinary(chunk)
        }

        if (queuedChunks.length >= MAX_QUEUED_CHUNKS) {
          queuedChunks.shift()
        }
        queuedChunks.push(chunk)
        connection.queueSize = queuedChunks.length

        if (!socket || socket.readyState === WebSocketImpl.CLOSED || socket.readyState === WebSocketImpl.CLOSING) {
          openSocket('audio')
        }

        return true
      },
    }

    return connection
  }

  function stopSession(senderId) {
    const session = sessions.get(senderId)
    if (!session) return

    for (const source of Object.keys(session.connections)) {
      session.connections[source].stop()
    }

    sessions.delete(senderId)
    emit(session.sender, { type: 'session_state', state: 'stopped' })
  }

  ipcMain.handle('transcription:start', (event, payload) => {
    const senderId = event.sender.id
    stopSession(senderId)

    const activeSources = normalizeSources(payload?.sources)

    const apiKey = String(env.DEEPGRAM_API_KEY || '').trim()
    if (!apiKey) {
      emit(event.sender, {
        type: 'session_state',
        state: 'error',
        message: 'DEEPGRAM_API_KEY is missing',
      })
      return { ok: false, error: 'DEEPGRAM_API_KEY is missing' }
    }

    if (activeSources.length === 0) {
      emit(event.sender, {
        type: 'session_state',
        state: 'error',
        message: 'No valid transcription sources provided',
      })
      return { ok: false, error: 'No valid transcription sources provided' }
    }

    emit(event.sender, { type: 'session_state', state: 'connecting' })

    const connections = {}
    try {
      for (const source of activeSources) {
        connections[source] = createConnection({ sender: event.sender, source, apiKey })
        emit(event.sender, {
          type: 'source_state',
          source,
          state: 'waiting_audio',
        })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to initialize transcription'
      emit(event.sender, {
        type: 'session_state',
        state: 'error',
        message,
      })
      return { ok: false, error: message }
    }

    sessions.set(senderId, {
      sender: event.sender,
      connections,
    })

    emit(event.sender, { type: 'session_state', state: 'listening' })
    return { ok: true, activeSources }
  })

  ipcMain.handle('transcription:stop', (event) => {
    stopSession(event.sender.id)
    return { ok: true }
  })

  ipcMain.on('transcription:audio-chunk', (event, payload) => {
    const session = sessions.get(event.sender.id)
    if (!session) return

    const source = normalizeSource(payload?.source)
    if (!source) return

    const chunk = toBuffer(payload?.chunk)
    if (!chunk || chunk.length === 0) return

    const connection = session.connections[source]
    if (!connection) return

    connection.sendAudio(chunk)
  })

  return {
    stopSession,
    stopAllSessions() {
      for (const senderId of sessions.keys()) {
        stopSession(senderId)
      }
    },
  }
}

module.exports = {
  registerTranscriptionIpc,
}

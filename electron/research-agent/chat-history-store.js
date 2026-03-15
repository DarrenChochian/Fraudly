const fs = require('fs')
const path = require('path')

function createChatHistoryStore({ projectRoot }) {
  const storageDir = path.join(projectRoot, 'storage')
  const CHAT_HISTORY_PREFIX = 'chat-history-'
  const CHAT_HISTORY_SUFFIX = '.json'

  function ensureStorageDir() {
    fs.mkdirSync(storageDir, { recursive: true })
  }

  function historyPathForChat(chatId) {
    return path.join(storageDir, `${CHAT_HISTORY_PREFIX}${chatId}${CHAT_HISTORY_SUFFIX}`)
  }

  function isExistingChatId(chatId) {
    return fs.existsSync(historyPathForChat(chatId))
  }

  function prettifyChatId(chatId) {
    if (chatId === 'suspicious-scan') return 'Suspicious Scan'

    const analysisMatch = /^analysis-(\d+)(?:-\d+)?$/.exec(chatId)
    if (analysisMatch) {
      const timestamp = Number(analysisMatch[1])
      if (Number.isFinite(timestamp)) {
        return `Analysis ${new Date(timestamp).toLocaleString()}`
      }
      return 'Analysis'
    }

    return chatId
      .split('-')
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')
  }

  function describeChat(chatId) {
    const filePath = historyPathForChat(chatId)
    const history = load(chatId)
    const fileStats = fs.existsSync(filePath) ? fs.statSync(filePath) : null
    const firstEntry = history[0] || null
    const lastEntry = history[history.length - 1] || null
    const createdAt = firstEntry?.timestamp || fileStats?.birthtime?.toISOString?.() || fileStats?.mtime?.toISOString?.() || null
    const updatedAt = lastEntry?.updatedAt || lastEntry?.completedAt || lastEntry?.timestamp || fileStats?.mtime?.toISOString?.() || createdAt

    return {
      id: chatId,
      title: prettifyChatId(chatId),
      createdAt,
      updatedAt,
    }
  }

  function load(chatId) {
    const filePath = historyPathForChat(chatId)
    if (!fs.existsSync(filePath)) return []
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }

  function save(chatId, history) {
    ensureStorageDir()
    fs.writeFileSync(historyPathForChat(chatId), JSON.stringify(history, null, 2), 'utf8')
  }

  function upsertRun(history, runId, buildEntry) {
    const existingIndex = history.findIndex((entry) => entry?.runId === runId)
    const existing = existingIndex >= 0 ? history[existingIndex] : null
    const nextEntry = buildEntry(existing)

    if (existingIndex >= 0) {
      history[existingIndex] = nextEntry
    } else {
      history.push(nextEntry)
    }

    return nextEntry
  }

  function normalizeToolCall(toolCall, existing = null) {
    return {
      toolCallId: String(toolCall?.toolCallId || existing?.toolCallId || '').trim(),
      toolName: String(toolCall?.toolName || existing?.toolName || 'tool').trim() || 'tool',
      argsPreview: String(toolCall?.argsPreview || existing?.argsPreview || 'no args'),
      status: String(toolCall?.status || existing?.status || 'running'),
      outputPreview: String(toolCall?.outputPreview || existing?.outputPreview || ''),
      error: String(toolCall?.error || existing?.error || ''),
      ts: String(toolCall?.ts || existing?.ts || new Date().toISOString()),
    }
  }

  function ensureChat(chatId) {
    ensureStorageDir()
    if (!isExistingChatId(chatId)) {
      fs.writeFileSync(historyPathForChat(chatId), JSON.stringify([], null, 2), 'utf8')
    }

    return describeChat(chatId)
  }

  function createAnalysisChat() {
    ensureStorageDir()

    let chatId = `analysis-${Date.now()}`
    let attempt = 1
    while (isExistingChatId(chatId)) {
      chatId = `analysis-${Date.now()}-${attempt}`
      attempt += 1
    }

    return ensureChat(chatId)
  }

  function startRun({ chatId, runId, prompt }) {
    ensureChat(chatId)
    const history = load(chatId)
    const timestamp = new Date().toISOString()

    upsertRun(history, runId, (existing) => ({
      timestamp: existing?.timestamp || timestamp,
      updatedAt: timestamp,
      runId,
      prompt: String(prompt || existing?.prompt || ''),
      response: existing?.response || '',
      error: existing?.error || '',
      toolCalls: Array.isArray(existing?.toolCalls) ? existing.toolCalls : [],
    }))

    save(chatId, history)
  }

  function recordToolCall({ chatId, runId, toolCallId, toolName, argsPreview, status, outputPreview, error, ts }) {
    ensureChat(chatId)
    const history = load(chatId)
    const timestamp = new Date().toISOString()

    upsertRun(history, runId, (existing) => {
      const toolCalls = Array.isArray(existing?.toolCalls) ? [...existing.toolCalls] : []
      const existingToolIndex = toolCalls.findIndex((entry) => entry?.toolCallId === toolCallId)
      const nextToolCall = normalizeToolCall(
        { toolCallId, toolName, argsPreview, status, outputPreview, error, ts },
        existingToolIndex >= 0 ? toolCalls[existingToolIndex] : null,
      )

      if (existingToolIndex >= 0) {
        toolCalls[existingToolIndex] = nextToolCall
      } else {
        toolCalls.push(nextToolCall)
      }

      return {
        timestamp: existing?.timestamp || timestamp,
        updatedAt: timestamp,
        runId,
        prompt: String(existing?.prompt || ''),
        response: String(existing?.response || ''),
        error: String(existing?.error || ''),
        toolCalls,
      }
    })

    save(chatId, history)
  }

  function completeRun({ chatId, runId, response }) {
    ensureChat(chatId)
    const history = load(chatId)
    const timestamp = new Date().toISOString()

    upsertRun(history, runId, (existing) => ({
      timestamp: existing?.timestamp || timestamp,
      updatedAt: timestamp,
      completedAt: timestamp,
      runId,
      prompt: String(existing?.prompt || ''),
      response: String(response || ''),
      error: '',
      toolCalls: Array.isArray(existing?.toolCalls) ? existing.toolCalls : [],
    }))

    save(chatId, history)
  }

  function failRun({ chatId, runId, error }) {
    ensureChat(chatId)
    const history = load(chatId)
    const timestamp = new Date().toISOString()

    upsertRun(history, runId, (existing) => ({
      timestamp: existing?.timestamp || timestamp,
      updatedAt: timestamp,
      completedAt: timestamp,
      runId,
      prompt: String(existing?.prompt || ''),
      response: String(existing?.response || ''),
      error: String(error || 'Research failed'),
      toolCalls: Array.isArray(existing?.toolCalls) ? existing.toolCalls : [],
    }))

    save(chatId, history)
  }

  function listChats() {
    ensureStorageDir()

    return fs
      .readdirSync(storageDir)
      .map((fileName) => {
        if (!fileName.startsWith(CHAT_HISTORY_PREFIX) || !fileName.endsWith(CHAT_HISTORY_SUFFIX)) {
          return null
        }

        const chatId = fileName.slice(CHAT_HISTORY_PREFIX.length, -CHAT_HISTORY_SUFFIX.length)
        return chatId ? describeChat(chatId) : null
      })
      .filter(Boolean)
      .sort((left, right) => new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime())
  }

  function append({ chatId, prompt, response }) {
    ensureChat(chatId)
    const history = load(chatId)
    history.push({
      timestamp: new Date().toISOString(),
      prompt,
      response,
    })
    save(chatId, history)
  }

  return { load, append, ensureChat, listChats, createAnalysisChat, startRun, recordToolCall, completeRun, failRun }
}

module.exports = { createChatHistoryStore }

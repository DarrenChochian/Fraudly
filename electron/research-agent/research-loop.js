const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { RESEARCH_TOOLS } = require('./tool-schema')
const { executeToolCalls } = require('./tool-executor')

function createResearchLoop({ config, backboardClient, jinaClient, sessionStore, projectRoot }) {
  const systemPromptPath = path.join(projectRoot, 'electron', 'research-agent', 'system-prompt.md')
  let assistantPromise = null
  const threadPromisesByChatId = new Map()

  function isThreadNotFoundError(error) {
    if (!(error instanceof Error)) return false
    return error.message.includes('Backboard API error (404)') && /thread not found/i.test(error.message)
  }

  function isAssistantNotFoundError(error) {
    if (!(error instanceof Error)) return false
    return error.message.includes('Backboard API error (404)') && /assistant not found/i.test(error.message)
  }

  function readSystemPrompt() {
    return fs.readFileSync(systemPromptPath, 'utf8')
  }

  function loadSession() {
    return (
      sessionStore.load() || {
        assistantId: null,
        assistantFingerprint: null,
        threadsByChatId: {},
      }
    )
  }

  function resetSession() {
    sessionStore.save({
      assistantId: null,
      assistantFingerprint: null,
      threadsByChatId: {},
    })
  }

  function buildAssistantFingerprint({ systemPrompt }) {
    const payload = JSON.stringify({
      systemPrompt,
      tools: RESEARCH_TOOLS,
      provider: config.backboardProvider,
      model: config.backboardModel,
    })

    return crypto.createHash('sha256').update(payload).digest('hex')
  }

  function clearThreadForChat(chatId) {
    const session = loadSession()
    if (!session.threadsByChatId?.[chatId]) return

    const nextThreads = { ...(session.threadsByChatId || {}) }
    delete nextThreads[chatId]
    sessionStore.save({
      assistantId: session.assistantId,
      assistantFingerprint: session.assistantFingerprint,
      threadsByChatId: nextThreads,
    })
  }

  async function ensureAssistant(onEvent) {
    const systemPrompt = readSystemPrompt()
    const assistantFingerprint = buildAssistantFingerprint({ systemPrompt })
    const session = loadSession()
    if (session.assistantId && session.assistantFingerprint === assistantFingerprint) {
      return session
    }

    if (assistantPromise) {
      return assistantPromise
    }

    assistantPromise = (async () => {
      const latest = loadSession()
      if (latest.assistantId && latest.assistantFingerprint === assistantFingerprint) {
        return latest
      }

      onEvent({
        type: 'progress',
        message: latest.assistantId
          ? 'Research assistant config changed. Reinitializing...'
          : 'Initializing research assistant...',
      })

      const assistant = await backboardClient.createAssistant({
        name: 'Research Agent',
        systemPrompt,
        tools: RESEARCH_TOOLS,
      })

      const next = {
        assistantId: assistant.assistant_id,
        assistantFingerprint,
        threadsByChatId: {},
      }
      sessionStore.save(next)
      return next
    })()

    try {
      return await assistantPromise
    } finally {
      assistantPromise = null
    }
  }

  async function ensureThreadForChat({ chatId, onEvent }) {
    const normalizedChatId = String(chatId || '').trim()
    if (!normalizedChatId) {
      throw new Error('chatId is required')
    }

    const session = await ensureAssistant(onEvent)
    const latestSession = loadSession()
    const existingThreadId = latestSession.threadsByChatId?.[normalizedChatId] || session.threadsByChatId?.[normalizedChatId]
    if (existingThreadId) {
      return {
        assistantId: latestSession.assistantId || session.assistantId,
        threadId: existingThreadId,
      }
    }

    const inFlight = threadPromisesByChatId.get(normalizedChatId)
    if (inFlight) {
      return inFlight
    }

    const threadPromise = (async () => {
      const refreshedSession = await ensureAssistant(onEvent)
      const persistedSession = loadSession()
      const persistedThreadId = persistedSession.threadsByChatId?.[normalizedChatId]
      if (persistedThreadId) {
        return {
          assistantId: persistedSession.assistantId || refreshedSession.assistantId,
          threadId: persistedThreadId,
        }
      }

      onEvent({ type: 'progress', message: 'Initializing chat thread...' })
      let thread
      try {
        thread = await backboardClient.createThread(refreshedSession.assistantId)
      } catch (error) {
        if (!isAssistantNotFoundError(error)) {
          throw error
        }

        onEvent({ type: 'progress', message: 'Assistant expired. Reinitializing...' })
        resetSession()
        const recreatedSession = await ensureAssistant(onEvent)
        thread = await backboardClient.createThread(recreatedSession.assistantId)
      }
      const latest = loadSession()
      const next = {
        assistantId: latest.assistantId || refreshedSession.assistantId,
        assistantFingerprint: latest.assistantFingerprint || refreshedSession.assistantFingerprint,
        threadsByChatId: {
          ...(latest.threadsByChatId || {}),
          [normalizedChatId]: thread.thread_id,
        },
      }

      sessionStore.save(next)
      return {
        assistantId: next.assistantId,
        threadId: thread.thread_id,
      }
    })()

    threadPromisesByChatId.set(normalizedChatId, threadPromise)

    try {
      return await threadPromise
    } finally {
      threadPromisesByChatId.delete(normalizedChatId)
    }
  }

  async function initializeChats({ chatIds, onEvent }) {
    const uniqueChatIds = Array.from(
      new Set(
        (Array.isArray(chatIds) ? chatIds : [])
          .map((chatId) => String(chatId || '').trim())
          .filter(Boolean),
      ),
    )

    if (uniqueChatIds.length === 0) {
      return {
        initialized: 0,
      }
    }

    for (const chatId of uniqueChatIds) {
      await ensureThreadForChat({ chatId, onEvent })
    }
    return {
      initialized: uniqueChatIds.length,
    }
  }

  async function run({ chatId, prompt, runId, onEvent, attachmentFilePaths = [] }) {
    const normalizedChatId = String(chatId || '').trim()
    let session = await ensureThreadForChat({ chatId: normalizedChatId, onEvent })
    onEvent({ type: 'progress', message: 'Submitting prompt to research agent...' })

    let normalized
    try {
      normalized = backboardClient.normalizeMessageResponse(
        await backboardClient.addMessage({
          threadId: session.threadId,
          content: prompt,
          llmProvider: config.backboardProvider,
          modelName: config.backboardModel,
          attachmentFilePaths,
        }),
      )
    } catch (error) {
      if (!isThreadNotFoundError(error)) {
        throw error
      }

      onEvent({ type: 'progress', message: 'Stored thread is invalid. Recreating thread...' })
      clearThreadForChat(normalizedChatId)
      session = await ensureThreadForChat({ chatId: normalizedChatId, onEvent })

      normalized = backboardClient.normalizeMessageResponse(
        await backboardClient.addMessage({
          threadId: session.threadId,
          content: prompt,
          llmProvider: config.backboardProvider,
          modelName: config.backboardModel,
          attachmentFilePaths,
        }),
      )
    }

    let finalSummary = ''

    while (normalized.status === 'REQUIRES_ACTION' && normalized.toolCalls.length > 0) {
      onEvent({
        type: 'progress',
        message: `Executing ${normalized.toolCalls.length} tool call(s)...`,
      })

      const toolOutputs = await executeToolCalls(normalized.toolCalls, {
        jinaClient,
        onProgress: onEvent,
        onSummary: (summary) => {
          finalSummary = summary
        },
        onToolLifecycle: onEvent,
      })

      normalized = backboardClient.normalizeMessageResponse(
        await backboardClient.submitToolOutputs({
          threadId: session.threadId,
          runId: normalized.runId,
          toolOutputs,
        }),
      )
    }

    const summary = finalSummary || normalized.content || ''

    return {
      runId,
      summary,
      threadId: session.threadId,
      assistantId: session.assistantId,
    }
  }

  function resetThread(chatId) {
    const normalizedChatId = String(chatId || '').trim()
    if (!normalizedChatId) {
      throw new Error('chatId is required')
    }

    clearThreadForChat(normalizedChatId)
    return {
      ok: true,
      chatId: normalizedChatId,
    }
  }

  return {
    initializeChats,
    run,
    resetThread,
  }
}

module.exports = {
  createResearchLoop,
}

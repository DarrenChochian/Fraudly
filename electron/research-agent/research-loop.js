const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { RESEARCH_TOOLS } = require('./tool-schema')
const { executeToolCalls } = require('./tool-executor')
const { buildAttachmentContext } = require('./attachment-context')

function createResearchLoop({ config, backboardClient, jinaClient, sessionStore, projectRoot, userDataPath }) {
  const systemPromptPath = path.join(projectRoot, 'electron', 'research-agent', 'system-prompt.md')
  let assistantPromise = null
  const threadPromisesByChatId = new Map()
  const activeRunsByChatId = new Map()

  function isThreadNotFoundError(error) {
    if (!(error instanceof Error)) return false
    return error.message.includes('Backboard API error (404)') && /thread not found/i.test(error.message)
  }

  function isAssistantNotFoundError(error) {
    if (!(error instanceof Error)) return false
    return error.message.includes('Backboard API error (404)') && /assistant not found/i.test(error.message)
  }

  function isToolResultMismatchError(error) {
    if (!(error instanceof Error)) return false
    const message = error.message || ''
    return /[`'"]?tool_use[`'"]?\s+ids?.*without\s+[`'"]?tool_result[`'"]?\s+blocks/i.test(message)
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

  async function runToolEnabledConversation({ chatId, prompt, onEvent, attachmentFilePaths = [] }) {
    async function resolveRequiredActions({ initialResponse, onSummary }) {
      let normalized = initialResponse

      while (normalized.status === 'REQUIRES_ACTION' && normalized.toolCalls.length > 0) {
        onEvent({
          type: 'progress',
          message: `Executing ${normalized.toolCalls.length} tool call(s)...`,
        })

        const toolOutputs = await executeToolCalls(normalized.toolCalls, {
          jinaClient,
          onProgress: onEvent,
          onSummary,
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

      return normalized
    }

    async function addMessageWithKeepAliveRecovery({ content, files = [] }) {
      const requestPayload = {
        threadId: session.threadId,
        content,
        llmProvider: config.backboardProvider,
        modelName: config.backboardModel,
        attachmentFilePaths: files,
      }

      let attempt = 0
      const maxRecoveryAttempts = 3

      while (true) {
        try {
          return backboardClient.normalizeMessageResponse(await backboardClient.addMessage(requestPayload))
        } catch (error) {
          if (!isToolResultMismatchError(error) || attempt >= maxRecoveryAttempts) {
            throw error
          }

          attempt += 1
          onEvent({
            type: 'progress',
            message: `Tool-result mismatch detected (attempt ${attempt}/${maxRecoveryAttempts}). Sending keep alive and continuing...`,
          })

          let keepAliveResponse
          try {
            keepAliveResponse = backboardClient.normalizeMessageResponse(
              await backboardClient.addMessage({
                threadId: session.threadId,
                content: 'keep alive',
                llmProvider: config.backboardProvider,
                modelName: config.backboardModel,
                attachmentFilePaths: [],
              }),
            )
          } catch (keepAliveError) {
            if (isToolResultMismatchError(keepAliveError) && attempt < maxRecoveryAttempts) {
              onEvent({
                type: 'progress',
                message: 'Keep alive hit the same mismatch. Retrying recovery...',
              })
              continue
            }
            throw keepAliveError
          }

          await resolveRequiredActions({
            initialResponse: keepAliveResponse,
            onSummary: () => {},
          })

          onEvent({
            type: 'progress',
            message: 'Keep alive processed. Retrying original prompt...',
          })
        }
      }
    }

    let session = await ensureThreadForChat({ chatId, onEvent })
    onEvent({ type: 'progress', message: 'Submitting prompt to research agent...' })

    let normalized
    try {
      normalized = await addMessageWithKeepAliveRecovery({
        content: prompt,
        files: attachmentFilePaths,
      })
    } catch (error) {
      if (!isThreadNotFoundError(error)) {
        throw error
      }

      onEvent({ type: 'progress', message: 'Stored thread is invalid. Recreating thread...' })
      clearThreadForChat(chatId)
      session = await ensureThreadForChat({ chatId, onEvent })

      normalized = await addMessageWithKeepAliveRecovery({
        content: prompt,
        files: attachmentFilePaths,
      })
    }

    let finalSummary = ''
    normalized = await resolveRequiredActions({
      initialResponse: normalized,
      onSummary: (summary) => {
        finalSummary = summary
      },
    })

    return {
      summary: finalSummary || normalized.content || '',
      threadId: session.threadId,
      assistantId: session.assistantId,
    }
  }

  async function run({ chatId, prompt, runId, onEvent, attachmentFilePaths = [] }) {
    const normalizedChatId = String(chatId || '').trim()
    if (!normalizedChatId) {
      throw new Error('chatId is required')
    }

    if (activeRunsByChatId.has(normalizedChatId)) {
      throw new Error('Research run is already in progress for this chat')
    }

    const runPromise = (async () => {
      let finalPrompt = prompt
      const shouldInlineAttachmentContext = config.backboardProvider === 'anthropic' && attachmentFilePaths.length > 0

      if (shouldInlineAttachmentContext) {
        const attachmentContext = await buildAttachmentContext({
          attachmentFilePaths,
          projectRoot,
          userDataPath,
          onEvent,
        })

        if (attachmentContext) {
          finalPrompt = `${prompt}\n\n${attachmentContext}`
        }
      }

      const conversationResult = await runToolEnabledConversation({
        chatId: normalizedChatId,
        prompt: finalPrompt,
        onEvent,
        attachmentFilePaths: shouldInlineAttachmentContext ? [] : attachmentFilePaths,
      })

      return {
        runId,
        summary: conversationResult.summary,
        threadId: conversationResult.threadId,
        assistantId: conversationResult.assistantId,
      }
    })()

    activeRunsByChatId.set(normalizedChatId, runPromise)
    try {
      return await runPromise
    } finally {
      if (activeRunsByChatId.get(normalizedChatId) === runPromise) {
        activeRunsByChatId.delete(normalizedChatId)
      }
    }
  }

  function resetThread(chatId) {
    const normalizedChatId = String(chatId || '').trim()
    if (!normalizedChatId) {
      throw new Error('chatId is required')
    }
    if (activeRunsByChatId.has(normalizedChatId)) {
      throw new Error('Cannot reset thread while research is running for this chat')
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

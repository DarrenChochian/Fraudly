const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { RESEARCH_TOOLS } = require('./tool-schema')
const { executeToolCalls } = require('./tool-executor')
const { buildAttachmentContext } = require('./attachment-context')

function sanitizeSummary(summary) {
  let text = String(summary || '').trim()
  if (!text) return ''

  text = text.replace(/\r\n/g, '\n')

  const lines = text.split('\n')
  while (lines.length > 0) {
    const lastLine = String(lines[lines.length - 1] || '').trim()
    if (!lastLine) {
      lines.pop()
      continue
    }

    const looksDanglingMarkdown =
      lastLine.length < 40 &&
      (/\*\*$/.test(lastLine) ||
        /^\*\*[^*]*\)?$/.test(lastLine) ||
        /^[-*]\s*$/.test(lastLine) ||
        /^[([{\-*_`]+$/.test(lastLine))

    if (!looksDanglingMarkdown) break
    lines.pop()
  }

  text = lines.join('\n').trim()
  text = text.replace(/\*\*([^*\n]{0,40})$/, '$1').trim()
  return text
}

function hasPendingToolCalls(normalizedResponse) {
  if (!normalizedResponse || !Array.isArray(normalizedResponse.toolCalls)) return false
  return normalizedResponse.toolCalls.length > 0
}

function looksLikeEventLegitimacyPrompt(prompt) {
  const text = String(prompt || '').trim().toLowerCase()
  if (!text) return false

  const hasEventWord = /\b(hackathon|event|conference|summit|competition)\b/.test(text)
  const hasLegitimacyWord = /\b(legit|legitimate|real|safe|trustworthy|scam)\b/.test(text) || /^\s*is\b/.test(text)
  return hasEventWord && hasLegitimacyWord
}

function extractEventName(prompt) {
  const firstLine = String(prompt || '')
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean) || ''

  if (!firstLine) return ''

  return firstLine
    .replace(/^\s*is\s+/i, '')
    .replace(/\b(a|an)\s+(legit|legitimate|real|safe|trustworthy)\s+(hackathon|event|conference|summit|competition)\b\??/i, '')
    .replace(/\b(legit|legitimate|real|safe|trustworthy)\s+(hackathon|event|conference|summit|competition)\b\??/i, '')
    .replace(/\?+$/, '')
    .trim()
}

function extractUrlsFromMarkdown(markdown) {
  const text = String(markdown || '')
  const matches = text.match(/https?:\/\/[^\s)\]]+/g) || []
  return Array.from(new Set(matches.map((url) => url.replace(/[.,]+$/, ''))))
}

function rankResearchUrl(url, eventName) {
  const lowerUrl = String(url || '').toLowerCase()
  const lowerName = String(eventName || '').toLowerCase()
  let score = 0

  if (lowerUrl.includes('devpost.com')) score += 10
  if (lowerUrl.includes('mlh.io')) score += 8
  if (lowerUrl.includes('university') || lowerUrl.includes('.edu')) score += 6
  if (lowerUrl.includes('hackathon')) score += 5

  const compactName = lowerName.replace(/[^a-z0-9]+/g, '')
  if (compactName && lowerUrl.replace(/[^a-z0-9]+/g, '').includes(compactName)) score += 12

  return score
}

const BACKBOARD_MESSAGE_CHAR_LIMIT = 180000
const PROMPT_TRUNCATION_NOTE = `\n\n[Additional context truncated to stay under the hardcoded ${BACKBOARD_MESSAGE_CHAR_LIMIT}-character Backboard message cap.]`

function capBackboardMessageContent(content) {
  const text = String(content || '')
  if (text.length <= BACKBOARD_MESSAGE_CHAR_LIMIT) {
    return {
      content: text,
      truncated: false,
    }
  }

  const sliceLength = Math.max(0, BACKBOARD_MESSAGE_CHAR_LIMIT - PROMPT_TRUNCATION_NOTE.length)
  return {
    content: `${text.slice(0, sliceLength)}${PROMPT_TRUNCATION_NOTE}`,
    truncated: true,
  }
}

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
    async function recoverFromToolResultMismatch({ attempt, maxRecoveryAttempts, retryMessage, onSummary }) {
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
        throw keepAliveError
      }

      await resolveRequiredActions({
        initialResponse: keepAliveResponse,
        onSummary: onSummary || (() => {}),
      })

      onEvent({
        type: 'progress',
        message: retryMessage,
      })
    }

    async function resolveRequiredActions({ initialResponse, onSummary }) {
      let normalized = initialResponse
      let attempt = 0
      const maxRecoveryAttempts = 3

      while (hasPendingToolCalls(normalized)) {
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

        try {
          normalized = backboardClient.normalizeMessageResponse(
            await backboardClient.submitToolOutputs({
              threadId: session.threadId,
              runId: normalized.runId,
              toolOutputs,
            }),
          )
          attempt = 0
        } catch (error) {
          if (!isToolResultMismatchError(error) || attempt >= maxRecoveryAttempts) {
            throw error
          }

          attempt += 1
          try {
            await recoverFromToolResultMismatch({
              attempt,
              maxRecoveryAttempts,
              retryMessage: 'Keep alive processed. Retrying tool output submission...',
              onSummary: () => {},
            })
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
        }
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
          try {
            await recoverFromToolResultMismatch({
              attempt,
              maxRecoveryAttempts,
              retryMessage: 'Keep alive processed. Retrying original prompt...',
              onSummary: () => {},
            })
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
      summary: sanitizeSummary(finalSummary || normalized.content || ''),
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

      if (looksLikeEventLegitimacyPrompt(finalPrompt)) {
        const eventName = extractEventName(finalPrompt)
        if (eventName) {
          onEvent({ type: 'progress', message: `Pre-researching live sources for ${eventName}...` })

          const queries = [
            `"${eventName}" hackathon`,
            `${eventName} hackathon official`,
            `site:devpost.com "${eventName}"`,
          ]

          const searchResults = await Promise.allSettled(queries.map((query) => jinaClient.websearch(query)))
          const successfulSearches = searchResults
            .filter((result) => result.status === 'fulfilled')
            .map((result) => result.value)

          const candidateUrls = successfulSearches
            .flatMap((result) => extractUrlsFromMarkdown(result.markdown))
            .filter((url) => /^https?:\/\//i.test(url))
            .sort((left, right) => rankResearchUrl(right, eventName) - rankResearchUrl(left, eventName))

          const topUrls = Array.from(new Set(candidateUrls)).slice(0, 3)
          const fetchResults = await Promise.allSettled(topUrls.map((url) => jinaClient.webfetch(url)))
          const successfulFetches = fetchResults
            .filter((result) => result.status === 'fulfilled')
            .map((result) => result.value)

          const searchContextBlocks = []

          if (successfulSearches.length > 0) {
            searchContextBlocks.push(
              'Live search context gathered automatically:',
              ...successfulSearches.map((result) => `Search query: ${result.query}\n${result.markdown}`),
            )
          }

          if (successfulFetches.length > 0) {
            searchContextBlocks.push(
              'Fetched pages gathered automatically:',
              ...successfulFetches.map((result) => `Fetched URL: ${result.url}\n${result.markdown}`),
            )
          }

          if (searchContextBlocks.length > 0) {
            finalPrompt = `${finalPrompt}\n\n${searchContextBlocks.join('\n\n')}`
          }
        }
      }

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

      const cappedPrompt = capBackboardMessageContent(finalPrompt)
      if (cappedPrompt.truncated) {
        onEvent({
          type: 'progress',
          message: `Prompt exceeded Backboard limits and was truncated to ${BACKBOARD_MESSAGE_CHAR_LIMIT} characters.`,
        })
      }

      const conversationResult = await runToolEnabledConversation({
        chatId: normalizedChatId,
        prompt: cappedPrompt.content,
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

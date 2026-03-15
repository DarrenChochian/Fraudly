const crypto = require('crypto')
const { createResearchConfig } = require('./config')
const { createBackboardClient } = require('./backboard-client')
const { createJinaClient } = require('./jina-client')
const { createSessionStore } = require('./session-store')
const { createResearchLoop } = require('./research-loop')
const { createChatHistoryStore } = require('./chat-history-store')

function registerResearchAgentIpc({ ipcMain, projectRoot, userDataPath }) {
  const chatHistoryStore = createChatHistoryStore({ projectRoot })
  let services = null

  function getServices() {
    if (services) return services

    const config = createResearchConfig({ projectRoot })
    const backboardClient = createBackboardClient({
      apiKey: config.backboardApiKey,
      baseUrl: config.backboardBaseUrl,
    })
    const jinaClient = createJinaClient({ apiKey: config.jinaApiKey })
    const sessionStore = createSessionStore({ userDataPath })
    const researchLoop = createResearchLoop({
      config,
      backboardClient,
      jinaClient,
      sessionStore,
      projectRoot,
      userDataPath,
    })

    services = {
      researchLoop,
    }

    return services
  }

  ipcMain.handle('research:get-history', async (_, payload) => {
    const chatId = String(payload?.chatId || '').trim()
    if (!chatId) return []
    return chatHistoryStore.load(chatId)
  })

  ipcMain.handle('research:list-chats', async () => chatHistoryStore.listChats())

  ipcMain.handle('research:ensure-chat', async (_, payload) => {
    const chatId = String(payload?.chatId || '').trim()
    if (!chatId) {
      throw new Error('chatId is required')
    }

    return chatHistoryStore.ensureChat(chatId)
  })

  ipcMain.handle('research:create-analysis-chat', async () => chatHistoryStore.createAnalysisChat())

  ipcMain.handle('research:initialize-chats', async (_, payload) => {
    const chatIds = Array.isArray(payload?.chatIds) ? payload.chatIds : []
    return getServices().researchLoop.initializeChats({
      chatIds,
      onEvent: () => {},
    })
  })

  ipcMain.handle('research:reset-thread', async (_, payload) => {
    const chatId = String(payload?.chatId || '').trim()
    if (!chatId) {
      throw new Error('chatId is required')
    }

    return getServices().researchLoop.resetThread(chatId)
  })

  ipcMain.handle('research:run', async (event, payload) => {
    const prompt = payload?.prompt
    const chatId = String(payload?.chatId || '').trim()
    const attachmentFilePaths = Array.isArray(payload?.attachmentFilePaths)
      ? payload.attachmentFilePaths.map((value) => String(value || '').trim()).filter(Boolean)
      : []
    if (!prompt || typeof prompt !== 'string') {
      throw new Error('Prompt is required')
    }
    if (!chatId) {
      throw new Error('chatId is required')
    }

    const runId = crypto.randomUUID()
    const sendEvent = (data) => {
      if (data?.type === 'tool_call_started' || data?.type === 'tool_call_finished') {
        chatHistoryStore.recordToolCall({
          chatId,
          runId,
          toolCallId: data.toolCallId,
          toolName: data.toolName,
          argsPreview: data.argsPreview,
          status: data.status,
          outputPreview: data.outputPreview,
          error: data.error,
          ts: data.ts,
        })
      }

      event.sender.send('research:event', {
        ...data,
        chatId,
        runId,
        ts: new Date().toISOString(),
      })
    }

    sendEvent({ type: 'started', message: 'Research started.' })
    chatHistoryStore.startRun({ chatId, runId, prompt })

    try {
      const result = await getServices().researchLoop.run({
        chatId,
        prompt,
        runId,
        onEvent: sendEvent,
        attachmentFilePaths,
      })

      chatHistoryStore.completeRun({ chatId, runId, response: result.summary })
      sendEvent({ type: 'completed', message: 'Research completed.', summary: result.summary })
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Research failed'
      chatHistoryStore.failRun({ chatId, runId, error: message })
      sendEvent({ type: 'error', message })
      throw error
    }
  })
}

module.exports = {
  registerResearchAgentIpc,
}

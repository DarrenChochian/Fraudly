const fs = require('fs')
const path = require('path')

function createSessionStore({ userDataPath }) {
  const sessionPath = path.join(userDataPath, 'research-agent-session.json')

  function normalizeSession(raw) {
    if (!raw || typeof raw !== 'object') {
      return {
        assistantId: null,
        threadsByChatId: {},
      }
    }

    const threadsByChatId =
      raw.threadsByChatId && typeof raw.threadsByChatId === 'object'
        ? Object.fromEntries(
            Object.entries(raw.threadsByChatId).filter(
              ([chatId, threadId]) =>
                typeof chatId === 'string' && chatId.length > 0 && typeof threadId === 'string' && threadId.length > 0,
            ),
          )
        : {}

    if (Object.keys(threadsByChatId).length === 0 && typeof raw.threadId === 'string' && raw.threadId) {
      threadsByChatId['1'] = raw.threadId
    }

    return {
      assistantId: typeof raw.assistantId === 'string' && raw.assistantId ? raw.assistantId : null,
      threadsByChatId,
    }
  }

  function load() {
    if (!fs.existsSync(sessionPath)) return null
    try {
      const raw = fs.readFileSync(sessionPath, 'utf8')
      const parsed = JSON.parse(raw)
      return normalizeSession(parsed)
    } catch {
      return null
    }
  }

  function save({ assistantId, threadsByChatId }) {
    const normalized = normalizeSession({ assistantId, threadsByChatId })
    const payload = {
      assistantId: normalized.assistantId,
      threadsByChatId: normalized.threadsByChatId,
      updatedAt: new Date().toISOString(),
    }
    fs.writeFileSync(sessionPath, JSON.stringify(payload, null, 2), 'utf8')
  }

  return {
    load,
    save,
    sessionPath,
  }
}

module.exports = {
  createSessionStore,
}

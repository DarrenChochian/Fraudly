import { useState, useEffect, useRef } from 'react'
import { createMessageId, toolEntryIdFromEvent, initialMessagesForChat } from '../utils/chat'

function historyEntriesToMessages(chatId, history) {
  if (!Array.isArray(history) || history.length === 0) {
    return initialMessagesForChat(chatId)
  }

  const messages = history.flatMap((entry, index) => {
    const runId = String(entry?.runId || `history-${chatId}-${index}`)
    const nextMessages = []

    if (entry?.prompt) {
      nextMessages.push({
        id: `history-${runId}-user`,
        type: 'text',
        role: 'user',
        text: entry.prompt,
      })
    }

    if (Array.isArray(entry?.toolCalls)) {
      nextMessages.push(
        ...entry.toolCalls.map((toolCall, toolIndex) => ({
          id: toolEntryIdFromEvent({
            runId,
            toolCallId: toolCall?.toolCallId || `tool-${toolIndex}`,
            toolName: toolCall?.toolName,
            argsPreview: toolCall?.argsPreview,
          }),
          type: 'tool',
          role: 'assistant',
          toolCallId: toolCall?.toolCallId || '',
          toolName: toolCall?.toolName || 'tool',
          argsPreview: toolCall?.argsPreview || 'no args',
          status: toolCall?.status || 'success',
          outputPreview: toolCall?.outputPreview || '',
          error: toolCall?.error || '',
          expanded: false,
        })),
      )
    }

    if (entry?.response) {
      nextMessages.push({
        id: `history-${runId}-assistant`,
        type: 'text',
        role: 'assistant',
        text: entry.response,
      })
    } else if (entry?.error) {
      nextMessages.push({
        id: `history-${runId}-error`,
        type: 'text',
        role: 'assistant',
        text: `Research failed: ${entry.error}`,
      })
    }

    return nextMessages
  })

  return messages.length > 0 ? messages : initialMessagesForChat(chatId)
}

export function useResearch() {
  const [chats, setChats] = useState([])
  const [chatMessages, setChatMessages] = useState({})
  const [runningByChat, setRunningByChat] = useState({})
  const runningByChatRef = useRef({})

  useEffect(() => {
    runningByChatRef.current = runningByChat
  }, [runningByChat])

  useEffect(() => {
    if (!window.electronAPI?.listResearchChats || !window.electronAPI?.getChatHistory) return

    const loadChats = async () => {
      const storedChats = await window.electronAPI.listResearchChats().catch(() => [])
      const histories = await Promise.all(
        storedChats.map(async (chat) => {
          const history = await window.electronAPI.getChatHistory(chat.id).catch(() => [])
          return [chat.id, historyEntriesToMessages(chat.id, history)]
        }),
      )

      setChats(storedChats)
      setChatMessages((prev) => ({
        ...prev,
        ...Object.fromEntries(histories),
      }))
    }

    loadChats().catch((error) => console.error('Failed to load research chats:', error))
  }, [])

  const refreshChats = async () => {
    if (!window.electronAPI?.listResearchChats || !window.electronAPI?.getChatHistory) return

    const storedChats = await window.electronAPI.listResearchChats().catch(() => [])
    const histories = await Promise.all(
      storedChats.map(async (chat) => {
        const history = await window.electronAPI.getChatHistory(chat.id).catch(() => [])
        return [chat.id, historyEntriesToMessages(chat.id, history)]
      }),
    )

    setChats(storedChats)
    setChatMessages((prev) => ({
      ...prev,
      ...Object.fromEntries(histories),
    }))
  }

  const upsertChat = (chat) => {
    if (!chat?.id) return

    setChats((prev) => {
      const remaining = prev.filter((entry) => entry.id !== chat.id)
      return [chat, ...remaining]
    })
  }

  const ensureChat = async (chatId) => {
    const normalizedChatId = String(chatId || '').trim()
    if (!normalizedChatId || !window.electronAPI?.ensureResearchChat) return null

    const chat = await window.electronAPI.ensureResearchChat(normalizedChatId)
    upsertChat(chat)
    setChatMessages((prev) => ({
      ...prev,
      [normalizedChatId]: prev[normalizedChatId] || initialMessagesForChat(normalizedChatId),
    }))
    return chat
  }

  const createAnalysisChat = async () => {
    if (!window.electronAPI?.createAnalysisResearchChat) return null

    const chat = await window.electronAPI.createAnalysisResearchChat()
    upsertChat(chat)
    setChatMessages((prev) => ({
      ...prev,
      [chat.id]: prev[chat.id] || initialMessagesForChat(chat.id),
    }))
    return chat
  }

  const appendMessage = (chatId, message) => {
    setChatMessages((prev) => ({
      ...prev,
      [chatId]: [...(prev[chatId] || initialMessagesForChat(chatId)), message],
    }))
  }

  const toggleToolCard = (chatId, messageId) => {
    setChatMessages((prev) => ({
      ...prev,
      [chatId]: (prev[chatId] || []).map((message) =>
        message.id === messageId ? { ...message, expanded: !message.expanded } : message,
      ),
    }))
  }

  const runResearchPrompt = async ({ chatId, text, resetThread = false, replaceChatMessages = false, attachmentFilePaths = [] }) => {
    const normalizedChatId = String(chatId || '').trim()
    const prompt = String(text || '').trim()
    if (!normalizedChatId || !prompt || runningByChatRef.current[normalizedChatId]) return false

    await ensureChat(normalizedChatId)

    if (replaceChatMessages) {
      setChatMessages((prev) => ({
        ...prev,
        [normalizedChatId]: initialMessagesForChat(normalizedChatId),
      }))
    }

    appendMessage(normalizedChatId, {
      id: createMessageId('user'),
      type: 'text',
      role: 'user',
      text: prompt,
    })

    if (!window.electronAPI?.runResearch) {
      appendMessage(normalizedChatId, {
        id: createMessageId('error'),
        type: 'text',
        role: 'assistant',
        text: 'Research backend is unavailable.',
      })
      return false
    }

    setRunningByChat((prev) => ({
      ...prev,
      [normalizedChatId]: true,
    }))

    try {
      if (resetThread) {
        await window.electronAPI?.resetResearchThread?.(normalizedChatId)
      }

      await window.electronAPI.runResearch({
        chatId: normalizedChatId,
        prompt,
        attachmentFilePaths,
      })
      return true
    } catch {
      setRunningByChat((prev) => {
        const next = { ...prev }
        delete next[normalizedChatId]
        return next
      })
      return false
    }
  }

  useEffect(() => {
    const unsubscribe = window.electronAPI?.onResearchEvent?.((payload) => {
      const chatId = String(payload?.chatId || '').trim()
      if (!chatId) return

      if (payload.type === 'tool_call_started' || payload.type === 'tool_call_finished') {
        const toolName = String(payload?.toolName || '').toLowerCase()
        if (toolName === 'message' || toolName === 'summary') return

        setChatMessages((prev) => {
          const nextChatMessages = [...(prev[chatId] || [])]
          const messageId = toolEntryIdFromEvent(payload)
          const existingIndex = nextChatMessages.findIndex((message) => message.id === messageId)
          const existing = existingIndex >= 0 ? nextChatMessages[existingIndex] : null

          const nextMessage = {
            id: messageId,
            type: 'tool',
            role: 'assistant',
            toolCallId: payload.toolCallId || '',
            toolName: payload.toolName || 'tool',
            argsPreview: payload.argsPreview || existing?.argsPreview || 'no args',
            status:
              payload.status || (payload.type === 'tool_call_started' ? 'running' : existing?.status || 'success'),
            outputPreview: payload.outputPreview || existing?.outputPreview || '',
            error: payload.error || existing?.error || '',
            expanded: existing?.expanded || false,
          }

          if (existingIndex >= 0) {
            nextChatMessages[existingIndex] = nextMessage
          } else {
            nextChatMessages.push(nextMessage)
          }

          return {
            ...prev,
            [chatId]: nextChatMessages,
          }
        })
      } else if (payload.type === 'started' || payload.type === 'progress') {
        appendMessage(chatId, {
          id: createMessageId('progress'),
          type: 'progress',
          role: 'assistant',
          text: payload.message || 'Working...',
        })
      } else if (payload.type === 'completed') {
        if (payload.summary) {
          appendMessage(chatId, {
            id: createMessageId('assistant'),
            type: 'text',
            role: 'assistant',
            text: payload.summary,
          })
        }
        setRunningByChat((prev) => {
          const next = { ...prev }
          delete next[chatId]
          return next
        })
        refreshChats().catch((error) => console.error('Failed to refresh research chats:', error))
      } else if (payload.type === 'error') {
        appendMessage(chatId, {
          id: createMessageId('error'),
          type: 'text',
          role: 'assistant',
          text: `Research failed: ${payload.message || 'Unknown error'}`,
        })
        setRunningByChat((prev) => {
          const next = { ...prev }
          delete next[chatId]
          return next
        })
        refreshChats().catch((error) => console.error('Failed to refresh research chats:', error))
      }
    })

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe()
      }
    }
  }, [])

  return {
    chats,
    chatMessages,
    setChatMessages,
    runningByChat,
    runningByChatRef,
    appendMessage,
    toggleToolCard,
    ensureChat,
    createAnalysisChat,
    runResearchPrompt,
  }
}

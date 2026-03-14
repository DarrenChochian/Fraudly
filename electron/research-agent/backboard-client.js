const fs = require('fs/promises')
const path = require('path')

function toSnakeCaseToolOutputs(toolOutputs) {
  return toolOutputs.map((item) => ({
    tool_call_id: item.tool_call_id || item.toolCallId,
    output: item.output,
  }))
}

function normalizeToolCalls(toolCalls) {
  if (!Array.isArray(toolCalls)) return []
  return toolCalls
}

function createBackboardClient({ apiKey, baseUrl }) {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '')

  async function request(path, { method = 'GET', body, query, bodyType = 'json' } = {}) {
    const normalizedPath = path.startsWith('/') ? path.slice(1) : path
    const url = new URL(`${normalizedBaseUrl}/${normalizedPath}`)
    if (query) {
      Object.entries(query).forEach(([key, value]) => {
        if (value === undefined || value === null) return
        url.searchParams.set(key, String(value))
      })
    }

    const headers = {
      'X-API-Key': apiKey,
    }

    let requestBody
    if (bodyType === 'json') {
      headers['Content-Type'] = 'application/json'
      requestBody = body ? JSON.stringify(body) : undefined
    } else {
      requestBody = body
    }

    const response = await fetch(url, {
      method,
      headers,
      body: requestBody,
    })

    const text = await response.text()
    let data = {}
    try {
      data = text ? JSON.parse(text) : {}
    } catch {
      data = { raw: text }
    }

    if (!response.ok) {
      const message = data?.detail ? JSON.stringify(data.detail) : text
      throw new Error(`Backboard API error (${response.status}): ${message}`)
    }

    return data
  }

  return {
    createAssistant({ name, systemPrompt, tools }) {
      return request('/assistants', {
        method: 'POST',
        body: {
          name,
          system_prompt: systemPrompt,
          tools,
        },
      })
    },

    createThread(assistantId) {
      return request(`/assistants/${assistantId}/threads`, {
        method: 'POST',
        body: {},
      })
    },

    async addMessage({ threadId, content, llmProvider, modelName, attachmentFilePaths = [] }) {
      const formData = new FormData()
      if (typeof content === 'string' && content.length > 0) {
        formData.set('content', content)
      }
      formData.set('stream', 'false')
      formData.set('memory', 'off')
      formData.set('web_search', 'off')
      formData.set('llm_provider', llmProvider)
      formData.set('model_name', modelName)

      for (const rawFilePath of Array.isArray(attachmentFilePaths) ? attachmentFilePaths : []) {
        const filePath = String(rawFilePath || '').trim()
        if (!filePath) continue

        const buffer = await fs.readFile(filePath)
        formData.append('files', new Blob([buffer]), path.basename(filePath) || 'attachment')
      }

      return request(`/threads/${threadId}/messages`, {
        method: 'POST',
        body: formData,
        bodyType: 'form',
      })
    },

    submitToolOutputs({ threadId, runId, toolOutputs }) {
      return request(`/threads/${threadId}/runs/${runId}/submit-tool-outputs`, {
        method: 'POST',
        body: {
          tool_outputs: toSnakeCaseToolOutputs(toolOutputs),
        },
      })
    },

    normalizeMessageResponse(response) {
      return {
        status: response?.status,
        content: response?.content,
        runId: response?.run_id || response?.runId,
        toolCalls: normalizeToolCalls(response?.tool_calls || response?.toolCalls),
      }
    },
  }
}

module.exports = {
  createBackboardClient,
}

function parseArguments(toolCall) {
  if (toolCall?.function?.parsed_arguments) {
    return toolCall.function.parsed_arguments
  }

  const rawArguments = toolCall?.function?.arguments
  if (!rawArguments) return {}
  if (typeof rawArguments === 'object') return rawArguments

  try {
    return JSON.parse(rawArguments)
  } catch {
    return {}
  }
}

function getToolCallId(toolCall) {
  return toolCall?.id || toolCall?.tool_call_id || ''
}

function truncate(value, max = 180) {
  const text = String(value ?? '')
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function buildArgsPreview(args) {
  if (!args || typeof args !== 'object') return 'no args'

  const entries = Object.entries(args)
  if (entries.length === 0) return 'no args'

  return entries
    .slice(0, 3)
    .map(([key, value]) => {
      if (typeof value === 'string') return `${key}=${truncate(value, 60)}`
      if (typeof value === 'number' || typeof value === 'boolean') return `${key}=${value}`
      if (Array.isArray(value)) return `${key}=[${value.length}]`
      if (value && typeof value === 'object') return `${key}={...}`
      return `${key}=${String(value)}`
    })
    .join(', ')
}

function createOutputPreview(output) {
  if (!output) return ''
  try {
    const parsed = JSON.parse(output)
    if (parsed && typeof parsed === 'object' && typeof parsed.error === 'string') {
      return truncate(`error=${parsed.error}`, 200)
    }
    return truncate(JSON.stringify(parsed), 200)
  } catch {
    return truncate(output, 200)
  }
}

async function executeWebsearch(args, jinaClient) {
  const queries = []
  if (typeof args.query === 'string' && args.query.trim()) {
    queries.push(args.query.trim())
  }
  if (Array.isArray(args.queries)) {
    for (const query of args.queries) {
      if (typeof query === 'string' && query.trim()) {
        queries.push(query.trim())
      }
    }
  }

  if (queries.length === 0) {
    throw new Error('webseach requires query or queries')
  }

  const results = await Promise.all(queries.map((query) => jinaClient.websearch(query)))
  return { results }
}

async function executeSingleToolCall(toolCall, context) {
  const toolCallId = getToolCallId(toolCall)
  const toolName = toolCall?.function?.name
  const args = parseArguments(toolCall)
  const argsPreview = buildArgsPreview(args)

  if (toolCallId && typeof context.onToolLifecycle === 'function') {
    context.onToolLifecycle({
      type: 'tool_call_started',
      toolCallId,
      toolName: toolName || 'unknown',
      argsPreview,
      status: 'running',
    })
  }

  try {
    if (!toolCallId) {
      throw new Error('Tool call id is missing')
    }

    if (toolName === 'webseach' || toolName === 'search_web' || toolName === 'websearch') {
      const result = await executeWebsearch(args, context.jinaClient)
      const output = JSON.stringify(result)
      if (typeof context.onToolLifecycle === 'function') {
        context.onToolLifecycle({
          type: 'tool_call_finished',
          toolCallId,
          toolName,
          argsPreview,
          status: 'success',
          outputPreview: createOutputPreview(output),
        })
      }
      return { tool_call_id: toolCallId, output }
    }

    if (toolName === 'webfetch') {
      const result = await context.jinaClient.webfetch(args.url)
      const output = JSON.stringify(result)
      if (typeof context.onToolLifecycle === 'function') {
        context.onToolLifecycle({
          type: 'tool_call_finished',
          toolCallId,
          toolName,
          argsPreview,
          status: 'success',
          outputPreview: createOutputPreview(output),
        })
      }
      return { tool_call_id: toolCallId, output }
    }

    if (toolName === 'message') {
      const message = typeof args.message === 'string' ? args.message : 'Working...'
      context.onProgress({ type: 'progress', message })
      const output = JSON.stringify({ status: 'ok' })
      if (typeof context.onToolLifecycle === 'function') {
        context.onToolLifecycle({
          type: 'tool_call_finished',
          toolCallId,
          toolName,
          argsPreview,
          status: 'success',
          outputPreview: createOutputPreview(output),
        })
      }
      return { tool_call_id: toolCallId, output }
    }

    if (toolName === 'summary') {
      context.onSummary(typeof args.summary === 'string' ? args.summary : '')
      const output = JSON.stringify({ status: 'ok' })
      if (typeof context.onToolLifecycle === 'function') {
        context.onToolLifecycle({
          type: 'tool_call_finished',
          toolCallId,
          toolName,
          argsPreview,
          status: 'success',
          outputPreview: createOutputPreview(output),
        })
      }
      return { tool_call_id: toolCallId, output }
    }

    throw new Error(`Unsupported tool: ${toolName}`)
  } catch (error) {
    if (toolCallId && typeof context.onToolLifecycle === 'function') {
      context.onToolLifecycle({
        type: 'tool_call_finished',
        toolCallId,
        toolName: toolName || 'unknown',
        argsPreview,
        status: 'error',
        error: error instanceof Error ? error.message : 'Tool execution failed',
      })
    }

    return {
      tool_call_id: toolCallId,
      output: JSON.stringify({
        error: error instanceof Error ? error.message : 'Tool execution failed',
        tool: toolName,
      }),
    }
  }
}

async function executeToolCalls(toolCalls, context) {
  const outputs = await Promise.all(toolCalls.map((toolCall) => executeSingleToolCall(toolCall, context)))
  return outputs
}

module.exports = {
  executeToolCalls,
}

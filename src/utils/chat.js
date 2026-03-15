export function createMessageId(prefix = 'msg') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function truncate(text, max = 90) {
  const value = String(text ?? '')
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

export function initialMessagesForChat(chatId) {
  return [
    {
      id: `${chatId}-welcome`,
      type: 'text',
      role: 'assistant',
      text: 'Hello! How can I help you today?',
    },
  ]
}

export function buildInitialChatMessages(chatDefinitions) {
  return Object.fromEntries(chatDefinitions.map((chat) => [chat.id, initialMessagesForChat(chat.id)]))
}

export function buildSuspiciousScanPrompt({ screenshotResult, callerTranscript, userTranscript }) {
  const caller = String(callerTranscript || '').trim() || '(no caller transcript yet)'
  const user = String(userTranscript || '').trim() || '(no user transcript yet)'
  const capturedAt = new Date().toISOString()
  const screenshotName = String(screenshotResult?.filePath || '')
    .split(/[/\\]/)
    .filter(Boolean)
    .pop() || 'screenshot.png'

  return [
    'Analyze this interaction for scam risk.',
    'A screenshot image is attached to this message. Use it as primary evidence.',
    `Screenshot captured at: ${capturedAt}`,
    `Attached screenshot filename: ${screenshotName}`,
    `Screenshot size: ${screenshotResult.width}x${screenshotResult.height}`,
    '',
    'Focus on signs such as:',
    '- Requests for personal information (DOB, SSN, card/account details, PIN, OTP, passwords)',
    '- Untrusted or mismatched domains/links',
    '- Urgency/threat language or pressure tactics',
    '- Requests for payment, gift cards, crypto, wire transfer, or remote-access tools',
    '',
    'Transcript context:',
    `- Caller: ${caller}`,
    `- User: ${user}`,
    '',
    'Return:',
    '1) Risk level (low/medium/high)',
    '2) Red flags found (if any)',
    '3) Immediate next steps for the user',
  ].join('\n')
}

function formatTranscriptWindowTimestamp(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function buildMonitorTranscriptWindow(transcriptWindow, windowMs = 60 * 1000) {
  const cutoff = Date.now() - windowMs
  const entries = Array.isArray(transcriptWindow)
    ? transcriptWindow
        .filter((entry) => {
          const ts = Date.parse(entry?.ts || '')
          return Number.isFinite(ts) && ts >= cutoff && String(entry?.transcript || '').trim()
        })
        .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))
    : []

  if (entries.length === 0) {
    return '- No transcript activity captured in the last 60 seconds.'
  }

  return entries
    .map((entry) => {
      const speaker = entry.source === 'caller' ? 'Caller' : 'User'
      const liveLabel = entry.isFinal ? '' : ' (live)'
      const ts = formatTranscriptWindowTimestamp(entry.ts)
      const prefix = ts ? `[${ts}] ` : ''
      return `- ${prefix}${speaker}${liveLabel}: ${String(entry.transcript || '').trim()}`
    })
    .join('\n')
}

export function buildBackgroundMonitorPrompt({ screenshotResult, callerTranscript, userTranscript, transcriptWindow, activeIncident }) {
  const caller = String(callerTranscript || '').trim() || '(no caller transcript yet)'
  const user = String(userTranscript || '').trim() || '(no user transcript yet)'
  const capturedAt = new Date().toISOString()
  const screenshotName = String(screenshotResult?.filePath || '')
    .split(/[/\\]/)
    .filter(Boolean)
    .pop() || 'screenshot.png'
  const recentTranscriptWindow = buildMonitorTranscriptWindow(transcriptWindow)

  const activeIncidentContext = activeIncident
    ? [
        'Current active incident context:',
        `- Chat ID: ${activeIncident.chatId}`,
        `- Prior title: ${activeIncident.title || '(none)'}`,
        `- Prior fingerprint: ${activeIncident.fingerprint || '(none)'}`,
        `- Prior risk level: ${activeIncident.riskLevel || '(unknown)'}`,
        `- Prior quick debrief: ${activeIncident.quickDebrief || '(none)'}`,
      ].join('\n')
    : 'There is no currently active suspicious incident.'

  return [
    'You are running a background fraud-monitoring scan for the currently visible screen.',
    'A screenshot image is attached to this message. Use it as the primary evidence.',
    `Screenshot captured at: ${capturedAt}`,
    `Attached screenshot filename: ${screenshotName}`,
    `Screenshot size: ${screenshotResult.width}x${screenshotResult.height}`,
    '',
    'Decide whether the currently visible content indicates a live scam/fraud incident.',
    'If suspicious content is visible, determine whether it appears to be the same incident as the prior active incident or a new unique incident.',
    'Only treat this as suspicious when the visible evidence supports it.',
    'Only mark meaningfulChange=true when the user should receive a new incident update.',
    '',
    activeIncidentContext,
    '',
    'Transcript context:',
    'Last 60 seconds of interleaved caller/user transcript:',
    recentTranscriptWindow,
    '',
    'Most recent transcript snapshot:',
    `- Caller: ${caller}`,
    `- User: ${user}`,
    '',
    'Return two things:',
    '1) A very short user-facing markdown analysis for background monitoring.',
    '   - Keep it under 35 words.',
    '   - No headings, no section titles, no long explanations.',
    '   - Prefer one sentence or two very short bullets.',
    '   - Put the real verdict in the JSON block below.',
    '   - If deeper research is needed, you may still use tools, but the final visible text must stay short.',
    '2) A fenced code block labeled fraud-monitor containing valid JSON with exactly these keys:',
    '   - status: "safe" | "suspicious"',
    '   - riskLevel: "low" | "medium" | "high"',
    '   - incidentTitle: short title for the incident, or empty string if safe',
    '   - quickDebrief: 1-2 sentence summary for notification/chat preview, or empty string if safe',
    '   - fingerprint: stable short identifier for the visible incident/entity if possible, else empty string',
    '   - sameIncidentAsPrevious: true | false',
    '   - meaningfulChange: true | false',
    '',
    'The JSON block must look like:',
    '```fraud-monitor',
    '{',
    '  "status": "suspicious",',
    '  "riskLevel": "high",',
    '  "incidentTitle": "Fake TD Bank login page",',
    '  "quickDebrief": "The page is requesting banking credentials on a suspicious domain.",',
    '  "fingerprint": "fake-td-login",',
    '  "sameIncidentAsPrevious": false,',
    '  "meaningfulChange": true',
    '}',
    '```',
    '',
    'Example visible text:',
    '- Suspicious: TD impersonation over Discord asking for credit card details. Do not reply or share any information.',
    '- Safe: No clear scam indicators visible in this screenshot.',
  ].join('\n')
}

export function statusStyles(status) {
  if (status === 'success') {
    return {
      borderColor: 'rgba(34, 197, 94, 0.35)',
      textColor: 'rgb(134 239 172)',
      badgeBg: 'rgba(34, 197, 94, 0.15)',
      badgeText: 'rgb(134 239 172)',
    }
  }
  if (status === 'error') {
    return {
      borderColor: 'rgba(239, 68, 68, 0.4)',
      textColor: 'rgb(252 165 165)',
      badgeBg: 'rgba(239, 68, 68, 0.15)',
      badgeText: 'rgb(252 165 165)',
    }
  }
  return {
    borderColor: 'rgba(255, 90, 168, 0.45)',
    textColor: '#ff8ec8',
    badgeBg: 'rgba(255, 90, 168, 0.15)',
    badgeText: '#ff8ec8',
  }
}

export function previewForHistory(message) {
  if (!message) return 'No activity yet'
  if (message.type === 'tool') {
    return `${message.toolName || 'tool'} (${message.status || 'running'}) • ${message.argsPreview || 'no args'}`
  }
  return message.text || 'No activity yet'
}

export function toolEntryIdFromEvent(payload) {
  const runId = payload?.runId || 'run'
  const toolCallId = payload?.toolCallId || `${payload?.toolName || 'tool'}-${payload?.argsPreview || 'args'}`
  return `tool-${runId}-${toolCallId}`
}

export type OpenAiChatMessage = {
  role: string
  content?: string | null
}

export function transcriptFromCustomMessages(messages: unknown): unknown[] {
  if (!Array.isArray(messages)) return []
  return messages.flatMap((message) => {
    if (!message || typeof message !== 'object') return []
    const row = message as OpenAiChatMessage
    if ((row.role !== 'user' && row.role !== 'assistant') || typeof row.content !== 'string' || !row.content.trim()) {
      return []
    }
    return [{
      role: row.role,
      message: row.content.trim(),
      at: new Date().toISOString(),
    }]
  })
}

export function parseStreamContent(dataLine: string): { content: string; usage: {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
} | null } | null {
  const data = dataLine.replace(/^data:\s*/, '').trim()
  if (!data || data === '[DONE]') return null
  try {
    const parsed = JSON.parse(data) as {
      choices?: Array<{ delta?: { content?: unknown } }>
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
    }
    return {
      content: typeof parsed.choices?.[0]?.delta?.content === 'string'
        ? parsed.choices[0].delta.content
        : '',
      usage: parsed.usage ?? null,
    }
  } catch {
    return null
  }
}

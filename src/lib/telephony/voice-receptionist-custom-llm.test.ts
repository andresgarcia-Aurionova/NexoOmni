import { describe, expect, it } from 'vitest'

import { parseStreamContent, transcriptFromCustomMessages } from './voice-receptionist-custom-llm'

describe('voice receptionist custom LLM', () => {
  it('extracts only committed conversation text for the live transcript', () => {
    expect(transcriptFromCustomMessages([
      { role: 'system', content: 'Instructions' },
      { role: 'assistant', content: 'Buenos días.' },
      { role: 'user', content: 'Quiero reservar para cuatro.' },
      { role: 'assistant', tool_calls: [{ id: '1' }] },
      { role: 'tool', content: '{"saved":true}' },
    ])).toEqual([
      expect.objectContaining({ role: 'assistant', message: 'Buenos días.' }),
      expect.objectContaining({ role: 'user', message: 'Quiero reservar para cuatro.' }),
    ])
  })

  it('reads streamed content and final usage from OpenAI SSE', () => {
    expect(parseStreamContent('data: {"choices":[{"delta":{"content":"Hola"}}]}')).toEqual({
      content: 'Hola',
      usage: null,
    })
    expect(parseStreamContent('data: {"choices":[],"usage":{"prompt_tokens":20,"completion_tokens":3,"total_tokens":23}}')).toEqual({
      content: '',
      usage: { prompt_tokens: 20, completion_tokens: 3, total_tokens: 23 },
    })
    expect(parseStreamContent('data: [DONE]')).toBeNull()
  })
})

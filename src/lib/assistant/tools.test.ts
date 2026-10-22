import { describe, expect, it } from 'vitest'
import { InvalidAssistantDecisionError, parseAssistantDecision } from './tools'

describe('parseAssistantDecision', () => {
  it('accepts a direct answer', () => {
    expect(parseAssistantDecision('{"type":"answer","answer":"Hola"}')).toEqual({
      type: 'answer',
      answer: 'Hola',
    })
  })

  it('accepts a bounded read-only tool call', () => {
    expect(parseAssistantDecision(
      '{"type":"tool_call","tool":{"name":"get_recent_call_transcriptions","limit":5}}'
    )).toEqual({
      type: 'tool_call',
      tool: { name: 'get_recent_call_transcriptions', limit: 5 },
    })
  })

  it('rejects unsupported tools, extra fields, and invalid limits', () => {
    const invalid = [
      '{"type":"tool_call","tool":{"name":"run_sql","query":"select *"}}',
      '{"type":"tool_call","tool":{"name":"get_account_overview","account_id":"other"}}',
      '{"type":"tool_call","tool":{"name":"get_recent_call_transcriptions","limit":100}}',
    ]
    for (const decision of invalid) {
      expect(() => parseAssistantDecision(decision)).toThrow(InvalidAssistantDecisionError)
    }
  })

  it('rejects non-JSON model output', () => {
    expect(() => parseAssistantDecision('```json\n{}\n```')).toThrow(
      InvalidAssistantDecisionError
    )
  })
})

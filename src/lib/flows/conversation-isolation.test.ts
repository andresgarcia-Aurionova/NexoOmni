import { createClient } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ admin: vi.fn() }))
vi.mock('./admin-client', () => ({ supabaseAdmin: mocks.admin }))

import { dispatchInboundToFlows } from './engine'
import { pauseFlowOnAgentReply } from './pause-on-agent-reply'

type Run = {
  id: string
  account_id: string
  contact_id: string
  conversation_id: string
  flow_id: string
  status: string
  current_node_key: string | null
  vars: Record<string, string>
  reprompt_count: number
}

let runs: Run[]
let updates: string[]

function database() {
  return createClient('https://db.example.test', 'key', {
    global: {
      fetch: async (input, init) => {
        const url = new URL(String(input))
        const table = url.pathname.split('/').pop()
        const method = init?.method ?? 'GET'
        if (table === 'flow_runs') {
          const matching = runs.filter((run) =>
            (['id', 'account_id', 'contact_id', 'conversation_id', 'status'] as const)
              .every((key) => !url.searchParams.has(key) || url.searchParams.get(key) === `eq.${run[key]}`))
          if (method === 'PATCH') {
            updates.push(...matching.map((run) => run.id))
            matching.forEach((run) => Object.assign(run, JSON.parse(String(init?.body))))
            return new Response(null, { status: 204 })
          }
          return Response.json(matching)
        }
        if (table === 'flow_nodes') return Response.json([
          { node_key: 'question', node_type: 'collect_input', config: { var_key: 'answer', next_node_key: 'end' } },
          { node_key: 'end', node_type: 'end', config: {} },
        ])
        if (table === 'flow_run_events') {
          if (method === 'HEAD') return new Response(null, { headers: { 'content-range': '*/0' } })
          if (method === 'POST') return new Response(null, { status: 201 })
        }
        return new Response(`Unexpected query ${method} ${table}`, { status: 500 })
      },
    },
  })
}

const input = {
  accountId: 'account',
  userId: 'owner',
  contactId: 'contact',
  conversationId: 'line-b',
  message: { kind: 'text' as const, text: '1', meta_message_id: 'message-b' },
  isFirstInboundMessage: false,
  allowNewRuns: false,
}

beforeEach(() => {
  runs = [{
    id: 'run-a', account_id: 'account', contact_id: 'contact',
    conversation_id: 'line-a', flow_id: 'flow-a', status: 'active',
    current_node_key: 'question', vars: {}, reprompt_count: 0,
  }]
  updates = []
  mocks.admin.mockReturnValue(database())
})

describe('flows by conversation', () => {
  it('does not advance an active flow on a different line', async () => {
    expect(await dispatchInboundToFlows(input)).toEqual({ consumed: false, outcome: 'no_match' })
    expect(updates).toEqual([])
  })

  it('selects only the active flow on the line receiving the reply', async () => {
    runs.push({ ...runs[0], id: 'run-b', conversation_id: 'line-b', flow_id: 'flow-b' })
    expect(await dispatchInboundToFlows(input)).toMatchObject({ consumed: true, flow_run_id: 'run-b', outcome: 'completed' })
    expect(updates).toEqual(['run-b', 'run-b'])
    expect(runs[0]).toMatchObject({ status: 'active', vars: {} })
    expect(runs[1]).toMatchObject({ status: 'completed', vars: { answer: '1' } })
  })

  it('pauses only the conversation where an agent replied', async () => {
    runs.push({ ...runs[0], id: 'run-b', conversation_id: 'line-b' })
    await pauseFlowOnAgentReply(database(), 'account', 'line-b')
    expect(updates).toEqual(['run-b'])
    expect(runs.map((run) => run.status)).toEqual(['active', 'paused_by_agent'])
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'

import { transferYeastarCall } from './yeastar-call-transfer'
import { yeastarAiConnection } from './yeastar-ai'

vi.mock('./yeastar-ai', async (original) => ({
  ...await original<typeof import('./yeastar-ai')>(),
  yeastarAiConnection: vi.fn().mockResolvedValue({
    pbxUrl: 'https://pbx.example.test',
    token: 'access-token',
  }),
}))

const db = createClient('https://db.example.test', 'test-key')

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('Yeastar call transfer', () => {
  it('blind-transfers the unique inbound channel with the configured extension permission', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      errcode: 0,
      errmsg: 'SUCCESS',
      call_id: '1650029138.338',
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(transferYeastarCall(db, 'account-1', {
      channelId: 'PJSIP/trunk-00000001',
      number: '6401',
      dialPermission: '2005',
    })).resolves.toEqual({ callId: '1650029138.338' })

    expect(yeastarAiConnection).toHaveBeenCalledWith(db, 'account-1')
    const url = fetchMock.mock.calls[0][0] as URL
    expect(url.pathname).toBe('/openapi/v1.0/call/transfer')
    expect(url.searchParams.get('access_token')).toBe('access-token')
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      type: 'blind',
      channel_id: 'PJSIP/trunk-00000001',
      number: '6401',
      dial_permission: '2005',
    })
  })

  it('does not report success for a rejected PBX transfer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({
      errcode: 10001,
      errmsg: 'Permission denied',
    })))

    await expect(transferYeastarCall(db, 'account-1', {
      channelId: 'PJSIP/trunk-00000001',
      number: '6401',
      dialPermission: '2005',
    })).rejects.toThrow('Permission denied')
  })
})

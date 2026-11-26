import type { SupabaseClient } from '@supabase/supabase-js'

import { apiUrl, yeastarAiConnection } from './yeastar-ai'

type TransferReply = {
  errcode?: number
  errmsg?: string
  call_id?: string
}

export async function transferYeastarCall(
  db: SupabaseClient,
  accountId: string,
  input: {
    channelId: string
    number: string
    dialPermission: string
  },
) {
  const { pbxUrl, token } = await yeastarAiConnection(db, accountId)
  const url = apiUrl(pbxUrl, 'call/transfer')
  url.searchParams.set('access_token', token)
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'OpenAPI',
    },
    body: JSON.stringify({
      type: 'blind',
      channel_id: input.channelId,
      number: input.number,
      dial_permission: input.dialPermission,
    }),
    signal: AbortSignal.timeout(15_000),
  })
  const result = await response.json().catch(() => ({})) as TransferReply
  if (!response.ok || result.errcode !== 0) {
    throw new Error(
      `Yeastar rechazó la transferencia (${result.errcode ?? response.status}): ${result.errmsg ?? 'sin detalle'}`,
    )
  }
  return { callId: result.call_id ?? null }
}

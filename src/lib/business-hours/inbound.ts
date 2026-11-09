import type { SupabaseClient } from '@supabase/supabase-js'

import { sendOmnichannelText } from '@/lib/omnichannel/outbound-text'
import { closurePeriodStart } from './schedule'
import { parseBusinessHours } from './config'

export async function getClosure(
  db: SupabaseClient,
  accountId: string,
  connectorId: string,
  now: Date,
): Promise<{ periodStart: string; message: string } | null> {
  const { data, error } = await db.from('connected_whatsapp_business_hours')
    .select('enabled, timezone, windows, holidays, message')
    .eq('account_id', accountId).eq('connector_id', connectorId).maybeSingle()
  if (error) throw error
  if (!data || !data.enabled) return null
  const parsed = parseBusinessHours({
    connectorId,
    enabled: data.enabled,
    timezone: data.timezone,
    windows: data.windows,
    holidays: data.holidays,
    message: data.message,
  })
  if (!parsed.success) throw new Error('Invalid business-hours configuration')
  const periodStart = closurePeriodStart(parsed.data, now)
  return periodStart ? { periodStart, message: parsed.data.message } : null
}

export async function sendClosureNotice(
  db: SupabaseClient,
  args: { accountId: string; connectorId: string; conversationId: string; periodStart: string; message: string; isFirstInboundMessage: boolean },
): Promise<'sent' | 'already_claimed'> {
  const { error } = await db.from('connected_whatsapp_closure_receipts').insert({
    account_id: args.accountId,
    connector_id: args.connectorId,
    conversation_id: args.conversationId,
    period_start: args.periodStart,
    deferred_first_inbound: args.isFirstInboundMessage,
  })
  if (error?.code === '23505') {
    if (args.isFirstInboundMessage) {
      const { error: deferError } = await db.from('connected_whatsapp_closure_receipts')
        .update({ deferred_first_inbound: true, resumed_at: null })
        .eq('account_id', args.accountId).eq('conversation_id', args.conversationId)
        .eq('period_start', args.periodStart)
      if (deferError) throw deferError
    }
    return 'already_claimed'
  }
  if (error) throw error
  try {
    await sendOmnichannelText(db, {
      accountId: args.accountId,
      conversationId: args.conversationId,
      text: args.message,
    })
  } catch (sendError) {
    const { error: updateError } = await db.from('connected_whatsapp_closure_receipts')
      .update({ state: 'failed' })
      .eq('account_id', args.accountId).eq('conversation_id', args.conversationId)
      .eq('period_start', args.periodStart)
    if (updateError) console.error('[business-hours] failed to mark delivery failure:', updateError)
    throw sendError
  }
  const { error: updateError } = await db.from('connected_whatsapp_closure_receipts')
    .update({ state: 'sent' })
    .eq('account_id', args.accountId).eq('conversation_id', args.conversationId)
    .eq('period_start', args.periodStart)
  if (updateError) throw updateError
  return 'sent'
}

export async function deferredFirstInbound(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
  consume: boolean,
): Promise<boolean> {
  const { data, error } = await db.rpc(consume ? 'consume_deferred_whatsapp_first_inbound' : 'has_deferred_whatsapp_first_inbound', {
    p_account_id: accountId,
    p_conversation_id: conversationId,
  })
  if (error) throw error
  if (typeof data !== 'boolean') throw new Error('Invalid deferred inbound result')
  return data
}

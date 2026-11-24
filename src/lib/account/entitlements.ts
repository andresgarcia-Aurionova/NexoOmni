import type { SupabaseClient } from '@supabase/supabase-js'

import { ForbiddenError, requireRole, type AccountContext } from '@/lib/auth/account'
import type { AccountRole } from '@/lib/auth/roles'

export const PLAN_CODES = ['basic', 'ai', 'yeastar_voice', 'whatsapp_voice'] as const
export type PlanCode = (typeof PLAN_CODES)[number]

export const ENTITLEMENTS = [
  'ai_assistant',
  'ai_conversation_intelligence',
  'ai_credits',
  'yeastar_telephony',
  'yeastar_live_chat',
  'social_messaging',
  'whatsapp_voice_calls',
  'automation_flows',
  'channel_whatsapp',
  'channel_facebook',
  'channel_instagram',
  'channel_googlebusiness',
  'channel_google',
  'channel_email',
  'channel_tiktok',
  'channel_twitter',
  'channel_threads',
  'channel_telegram',
  'channel_hubspot',
  'channel_salesforce',
] as const
export type Entitlement = (typeof ENTITLEMENTS)[number]

export const CHANNEL_ADD_ON_ENTITLEMENTS = [
  'channel_whatsapp',
  'channel_facebook',
  'channel_instagram',
  'channel_googlebusiness',
  'channel_google',
  'channel_email',
  'channel_tiktok',
  'channel_twitter',
  'channel_threads',
  'channel_telegram',
  'channel_hubspot',
  'channel_salesforce',
] as const
export type ChannelAddOnEntitlement = (typeof CHANNEL_ADD_ON_ENTITLEMENTS)[number]

type SubscriptionRow = {
  plan_code: string
  seat_limit: number
  status: string
  ends_at: string | null
  grace_days: number
  feature_overrides: Record<string, unknown> | null
}

export type AccountEntitlements = {
  planCode: PlanCode
  seatLimit: number
  status: 'active' | 'trial' | 'suspended' | 'cancelled'
  endsAt: string | null
  graceDays: number
  features: Record<Entitlement, boolean>
}

const PLAN_FEATURES: Record<PlanCode, Record<Entitlement, boolean>> = {
  basic: { ai_assistant: false, ai_conversation_intelligence: false, ai_credits: false, yeastar_telephony: false, yeastar_live_chat: false, social_messaging: true, whatsapp_voice_calls: false, automation_flows: true, channel_whatsapp: false, channel_facebook: false, channel_instagram: false, channel_googlebusiness: false, channel_google: false, channel_email: false, channel_tiktok: false, channel_twitter: false, channel_threads: false, channel_telegram: false, channel_hubspot: false, channel_salesforce: false },
  ai: { ai_assistant: true, ai_conversation_intelligence: true, ai_credits: true, yeastar_telephony: false, yeastar_live_chat: false, social_messaging: true, whatsapp_voice_calls: false, automation_flows: true, channel_whatsapp: false, channel_facebook: false, channel_instagram: false, channel_googlebusiness: false, channel_google: false, channel_email: false, channel_tiktok: false, channel_twitter: false, channel_threads: false, channel_telegram: false, channel_hubspot: false, channel_salesforce: false },
  yeastar_voice: { ai_assistant: true, ai_conversation_intelligence: true, ai_credits: true, yeastar_telephony: true, yeastar_live_chat: true, social_messaging: true, whatsapp_voice_calls: false, automation_flows: true, channel_whatsapp: false, channel_facebook: false, channel_instagram: false, channel_googlebusiness: false, channel_google: false, channel_email: false, channel_tiktok: false, channel_twitter: false, channel_threads: false, channel_telegram: false, channel_hubspot: false, channel_salesforce: false },
  whatsapp_voice: { ai_assistant: true, ai_conversation_intelligence: true, ai_credits: true, yeastar_telephony: true, yeastar_live_chat: true, social_messaging: true, whatsapp_voice_calls: true, automation_flows: true, channel_whatsapp: false, channel_facebook: false, channel_instagram: false, channel_googlebusiness: false, channel_google: false, channel_email: false, channel_tiktok: false, channel_twitter: false, channel_threads: false, channel_telegram: false, channel_hubspot: false, channel_salesforce: false },
}

export function channelAddOnEntitlement(
  channel: string
): ChannelAddOnEntitlement | null {
  const feature = `channel_${channel}`;
  return (CHANNEL_ADD_ON_ENTITLEMENTS as readonly string[]).includes(feature)
    ? feature as ChannelAddOnEntitlement
    : null;
}

function isPlanCode(value: string): value is PlanCode {
  return (PLAN_CODES as readonly string[]).includes(value)
}

function isSubscriptionStatus(value: string): value is AccountEntitlements['status'] {
  return value === 'active' || value === 'trial' || value === 'suspended' || value === 'cancelled'
}

/** Server-side source of truth. UI visibility is never an authorization boundary. */
export async function getAccountEntitlements(supabase: SupabaseClient, accountId: string): Promise<AccountEntitlements | null> {
  const { data, error } = await supabase
    .from('account_subscriptions')
    .select('plan_code, seat_limit, status, ends_at, grace_days, feature_overrides')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null

  const row = data as SubscriptionRow
  const planCode = row.plan_code
  const status = row.status
  if (!isPlanCode(planCode) || !isSubscriptionStatus(status)) return null
  const endsAt = row.ends_at ?? null
  const graceDays = row.grace_days ?? 0
  const enabled = (status === 'active' || status === 'trial') && (!endsAt || new Date(endsAt).getTime() + graceDays * 86_400_000 > Date.now())
  const features = Object.fromEntries(ENTITLEMENTS.map((feature) => {
    const override = row.feature_overrides?.[feature]
    return [feature, enabled && (typeof override === 'boolean' ? override : PLAN_FEATURES[planCode][feature])]
  })) as Record<Entitlement, boolean>

  return { planCode, seatLimit: row.seat_limit, status, endsAt, graceDays, features }
}

/**
 * Server guard for a billable module. Add it to every route that starts,
 * configures, or exposes that module; client-side feature flags are cosmetic.
 */
export async function requireEntitlement(
  feature: Entitlement,
  minRole: AccountRole = 'viewer',
): Promise<AccountContext & { entitlements: AccountEntitlements }> {
  const ctx = await requireRole(minRole)
  const entitlements = await getAccountEntitlements(ctx.supabase, ctx.accountId)
  if (!entitlements?.features[feature]) {
    throw new ForbiddenError('Esta función no está incluida en el plan activo de la cuenta.')
  }
  return { ...ctx, entitlements }
}

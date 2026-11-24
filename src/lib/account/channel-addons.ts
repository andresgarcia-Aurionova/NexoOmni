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

export type ChannelAddOnEntitlement =
  (typeof CHANNEL_ADD_ON_ENTITLEMENTS)[number]

export function channelAddOnEntitlement(
  channel: string,
): ChannelAddOnEntitlement | null {
  const feature = `channel_${channel}`
  return (CHANNEL_ADD_ON_ENTITLEMENTS as readonly string[]).includes(feature)
    ? feature as ChannelAddOnEntitlement
    : null
}

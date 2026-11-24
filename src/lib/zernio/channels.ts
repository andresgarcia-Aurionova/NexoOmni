export const ZERNIO_PLATFORMS = [
  'whatsapp',
  'facebook',
  'instagram',
  'googlebusiness',
  'google',
  'imap',
  'tiktok',
  'twitter',
  'threads',
  'telegram',
  'hubspot',
  'salesforce',
] as const

export type ZernioPlatform = (typeof ZERNIO_PLATFORMS)[number]

export const ZERNIO_CONNECT_CHANNELS = [
  'whatsapp',
  'facebook',
  'instagram',
  'googlebusiness',
  'google',
  'email',
  'tiktok',
  'twitter',
  'threads',
  'telegram',
  'hubspot',
  'salesforce',
] as const

export type ZernioConnectChannel = (typeof ZERNIO_CONNECT_CHANNELS)[number]

export const ZERNIO_CONVERSATION_PLATFORMS = [
  'whatsapp',
  'facebook',
  'instagram',
  'googlebusiness',
  'google',
  'imap',
  'tiktok',
  'twitter',
  'threads',
  'telegram',
] as const satisfies readonly ZernioPlatform[]

export type ZernioConversationPlatform = (typeof ZERNIO_CONVERSATION_PLATFORMS)[number]

export const ZERNIO_CRM_PLATFORMS = ['hubspot', 'salesforce'] as const satisfies readonly ZernioPlatform[]

export function isZernioPlatform(value: string): value is ZernioPlatform {
  return (ZERNIO_PLATFORMS as readonly string[]).includes(value)
}

export function isZernioConnectChannel(value: string): value is ZernioConnectChannel {
  return (ZERNIO_CONNECT_CHANNELS as readonly string[]).includes(value)
}

export function isZernioConversationPlatform(value: string): value is ZernioConversationPlatform {
  return (ZERNIO_CONVERSATION_PLATFORMS as readonly string[]).includes(value)
}

export function zernioProvider(platform: ZernioPlatform) {
  return `zernio_${platform}` as `zernio_${ZernioPlatform}`
}

export function zernioChannelLabel(platform: ZernioPlatform) {
  switch (platform) {
    case 'googlebusiness': return 'Google Business'
    case 'google': return 'Gmail / Google'
    case 'imap': return 'Correo IMAP'
    case 'twitter': return 'X'
    case 'hubspot': return 'HubSpot'
    case 'salesforce': return 'Salesforce'
    case 'facebook': return 'Facebook'
    case 'instagram': return 'Instagram'
    case 'tiktok': return 'TikTok'
    case 'threads': return 'Threads'
    case 'telegram': return 'Telegram'
    case 'whatsapp': return 'WhatsApp'
  }
}

export function connectChannelForProvider(provider: string): ZernioConnectChannel | null {
  if (!provider.startsWith('zernio_')) return null
  const platform = provider.slice(7)
  if (platform === 'imap') return 'email'
  return isZernioConnectChannel(platform) ? platform : null
}

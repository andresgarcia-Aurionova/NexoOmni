import type { ChannelType } from '@/types'

export const INBOX_CHANNEL_FILTERS = [
  'all',
  'whatsapp',
  'facebook',
  'instagram',
  'yeastar_live_chat',
  'googlebusiness',
  'email',
  'tiktok',
  'twitter',
  'threads',
  'telegram',
] as const

export type InboxChannelFilter = (typeof INBOX_CHANNEL_FILTERS)[number]

export function parseInboxChannelFilter(value: string | null): InboxChannelFilter {
  return value && (INBOX_CHANNEL_FILTERS as readonly string[]).includes(value)
    ? value as InboxChannelFilter
    : 'all'
}

export function normalizeInboxChannel(
  channel: ChannelType | null | undefined,
): Exclude<InboxChannelFilter, 'all'> | null {
  switch (channel) {
    case 'whatsapp':
    case 'zernio_whatsapp': return 'whatsapp'
    case 'facebook':
    case 'zernio_facebook': return 'facebook'
    case 'instagram':
    case 'zernio_instagram': return 'instagram'
    case 'zernio_googlebusiness': return 'googlebusiness'
    case 'zernio_google':
    case 'zernio_imap': return 'email'
    case 'tiktok':
    case 'zernio_tiktok': return 'tiktok'
    case 'zernio_twitter': return 'twitter'
    case 'zernio_threads': return 'threads'
    case 'zernio_telegram': return 'telegram'
    case 'yeastar_live_chat': return 'yeastar_live_chat'
    default: return null
  }
}

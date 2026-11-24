import { describe, expect, it } from 'vitest'

import {
  INBOX_CHANNEL_FILTERS,
  normalizeInboxChannel,
  parseInboxChannelFilter,
} from './channel-filter'

describe('Inbox channel filters', () => {
  it('accepts every channel exposed by the Inbox filter menu', () => {
    for (const filter of INBOX_CHANNEL_FILTERS) {
      expect(parseInboxChannelFilter(filter)).toBe(filter)
    }
  })

  it('falls back to all for unknown or missing channel values', () => {
    expect(parseInboxChannelFilter('gmail')).toBe('all')
    expect(parseInboxChannelFilter(null)).toBe('all')
  })

  it('groups Google and IMAP providers into the email filter', () => {
    expect(normalizeInboxChannel('zernio_google')).toBe('email')
    expect(normalizeInboxChannel('zernio_imap')).toBe('email')
  })

  it('maps every additional connected provider', () => {
    expect(normalizeInboxChannel('zernio_googlebusiness')).toBe('googlebusiness')
    expect(normalizeInboxChannel('zernio_tiktok')).toBe('tiktok')
    expect(normalizeInboxChannel('zernio_twitter')).toBe('twitter')
    expect(normalizeInboxChannel('zernio_threads')).toBe('threads')
    expect(normalizeInboxChannel('zernio_telegram')).toBe('telegram')
  })
})

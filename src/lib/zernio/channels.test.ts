import { describe, expect, it } from 'vitest'

import {
  connectChannelForProvider,
  isZernioConversationPlatform,
  zernioChannelLabel,
  zernioProvider,
} from './channels'

describe('Zernio integration channels', () => {
  it('separates conversation providers from CRM-only providers', () => {
    expect(isZernioConversationPlatform('google')).toBe(true)
    expect(isZernioConversationPlatform('telegram')).toBe(true)
    expect(isZernioConversationPlatform('hubspot')).toBe(false)
    expect(isZernioConversationPlatform('salesforce')).toBe(false)
  })

  it('maps provider rows back to the guided connection card', () => {
    expect(connectChannelForProvider('zernio_google')).toBe('google')
    expect(connectChannelForProvider('zernio_imap')).toBe('email')
    expect(connectChannelForProvider('zernio_twitter')).toBe('twitter')
    expect(connectChannelForProvider('facebook')).toBeNull()
  })

  it('keeps internal provider values out of labels', () => {
    expect(zernioProvider('twitter')).toBe('zernio_twitter')
    expect(zernioChannelLabel('twitter')).toBe('X')
    expect(zernioChannelLabel('googlebusiness')).toBe('Google Business')
  })
})

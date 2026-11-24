import { describe, expect, it } from 'vitest'

import { displayContactPhone, isTechnicalContactIdentifier } from './contact-identity'

describe('contact identity display', () => {
  it.each([
    'zernio:zernio_google:contact-123',
    'connected-contact-abcdefgh',
    'email-contact:person@example.com',
    'email:person@example.com',
  ])('hides technical contact identifiers: %s', (value) => {
    expect(isTechnicalContactIdentifier(value)).toBe(true)
    expect(displayContactPhone(value)).toBeNull()
  })

  it('keeps real phone numbers visible', () => {
    expect(displayContactPhone('+52 55 1234 5678')).toBe('+52 55 1234 5678')
  })
})

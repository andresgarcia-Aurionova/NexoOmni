import { describe, expect, it } from 'vitest'

import { parseZernioBusinessReview } from './review-context'

describe('Zernio Google Business reviews', () => {
  it('normalizes the documented review.new payload', () => {
    expect(parseZernioBusinessReview({
      event: 'review.new',
      timestamp: '2026-11-24T16:00:00Z',
      review: {
        id: 'accounts/1/locations/2/reviews/3',
        platform: 'googlebusiness',
        rating: 5,
        text: 'Excelente atención',
        reviewer: { id: null, name: 'María', profileImage: 'https://example.com/avatar.jpg' },
        locationId: '2',
        locationName: 'Sucursal Centro',
        reviewUrl: 'https://maps.google.com/review/3',
        createdAt: '2026-11-24T15:55:00Z',
      },
    })).toEqual({
      id: 'accounts/1/locations/2/reviews/3',
      reviewerId: 'review:accounts/1/locations/2/reviews/3',
      reviewerName: 'María',
      reviewerPicture: 'https://example.com/avatar.jpg',
      rating: 5,
      text: 'Excelente atención',
      createdAt: '2026-11-24T15:55:00Z',
      locationId: '2',
      locationName: 'Sucursal Centro',
      reviewUrl: 'https://maps.google.com/review/3',
    })
  })

  it('rejects non-review events and incomplete payloads', () => {
    expect(parseZernioBusinessReview({ event: 'review.updated' })).toBeNull()
    expect(parseZernioBusinessReview({ event: 'review.new', review: {} })).toBeNull()
  })
})

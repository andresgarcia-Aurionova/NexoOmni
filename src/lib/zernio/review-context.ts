type Json = Record<string, unknown>

function record(value: unknown): Json {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}
}

function text(...values: unknown[]) {
  for (const value of values) if (typeof value === 'string' && value.trim()) return value.trim()
  return ''
}

function httpsUrl(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

export type ZernioBusinessReview = {
  id: string
  reviewerId: string
  reviewerName: string
  reviewerPicture: string | null
  rating: number | null
  text: string
  createdAt: string | null
  locationId: string | null
  locationName: string | null
  reviewUrl: string | null
}

export function parseZernioBusinessReview(event: Json): ZernioBusinessReview | null {
  if (event.event !== 'review.new') return null
  const review = record(event.review)
  const reviewer = record(review.reviewer)
  const id = text(review.id, review.reviewId, review.name)
  if (!id) return null
  const reviewerId = text(reviewer.id, reviewer.displayName)
  const reviewerName = text(reviewer.name, reviewer.displayName) || 'Cliente de Google Business'
  const rating = typeof review.rating === 'number' && Number.isFinite(review.rating) ? review.rating : null
  return {
    id,
    reviewerId: reviewerId || `review:${id}`,
    reviewerName,
    reviewerPicture: httpsUrl(reviewer.profileImage ?? reviewer.profile_image ?? reviewer.picture),
    rating,
    text: text(review.text, review.comment) || '[Reseña sin texto]',
    createdAt: text(review.createdAt, review.created, review.createTime, event.timestamp) || null,
    locationId: text(review.locationId) || null,
    locationName: text(review.locationName) || null,
    reviewUrl: httpsUrl(review.reviewUrl ?? review.url),
  }
}

export const RESTAURANTS = ['A', 'B', 'C'] as const
export type RestaurantCode = (typeof RESTAURANTS)[number]
export type ReservationZone = 'piso_uno' | 'terraza'

export const RESTAURANT_ZONES: Record<RestaurantCode, readonly ReservationZone[]> = {
  A: ['piso_uno'],
  B: ['piso_uno', 'terraza'],
  C: ['terraza'],
}

export const ZONE_LABELS: Record<ReservationZone, string> = { piso_uno: 'Piso uno', terraza: 'Terraza' }

export const MAX_PARTY_SIZE = 50
export const RESERVATION_MINUTES = 90
const MEXICO_CITY_OFFSET = '-06:00'

export class ReservationError extends Error {}

export function reservationMemorySummary(args: {
  restaurant: RestaurantCode
  zone: ReservationZone
  partySize: number
  startsAt: string
  name: string
  occasion: string | null
}): string {
  const when = new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'full', timeStyle: 'short', hour12: false, timeZone: 'America/Mexico_City',
  }).format(new Date(args.startsAt))
  return `Reservación en Restaurante ${args.restaurant}, ${ZONE_LABELS[args.zone]}, para ${args.partySize} ${args.partySize === 1 ? 'persona' : 'personas'}, el ${when}, a nombre de ${args.name}. Ocasión: ${args.occasion ?? 'ninguna'}.`
}

const fold = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()

export function parseRestaurant(value: unknown): RestaurantCode {
  const text = typeof value === 'string' ? fold(value).replace(/^restaurante\s+/, '') : ''
  const code = text.toUpperCase()
  if ((RESTAURANTS as readonly string[]).includes(code)) return code as RestaurantCode
  throw new ReservationError('restaurant must be Restaurante A, B or C')
}

export function resolveZone(restaurant: RestaurantCode, value: unknown): ReservationZone {
  const allowed = RESTAURANT_ZONES[restaurant]
  const text = typeof value === 'string' ? fold(value) : ''
  const requested: ReservationZone | null = /terraza/.test(text) ? 'terraza' : /piso|interior|adentro/.test(text) ? 'piso_uno' : null
  if (!requested) {
    if (allowed.length === 1) return allowed[0]
    throw new ReservationError(`zone is required for Restaurante ${restaurant}: ${allowed.map((z) => ZONE_LABELS[z]).join(' or ')}`)
  }
  if (!allowed.includes(requested)) {
    throw new ReservationError(`Restaurante ${restaurant} only has ${allowed.map((z) => ZONE_LABELS[z]).join(' and ')}`)
  }
  return requested
}

export function parsePartySize(value: unknown): number {
  const size = typeof value === 'number' ? value : typeof value === 'string' && /^\d{1,3}$/.test(value.trim()) ? Number(value) : NaN
  if (!Number.isInteger(size) || size < 1 || size > MAX_PARTY_SIZE) {
    throw new ReservationError(`party_size must be a whole number between 1 and ${MAX_PARTY_SIZE}`)
  }
  return size
}

/** Builds the reservation window from a Mexico City local date (YYYY-MM-DD) and time (HH:mm). */
export function parseReservationWindow(date: unknown, time: unknown, now = new Date()) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new ReservationError('date must be YYYY-MM-DD and time must be HH:mm (24h)')
  }
  const [y, m, d] = date.split('-').map(Number)
  const calendar = new Date(Date.UTC(y, m - 1, d))
  if (calendar.getUTCFullYear() !== y || calendar.getUTCMonth() !== m - 1 || calendar.getUTCDate() !== d) {
    throw new ReservationError('date is not a valid calendar date')
  }
  const start = new Date(`${date}T${time}:00${MEXICO_CITY_OFFSET}`)
  if (start.getTime() <= now.getTime()) throw new ReservationError('The reservation must be in the future')
  return { startsAt: start.toISOString(), endsAt: new Date(start.getTime() + RESERVATION_MINUTES * 60_000).toISOString() }
}

export function cleanText(value: unknown, max: number): string | null {
  if (value == null || value === '') return null
  if (typeof value !== 'string') throw new ReservationError('Text fields must be strings')
  const text = value.replace(/\s+/g, ' ').trim()
  return text ? text.slice(0, max) : null
}

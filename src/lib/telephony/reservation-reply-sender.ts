import { sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils'

export function reservationReplySenderPhone(...values: unknown[]): string | undefined {
  const phones = values
    .filter((value): value is string => typeof value === 'string' && /^\+?[\d ()-]+$/.test(value.trim()))
    .map(sanitizePhoneForMeta)
    .filter(Boolean)
  const unique = [...new Set(phones)]
  return unique.length === 1 ? unique[0] : undefined
}

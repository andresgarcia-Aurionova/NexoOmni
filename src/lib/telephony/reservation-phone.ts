import { isValidE164 } from '@/lib/whatsapp/phone-utils'

/**
 * The restaurant proof of concept treats a ten-digit local number as Mexican.
 * Other international numbers need an explicit '+' to avoid guessing a country.
 */
export function reservationPhone(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const value = input.trim()
  if (!/^\+?[\d ()-]+$/.test(value)) return null

  const digits = value.replace(/\D/g, '')
  if (!value.startsWith('+') && /^[1-9]\d{9}$/.test(digits)) {
    const mexican = `52${digits}`
    return isValidE164(mexican) ? mexican : null
  }
  if (!value.startsWith('+')) return null
  if (!isValidE164(digits)) return null
  return digits
}

export function reservationPbxPhone(input: string): string | null {
  const value = input.trim()
  if (!/^\+?[\d ()-]+$/.test(value)) return null
  const digits = value.replace(/\D/g, '')
  if (/^521[1-9]\d{9}$/.test(digits)) return `52${digits.slice(3)}`
  if (/^52[1-9]\d{9}$/.test(digits)) return digits
  return reservationPhone(value)
}

export function reservationPhoneVariants(phone: string): string[] {
  if (/^52[1-9]\d{9}$/.test(phone)) {
    const national = phone.slice(2)
    return [phone, national, `521${national}`]
  }
  return [phone]
}

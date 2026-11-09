import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import { sendTemplateMessage } from '@/lib/whatsapp/meta-api'
import { isRecipientNotAllowedError, isValidE164, phoneVariants, sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils'
import { listZernioWhatsAppConnectors } from '@/lib/zernio/send-template-to-contact'
import { sendZernioTemplateMessage } from '@/lib/zernio/server'

export const MAX_ALERT_RECIPIENTS = 5
export const DEFAULT_ALERT_TEMPLATE = 'aviso_reservacion_restaurante'
export const DEFAULT_ALERT_LANGUAGE = 'es_MX'

export type ReservationAlertSettings = {
  enabled: boolean
  templateName: string
  templateLanguage: string
  recipientPhones: string[]
}

export const EMPTY_ALERT_SETTINGS: ReservationAlertSettings = {
  enabled: false, templateName: DEFAULT_ALERT_TEMPLATE, templateLanguage: DEFAULT_ALERT_LANGUAGE, recipientPhones: [],
}

export class AlertSettingsError extends Error {}

/** Cleans a free-text list of phones (commas, semicolons or line breaks) into unique E.164 numbers. */
export function parseRecipientPhones(input: unknown): string[] {
  const items = Array.isArray(input) ? input : typeof input === 'string' ? input.split(/[\n,;]+/) : null
  if (!items) throw new AlertSettingsError('recipientPhones must be a list of phone numbers')
  const phones: string[] = []
  for (const item of items) {
    if (typeof item !== 'string' || !item.trim()) continue
    const phone = sanitizePhoneForMeta(item)
    if (!isValidE164(phone)) throw new AlertSettingsError(`Invalid phone number: ${item.trim().slice(0, 30)}`)
    if (!phones.includes(phone)) phones.push(phone)
  }
  if (phones.length > MAX_ALERT_RECIPIENTS) throw new AlertSettingsError(`At most ${MAX_ALERT_RECIPIENTS} numbers are allowed`)
  return phones
}

export function parseAlertSettings(body: unknown): ReservationAlertSettings {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AlertSettingsError('Expected a JSON object')
  const raw = body as Record<string, unknown>
  const templateName = typeof raw.templateName === 'string' ? raw.templateName.trim() : ''
  const templateLanguage = typeof raw.templateLanguage === 'string' ? raw.templateLanguage.trim() : ''
  if (!/^[a-z0-9_]{1,512}$/.test(templateName)) throw new AlertSettingsError('templateName must use lowercase letters, numbers and underscores')
  if (!/^[a-z]{2}(_[A-Z]{2})?$/.test(templateLanguage)) throw new AlertSettingsError('templateLanguage must look like es_MX')
  const recipientPhones = parseRecipientPhones(raw.recipientPhones ?? [])
  const enabled = raw.enabled === true
  if (enabled && recipientPhones.length === 0) throw new AlertSettingsError('Add at least one number before enabling the alert')
  return { enabled, templateName, templateLanguage, recipientPhones }
}

export async function loadAlertSettings(db: SupabaseClient, accountId: string): Promise<ReservationAlertSettings> {
  const { data, error } = await db.from('reservation_alert_settings')
    .select('enabled, template_name, template_language, recipient_phones').eq('account_id', accountId).maybeSingle()
  if (error) throw error
  if (!data) return EMPTY_ALERT_SETTINGS
  return {
    enabled: data.enabled, templateName: data.template_name, templateLanguage: data.template_language,
    recipientPhones: data.recipient_phones ?? [],
  }
}

const oneLine = (value: string) => value.replace(/\s+/g, ' ').trim()

/** Template variables cannot contain line breaks. */
export function reservationAlertParams(args: {
  restaurant: string; startsAt: string; name: string; partySize: number; zone: string; occasion: string | null; phone: string | null
}): [string, string, string] {
  const when = new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'full', timeStyle: 'short', hour12: false, timeZone: 'America/Mexico_City',
  }).format(new Date(args.startsAt))
  const detail = [
    args.name, `${args.partySize} ${args.partySize === 1 ? 'persona' : 'personas'}`, args.zone,
    args.occasion ? `ocasión: ${args.occasion}` : null, args.phone ? `tel. +${args.phone.replace(/^\+/, '')}` : null,
  ].filter(Boolean).join(', ')
  return [`Restaurante ${args.restaurant}`, oneLine(when), oneLine(detail)]
}

async function sendToOne(db: SupabaseClient, accountId: string, settings: ReservationAlertSettings, phone: string, params: string[]) {
  const { data: meta } = await db.from('whatsapp_config').select('phone_number_id, access_token').eq('account_id', accountId).maybeSingle()
  if (!meta) {
    const [connector] = await listZernioWhatsAppConnectors(db, accountId)
    if (!connector) throw new Error('No WhatsApp number is connected')
    await sendZernioTemplateMessage({
      zernioAccountId: connector.zernio_account_id, phone,
      templateName: settings.templateName, templateLanguage: settings.templateLanguage, templateParams: params,
    })
    return
  }
  const accessToken = decrypt(meta.access_token)
  let lastError: unknown = new Error('Recipient not allowed')
  for (const candidate of phoneVariants(phone)) {
    try {
      await sendTemplateMessage({
        phoneNumberId: meta.phone_number_id, accessToken, to: candidate,
        templateName: settings.templateName, language: settings.templateLanguage, params,
      })
      return
    } catch (cause) {
      lastError = cause
      if (!isRecipientNotAllowedError(cause instanceof Error ? cause.message : String(cause))) throw cause
    }
  }
  throw lastError
}

/** Number of recipients that accepted the template. Never throws, so a saved reservation is never lost. */
export async function sendReservationAlert(db: SupabaseClient, accountId: string, params: string[]): Promise<number> {
  try {
    const settings = await loadAlertSettings(db, accountId)
    if (!settings.enabled || settings.recipientPhones.length === 0) return 0
    const results = await Promise.allSettled(settings.recipientPhones.map((phone) => sendToOne(db, accountId, settings, phone, params)))
    for (const result of results) {
      if (result.status === 'rejected') {
        console.error('[telephony/reservations] alert failed:', result.reason instanceof Error ? result.reason.message : result.reason)
      }
    }
    return results.filter((result) => result.status === 'fulfilled').length
  } catch (cause) {
    console.error('[telephony/reservations] alert failed:', cause instanceof Error ? cause.message : cause)
    return 0
  }
}

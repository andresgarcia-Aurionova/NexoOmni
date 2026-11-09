import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import { sendTemplateMessage } from '@/lib/whatsapp/meta-api'
import { isRecipientNotAllowedError, isValidE164, phoneVariants, sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils'
import { listZernioWhatsAppConnectors } from '@/lib/zernio/send-template-to-contact'
import { sendZernioTemplateMessage } from '@/lib/zernio/server'

export type ReservationAlertConfig = { phone: string; templateName: string; language: string }

/** The destination and template are server settings, never caller input, so a leaked API key cannot message arbitrary numbers. */
export function reservationAlertConfig(env: Record<string, string | undefined> = process.env): ReservationAlertConfig | null {
  const phone = sanitizePhoneForMeta(env.RESERVATION_ALERT_PHONE ?? '')
  const templateName = env.RESERVATION_ALERT_TEMPLATE?.trim() || 'aviso_reservacion_restaurante'
  if (!isValidE164(phone)) return null
  return { phone, templateName, language: env.RESERVATION_ALERT_LANGUAGE?.trim() || 'es_MX' }
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

/** Returns whether the template was accepted by the provider; never throws, so the saved reservation is never lost. */
export async function sendReservationAlert(db: SupabaseClient, accountId: string, params: string[], config = reservationAlertConfig()): Promise<boolean> {
  if (!config) return false
  try {
    const { data: meta } = await db.from('whatsapp_config').select('phone_number_id, access_token').eq('account_id', accountId).maybeSingle()
    if (!meta) {
      const [connector] = await listZernioWhatsAppConnectors(db, accountId)
      if (!connector) return false
      await sendZernioTemplateMessage({
        zernioAccountId: connector.zernio_account_id, phone: config.phone,
        templateName: config.templateName, templateLanguage: config.language, templateParams: params,
      })
      return true
    }
    const accessToken = decrypt(meta.access_token)
    for (const candidate of phoneVariants(config.phone)) {
      try {
        await sendTemplateMessage({ phoneNumberId: meta.phone_number_id, accessToken, to: candidate, templateName: config.templateName, language: config.language, params })
        return true
      } catch (cause) {
        if (!isRecipientNotAllowedError(cause instanceof Error ? cause.message : String(cause))) throw cause
      }
    }
    return false
  } catch (cause) {
    console.error('[telephony/reservations] alert failed:', cause instanceof Error ? cause.message : cause)
    return false
  }
}

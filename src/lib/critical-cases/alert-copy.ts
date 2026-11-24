import esMessages from '../../../messages/es.json'
import enMessages from '../../../messages/en.json'
import koMessages from '../../../messages/ko.json'
import { oneLine } from '@/lib/telephony/reservation-alert'

type Locale = 'es' | 'en' | 'ko'
type Copy = typeof enMessages.CriticalCases

const messages: Record<Locale, Copy> = {
  es: esMessages.CriticalCases,
  en: enMessages.CriticalCases,
  ko: koMessages.CriticalCases,
}

function configuredLocale(): Locale {
  const locale = process.env.NEXT_PUBLIC_APP_LOCALE
  return locale === 'es' || locale === 'ko' ? locale : 'en'
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

type AlertInput = { level: 'n2' | 'n3'; sede: string | null; reason: string | null; contact: string }

/** Meta template variables cannot contain line breaks and must be non-empty. */
export function criticalCaseWhatsAppParams(input: AlertInput): [string, string, string] {
  const level = `Nivel ${input.level.toUpperCase()}`
  const where = input.sede ? `${level} – Sede ${oneLine(input.sede)}` : level
  const detail = oneLine(input.reason || 'Sin detalle; revisar la conversación').slice(0, 500)
  return [where, oneLine(input.contact) || '—', detail]
}

export function buildCriticalCaseEmail(input: AlertInput & { url: string | null }, locale: Locale = configuredLocale()) {
  const copy = messages[locale]
  const level = input.level.toUpperCase()
  const subject = copy.emailSubject.replace('{level}', level).replace('{contact}', oneLine(input.contact))
  const rows: Array<[string, string]> = [
    [copy.emailLevel, level],
    [copy.emailContact, input.contact],
    [copy.emailSede, input.sede || copy.sedeUnknown],
    [copy.emailReason, input.reason || copy.reasonUnknown],
  ]
  const table = rows.map(([label, value]) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;white-space:nowrap">${escapeHtml(label)}</td><td style="padding:4px 0">${escapeHtml(value)}</td></tr>`).join('')
  const button = input.url
    ? `<p style="margin:20px 0 0"><a href="${escapeHtml(input.url)}" style="background:#b91c1c;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px;font-size:14px">${escapeHtml(copy.emailCta)}</a></p>`
    : ''
  return {
    subject,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1f2937"><div style="border-left:5px solid #b91c1c;padding:4px 0 4px 16px"><h1 style="font-size:20px;margin:0 0 12px">${escapeHtml(copy.emailHeading.replace('{level}', level))}</h1><p style="font-size:15px;line-height:1.6;margin:0 0 12px">${escapeHtml(copy.emailBody)}</p><table style="font-size:14px;border-collapse:collapse">${table}</table>${button}</div><p style="font-size:12px;color:#6b7280;margin-top:24px">NexoOmni</p></div>`,
  }
}

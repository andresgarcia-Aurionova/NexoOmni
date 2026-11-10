import type { SupabaseClient } from '@supabase/supabase-js'
import { parseBusinessHours } from '@/lib/business-hours/config'
import { listZernioWhatsAppConnectors } from '@/lib/zernio/send-template-to-contact'
import { extractVariableIndices } from '@/lib/whatsapp/template-validators'

export type ReservationReminderConfigErrorCode =
  | 'template_unavailable'
  | 'template_format'
  | 'connector_unavailable'
  | 'hours_unavailable'
  | 'hours_invalid'

export class ReservationReminderConfigError extends Error {
  constructor(readonly code: ReservationReminderConfigErrorCode, message: string) {
    super(message)
    this.name = 'ReservationReminderConfigError'
  }
}

/**
 * The approved template determines the sender. Using the hours of another
 * connected number would schedule the reminder in the wrong timezone.
 */
export async function loadReservationReminderConfig(
  db: SupabaseClient, accountId: string, templateName: string, language: string,
) {
  const { data: templates, error } = await db.from('message_templates')
    .select('connector_id,status,body_text,header_type,buttons')
    .eq('account_id', accountId).eq('name', templateName).eq('language', language)
  if (error) throw error
  const approved = (templates ?? []).filter((row) => String(row.status).toLowerCase() === 'approved')
  if (approved.length !== 1) {
    throw new ReservationReminderConfigError('template_unavailable', 'Debe existir una sola plantilla de confirmación aprobada para el idioma elegido.')
  }
  const template = approved[0]
  const variables = extractVariableIndices(template.body_text ?? '')
  if (variables.length !== 2 || variables[0] !== 1 || variables[1] !== 2 ||
    template.header_type || (Array.isArray(template.buttons) && template.buttons.length > 0)) {
    throw new ReservationReminderConfigError('template_format', 'La plantilla debe tener dos variables en el cuerpo y no tener encabezado ni botones.')
  }
  if (!template.connector_id) {
    throw new ReservationReminderConfigError('connector_unavailable', 'La plantilla debe pertenecer a un número conectado con horario de WhatsApp.')
  }
  const connectors = await listZernioWhatsAppConnectors(db, accountId)
  const connector = connectors.find((item) => item.id === template.connector_id)
  if (!connector) {
    throw new ReservationReminderConfigError('connector_unavailable', 'El número de la plantilla no está conectado.')
  }
  const { data: hours, error: hoursError } = await db.from('connected_whatsapp_business_hours')
    .select('enabled,timezone,windows,holidays,message')
    .eq('account_id', accountId).eq('connector_id', connector.id).maybeSingle()
  if (hoursError) throw hoursError
  if (!hours?.enabled) {
    throw new ReservationReminderConfigError('hours_unavailable', 'Configura y activa el horario del número de WhatsApp de la plantilla.')
  }
  const parsed = parseBusinessHours({ ...hours, connectorId: connector.id })
  if (!parsed.success) {
    throw new ReservationReminderConfigError('hours_invalid', 'El horario del número de WhatsApp no es válido.')
  }
  return { connector, schedule: parsed.data }
}

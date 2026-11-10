import type { SupabaseClient } from '@supabase/supabase-js'
import esMessages from '../../../messages/es.json'
import enMessages from '../../../messages/en.json'
import koMessages from '../../../messages/ko.json'
import { resolveAuditUserId } from '@/lib/api/v1/contacts'
import { sendReservationConfirmation } from './reservation-confirmation-send'
import { reservationDateLabel } from './reservation-alert'
import { recordReservationMemory } from './reservation-memory'
import { loadReservationReminderConfig, ReservationReminderConfigError } from './reservation-reminder-config'
import { reservationReminderDueAt } from './reservation-reminder-schedule'
import { parseRestaurant } from './reservations'

type Job = {
  appointment_id: string
  account_id: string
  revision: number
  state: string
}

function notificationCopy() {
  const locale = process.env.NEXT_PUBLIC_APP_LOCALE
  return locale === 'en' ? enMessages.ReservationConfirmations
    : locale === 'ko' ? koMessages.ReservationConfirmations : esMessages.ReservationConfirmations
}

function formatCopy(template: string, values: Record<string, string>) {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match)
}

async function updateJob(db: SupabaseClient, job: Job, patch: Record<string, unknown>, expectedState: string) {
  const { data, error } = await db.from('reservation_confirmation_jobs')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('appointment_id', job.appointment_id).eq('account_id', job.account_id)
    .eq('revision', job.revision).eq('state', expectedState).select('appointment_id').maybeSingle()
  if (error) throw error
  return Boolean(data)
}

async function notify(db: SupabaseClient, job: Job, kind: string, title: string, body: string) {
  const { error } = await db.rpc('notify_reservation_confirmation', {
    p_appointment_id: job.appointment_id, p_account_id: job.account_id, p_revision: job.revision,
    p_kind: kind, p_title: title, p_body: body,
  })
  if (error) throw error
}

async function recordResponse(db: SupabaseClient, job: Job) {
  const { error } = await db.rpc('record_voice_reservation_response', {
    p_appointment_id: job.appointment_id, p_account_id: job.account_id, p_revision: job.revision,
  })
  if (error) throw error
}

function message(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 500) : 'Error desconocido'
}

export async function processReservationConfirmationJobs(db: SupabaseClient) {
  const now = new Date()
  const copy = notificationCopy()
  const stale = new Date(now.getTime() - 10 * 60_000).toISOString()
  const { data: abandoned, error: abandonedError } = await db.from('reservation_confirmation_jobs')
    .select('appointment_id,account_id,revision,state').in('state', ['processing', 'sending'])
    .lt('updated_at', stale).limit(20)
  if (abandonedError) throw abandonedError
  for (const job of (abandoned ?? []) as Job[]) {
    if (job.state === 'processing') {
      await updateJob(db, job, { state: 'queued', due_at: now.toISOString() }, 'processing')
    } else {
      await updateJob(db, job, { state: 'failed', error_message: 'Resultado de envío desconocido.' }, 'sending')
    }
  }
  const { data: failures, error: failureError } = await db.from('reservation_confirmation_jobs')
    .select('appointment_id,account_id,revision,state').eq('state', 'failed')
    .is('failure_notice_at', null).limit(20)
  if (failureError) throw failureError
  for (const job of (failures ?? []) as Job[]) {
    try {
      await notify(db, job, 'send_failed', copy.reviewTitle, copy.failed)
      await updateJob(db, job, { failure_notice_at: new Date().toISOString() }, 'failed')
    } catch (noticeError) {
      console.error('[reservations] could not notify about a failed confirmation:', noticeError)
    }
  }
  const { data: pendingDeclines, error: pendingDeclinesError } = await db
    .from('reservation_confirmation_decline_outbox')
    .select('appointment_id,revision').is('delivered_at', null).order('created_at').limit(20)
  if (pendingDeclinesError) throw pendingDeclinesError
  for (const pending of pendingDeclines ?? []) {
    const { error: deliveryError } = await db.rpc('deliver_voice_reservation_decline', {
      p_appointment_id: pending.appointment_id, p_revision: pending.revision,
    })
    if (deliveryError) console.error('[reservations] could not deliver a declined confirmation:', deliveryError)
  }
  const { data: declines, error: declinesError } = await db.from('reservation_confirmation_jobs')
    .select('appointment_id,account_id,revision,state').eq('state', 'sent').eq('response', 'no')
    .is('response_notice_at', null).limit(20)
  if (declinesError) throw declinesError
  for (const job of (declines ?? []) as Job[]) {
    try {
      await notify(db, job, 'declined', copy.declinedTitle, copy.declined)
      await updateJob(db, job, { response_notice_at: new Date().toISOString() }, 'sent')
    } catch (noticeError) {
      console.error('[reservations] could not notify about a declined confirmation:', noticeError)
    }
  }
  const { data: responses, error: responseError } = await db.from('reservation_confirmation_jobs')
    .select('appointment_id,account_id,revision,state').eq('state', 'sent')
    .not('response', 'is', null).is('response_memory_at', null).limit(20)
  if (responseError) throw responseError
  for (const job of (responses ?? []) as Job[]) {
    try {
      await recordResponse(db, job)
    } catch (memoryError) {
      console.error('[reservations] could not record confirmation in memory:', memoryError)
    }
  }
  const { data: jobs, error } = await db.from('reservation_confirmation_jobs')
    .select('appointment_id,account_id,revision,state')
    .in('state', ['queued', 'scheduled']).lte('due_at', now.toISOString())
    .order('due_at').limit(20)
  if (error) throw error
  const counts = { scheduled: 0, sent: 0, skipped: 0, failed: 0 }

  for (const job of (jobs ?? []) as Job[]) {
    if (!await updateJob(db, job, { state: 'processing' }, job.state)) continue
    try {
      const { data: appointment, error: appointmentError } = await db.from('appointments')
        .select('id,contact_id,created_by,title,notes,starts_at,status,reservation_restaurant')
        .eq('id', job.appointment_id).eq('account_id', job.account_id).maybeSingle()
      if (appointmentError) throw appointmentError
      if (!appointment || !appointment.reservation_restaurant || ['cancelled', 'completed', 'no_show'].includes(appointment.status)) {
        await updateJob(db, job, { state: 'skipped' }, 'processing')
        counts.skipped++
        continue
      }
      if (new Date(appointment.starts_at) <= now) {
        await updateJob(db, job, { state: 'skipped', error_message: 'La reservación ya comenzó.' }, 'processing')
        counts.skipped++
        continue
      }
      if (appointment.contact_id) {
        const details = typeof appointment.notes === 'string' ? appointment.notes.replace(/\s+/g, ' ').trim() : appointment.title
        await recordReservationMemory(db, {
          accountId: job.account_id, contactId: appointment.contact_id, appointmentId: appointment.id,
          summary: `Reservación en Restaurante ${parseRestaurant(appointment.reservation_restaurant)}. ${reservationDateLabel(appointment.starts_at)}. ${details}`,
        })
      }
      const { data: settings, error: settingsError } = await db.from('reservation_alert_settings')
        .select('confirmation_enabled,confirmation_template_name,confirmation_template_language')
        .eq('account_id', job.account_id).maybeSingle()
      if (settingsError) throw settingsError
      if (!settings?.confirmation_enabled) {
        await updateJob(db, job, { state: 'scheduled', due_at: new Date(Date.now() + 5 * 60_000).toISOString() }, 'processing')
        counts.scheduled++
        continue
      }
      const title = copy.title
      if (!appointment.contact_id) {
        await notify(db, job, 'missing_contact', title, formatCopy(copy.missingContact, { title: appointment.title }))
        await updateJob(db, job, { state: 'skipped', error_message: 'Falta un contacto vinculado.' }, 'processing')
        counts.skipped++
        continue
      }
      let config
      try {
        config = await loadReservationReminderConfig(db, job.account_id, settings.confirmation_template_name, settings.confirmation_template_language)
      } catch (configError) {
        if (!(configError instanceof ReservationReminderConfigError)) throw configError
        await notify(db, job, `config_${configError.code}`, title, formatCopy(copy.config, { title: appointment.title, reason: copy[configError.code] }))
        await updateJob(db, job, {
          state: 'scheduled', due_at: new Date(Date.now() + 5 * 60_000).toISOString(), error_message: configError.message,
        }, 'processing')
        counts.scheduled++
        continue
      }
      const currentTime = new Date()
      const dueAt = reservationReminderDueAt(config.schedule, new Date(appointment.starts_at), currentTime)
      if (!dueAt) {
        await notify(db, job, 'no_opening', title, formatCopy(copy.noOpening, { title: appointment.title }))
        await updateJob(db, job, { state: 'skipped', error_message: 'No queda horario de atención antes de la reserva.' }, 'processing')
        counts.skipped++
        continue
      }
      if (new Date(dueAt) > currentTime) {
        await updateJob(db, job, { state: 'scheduled', due_at: dueAt, error_message: null }, 'processing')
        counts.scheduled++
        continue
      }
      const { data: contact, error: contactError } = await db.from('contacts').select('phone')
        .eq('id', appointment.contact_id).eq('account_id', job.account_id).maybeSingle()
      if (contactError) throw contactError
      if (!contact?.phone) {
        await notify(db, job, 'missing_phone', title, formatCopy(copy.missingPhone, { title: appointment.title }))
        await updateJob(db, job, { state: 'skipped', error_message: 'El contacto no tiene teléfono.' }, 'processing')
        counts.skipped++
        continue
      }
      await notify(db, job, 'due', title, formatCopy(copy.due, { title: appointment.title }))
      if (!await updateJob(db, job, { state: 'sending', error_message: null }, 'processing')) continue
      try {
        const ownerUserId = appointment.created_by ?? await resolveAuditUserId(db, job.account_id)
        const result = await sendReservationConfirmation(db, {
          accountId: job.account_id, contactId: appointment.contact_id, phone: contact.phone, ownerUserId,
          restaurant: parseRestaurant(appointment.reservation_restaurant), startsAt: appointment.starts_at,
          templateName: settings.confirmation_template_name, templateLanguage: settings.confirmation_template_language,
          connector: config.connector,
        })
        if (!await updateJob(db, job, {
          state: 'sent', sent_at: new Date().toISOString(), conversation_id: result.conversationId,
        }, 'sending')) {
          console.error('[reservations] reservation changed while sending confirmation:', job.appointment_id)
        } else counts.sent++
      } catch (sendError) {
        console.error('[reservations] confirmation send failed or its result is uncertain:', sendError)
        await updateJob(db, job, { state: 'failed', error_message: message(sendError) }, 'sending')
        counts.failed++
      }
    } catch (cause) {
      console.error('[reservations] confirmation job failed:', { appointmentId: job.appointment_id, error: cause })
      await updateJob(db, job, {
        state: 'scheduled', due_at: new Date(Date.now() + 5 * 60_000).toISOString(), error_message: message(cause),
      }, 'processing')
      counts.failed++
    }
  }
  return counts
}

export async function handleReservationConfirmationReply(
  db: SupabaseClient, accountId: string, contactId: string, conversationId: string, text: string,
): Promise<'none' | 'handled' | 'ambiguous'> {
  const normalized = text.normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase()
  if (normalized !== 'si' && normalized !== 'no') return 'none'
  const copy = notificationCopy()
  const { data: jobs, error } = await db.from('reservation_confirmation_jobs')
    .select('appointment_id,account_id,revision,state,appointment:appointments!inner(contact_id,starts_at,status,title)')
    .eq('account_id', accountId).eq('conversation_id', conversationId).eq('state', 'sent')
    .is('response', null).eq('appointment.contact_id', contactId)
    .gt('appointment.starts_at', new Date().toISOString()).not('appointment.status', 'in', '(cancelled,completed,no_show)')
    .limit(3)
  if (error) throw error
  if (!jobs?.length) return 'none'
  const { data: agendaPro, error: agendaError } = await db.from('agendapro_bookings')
    .select('id').eq('account_id', accountId).eq('contact_id', contactId)
    .eq('confirmation_status', 'pending').eq('confirmation_reminder_status', 'sent')
    .gt('start_time', new Date().toISOString()).limit(1)
  if (agendaError) throw agendaError
  if (jobs.length !== 1 || agendaPro?.length) {
    for (const job of jobs as Job[]) {
      await notify(db, job, 'ambiguous_reply', copy.ambiguousTitle, copy.ambiguous)
    }
    return 'ambiguous'
  }
  const job = jobs[0] as Job
  const { data: accepted, error: responseError } = await db.rpc('accept_voice_reservation_response', {
    p_appointment_id: job.appointment_id, p_account_id: accountId, p_revision: job.revision,
    p_contact_id: contactId, p_conversation_id: conversationId,
    p_response: normalized === 'si' ? 'yes' : 'no',
    p_notice_title: copy.declinedTitle, p_notice_body: copy.declined,
  })
  if (responseError) throw responseError
  if (!accepted) {
    console.error('[reservations] confirmation changed before the reply could be recorded:', job.appointment_id)
    const { data: current, error: currentError } = await db.from('reservation_confirmation_jobs')
      .select('appointment_id,account_id,revision,state')
      .eq('appointment_id', job.appointment_id).eq('account_id', accountId).maybeSingle()
    if (currentError) throw currentError
    if (current) await notify(db, current as Job, 'ambiguous_reply', copy.ambiguousTitle, copy.ambiguous)
    return 'ambiguous'
  }
  return 'handled'
}

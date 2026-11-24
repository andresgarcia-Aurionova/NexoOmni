import type { SupabaseClient } from '@supabase/supabase-js'

import { resolveAuditUserId } from '@/lib/api/v1/contacts'
import {
  listZernioCalendarEvents,
  listZernioCalendars,
  listZernioContacts,
  listZernioEmailThreads,
  type ZernioCalendarEvent,
  type ZernioContact,
} from '@/lib/zernio/server'
import { isUniqueViolation } from '@/lib/contacts/dedupe'
import { findOrCreateZernioConversation } from '@/lib/zernio/webhook-conversation'
import { getAccountEntitlements } from '@/lib/account/entitlements'

type Json = Record<string, unknown>

export type ZernioGoogleConnector = {
  id: string
  account_id: string
  provider: 'zernio_google'
  display_name: string
  queue_id: string | null
  zernio_account_id: string | null
  zernio_metadata: Json | null
}

type SyncOptions = {
  now?: Date
  contacts?: boolean
  calendar?: boolean
  email?: boolean
}

function record(value: unknown): Json {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  const value = record(error)
  const detail = typeof value.message === 'string'
    ? value.message
    : typeof value.details === 'string'
      ? value.details
      : 'Error desconocido al sincronizar Google.'
  return value.code ? `${detail} (${String(value.code)})` : detail
}

function validEmail(value: string | null) {
  const email = value?.trim().toLowerCase() ?? ''
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null
}

async function upsertLocalContact(
  db: SupabaseClient,
  connector: ZernioGoogleConnector,
  auditUserId: string,
  remote: ZernioContact,
  preserveExisting = false,
) {
  const email = validEmail(remote.email)
  const { data: identity, error: identityError } = await db
    .from('omnichannel_contact_identities')
    .select('contact_id')
    .eq('connector_id', connector.id)
    .eq('external_user_id', remote.id)
    .maybeSingle()
  if (identityError) throw identityError

  let contactId = identity?.contact_id as string | null ?? null
  if (!contactId && email) {
    const { data: existing, error } = await db
      .from('contacts')
      .select('id')
      .eq('account_id', connector.account_id)
      .eq('email_normalized', email)
      .limit(2)
    if (error) throw error
    if (existing?.length === 1) contactId = existing[0].id as string
  }

  const displayName = remote.name.trim() || (email ? email.split('@')[0] : 'Contacto de Gmail')
  const update = {
    name: displayName,
    email: remote.email?.trim() || null,
    company: remote.company?.trim() || null,
    avatar_url: remote.avatarUrl || null,
    updated_at: new Date().toISOString(),
  }
  if (contactId) {
    let values: Record<string, unknown> = update
    if (preserveExisting) {
      const { data: current, error: currentError } = await db.from('contacts')
        .select('name, email, company, avatar_url')
        .eq('id', contactId)
        .eq('account_id', connector.account_id)
        .maybeSingle()
      if (currentError) throw currentError
      values = {
        updated_at: update.updated_at,
        ...(current?.name ? {} : { name: update.name }),
        ...(current?.email ? {} : { email: update.email }),
        ...(current?.company ? {} : { company: update.company }),
        ...(current?.avatar_url ? {} : { avatar_url: update.avatar_url }),
      }
    }
    const { error } = await db.from('contacts').update(values)
      .eq('id', contactId)
      .eq('account_id', connector.account_id)
    if (error) throw error
  } else {
    const placeholder = `zernio:${connector.provider}:${remote.id}`
    const { data: created, error } = await db.from('contacts').insert({
      account_id: connector.account_id,
      user_id: auditUserId,
      phone: placeholder,
      name: displayName,
      email: update.email,
      company: update.company,
      avatar_url: update.avatar_url,
    }).select('id').single()
    if (error || !created) throw error ?? new Error('No se pudo crear el contacto de Google.')
    contactId = created.id as string
  }

  const { error: linkError } = await db.from('omnichannel_contact_identities').upsert({
    account_id: connector.account_id,
    connector_id: connector.id,
    external_user_id: remote.id,
    contact_id: contactId,
    display_name: displayName,
    avatar_url: remote.avatarUrl || null,
  }, { onConflict: 'connector_id,external_user_id' })
  if (linkError) throw linkError
  return contactId
}

function eventTimes(event: ZernioCalendarEvent) {
  const startsAt = new Date(event.start)
  let endsAt = new Date(event.end)
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) return null
  if (endsAt <= startsAt) endsAt = new Date(startsAt.getTime() + 60 * 60_000)
  return { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() }
}

async function upsertCalendarEvent(
  db: SupabaseClient,
  connector: ZernioGoogleConnector,
  event: ZernioCalendarEvent,
) {
  const times = eventTimes(event)
  if (!times) return false
  const calendarId = event.calendarId ?? 'primary'
  const { data: existing, error } = await db.from('appointments')
    .select('id')
    .eq('account_id', connector.account_id)
    .eq('zernio_calendar_connector_id', connector.id)
    .eq('zernio_calendar_id', calendarId)
    .eq('google_calendar_event_id', event.id)
    .maybeSingle()
  if (error) throw error

  const notes = [event.description?.trim(), event.location?.trim()]
    .filter((value): value is string => Boolean(value))
    .join('\n')
  const values = {
    title: event.title.trim().slice(0, 160) || 'Evento de Google Calendar',
    notes: notes || null,
    starts_at: times.startsAt,
    ends_at: times.endsAt,
    timezone: event.timezone?.slice(0, 80) || 'UTC',
    status: event.status?.toLowerCase() === 'cancelled' ? 'cancelled' : 'scheduled',
    google_sync_status: 'synced',
    google_sync_error: null,
    updated_at: new Date().toISOString(),
  }
  if (existing?.id) {
    const { error: updateError } = await db.from('appointments').update(values)
      .eq('id', existing.id)
      .eq('account_id', connector.account_id)
    if (updateError) throw updateError
  } else {
    const { data: mirrored, error: mirroredError } = await db.from('appointments')
      .select('id')
      .eq('account_id', connector.account_id)
      .eq('google_calendar_event_id', event.id)
      .maybeSingle()
    if (mirroredError) throw mirroredError
    if (mirrored?.id) return false
    const { error: insertError } = await db.from('appointments').insert({
      ...values,
      account_id: connector.account_id,
      contact_id: null,
      assigned_agent_id: null,
      specialist_id: null,
      created_by: null,
      google_calendar_connection_id: null,
      google_calendar_event_id: event.id,
      zernio_calendar_connector_id: connector.id,
      zernio_calendar_id: calendarId,
    })
    if (insertError) throw insertError
  }
  return true
}

async function importEmailThread(
  db: SupabaseClient,
  connector: ZernioGoogleConnector,
  auditUserId: string,
  mailbox: string | null,
  thread: Awaited<ReturnType<typeof listZernioEmailThreads>>['threads'][number],
) {
  const participant = thread.participants.find((entry) =>
    entry.email.toLowerCase() !== mailbox?.toLowerCase(),
  ) ?? thread.participants[0]
  if (!participant) return false
  const contactId = await upsertLocalContact(db, connector, auditUserId, {
    id: participant.email,
    name: participant.name ?? '',
    email: participant.email,
    company: null,
    avatarUrl: null,
    phone: null,
  }, true)
  const { row: conversation } = await findOrCreateZernioConversation(
    db,
    connector,
    contactId,
    auditUserId,
    thread.id,
  )
  const receivedAt = thread.latestMessageReceivedAt
  const sentAt = thread.latestMessageSentAt
  const inboundLatest = receivedAt && (!sentAt || new Date(receivedAt) > new Date(sentAt))
  const lastMessageAt = inboundLatest ? receivedAt : (sentAt ?? receivedAt ?? new Date().toISOString())
  const content = thread.subject && thread.snippet && thread.subject !== thread.snippet
    ? `${thread.subject}\n\n${thread.snippet}`
    : thread.subject || thread.snippet
  const messageId = `zernio:${connector.id}:email-thread:${thread.id}`
  const { error: messageError } = await db.from('messages').insert({
    conversation_id: conversation.id,
    sender_type: inboundLatest ? 'customer' : 'agent',
    content_type: 'text',
    content_text: content,
    message_id: messageId,
    status: 'delivered',
    created_at: lastMessageAt,
  })
  if (messageError && !isUniqueViolation(messageError)) throw messageError
  const { error: conversationError } = await db.from('conversations').update({
    channel_source_label: `${connector.display_name}${thread.subject ? ` · ${thread.subject}` : ''}`.slice(0, 180),
    last_message_text: content,
    last_message_at: lastMessageAt,
    unread_count: thread.unread ? 1 : 0,
    status: 'open',
    updated_at: new Date().toISOString(),
  }).eq('id', conversation.id).eq('account_id', connector.account_id)
  if (conversationError) throw conversationError
  return true
}

export async function syncZernioGoogleConnector(
  db: SupabaseClient,
  connector: ZernioGoogleConnector,
  options: SyncOptions = {},
) {
  if (!connector.zernio_account_id) throw new Error('La conexión Google no tiene una cuenta Zernio vinculada.')
  const auditUserId = await resolveAuditUserId(db, connector.account_id)
  const now = options.now ?? new Date()
  const summary = { contacts: 0, events: 0, emailThreads: 0 }
  const errors: string[] = []
  let contactsSucceeded = options.contacts === false
  let calendarSucceeded = options.calendar === false
  let emailSucceeded = options.email === false

  if (options.contacts !== false) {
    try {
      let skip = 0
      let pages = 0
      do {
        const page = await listZernioContacts(connector.zernio_account_id, 100, skip)
        for (const contact of page.contacts) {
          await upsertLocalContact(db, connector, auditUserId, contact)
          summary.contacts += 1
        }
        skip = page.nextSkip
        pages += 1
        if (!page.hasMore || page.contacts.length === 0 || pages >= 50) break
      } while (true)
      contactsSucceeded = true
    } catch (error) {
      errors.push(`Contactos: ${errorMessage(error)}`)
    }
  }

  if (options.calendar !== false) {
    try {
      const calendars = await listZernioCalendars(connector.zernio_account_id)
      const from = new Date(now.getTime() - 30 * 86_400_000).toISOString()
      const to = new Date(now.getTime() + 90 * 86_400_000).toISOString()
      for (const calendar of calendars) {
        let cursor: string | null = null
        let pages = 0
        do {
          const page = await listZernioCalendarEvents(
            connector.zernio_account_id,
            calendar.id,
            from,
            to,
            cursor,
          )
          for (const event of page.events) {
            if (await upsertCalendarEvent(db, connector, event)) summary.events += 1
          }
          cursor = page.nextCursor
          pages += 1
          if (!cursor || pages >= 50) break
        } while (true)
      }
      calendarSucceeded = true
    } catch (error) {
      errors.push(`Calendario: ${errorMessage(error)}`)
    }
  }

  if (options.email !== false) {
    try {
      const mailbox = typeof record(connector.zernio_metadata).username === 'string'
        ? record(connector.zernio_metadata).username as string
        : null
      const after = new Date(now.getTime() - 90 * 86_400_000).toISOString()
      let cursor: string | null = null
      let pages = 0
      do {
        const page = await listZernioEmailThreads(connector.zernio_account_id, after, cursor)
        for (const thread of page.threads) {
          if (await importEmailThread(db, connector, auditUserId, mailbox, thread)) summary.emailThreads += 1
        }
        cursor = page.nextCursor
        pages += 1
        if (!cursor || pages >= 5) break
      } while (true)
      emailSucceeded = true
    } catch (error) {
      errors.push(`Correo: ${errorMessage(error)}`)
    }
  }

  const metadata = {
    ...record(connector.zernio_metadata),
    google_contacts_synced_at: contactsSucceeded && options.contacts !== false
      ? record(connector.zernio_metadata).google_contacts_synced_at ?? now.toISOString()
      : record(connector.zernio_metadata).google_contacts_synced_at,
    google_calendar_synced_at: calendarSucceeded && options.calendar !== false
      ? now.toISOString()
      : record(connector.zernio_metadata).google_calendar_synced_at,
    google_email_synced_at: emailSucceeded && options.email !== false
      ? record(connector.zernio_metadata).google_email_synced_at ?? now.toISOString()
      : record(connector.zernio_metadata).google_email_synced_at,
    google_sync_error: errors.length ? errors.join(' | ') : null,
  }
  const { error: metadataError } = await db.from('omnichannel_connectors').update({
    zernio_metadata: metadata,
    last_error: errors.length ? errors.join(' | ').slice(0, 500) : null,
    updated_at: now.toISOString(),
  }).eq('id', connector.id)
  if (metadataError) throw metadataError
  if (errors.length) throw new Error(errors.join(' | '))
  return summary
}

export async function syncZernioGoogleConnectors(db: SupabaseClient) {
  const { data, error } = await db.from('omnichannel_connectors')
    .select('id, account_id, provider, display_name, queue_id, zernio_account_id, zernio_metadata')
    .eq('provider', 'zernio_google')
    .neq('status', 'paused')
  if (error) throw error
  const summary = { checked: 0, contacts: 0, events: 0, emailThreads: 0, failed: 0 }
  for (const raw of data ?? []) {
    const connector = raw as ZernioGoogleConnector
    const previous = new Date(String(record(connector.zernio_metadata).google_calendar_synced_at ?? ''))
    if (!Number.isNaN(previous.getTime()) && Date.now() - previous.getTime() < 5 * 60_000) continue
    const entitlements = await getAccountEntitlements(db, connector.account_id)
    if (!entitlements?.features.channel_google) continue
    summary.checked += 1
    try {
      const metadata = record(connector.zernio_metadata)
      const result = await syncZernioGoogleConnector(db, connector, {
        contacts: !metadata.google_contacts_synced_at,
        email: !metadata.google_email_synced_at,
        calendar: true,
      })
      summary.contacts += result.contacts
      summary.events += result.events
      summary.emailThreads += result.emailThreads
    } catch (syncError) {
      summary.failed += 1
      console.error('[zernio] Google resource sync failed:', syncError)
    }
  }
  return summary
}

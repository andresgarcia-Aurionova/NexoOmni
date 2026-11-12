import type { SupabaseClient } from '@supabase/supabase-js'
import { isUniqueViolation } from '@/lib/contacts/dedupe'

type Connector = { id: string; account_id: string; provider: string; display_name: string; queue_id: string | null }
type ConversationRow = { id: string; unread_count: number | null; status: string | null }

export async function findOrCreateZernioConversation(
  db: SupabaseClient, connector: Connector, contactId: string, auditUserId: string, externalConversationId: string,
): Promise<{ row: ConversationRow; created: boolean }> {
  const find = async () => {
    const { data, error } = await db.from('conversations')
      .select('id, unread_count, status, contact_id')
      .eq('account_id', connector.account_id).eq('connector_id', connector.id)
      .eq('external_session_id', externalConversationId).limit(1)
    if (error) throw error
    const row = data?.[0]
    if (row && connector.provider === 'zernio_whatsapp' && row.contact_id !== contactId) {
      throw new Error('La conversación pertenece a otro contacto y requiere revisión.')
    }
    return (row as ConversationRow | undefined) ?? null
  }
  const existing = await find()
  if (existing) return { row: existing, created: false }

  if (connector.provider === 'zernio_whatsapp') {
    const { data: attached, error: attachError } = await db.from('conversations')
      .update({ external_session_id: externalConversationId })
      .eq('account_id', connector.account_id).eq('connector_id', connector.id)
      .eq('contact_id', contactId).eq('channel_type', connector.provider).is('external_session_id', null)
      .select('id, unread_count, status').maybeSingle()
    if (attachError && !isUniqueViolation(attachError)) throw attachError
    if (attached) return { row: attached as ConversationRow, created: false }
    if (attachError) {
      const raced = await find()
      if (raced) return { row: raced, created: false }
      throw attachError
    }
  }
  const { data, error } = await db.from('conversations')
    .insert({ account_id: connector.account_id, user_id: auditUserId, contact_id: contactId,
      channel_type: connector.provider, connector_id: connector.id, external_session_id: externalConversationId,
      channel_source_label: connector.display_name, queue_id: connector.queue_id })
    .select('id, unread_count, status').single()
  if (!error && data) return { row: data as ConversationRow, created: true }
  if (isUniqueViolation(error)) {
    const raced = await find()
    if (raced) return { row: raced, created: false }
  }
  throw error ?? new Error('No se pudo crear la conversación del canal conectado.')
}

// ============================================================
// Send an approved WhatsApp template to a contact through a
// Zernio-connected WhatsApp number, from a background job (no logged-in
// agent) — e.g. the AgendaPro 24h confirmation reminder.
//
// Mirrors the cold-start branch of POST /api/omnichannel/zernio/send
// (the Inbox/Contacts "Enviar plantilla" path) with two differences that
// matter for automated sends:
//  - the message is logged as sender_type 'bot' with no sender_id, so it
//    does NOT trip the AI's "a human already replied" gate
//    (src/lib/ai/auto-reply.ts) the way an agent's own send does;
//  - the conversation row is find-or-created race-safely: Zernio's own
//    `message.sent` echo for this very send can reach our webhook and
//    create the conversation before we do (same unique index as the
//    webhook race fixed in src/app/api/omnichannel/zernio/webhook).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { isUniqueViolation } from '@/lib/contacts/dedupe';
import { renderTemplateBody } from '@/lib/whatsapp/broadcast-message-log';
import { isValidE164, sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils';
import { getZernioParticipantProfile, sendZernioTemplateMessage, sendZernioTemplateToConversation } from '@/lib/zernio/server';
import { persistZernioOutbound } from './outbound-message';

export type ZernioWhatsAppConnector = { id: string; zernio_account_id: string };

/** Usable Zernio WhatsApp numbers for an account, oldest first. 'configured'
 *  counts as usable (it just hasn't received its first inbound yet) — same
 *  rule as /api/inbox/whatsapp-status. */
export async function listZernioWhatsAppConnectors(db: SupabaseClient, accountId: string): Promise<ZernioWhatsAppConnector[]> {
  const { data, error } = await db
    .from('omnichannel_connectors')
    .select('id, zernio_account_id')
    .eq('account_id', accountId)
    .eq('provider', 'zernio_whatsapp')
    .in('status', ['configured', 'active'])
    .not('zernio_account_id', 'is', null)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as ZernioWhatsAppConnector[];
}

export async function sendZernioTemplateToContact(db: SupabaseClient, args: {
  accountId: string;
  contactId: string;
  phone: string;
  ownerUserId: string;
  templateName: string;
  templateLanguage: string;
  bodyParams: string[];
  connectors: ZernioWhatsAppConnector[];
  requireExactParticipant?: boolean;
  allowVerifiedColdStart?: boolean;
}): Promise<{ conversationId: string; messageId: string | null }> {
  const phone = sanitizePhoneForMeta(args.phone);
  if (!isValidE164(phone)) throw new Error('El contacto no tiene un teléfono de WhatsApp válido.');
  if (args.connectors.length === 0) throw new Error('No hay un número de WhatsApp conectado con la Conexión NexoOmni.');

  // Prefer the number this contact already talks to; otherwise the first.
  const connectorIds = args.connectors.map((c) => c.id);
  const { data: existingRows, error: existingError } = await db
    .from('conversations')
    .select('id, connector_id, external_session_id')
    .eq('account_id', args.accountId)
    .eq('contact_id', args.contactId)
    .eq('channel_type', 'zernio_whatsapp')
    .in('connector_id', connectorIds)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(1);
  if (existingError) throw existingError;
  const existing = existingRows?.[0] as { id: string; connector_id: string; external_session_id: string | null } | undefined;
  const connector = args.connectors.find((c) => c.id === existing?.connector_id) ?? args.connectors[0];

  if (args.requireExactParticipant) {
    if (existing?.external_session_id) {
      await verifyParticipant(existing.external_session_id, connector.zernio_account_id, phone);
    } else {
      if (!args.allowVerifiedColdStart) throw new Error('No hay una conversación verificada para este número de WhatsApp.');
      const { data: identity, error: identityError } = await db.from('omnichannel_contact_identities')
        .select('account_id, contact_id').eq('connector_id', connector.id).eq('external_user_id', phone).maybeSingle();
      if (identityError) throw identityError;
      if (identity && (identity.account_id !== args.accountId || identity.contact_id !== args.contactId)) {
        throw new Error('La identidad de WhatsApp pertenece a otro contacto y requiere revisión.');
      }
    }
  }

  let conversationId: string;
  let messageId: string | null;
  if (existing?.external_session_id) {
    conversationId = existing.id;
    messageId = await sendZernioTemplateToConversation({
      conversationId: existing.external_session_id,
      zernioAccountId: connector.zernio_account_id,
      templateName: args.templateName,
      templateLanguage: args.templateLanguage,
      bodyParams: args.bodyParams,
    });
  } else {
    const result = await sendZernioTemplateMessage({
      zernioAccountId: connector.zernio_account_id,
      phone,
      templateName: args.templateName,
      templateLanguage: args.templateLanguage,
      templateParams: args.bodyParams,
    });
    messageId = result.messageId;
    if (args.requireExactParticipant) {
      if (!result.conversationId) throw new Error('El envío no devolvió una conversación verificable.');
      await verifyParticipant(result.conversationId, connector.zernio_account_id, phone);
      conversationId = await attachVerifiedZernioConversation(db, args, connector.id, existing?.id, result.conversationId);
    } else {
      conversationId = await attachZernioConversation(db, args, connector.id, existing?.id, result.conversationId);
    }
  }

  async function verifyParticipant(conversationId: string, zernioAccountId: string, phone: string) {
    const participant = await getZernioParticipantProfile(conversationId, zernioAccountId);
    if (!participant.participantId || !/^\+?[\d ()-]+$/.test(participant.participantId)
      || sanitizePhoneForMeta(participant.participantId) !== phone) {
      throw new Error('El destinatario de la conversación no coincide con el número de WhatsApp elegido.');
    }
  }

  const { data: templateRow } = await db
    .from('message_templates')
    .select('body_text')
    .eq('account_id', args.accountId)
    .eq('connector_id', connector.id)
    .eq('name', args.templateName)
    .eq('language', args.templateLanguage)
    .maybeSingle();
  const now = new Date().toISOString();
  await persistZernioOutbound(db, {
    accountId: args.accountId, connectorId: connector.id, conversationId,
    internalId: messageId, local: true,
    message: {
      sender_type: 'bot',
      content_type: 'template',
      content_text: templateRow?.body_text ? renderTemplateBody(templateRow.body_text as string, args.bodyParams) : args.templateName,
      template_name: args.templateName,
      created_at: now,
    },
  });
  await db.from('conversations')
    .update({ last_message_text: `Plantilla: ${args.templateName}`, last_message_at: now, updated_at: now })
    .eq('id', conversationId)
    .eq('account_id', args.accountId);

  return { conversationId, messageId };
}

export async function attachVerifiedZernioConversation(
  db: SupabaseClient,
  args: { accountId: string; contactId: string; ownerUserId: string },
  connectorId: string,
  existingId: string | undefined,
  externalSessionId: string,
): Promise<string> {
  if (existingId) {
    const { data, error } = await db.from('conversations').update({ external_session_id: externalSessionId })
      .eq('id', existingId).eq('account_id', args.accountId).eq('contact_id', args.contactId)
      .eq('connector_id', connectorId).is('external_session_id', null).select('id').maybeSingle();
    if (error && !isUniqueViolation(error)) throw error;
    if (data) return data.id as string;
  } else {
    const { data, error } = await db.from('conversations').insert({
      account_id: args.accountId, user_id: args.ownerUserId, contact_id: args.contactId,
      channel_type: 'zernio_whatsapp', connector_id: connectorId, external_session_id: externalSessionId,
    }).select('id').single();
    if (!error && data) return data.id as string;
    if (error && !isUniqueViolation(error)) throw error;
  }
  const { data, error } = await db.from('conversations').select('id')
    .eq('account_id', args.accountId).eq('connector_id', connectorId)
    .eq('contact_id', args.contactId).eq('external_session_id', externalSessionId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('La conversación del destinatario cambió y requiere revisión.');
  return data.id as string;
}

export async function attachZernioConversation(
  db: SupabaseClient,
  args: { accountId: string; contactId: string; ownerUserId: string },
  connectorId: string,
  existingId: string | undefined,
  externalSessionId: string | null,
): Promise<string> {
  if (existingId) {
    if (externalSessionId) {
      const { error } = await db.from('conversations').update({ external_session_id: externalSessionId })
        .eq('id', existingId).eq('account_id', args.accountId).eq('connector_id', connectorId);
      if (error) throw error;
    }
    return existingId;
  }
  const { data: created, error } = await db.from('conversations').insert({
    account_id: args.accountId,
    user_id: args.ownerUserId,
    contact_id: args.contactId,
    channel_type: 'zernio_whatsapp',
    connector_id: connectorId,
    external_session_id: externalSessionId,
  }).select('id').single();
  if (!error && created) return created.id as string;
  if (isUniqueViolation(error)) {
    // The webhook's echo of this send (or an inbound from the client) got
    // there first — reuse that row.
    const byThread = externalSessionId
      ? await db.from('conversations').select('id')
          .eq('account_id', args.accountId).eq('connector_id', connectorId).eq('external_session_id', externalSessionId)
          .limit(1)
      : null;
    if (byThread?.error) throw byThread.error;
    if (byThread?.data?.[0]) return byThread.data[0].id as string;
    const { data: byContact, error: contactError } = await db.from('conversations').select('id')
      .eq('account_id', args.accountId).eq('contact_id', args.contactId).eq('connector_id', connectorId).eq('channel_type', 'zernio_whatsapp')
      .limit(1);
    if (contactError) throw contactError;
    if (byContact?.[0]) return byContact[0].id as string;
  }
  throw error ?? new Error('No se pudo registrar la conversación del recordatorio.');
}

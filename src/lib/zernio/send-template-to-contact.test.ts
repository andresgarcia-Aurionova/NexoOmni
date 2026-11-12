import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/lib/zernio/server', () => ({
  sendZernioTemplateMessage: vi.fn(),
  sendZernioTemplateToConversation: vi.fn(),
  getZernioParticipantProfile: vi.fn(),
}));

import { getZernioParticipantProfile, sendZernioTemplateMessage, sendZernioTemplateToConversation } from '@/lib/zernio/server';
import { sendZernioTemplateToContact } from './send-template-to-contact';

type Row = Record<string, unknown>;

/** Minimal chainable Supabase stub. `selects[table]` is a queue of results
 *  for successive awaited selects on that table; inserts are recorded. */
function makeDb(opts: {
  existingConversation?: Row | null;
  insertConversationError?: { code: string } | null;
  racedConversation?: Row | null;
  mappedIdentity?: Row | null;
  strictConversation?: Row | null;
}) {
  const inserts: { table: string; row: Row }[] = [];
  const updates: { table: string; patch: Row }[] = [];
  let conversationSelects = 0;

  const from = (table: string) => {
    let mode: 'select' | 'insert' | 'update' = 'select';
    let payload: Row = {};
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    Object.assign(builder, {
      select: chain, eq: chain, in: chain, not: chain, order: chain, is: chain,
      insert: (row: Row) => { mode = 'insert'; payload = row; inserts.push({ table, row }); return builder; },
      update: (patch: Row) => { mode = 'update'; payload = patch; updates.push({ table, patch }); return builder; },
      limit: () => {
        if (table === 'conversations') {
          conversationSelects++;
          const row = conversationSelects === 1 ? opts.existingConversation : opts.racedConversation;
          return Promise.resolve({ data: row ? [row] : [], error: null });
        }
        return Promise.resolve({ data: [], error: null });
      },
      maybeSingle: () => Promise.resolve({
        data: table === 'omnichannel_contact_identities' ? (opts.mappedIdentity === undefined ? { account_id: 'acct', contact_id: 'contact-1' } : opts.mappedIdentity)
          : table === 'conversations' ? (opts.strictConversation ?? null) : null,
        error: null,
      }),
      single: () => {
        if (table === 'conversations' && mode === 'insert') {
          if (opts.insertConversationError) return Promise.resolve({ data: null, error: opts.insertConversationError });
          return Promise.resolve({ data: { id: 'conv-new' }, error: null });
        }
        return Promise.resolve({ data: payload, error: null });
      },
      then: (resolve: (v: { data: null; error: null }) => void) => resolve({ data: null, error: null }),
    });
    return builder;
  };

  const rpc = (_name: string, args: { p_message: Row; p_conversation_id: string; p_internal_id: string }) => {
    const row = { ...args.p_message, conversation_id: args.p_conversation_id, platform_message_id: args.p_internal_id };
    inserts.push({ table: 'messages', row });
    return Promise.resolve({ data: { id: 'message-1', ...row }, error: null });
  };
  return { db: { from, rpc } as unknown as SupabaseClient, inserts, updates };
}

const base = {
  accountId: 'acct',
  contactId: 'contact-1',
  phone: '+52 55 1234 5678',
  ownerUserId: 'owner',
  templateName: 'confirmacion_cita_24h',
  templateLanguage: 'es_MX',
  bodyParams: ['Ana', 'Terapia', 'viernes 3', '10:00', 'Balbuena'],
  connectors: [{ id: 'conn-1', zernio_account_id: 'zacc-1' }],
};

describe('sendZernioTemplateToContact', () => {
  beforeEach(() => {
    vi.mocked(sendZernioTemplateMessage).mockReset();
    vi.mocked(sendZernioTemplateToConversation).mockReset();
    vi.mocked(getZernioParticipantProfile).mockReset();
  });

  it('sends into the existing Zernio thread and logs it as a bot message', async () => {
    vi.mocked(sendZernioTemplateToConversation).mockResolvedValue('zmsg-1');
    const { db, inserts } = makeDb({ existingConversation: { id: 'conv-1', connector_id: 'conn-1', external_session_id: 'zconv-1' } });

    const result = await sendZernioTemplateToContact(db, base);

    expect(result).toEqual({ conversationId: 'conv-1', messageId: 'zmsg-1' });
    expect(sendZernioTemplateToConversation).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'zconv-1', zernioAccountId: 'zacc-1', bodyParams: base.bodyParams,
    }));
    expect(sendZernioTemplateMessage).not.toHaveBeenCalled();
    const message = inserts.find((i) => i.table === 'messages')?.row;
    // 'bot' with no sender_id: must not count as "a human already replied".
    expect(message).toMatchObject({ conversation_id: 'conv-1', sender_type: 'bot', platform_message_id: 'zmsg-1' });
    expect(message).not.toHaveProperty('sender_id');
  });

  it('opens a new Zernio conversation by phone when the contact has none', async () => {
    vi.mocked(sendZernioTemplateMessage).mockResolvedValue({ messageId: 'zmsg-2', conversationId: 'zconv-2' });
    const { db, inserts } = makeDb({ existingConversation: null });

    const result = await sendZernioTemplateToContact(db, base);

    expect(result.conversationId).toBe('conv-new');
    expect(sendZernioTemplateMessage).toHaveBeenCalledWith(expect.objectContaining({
      // Same digits-only form the Inbox's own Zernio send already uses.
      zernioAccountId: 'zacc-1', phone: '525512345678', templateParams: base.bodyParams,
    }));
    expect(inserts.find((i) => i.table === 'conversations')?.row).toMatchObject({
      channel_type: 'zernio_whatsapp', connector_id: 'conn-1', external_session_id: 'zconv-2',
    });
  });

  it("reuses the webhook's row when its echo created the conversation first", async () => {
    vi.mocked(sendZernioTemplateMessage).mockResolvedValue({ messageId: 'zmsg-3', conversationId: 'zconv-3' });
    const { db } = makeDb({
      existingConversation: null,
      insertConversationError: { code: '23505' },
      racedConversation: { id: 'conv-from-webhook' },
    });

    const result = await sendZernioTemplateToContact(db, base);

    expect(result.conversationId).toBe('conv-from-webhook');
  });

  it('rejects an invalid phone without calling Zernio', async () => {
    const { db } = makeDb({});
    await expect(sendZernioTemplateToContact(db, { ...base, phone: 'zernio:zernio_whatsapp:abc' })).rejects.toThrow();
    expect(sendZernioTemplateMessage).not.toHaveBeenCalled();
    expect(sendZernioTemplateToConversation).not.toHaveBeenCalled();
  });

  it('sends only when the provider confirms the exact participant', async () => {
    vi.mocked(getZernioParticipantProfile).mockResolvedValue({ name: null, picture: null, participantId: '525512345678' });
    vi.mocked(sendZernioTemplateToConversation).mockResolvedValue('zmsg-1');
    const { db } = makeDb({ existingConversation: { id: 'conv-1', connector_id: 'conn-1', external_session_id: 'zconv-1' } });
    await sendZernioTemplateToContact(db, { ...base, requireExactParticipant: true });
    expect(getZernioParticipantProfile).toHaveBeenCalledWith('zconv-1', 'zacc-1');
    expect(sendZernioTemplateToConversation).toHaveBeenCalledOnce();
    expect(sendZernioTemplateMessage).not.toHaveBeenCalled();
  });

  it.each(['525512345679', '5215512345678', null, 'user:525512345678'])(
    'does not send if the provider participant is missing or different: %s',
    async (participantId) => {
      vi.mocked(getZernioParticipantProfile).mockResolvedValue({ name: null, picture: null, participantId });
      const { db } = makeDb({ existingConversation: { id: 'conv-1', connector_id: 'conn-1', external_session_id: 'zconv-1' } });
      await expect(sendZernioTemplateToContact(db, { ...base, requireExactParticipant: true })).rejects.toThrow();
      expect(sendZernioTemplateToConversation).not.toHaveBeenCalled();
      expect(sendZernioTemplateMessage).not.toHaveBeenCalled();
    },
  );

  it('does not open a new conversation in exact-participant mode', async () => {
    const { db } = makeDb({});
    await expect(sendZernioTemplateToContact(db, { ...base, requireExactParticipant: true })).rejects.toThrow();
    expect(sendZernioTemplateMessage).not.toHaveBeenCalled();
    expect(getZernioParticipantProfile).not.toHaveBeenCalled();
  });

  it('checks the returned participant before associating the new thread', async () => {
    vi.mocked(sendZernioTemplateMessage).mockResolvedValue({ messageId: 'message', conversationId: 'zconv' });
    vi.mocked(getZernioParticipantProfile).mockResolvedValue({ name: null, picture: null, participantId: '525512345678' });
    const { db } = makeDb({ mappedIdentity: null });
    const result = await sendZernioTemplateToContact(db, { ...base, requireExactParticipant: true, allowVerifiedColdStart: true });
    expect(result.conversationId).toBe('conv-new');
    expect(getZernioParticipantProfile).toHaveBeenCalledWith('zconv', 'zacc-1');
  });

  it('refuses to send when an existing identity belongs to someone else', async () => {
    const { db } = makeDb({ mappedIdentity: { account_id: 'acct', contact_id: 'other' } });
    await expect(sendZernioTemplateToContact(db, { ...base, requireExactParticipant: true, allowVerifiedColdStart: true })).rejects.toThrow();
    expect(sendZernioTemplateMessage).not.toHaveBeenCalled();
  });

  it.each(['525599999999', 'opaque-id', null])('does not attach an unverified thread: %s', async (participantId) => {
    vi.mocked(sendZernioTemplateMessage).mockResolvedValue({ messageId: 'message', conversationId: 'zconv' });
    vi.mocked(getZernioParticipantProfile).mockResolvedValue({ name: null, picture: null, participantId });
    const { db, inserts } = makeDb({});
    await expect(sendZernioTemplateToContact(db, { ...base, requireExactParticipant: true, allowVerifiedColdStart: true })).rejects.toThrow();
    expect(inserts.some((row) => row.table === 'conversations')).toBe(false);
  });

  it('refuses a concurrent thread attached to a different contact', async () => {
    vi.mocked(sendZernioTemplateMessage).mockResolvedValue({ messageId: 'message', conversationId: 'zconv' });
    vi.mocked(getZernioParticipantProfile).mockResolvedValue({ name: null, picture: null, participantId: '525512345678' });
    const { db } = makeDb({ insertConversationError: { code: '23505' }, strictConversation: null });
    await expect(sendZernioTemplateToContact(db, { ...base, requireExactParticipant: true, allowVerifiedColdStart: true })).rejects.toThrow();
  });

  it('accepts a concurrent thread only for the exact contact and conversation', async () => {
    vi.mocked(sendZernioTemplateMessage).mockResolvedValue({ messageId: 'message', conversationId: 'zconv' });
    vi.mocked(getZernioParticipantProfile).mockResolvedValue({ name: null, picture: null, participantId: '525512345678' });
    const { db } = makeDb({ insertConversationError: { code: '23505' }, strictConversation: { id: 'raced' } });
    expect((await sendZernioTemplateToContact(db, { ...base, requireExactParticipant: true, allowVerifiedColdStart: true })).conversationId).toBe('raced');
  });

  it('does not send if participant lookup fails', async () => {
    vi.mocked(getZernioParticipantProfile).mockRejectedValue(new Error('provider unavailable'));
    const { db } = makeDb({ existingConversation: { id: 'conv-1', connector_id: 'conn-1', external_session_id: 'zconv-1' } });
    await expect(sendZernioTemplateToContact(db, { ...base, requireExactParticipant: true })).rejects.toThrow('provider unavailable');
    expect(sendZernioTemplateToConversation).not.toHaveBeenCalled();
  });
});

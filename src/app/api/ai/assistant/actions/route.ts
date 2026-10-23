import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAccountModule } from '@/lib/account/modules'
import { requireEntitlement } from '@/lib/account/entitlements'
import { toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { findConflict } from '@/lib/appointments/availability'
import { syncGoogleAppointment } from '@/lib/appointments/google-calendar'
import { recordAppointmentMemoryEvent } from '@/lib/appointments/memory'
import { AssistantActionProposalSchema } from '@/lib/assistant/action-types'
import { SendMessageError, sendMessageToConversation } from '@/lib/whatsapp/send-message'

const RequestSchema = z.object({
  action_id: z.string().uuid(),
  decision: z.enum(['confirm', 'cancel']),
}).strict()

class ActionPreconditionError extends Error {}

function actionFailure(error: unknown, needsReview = false) {
  const code = error instanceof SendMessageError ? error.code : 'assistant_action_failed'
  if (needsReview) {
    return NextResponse.json({ error: 'action_needs_review', code: 'action_needs_review' }, { status: 503 })
  }
  const status = error instanceof SendMessageError ? error.status : 400
  return NextResponse.json({ error: code, code }, { status })
}

async function executeAction(
  db: Awaited<ReturnType<typeof requireEntitlement>>['supabase'],
  accountId: string,
  userId: string,
  raw: unknown,
) {
  const proposal = AssistantActionProposalSchema.parse(raw)
  const action = proposal.action
  const { data: contact, error: contactError } = await db.from('contacts')
    .select('id, phone').eq('id', action.contact_id).eq('account_id', accountId)
    .is('deleted_at', null).maybeSingle()
  if (contactError) throw contactError
  if (!contact) throw new ActionPreconditionError('The action contact is no longer available.')

  if (action.action_type === 'create_follow_up_task') {
    const dueAt = new Date(action.due_at)
    if (dueAt.getTime() <= Date.now()) throw new ActionPreconditionError('The follow-up time has passed.')
    const { data, error } = await db.from('contact_commitments').insert({
      account_id: accountId,
      contact_id: contact.id,
      description: action.description,
      owner: 'agent',
      due_date: action.due_at.slice(0, 10),
      due_at: dueAt.toISOString(),
      assigned_agent_id: userId,
      source_type: 'manual',
    }).select('id').single()
    if (error) throw error
    return { object_type: 'task', object_id: data.id }
  }

  if (action.action_type === 'schedule_appointment') {
    const context = await requireAccountModule('appointments', 'supervisor')
    if (context.accountId !== accountId || context.userId !== userId) throw new ActionPreconditionError('Account context changed.')
    const startsAt = new Date(action.starts_at)
    const endsAt = new Date(action.ends_at)
    if (startsAt.getTime() <= Date.now() || endsAt <= startsAt
      || endsAt.getTime() - startsAt.getTime() > 8 * 60 * 60_000) {
      throw new ActionPreconditionError('The appointment time is no longer valid.')
    }
    const appointmentDate = new Intl.DateTimeFormat('es-MX', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: action.timezone,
    }).format(startsAt)
    if (await findConflict(db, accountId, { specialistId: null, agentUserId: userId }, startsAt, endsAt)) {
      throw new ActionPreconditionError('That appointment time is no longer available.')
    }
    const { data, error } = await db.from('appointments').insert({
      account_id: accountId,
      created_by: userId,
      assigned_agent_id: userId,
      contact_id: contact.id,
      title: action.title,
      notes: action.notes ?? null,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      timezone: action.timezone,
    }).select('id, title, notes, starts_at, ends_at, timezone, status, google_calendar_event_id, google_calendar_connection_id, assigned_agent_id, specialist_id').single()
    if (error) throw error
    try {
      const { error: auditError } = await db.from('appointment_audit_log').insert({
        account_id: accountId,
        appointment_id: data.id,
        actor_user_id: userId,
        source: 'nexoomni',
        action: 'created',
        after_data: { title: data.title, starts_at: data.starts_at, ends_at: data.ends_at, status: data.status },
      })
      if (auditError) console.error('[assistant action] appointment audit insert failed:', auditError)
    } catch (auditError) {
      console.error('[assistant action] appointment audit insert failed:', auditError)
    }
    await syncGoogleAppointment(accountId, data).catch(async (syncError) => {
      console.error('[assistant action] Google Calendar sync failed:', syncError)
      try {
        const { error: syncStatusError } = await db.from('appointments').update({
          google_sync_status: 'failed',
          google_sync_error: syncError instanceof Error ? syncError.message.slice(0, 500) : 'Google Calendar sync failed.',
        }).eq('id', data.id).eq('account_id', accountId)
        if (syncStatusError) console.error('[assistant action] appointment sync status update failed:', syncStatusError)
      } catch (syncStatusError) {
        console.error('[assistant action] appointment sync status update failed:', syncStatusError)
      }
    })
    await recordAppointmentMemoryEvent({
      accountId,
      contactId: contact.id,
      appointmentId: data.id,
      summary: `Cita agendada: ${data.title} para el ${appointmentDate}.`,
    }).catch((memoryError) => console.error('[assistant action] appointment memory update failed:', memoryError))
    return { object_type: 'appointment', object_id: data.id }
  }

  if (action.action_type === 'update_contact') {
    const { data, error } = await db.from('contacts').update({
      ...action.changes,
      updated_at: new Date().toISOString(),
    }).eq('id', contact.id).eq('account_id', accountId).is('deleted_at', null)
      .select('id').maybeSingle()
    if (error) throw error
    if (!data) throw new ActionPreconditionError('The contact could not be updated.')
    return { object_type: 'contact', object_id: data.id }
  }

  const { data: conversation, error: conversationError } = await db.from('conversations')
    .select('id, channel_type').eq('account_id', accountId)
    .eq('contact_id', contact.id).maybeSingle()
  if (conversationError) throw conversationError
  if (!conversation || conversation.channel_type !== 'whatsapp') {
    throw new ActionPreconditionError('The contact no longer has an eligible WhatsApp conversation.')
  }
  const limit = checkRateLimit(`send:${userId}`, RATE_LIMITS.send)
  if (!limit.success) throw new SendMessageError('rate_limited', 'The message rate limit has been reached.', 429)
  const result = await sendMessageToConversation(db, accountId, {
    conversationId: conversation.id,
    messageType: 'text',
    contentText: action.message_text,
  })
  return { object_type: 'message', object_id: result.messageId }
}

export async function POST(request: Request) {
  let claimed: Record<string, unknown> | null = null
  let actionId = ''
  let accountId = ''
  let userId = ''
  try {
    const context = await requireEntitlement('ai_assistant', 'supervisor')
    const parsed = RequestSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
    const limit = checkRateLimit(`ai-assistant-action:${context.userId}`, RATE_LIMITS.aiAssistant)
    if (!limit.success) {
      return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
    }
    actionId = parsed.data.action_id
    accountId = context.accountId
    userId = context.userId
    const admin = supabaseAdmin()

    if (parsed.data.decision === 'cancel') {
      const { data, error } = await admin.rpc('cancel_assistant_action', {
        p_action_id: actionId, p_account_id: accountId, p_user_id: userId,
      })
      if (error) throw error
      if (!Array.isArray(data) || !data.length) return NextResponse.json({ error: 'action_not_pending' }, { status: 409 })
      return NextResponse.json({ status: 'cancelled' })
    }

    const { data, error } = await admin.rpc('claim_assistant_action', {
      p_action_id: actionId, p_account_id: accountId, p_user_id: userId,
    })
    if (error) throw error
    if (!Array.isArray(data) || !data.length) {
      const { data: current, error: lookupError } = await admin.from('assistant_action_requests')
        .select('status, result').eq('id', actionId).eq('account_id', accountId).eq('user_id', userId)
        .maybeSingle()
      if (lookupError) throw lookupError
      if (current?.status === 'completed') return NextResponse.json({ status: 'completed', result: current.result })
      if (current?.status === 'expired') return NextResponse.json({ error: 'action_expired' }, { status: 410 })
      if (current?.status === 'needs_review') {
        return NextResponse.json({ error: 'action_needs_review', code: 'action_needs_review' }, { status: 409 })
      }
      return NextResponse.json({ error: 'action_not_pending' }, { status: 409 })
    }
    claimed = data[0] as Record<string, unknown>
    if (claimed.status === 'expired') return NextResponse.json({ error: 'action_expired' }, { status: 410 })

    let result: { object_type: string; object_id: string }
    try {
      result = await executeAction(context.supabase, accountId, userId, claimed.payload)
    } catch (error) {
      console.error('[ai/assistant action] execution failed:', error)
      const safelyRejected = error instanceof ActionPreconditionError
        || error instanceof z.ZodError
        || (error instanceof SendMessageError && !['db_error', 'delivery_unconfirmed'].includes(error.code))
      const needsReview = !safelyRejected
      const { data: recordedFailure, error: auditError } = await admin.rpc('finish_assistant_action', {
        p_action_id: actionId,
        p_account_id: accountId,
        p_user_id: userId,
        p_status: needsReview ? 'needs_review' : 'failed',
        p_result: { code: error instanceof SendMessageError ? error.code : 'action_failed' },
      })
      if (auditError || !Array.isArray(recordedFailure) || !recordedFailure.length) {
        console.error(
          '[ai/assistant action] failed execution audit could not be saved:',
          auditError ?? 'No final action state was returned.'
        )
        return NextResponse.json({ error: 'action_result_unconfirmed', code: 'action_result_unconfirmed' }, { status: 503 })
      }
      return actionFailure(error, needsReview)
    }

    const { data: completed, error: completeError } = await admin.rpc('finish_assistant_action', {
      p_action_id: actionId,
      p_account_id: accountId,
      p_user_id: userId,
      p_status: 'completed',
      p_result: result,
    })
    if (!completeError && Array.isArray(completed) && completed.length) {
      return NextResponse.json({ status: 'completed', result })
    }

    console.error(
      '[ai/assistant action] completion could not be confirmed:',
      completeError ?? 'No completed action was returned.'
    )
    const { data: reviewed, error: reviewError } = await admin.rpc('finish_assistant_action', {
      p_action_id: actionId,
      p_account_id: accountId,
      p_user_id: userId,
      p_status: 'needs_review',
      p_result: { code: 'completion_audit_failed' },
    })
    if (reviewError) console.error('[ai/assistant action] review state could not be saved:', reviewError)
    if (Array.isArray(reviewed) && reviewed.length) {
      return NextResponse.json({ error: 'action_needs_review', code: 'action_needs_review' }, { status: 503 })
    }

    const { data: current, error: currentError } = await admin.from('assistant_action_requests')
      .select('status, result').eq('id', actionId).eq('account_id', accountId).eq('user_id', userId)
      .maybeSingle()
    if (currentError) console.error('[ai/assistant action] final state lookup failed:', currentError)
    if (current?.status === 'completed') {
      return NextResponse.json({ status: 'completed', result: current.result })
    }
    if (current?.status === 'needs_review') {
      return NextResponse.json({ error: 'action_needs_review', code: 'action_needs_review' }, { status: 503 })
    }
    return NextResponse.json({ error: 'action_result_unconfirmed', code: 'action_result_unconfirmed' }, { status: 503 })
  } catch (error) {
    return toErrorResponse(error)
  }
}

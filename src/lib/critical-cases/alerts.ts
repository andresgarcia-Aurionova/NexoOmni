import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { sendSmtpEmail } from '@/lib/email/smtp'
import { oneLine, resolveAlertSender, sendToOne, type AlertSender } from '@/lib/telephony/reservation-alert'
import { buildCriticalCaseEmail, criticalCaseWhatsAppParams } from './alert-copy'
import { loadCriticalSettings } from './settings'

type OutboxRow = {
  id: string
  account_id: string
  conversation_id: string
  channel: 'email' | 'whatsapp'
  recipient: string
  level: 'n2' | 'n3'
  sede: string | null
  reason: string | null
  attempt_count: number
}

const MAX_ATTEMPTS = 8
const BATCH_SIZE = 10
const CLAIM_TIMEOUT_MS = 15 * 60_000
const TABLE = 'critical_case_alert_outbox'

function retryDelay(attempt: number) {
  return Math.min(2 ** Math.max(0, attempt - 1) * 60_000, 6 * 60 * 60_000)
}

function appUrl(): string | null {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim() || process.env.APP_URL?.trim()
  return raw ? raw.replace(/\/+$/, '') : null
}

async function contactName(db: SupabaseClient, conversationId: string): Promise<string> {
  const { data } = await db.from('conversations')
    .select('contact:contacts(name, phone)')
    .eq('id', conversationId)
    .maybeSingle()
  const contact = (Array.isArray(data?.contact) ? data?.contact[0] : data?.contact) as
    | { name: string | null; phone: string | null }
    | null
    | undefined
  return oneLine(contact?.name || contact?.phone || '—').slice(0, 120)
}

export async function processCriticalCaseAlerts(db: SupabaseClient) {
  const now = new Date()
  const timestamp = now.toISOString()
  const { error: recoverError } = await db.from(TABLE)
    .update({ status: 'pending', claimed_at: null, next_attempt_at: timestamp })
    .eq('status', 'processing')
    .lt('claimed_at', new Date(now.getTime() - CLAIM_TIMEOUT_MS).toISOString())
  if (recoverError) throw recoverError

  const { data, error } = await db.from(TABLE)
    .select('id, account_id, conversation_id, channel, recipient, level, sede, reason, attempt_count')
    .eq('status', 'pending')
    .lte('next_attempt_at', timestamp)
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE)
  if (error) throw error

  const claimed: Array<{ row: OutboxRow; attempts: number }> = []
  for (const row of (data ?? []) as OutboxRow[]) {
    const attempts = row.attempt_count + 1
    const { data: won, error: claimError } = await db.from(TABLE)
      .update({ status: 'processing', claimed_at: new Date().toISOString(), attempt_count: attempts })
      .eq('id', row.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle()
    if (claimError) throw claimError
    if (won) claimed.push({ row, attempts })
  }

  const senders = new Map<string, Promise<AlertSender>>()
  const names = new Map<string, Promise<string>>()
  const link = appUrl()

  const results = await Promise.all(claimed.map(async ({ row, attempts }) => {
    try {
      if (!names.has(row.conversation_id)) names.set(row.conversation_id, contactName(db, row.conversation_id))
      const name = await names.get(row.conversation_id)!
      if (row.channel === 'email') {
        const email = buildCriticalCaseEmail({
          level: row.level, sede: row.sede, reason: row.reason, contact: name,
          url: link ? `${link}/inbox?c=${encodeURIComponent(row.conversation_id)}` : null,
        })
        await sendSmtpEmail({ to: row.recipient, subject: email.subject, html: email.html })
      } else {
        const settings = await loadCriticalSettings(db, row.account_id)
        if (!settings.enabled) throw new Error('Critical case WhatsApp alerts are disabled')
        if (!senders.has(row.account_id)) senders.set(row.account_id, resolveAlertSender(db, row.account_id, settings))
        const sender = await senders.get(row.account_id)!
        await sendToOne(sender, settings, row.recipient, criticalCaseWhatsAppParams({
          level: row.level, sede: row.sede, reason: row.reason, contact: name,
        }))
      }
      const { error: sentError } = await db.from(TABLE)
        .update({ status: 'sent', sent_at: new Date().toISOString(), claimed_at: null, last_error: null })
        .eq('id', row.id)
        .eq('status', 'processing')
      if (sentError) throw sentError
      return 'sent' as const
    } catch (cause) {
      const isDead = attempts >= MAX_ATTEMPTS
      const message = cause instanceof Error ? cause.message : String(cause)
      const { error: failureError } = await db.from(TABLE)
        .update({
          status: isDead ? 'dead' : 'pending',
          claimed_at: null,
          next_attempt_at: new Date(Date.now() + retryDelay(attempts)).toISOString(),
          last_error: message.slice(0, 500),
        })
        .eq('id', row.id)
        .eq('status', 'processing')
      if (failureError) throw failureError
      console.error(`[critical-cases] ${row.channel} alert failed for outbox row ${row.id}:`, message)
      return isDead ? 'dead' as const : 'retried' as const
    }
  }))

  return {
    sent: results.filter((result) => result === 'sent').length,
    retried: results.filter((result) => result === 'retried').length,
    dead: results.filter((result) => result === 'dead').length,
  }
}

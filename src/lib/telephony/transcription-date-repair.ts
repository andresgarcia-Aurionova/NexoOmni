import type { SupabaseClient } from '@supabase/supabase-js'
import { parsePbxLocalTime } from './yeastar-ai'

const TIMEZONE = 'America/Mexico_City'

function localParts(date: Date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date).map((part) => [part.type, part.value]))
  return parts as Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', string>
}

// A call that starts in the future was imported with day and month swapped
// (e.g. 12 Oct read as 10 Dec). Returns the swapped date, or null if the swap
// is not possible or would still be in the future.
export function swapDayMonth(startedAt: string, now = Date.now()): Date | null {
  const start = new Date(startedAt)
  if (Number.isNaN(start.getTime()) || start.getTime() <= now + 60 * 60_000) return null
  const p = localParts(start)
  if (Number(p.day) > 12) return null
  const swapped = parsePbxLocalTime(`${p.year}-${p.day}-${p.month} ${p.hour}:${p.minute}:${p.second}`, TIMEZONE)
  return swapped && swapped.getTime() <= now + 60 * 60_000 ? swapped : null
}

export async function repairFutureTranscriptionDates(db: SupabaseClient, accountId: string): Promise<number> {
  const limit = new Date(Date.now() + 60 * 60_000).toISOString()
  const { data, error } = await db.from('yeastar_call_transcriptions')
    .select('id, started_at, answered_at, ended_at')
    .eq('account_id', accountId).gt('started_at', limit).limit(200)
  if (error) throw error
  let repaired = 0
  for (const row of data ?? []) {
    const fixed = swapDayMonth(row.started_at)
    if (!fixed) continue
    const delta = fixed.getTime() - new Date(row.started_at).getTime()
    const shift = (value: string | null) => value ? new Date(new Date(value).getTime() + delta).toISOString() : null
    const { error: updateError } = await db.from('yeastar_call_transcriptions').update({
      started_at: fixed.toISOString(), answered_at: shift(row.answered_at), ended_at: shift(row.ended_at),
    }).eq('id', row.id)
    if (updateError) throw updateError
    repaired += 1
  }
  return repaired
}

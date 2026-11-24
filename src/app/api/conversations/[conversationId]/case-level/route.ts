import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { isCaseLevel } from '@/lib/critical-cases/settings'

const CASE_COLUMNS = 'id, case_level, case_level_source, case_level_reason, case_sede, case_level_set_at, is_critical'

export async function PATCH(request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  try {
    const { accountId, userId } = await requireRole('supervisor')
    const { conversationId } = await params
    const body = await request.json().catch(() => null) as Record<string, unknown> | null
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Expected a JSON object' }, { status: 400 })
    }
    const level = body.level ?? null
    if (level !== null && !isCaseLevel(level)) {
      return NextResponse.json({ error: 'level must be n1, n2, n3 or null' }, { status: 400 })
    }
    const sede = typeof body.sede === 'string' ? body.sede.replace(/\s+/g, ' ').trim().slice(0, 120) || null : undefined
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) || null : undefined

    // Case columns are guarded against browser writes (migration 208); the
    // supervisor check above authorizes, the service client writes.
    const { data, error } = await supabaseAdmin().from('conversations')
      .update({
        case_level: level,
        case_level_source: level === null ? null : 'human',
        case_level_set_by: level === null ? null : userId,
        case_level_set_at: level === null ? null : new Date().toISOString(),
        ...(level === null ? { case_level_reason: null } : reason !== undefined ? { case_level_reason: reason } : {}),
        ...(sede !== undefined ? { case_sede: sede } : {}),
      })
      .eq('id', conversationId)
      .eq('account_id', accountId)
      .select(CASE_COLUMNS)
      .maybeSingle()
    if (error) throw error
    if (!data) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    return NextResponse.json({ case: data })
  } catch (error) {
    return toErrorResponse(error)
  }
}

import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { loadCriticalSettings } from '@/lib/critical-cases/settings'

/** Branch names only (no phones) so supervisors can tag a case's sede. */
export async function GET() {
  try {
    const { accountId } = await requireRole('supervisor')
    const settings = await loadCriticalSettings(supabaseAdmin(), accountId)
    return NextResponse.json({ sedes: settings.sedes.map((sede) => sede.name) })
  } catch (error) {
    return toErrorResponse(error)
  }
}

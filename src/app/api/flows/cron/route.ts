import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { resolveFallbackPolicy } from '@/lib/flows/fallback'

/**
 * Sweep abandoned active flow runs.
 *
 * Reads each active run's parent-flow `fallback_policy.on_timeout_hours`
 * to compute the staleness cutoff (default 24h), then marks any run
 * past its cutoff as `timed_out`. Writes a matching `flow_run_events`
 * row for the audit trail.
 *
 * Without this sweep, a customer who abandons a flow mid-conversation
 * keeps a row in `idx_one_active_run_per_contact` (the partial unique
 * index on `flow_runs WHERE status='active'`) forever — blocking any
 * new triggers for them. The cron is therefore not optional.
 *
 * Auth: re-uses `AUTOMATION_CRON_SECRET` so operators only have one
 * secret to provision. The two endpoints (`/api/automations/cron`
 * and this one) are independent operations; we keep them on separate
 * URLs so one failing doesn't block the other.
 *
 * Hosting: hit on a schedule (Vercel Cron / GitHub Actions / external
 * pinger). A 5-minute interval is more than enough for a 24h timeout
 * default; once per hour would also be acceptable for low-volume
 * tenants.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  // Constant-time compare so an attacker who can hit the endpoint
  // can't recover the secret byte-by-byte from response-time deltas.
  // Length pre-check is required by timingSafeEqual (throws otherwise)
  // and leaks only the length itself, which isn't sensitive.
  const supplied = request.headers.get('x-cron-secret') ?? ''
  const suppliedBuf = Buffer.from(supplied)
  const expectedBuf = Buffer.from(expected)
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = supabaseAdmin()
  const now = new Date()

  const { data: stalledAi, error: aiScanError } = await admin.from('flow_ai_turns')
    .select('id, flow_run_id, node_key, flow_runs!inner(account_id, status)')
    .eq('status', 'processing')
    .eq('flow_runs.status', 'active')
    .lt('started_at', new Date(now.getTime() - 3 * 60_000).toISOString())
    .order('started_at', { ascending: true })
    .limit(100)
  if (aiScanError) {
    console.error('[flows-cron] AI turn scan failed:', aiScanError.message)
    return NextResponse.json({ error: 'AI turn recovery unavailable' }, { status: 500 })
  }
  let aiHandedOff = 0
  let aiRecoveryFailures = 0
  for (const turn of stalledAi ?? []) {
    const parent = Array.isArray(turn.flow_runs) ? turn.flow_runs[0] : turn.flow_runs
    if (!parent || typeof parent.account_id !== 'string') {
      console.error('[flows-cron] AI turn has no account')
      aiRecoveryFailures += 1
      continue
    }
    const { data: recovered, error: recoveryError } = await admin.rpc('handoff_flow_ai_turn', {
      p_account_id: parent.account_id, p_run_id: turn.flow_run_id, p_turn_id: turn.id,
      p_node_key: turn.node_key, p_stalled_only: true,
    })
    if (recoveryError || typeof recovered !== 'boolean') {
      console.error('[flows-cron] AI turn recovery failed:', recoveryError?.message ?? 'invalid result')
      aiRecoveryFailures += 1
    } else if (recovered) {
      aiHandedOff += 1
    }
  }

  // Pull all currently-active runs along with their parent flow's
  // fallback_policy. Joined in one query — the small set of active
  // runs per tenant keeps this cheap.
  const { data: runs, error } = await admin
    .from('flow_runs')
    .select(
      'id, flow_id, user_id, contact_id, current_node_key, vars, last_advanced_at, flows ( fallback_policy )',
    )
    .eq('status', 'active')

  if (error) {
    console.error('[flows-cron] active-run scan failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!runs?.length) {
    return NextResponse.json({ swept: 0, aiHandedOff, aiRecoveryFailures },
      { status: aiRecoveryFailures ? 500 : 200 })
  }

  type Row = {
    id: string
    flow_id: string
    user_id: string
    contact_id: string | null
    current_node_key: string | null
    vars: Record<string, unknown> | null
    last_advanced_at: string
    flows: { fallback_policy: unknown } | { fallback_policy: unknown }[] | null
  }

  let swept = 0
  let handedOff = 0
  let recoveryFailures = 0
  for (const r of runs as Row[]) {
    const nodeKey = r.current_node_key
    const token = nodeKey && r.vars?.[`__offer_token_${nodeKey}`]
    if (r.vars?.__guarded_appointments === true && nodeKey && typeof token === 'string'
        && (r.vars[`__offer_claim_${nodeKey}`] === token || r.vars[`__offer_pending_${nodeKey}`] === token)
        && now.getTime() - new Date(r.last_advanced_at).getTime() >= 3 * 60_000) {
      const { data: recovered, error: recoveryError } = await admin.rpc('handoff_stalled_flow_appointment', {
        p_run_id: r.id,
        p_expected_node_key: nodeKey,
        p_expected_offer_token: token,
        p_expected_advanced_at: r.last_advanced_at,
      })
      if (recoveryError) {
        console.error('[flows-cron] appointment claim recovery failed:', recoveryError.message)
        recoveryFailures += 1
      } else if (recovered === true) {
        handedOff += 1
      } else if (recovered !== false) {
        console.error('[flows-cron] invalid appointment claim recovery result')
        recoveryFailures += 1
      }
      continue
    }
    const flowsField = Array.isArray(r.flows) ? r.flows[0] : r.flows
    const policy = resolveFallbackPolicy(flowsField?.fallback_policy ?? null)
    const lastAdvanced = new Date(r.last_advanced_at)
    const ageHours = (now.getTime() - lastAdvanced.getTime()) / (1000 * 60 * 60)
    if (ageHours < policy.on_timeout_hours) continue

    // A reply may have advanced the run after the scan.
    const { data: updated } = await admin
      .from('flow_runs')
      .update({
        status: 'timed_out',
        ended_at: now.toISOString(),
        end_reason: 'stale_sweep',
      })
      .eq('id', r.id)
      .eq('status', 'active')
      .eq('last_advanced_at', r.last_advanced_at)
      .select('id')

    if (Array.isArray(updated) && updated.length > 0) {
      await admin.from('flow_run_events').insert({
        flow_run_id: r.id,
        event_type: 'timeout',
        payload: {
          age_hours: Math.round(ageHours * 10) / 10,
          policy_hours: policy.on_timeout_hours,
        },
      })
      swept += 1
    }
  }

  return NextResponse.json({ swept, handedOff, recoveryFailures, aiHandedOff, aiRecoveryFailures },
    { status: recoveryFailures || aiRecoveryFailures ? 500 : 200 })
}

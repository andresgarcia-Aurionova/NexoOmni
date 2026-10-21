import { NextResponse } from 'next/server'
import { toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { validateAiCredentials } from '@/lib/ai/validate'
import { AiError, type AiProvider } from '@/lib/ai/types'
import { requirePlatformOperator } from '@/lib/platform/operator'
import { supabaseAdmin } from '@/lib/ai/admin-client'

const ACCOUNT_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * POST /api/ai/test  (platform operator only)
 *
 * Validate a candidate provider/model/key against the provider without
 * saving it. Tenant admins cannot test arbitrary provider credentials.
 */
export async function POST(request: Request) {
  try {
    const { user } = await requirePlatformOperator()

    const limit = checkRateLimit(`ai-test:${user.id}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const provider = body.provider as AiProvider
    if (provider !== 'openai' && provider !== 'anthropic') {
      return NextResponse.json(
        { error: 'provider must be "openai" or "anthropic"' },
        { status: 400 },
      )
    }
    const model = typeof body.model === 'string' ? body.model.trim() : ''
    const accountId =
      typeof body.account_id === 'string' ? body.account_id : ''
    if (!ACCOUNT_ID_RE.test(accountId)) {
      return NextResponse.json(
        { error: 'account_id must identify a valid customer.' },
        { status: 400 },
      )
    }
    const { data: account, error: accountError } = await supabaseAdmin()
      .from('accounts')
      .select('id')
      .eq('id', accountId)
      .maybeSingle()
    if (accountError) throw accountError
    if (!account) {
      return NextResponse.json({ error: 'Customer was not found.' }, { status: 404 })
    }
    if (!model) {
      return NextResponse.json({ error: 'model is required' }, { status: 400 })
    }

    const apiKeyPlain =
      typeof body.api_key === 'string' ? body.api_key.trim() : ''
    if (!apiKeyPlain) {
      return NextResponse.json(
        { error: 'Enter an API key to test.' },
        { status: 400 },
      )
    }

    try {
      await validateAiCredentials({
        accountId,
        provider,
        model,
        apiKey: apiKeyPlain,
        systemPrompt: null,
        isActive: true,
        autoReplyEnabled: false,
        autoReplyMaxPerConversation: 3,
        handoffAgentId: null,
        embeddingsApiKey: null,
        timezone: 'America/Mexico_City',
      }, accountId)
    } catch (err) {
      if (err instanceof AiError) {
        return NextResponse.json(
          { error: err.message, code: err.code },
          { status: 400 },
        )
      }
      console.error('[ai/test] validation error:', err)
      return NextResponse.json(
        { error: 'Could not validate the API key.' },
        { status: 400 },
      )
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

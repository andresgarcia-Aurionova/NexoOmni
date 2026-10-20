import { NextResponse } from 'next/server'

import { toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { AI_PROVIDER_DEFAULT_MODEL } from '@/lib/ai/defaults'
import { validateAiCredentials } from '@/lib/ai/validate'
import { AiError, type AiProvider } from '@/lib/ai/types'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import { requirePlatformOperator } from '@/lib/platform/operator'
import {
  checkRateLimit,
  RATE_LIMITS,
  rateLimitResponse,
} from '@/lib/rate-limit'

const ACCOUNT_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_KEY_LENGTH = 8192

function validProvider(value: unknown): value is AiProvider {
  return value === 'openai' || value === 'anthropic'
}

function adminClient() {
  return supabaseAdmin()
}

export async function GET(request: Request) {
  try {
    await requirePlatformOperator()
    const accountId = new URL(request.url).searchParams.get('account_id') ?? ''
    if (!ACCOUNT_ID_RE.test(accountId)) {
      return NextResponse.json(
        { error: 'Selecciona un cliente válido.' },
        { status: 400 }
      )
    }

    const admin = adminClient()
    const [account, config, credentialResult] = await Promise.all([
      admin.from('accounts').select('id, name').eq('id', accountId).maybeSingle(),
      admin
        .from('ai_configs')
        .select('provider, model')
        .eq('account_id', accountId)
        .maybeSingle(),
      admin
        .from('ai_provider_credentials')
        .select('provider, encrypted_api_key, updated_at')
        .eq('account_id', accountId)
        .eq('credential_type', 'chat'),
    ])
    const error = account.error ?? config.error ?? credentialResult.error
    if (error) throw error
    if (!account.data) {
      return NextResponse.json({ error: 'No se encontró el cliente.' }, { status: 404 })
    }

    const credentials = (credentialResult.data ?? []).map((credential) => {
      let lastFour: string | null = null
      let readable = true
      try {
        const plaintext = decrypt(credential.encrypted_api_key)
        lastFour = plaintext.length >= 4 ? plaintext.slice(-4) : null
      } catch (error) {
        readable = false
        console.error(
          `[platform/ai-credentials GET] stored ${credential.provider} credential for ${accountId} could not be decrypted:`,
          error
        )
      }
      return {
        provider: credential.provider,
        has_key: true,
        readable,
        last_four: lastFour,
        updated_at: credential.updated_at,
        active: config.data?.provider === credential.provider,
      }
    })

    return NextResponse.json({
      account: account.data,
      active_provider: config.data?.provider ?? null,
      active_model: config.data?.model ?? null,
      credentials,
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const operator = await requirePlatformOperator()
    const limit = checkRateLimit(
      `platform:ai-credential:${operator.user.id}`,
      RATE_LIMITS.adminAction
    )
    if (!limit.success) return rateLimitResponse(limit)

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null
    const accountId =
      typeof body?.account_id === 'string' ? body.account_id : ''
    const providerValue = body?.provider
    const apiKey =
      typeof body?.api_key === 'string' ? body.api_key.trim() : ''

    if (!ACCOUNT_ID_RE.test(accountId)) {
      return NextResponse.json(
        { error: 'Selecciona un cliente válido.' },
        { status: 400 }
      )
    }
    if (!validProvider(providerValue)) {
      return NextResponse.json(
        { error: 'Selecciona un proveedor válido.' },
        { status: 400 }
      )
    }
    if (!apiKey || apiKey.length > MAX_KEY_LENGTH) {
      return NextResponse.json(
        { error: 'La clave es obligatoria y no puede superar 8192 caracteres.' },
        { status: 400 }
      )
    }

    const admin = adminClient()
    const { data: account, error: accountError } = await admin
      .from('accounts')
      .select('id')
      .eq('id', accountId)
      .maybeSingle()
    if (accountError) throw accountError
    if (!account) {
      return NextResponse.json({ error: 'No se encontró el cliente.' }, { status: 404 })
    }

    try {
      await validateAiCredentials({
        provider: providerValue,
        model: AI_PROVIDER_DEFAULT_MODEL[providerValue],
        apiKey,
        systemPrompt: null,
        isActive: false,
        autoReplyEnabled: false,
        autoReplyMaxPerConversation: 3,
        handoffAgentId: null,
        embeddingsApiKey: null,
        timezone: 'America/Mexico_City',
      })
    } catch (error) {
      if (error instanceof AiError) {
        return NextResponse.json(
          { error: error.message, code: error.code },
          { status: 400 }
        )
      }
      console.error('[platform/ai-credentials POST] validation error:', error)
      return NextResponse.json(
        { error: 'No se pudo verificar la clave con el proveedor.' },
        { status: 400 }
      )
    }

    const encryptedKey = encrypt(apiKey)
    const { error: credentialError } = await admin
      .from('ai_provider_credentials')
      .upsert(
        {
          account_id: accountId,
          provider: providerValue,
          credential_type: 'chat',
          encrypted_api_key: encryptedKey,
          updated_by: operator.user.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'account_id,provider,credential_type' }
      )
    if (credentialError) throw credentialError

    const { data: config, error: configError } = await admin
      .from('ai_configs')
      .select('provider')
      .eq('account_id', accountId)
      .maybeSingle()
    if (configError) throw configError

    if (config?.provider === providerValue) {
      const { error } = await admin
        .from('ai_configs')
        .update({ api_key: encryptedKey })
        .eq('account_id', accountId)
      if (error) throw error
    } else if (!config && providerValue === 'openai') {
      const { error } = await admin.from('ai_configs').insert({
        account_id: accountId,
        created_by: operator.user.id,
        provider: providerValue,
        model: AI_PROVIDER_DEFAULT_MODEL[providerValue],
        api_key: encryptedKey,
      })
      if (error) throw error
    }

    return NextResponse.json({
      success: true,
      provider: providerValue,
      active: config?.provider === providerValue || (!config && providerValue === 'openai'),
      message: 'La clave se verificó y quedó guardada de forma cifrada.',
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}

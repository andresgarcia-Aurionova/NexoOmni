import { NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';

import { toErrorResponse } from '@/lib/auth/account';
import { requirePlatformOperator } from '@/lib/platform/operator';
import { syncZernioCallsWithCreditBalance } from '@/lib/zernio/call-credit-pause';
import {
  checkRateLimit,
  RATE_LIMITS,
  rateLimitResponse,
} from '@/lib/rate-limit';

const ACCOUNT_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_CREDIT_GRANT = 1_000_000_000_000;

type UsageSummaryRow = {
  account_id: string;
  mode: string;
  provider: 'openai' | 'anthropic';
  model: string;
  calls: number | string;
  prompt_tokens: number | string;
  completion_tokens: number | string;
  estimated_cost_nano_usd: number | string | null;
  estimated_credits: number | string | null;
  unpriced_calls: number | string;
};
type AiUsageMode =
  | 'auto_reply'
  | 'draft'
  | 'analysis'
  | 'report'
  | 'call_summary'
  | 'voice_transcription'
  | 'image_description'
  | 'embeddings'
  | 'credential_test'
  | 'assistant';
const AI_USAGE_MODES: AiUsageMode[] = [
  'auto_reply',
  'draft',
  'analysis',
  'report',
  'call_summary',
  'voice_transcription',
  'image_description',
  'embeddings',
  'credential_test',
  'assistant',
];

function isAiUsageMode(value: unknown): value is AiUsageMode {
  return typeof value === 'string' && AI_USAGE_MODES.includes(value as AiUsageMode);
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase server configuration');
  return createAdminClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

function stringValue(value: unknown) {
  return value === null || value === undefined ? null : String(value);
}

export async function GET(request: Request) {
  try {
    await requirePlatformOperator();
    const accountId = new URL(request.url).searchParams.get('account_id');
    if (accountId && !ACCOUNT_ID_RE.test(accountId)) {
      return NextResponse.json(
        { error: 'Selecciona un cliente válido.' },
        { status: 400 }
      );
    }
    const admin = adminClient();
    const ledgerQuery = admin
      .from('ai_credit_ledger')
      .select(
        'id, account_id, entry_type, delta_credits, balance_after, metadata, actor_user_id, created_at'
      )
      .order('created_at', { ascending: false })
      .limit(100)
      .eq('account_id', accountId ?? '00000000-0000-0000-0000-000000000000');
    const [
      { data: accounts, error: accountsError },
      { data: wallets, error: walletsError },
      { data: usage, error: usageError },
      { data: ledger, error: ledgerError },
    ] = await Promise.all([
      admin.from('accounts').select('id, name').order('name'),
      admin
        .from('ai_credit_wallets')
        .select('account_id, available_credits, updated_at'),
      admin.rpc('platform_ai_credit_usage_summary'),
      ledgerQuery,
    ]);
    const error = accountsError ?? walletsError ?? usageError ?? ledgerError;
    if (error) throw error;

    return NextResponse.json({
      accounts: (accounts ?? []).map((account) => ({
        id: account.id,
        name: account.name,
        available_credits:
          stringValue(
            (wallets ?? []).find((wallet) => wallet.account_id === account.id)
              ?.available_credits
          ) ?? '0',
        updated_at:
          (wallets ?? []).find((wallet) => wallet.account_id === account.id)
            ?.updated_at ?? null,
      })),
      usage: ((usage ?? []) as UsageSummaryRow[]).map((row) => ({
        ...row,
        calls: stringValue(row.calls) ?? '0',
        prompt_tokens: stringValue(row.prompt_tokens) ?? '0',
        completion_tokens: stringValue(row.completion_tokens) ?? '0',
        estimated_cost_nano_usd: stringValue(row.estimated_cost_nano_usd),
        estimated_credits: stringValue(row.estimated_credits),
        unpriced_calls: stringValue(row.unpriced_calls) ?? '0',
      })),
      ledger: (ledger ?? []).map((entry) => ({
        id: entry.id,
        account_id: entry.account_id,
        entry_type: entry.entry_type,
        delta_credits: stringValue(entry.delta_credits) ?? '0',
        balance_after: stringValue(entry.balance_after) ?? '0',
        reason:
          typeof entry.metadata?.reason === 'string'
            ? entry.metadata.reason
            : null,
        usage_mode: isAiUsageMode(entry.metadata?.mode)
          ? entry.metadata.mode
          : null,
        source:
          typeof entry.metadata?.source === 'string'
            ? entry.metadata.source
            : null,
        actor_user_id: entry.actor_user_id,
        created_at: entry.created_at,
      })),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const operator = await requirePlatformOperator();
    const limit = checkRateLimit(
      `platform:credit-grant:${operator.user.id}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    const accountId =
      typeof body?.account_id === 'string' ? body.account_id : '';
    const credits =
      typeof body?.credits === 'number' ? body.credits : Number.NaN;
    const entryType = body?.entry_type;
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    const requestId =
      typeof body?.request_id === 'string' ? body.request_id : '';

    if (!ACCOUNT_ID_RE.test(accountId)) {
      return NextResponse.json(
        { error: 'Selecciona un cliente válido.' },
        { status: 400 }
      );
    }
    if (
      !Number.isSafeInteger(credits) ||
      credits < 1 ||
      credits > MAX_CREDIT_GRANT
    ) {
      return NextResponse.json(
        {
          error:
            'Los créditos deben ser un entero entre 1 y 1,000,000,000,000.',
        },
        { status: 400 }
      );
    }
    if (entryType !== 'purchase' && entryType !== 'adjustment') {
      return NextResponse.json(
        {
          error:
            'Selecciona si el abono corresponde a una recarga o a un ajuste.',
        },
        { status: 400 }
      );
    }
    if (reason.length < 5 || reason.length > 500) {
      return NextResponse.json(
        { error: 'El motivo debe tener entre 5 y 500 caracteres.' },
        { status: 400 }
      );
    }
    if (!REQUEST_ID_RE.test(requestId)) {
      return NextResponse.json(
        { error: 'No se pudo identificar la operación. Vuelve a intentarlo.' },
        { status: 400 }
      );
    }

    const admin = adminClient();
    const { data, error } = await admin.rpc('platform_ai_credit_grant', {
      p_account_id: accountId,
      p_credits: credits,
      p_idempotency_key: `platform-manual:${requestId}`,
      p_entry_type: entryType,
      p_reason: reason,
      p_actor_user_id: operator.user.id,
    });
    if (error) throw error;

    const result = Array.isArray(data) ? data[0] : null;
    if (!result || !['granted', 'duplicate'].includes(result.result)) {
      throw new Error('La base de datos no confirmó el abono de créditos.');
    }

    let expiresAt: string | null = null;
    if (entryType === 'purchase' && result.ledger_entry_id) {
      const { data: batch, error: batchError } = await admin
        .from('ai_credit_batches')
        .select('expires_at')
        .eq('ledger_entry_id', result.ledger_entry_id)
        .maybeSingle();
      if (batchError) throw batchError;
      expiresAt =
        typeof batch?.expires_at === 'string' ? batch.expires_at : null;
    }

    let callsReactivated = BigInt(String(result.available_credits)) > BigInt(0);
    if (callsReactivated) {
      try {
        await syncZernioCallsWithCreditBalance(
          admin,
          accountId,
          BigInt(String(result.available_credits))
        );
      } catch (error) {
        console.error(
          `[credit call pause] Credits were granted, but Zernio calls remain pending for account ${accountId}:`,
          error
        );
        callsReactivated = false;
      }
    }

    return NextResponse.json(
      {
        result: result.result,
        available_credits: stringValue(result.available_credits),
        calls_reactivated: callsReactivated,
        expires_at: expiresAt,
        message:
          result.result === 'duplicate'
            ? 'Esta operación ya se había aplicado; no se abonaron créditos por segunda vez.'
            : 'Créditos abonados y registrados en el historial.',
      },
      { status: result.result === 'granted' ? 201 : 200 }
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}

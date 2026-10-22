import { NextResponse } from 'next/server';

import { toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/ai/admin-client';
import { requirePlatformOperator } from '@/lib/platform/operator';

const ACCOUNT_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type FinancialRow = {
  account_id: string;
  activity: string;
  provider: string;
  model: string;
  operation_count: number | string;
  prompt_tokens: number | string | null;
  completion_tokens: number | string | null;
  total_tokens: number | string | null;
  cost_nano_usd: number | string;
  charged_price_nano_usd: number | string;
  expected_price_nano_usd: number | string;
  profit_nano_usd: number | string;
  credits_charged: number | string;
  pending_charges: number | string;
  estimated: boolean;
};

function stringValue(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

export async function GET(request: Request) {
  try {
    await requirePlatformOperator();
    const params = new URL(request.url).searchParams;
    const accountId = params.get('account_id');
    if (accountId && !ACCOUNT_ID_RE.test(accountId)) {
      return NextResponse.json(
        { error: 'Selecciona un cliente válido.' },
        { status: 400 }
      );
    }

    const now = new Date();
    const sinceParam = params.get('since');
    const untilParam = params.get('until');
    const since = sinceParam
      ? new Date(sinceParam)
      : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const until = untilParam ? new Date(untilParam) : now;
    if (
      !Number.isFinite(since.getTime()) ||
      !Number.isFinite(until.getTime()) ||
      since >= until ||
      until.getTime() - since.getTime() > 366 * 24 * 60 * 60 * 1000
    ) {
      return NextResponse.json(
        { error: 'El periodo del reporte no es válido.' },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin().rpc(
      'platform_ai_financial_report',
      {
        p_since: since.toISOString(),
        p_until: until.toISOString(),
        p_account_id: accountId,
      }
    );
    if (error) throw error;

    const rows = ((data ?? []) as FinancialRow[]).map((row) => ({
      ...row,
      operation_count: stringValue(row.operation_count) ?? '0',
      prompt_tokens: stringValue(row.prompt_tokens),
      completion_tokens: stringValue(row.completion_tokens),
      total_tokens: stringValue(row.total_tokens),
      cost_nano_usd: stringValue(row.cost_nano_usd) ?? '0',
      charged_price_nano_usd:
        stringValue(row.charged_price_nano_usd) ?? '0',
      expected_price_nano_usd:
        stringValue(row.expected_price_nano_usd) ?? '0',
      profit_nano_usd: stringValue(row.profit_nano_usd) ?? '0',
      credits_charged: stringValue(row.credits_charged) ?? '0',
      pending_charges: stringValue(row.pending_charges) ?? '0',
    }));

    return NextResponse.json({
      period: { since: since.toISOString(), until: until.toISOString() },
      rows,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

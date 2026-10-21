import { NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';

import {
  isAiCreditUsageActivity,
  type AiCreditUsageActivity,
} from '@/lib/ai/credit-usage-activities';
import { loadBanxicoFix } from '@/lib/billing/banxico-fx';
import { isStripeCheckoutConfigured } from '@/lib/stripe/server';
import { requireEntitlement } from '@/lib/account/entitlements';
import { toErrorResponse } from '@/lib/auth/account';

type MonthlyUsageActivity = {
  activity: AiCreditUsageActivity;
  operation_count: string;
  credits_used: string;
};

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

function nonNegativeInteger(value: unknown, field: string): string {
  const normalized = String(value);
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`Invalid monthly credit summary field: ${field}`);
  }
  return normalized;
}

function parseMonthlyUsageRows(value: unknown): MonthlyUsageActivity[] {
  if (!Array.isArray(value)) {
    throw new Error('Invalid monthly credit summary response.');
  }
  return value.map((row) => {
    if (!row || typeof row !== 'object') {
      throw new Error('Invalid monthly credit summary row.');
    }
    const record = row as Record<string, unknown>;
    return {
      activity: isAiCreditUsageActivity(record.activity)
        ? record.activity
        : 'other',
      operation_count: nonNegativeInteger(
        record.operation_count,
        'operation_count'
      ),
      credits_used: nonNegativeInteger(record.credits_used, 'credits_used'),
    };
  });
}

function sumCreditsUsed(activities: MonthlyUsageActivity[]): string {
  return activities
    .reduce(
      (total, activity) => total + BigInt(activity.credits_used),
      BigInt(0)
    )
    .toString();
}

function estimateBalanceMxnCentavos(
  balance: string,
  nanoUsdPerCredit: string,
  mxnPerUsdMicro: bigint
): string {
  if (
    !/^\d+$/.test(balance) ||
    !/^\d+$/.test(nanoUsdPerCredit) ||
    mxnPerUsdMicro <= BigInt(0)
  ) {
    throw new Error('Invalid values for the MXN credit balance estimate.');
  }
  const denominator = BigInt(1_000_000_000) * BigInt(1_000_000);
  const numerator =
    BigInt(balance) *
    BigInt(nanoUsdPerCredit) *
    mxnPerUsdMicro *
    BigInt(100);
  return ((numerator + denominator / BigInt(2)) / denominator).toString();
}

async function getBalanceMxnEstimate(balance: string) {
  const admin = adminClient();
  const [{ data: settings, error }, fx] = await Promise.all([
    admin
      .from('ai_billing_settings')
      .select('nano_usd_per_credit')
      .eq('id', true)
      .maybeSingle(),
    loadBanxicoFix(admin, Date.now(), { cachedOnly: true }),
  ]);
  if (error) throw error;
  if (!settings) throw new Error('AI billing settings are missing.');

  return {
    centavos: estimateBalanceMxnCentavos(
      balance,
      String(settings.nano_usd_per_credit),
      fx.mxnPerUsdMicro
    ),
    fx_date: fx.date,
  };
}

export async function GET() {
  try {
    const { accountId, supabase } = await requireEntitlement(
      'ai_conversation_intelligence',
      'supervisor'
    );
    const now = new Date();
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
    ).toISOString();
    const [
      { data: wallet, error: walletError },
      { data: ledger, error: ledgerError },
      { data: monthlyUsageRows, error: monthlyUsageError },
    ] =
      await Promise.all([
        supabase
          .from('ai_credit_wallets')
          .select('available_credits,updated_at')
          .eq('account_id', accountId)
          .maybeSingle(),
        supabase
          .from('ai_credit_ledger')
          .select('id,entry_type,delta_credits,balance_after,created_at')
          .eq('account_id', accountId)
          .order('created_at', { ascending: false })
          .limit(50),
        supabase.rpc('account_ai_credit_monthly_usage_summary', {
          p_account_id: accountId,
          p_month_start: monthStart,
        }),
      ]);

    if (walletError) throw walletError;
    if (ledgerError) throw ledgerError;
    if (!wallet) throw new Error('AI credit wallet is missing for the account.');
    if (monthlyUsageError) {
      console.error(
        '[account credits] monthly usage summary failed:',
        monthlyUsageError
      );
    }

    const monthlyActivities = monthlyUsageError
      ? []
      : parseMonthlyUsageRows(monthlyUsageRows ?? []);
    let balanceMxnEstimate: Awaited<
      ReturnType<typeof getBalanceMxnEstimate>
    > | null = null;
    try {
      balanceMxnEstimate = await getBalanceMxnEstimate(
        String(wallet.available_credits)
      );
    } catch (error) {
      console.error(
        '[account credits] MXN balance estimate is unavailable:',
        error
      );
    }

    return NextResponse.json(
      {
        balance: String(wallet.available_credits),
        updated_at: wallet.updated_at,
        checkout_available: isStripeCheckoutConfigured(),
        monthly_usage: monthlyUsageError
          ? null
          : {
              month_start: monthStart,
              total_credits_used: sumCreditsUsed(monthlyActivities),
              activities: monthlyActivities,
            },
        monthly_usage_error: Boolean(monthlyUsageError),
        balance_mxn_estimate: balanceMxnEstimate,
        movements: (ledger ?? []).map((entry) => ({
          id: entry.id,
          entry_type: entry.entry_type,
          delta_credits: String(entry.delta_credits),
          balance_after: String(entry.balance_after),
          created_at: entry.created_at,
        })),
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}

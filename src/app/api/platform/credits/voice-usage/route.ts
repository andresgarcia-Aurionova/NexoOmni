import { NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';

import { toErrorResponse } from '@/lib/auth/account';
import { requirePlatformOperator } from '@/lib/platform/operator';
import {
  fetchZernioCallUsage,
  type ZernioProfileAccount,
} from '@/lib/zernio/call-usage';

type YeastarUsageRow = {
  account_id: string;
  calls: number | string;
  talk_duration_seconds: number | string;
  transcribed_calls: number | string;
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

function stringValue(value: unknown) {
  return value === null || value === undefined ? '0' : String(value);
}

export async function GET() {
  try {
    await requirePlatformOperator();

    const now = new Date();
    const since = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
    ).toISOString();
    const until = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)
    ).toISOString();
    const admin = adminClient();
    const [
      { data: yeastarRows, error: yeastarError },
      { data: profiles, error: profilesError },
    ] = await Promise.all([
      admin.rpc('platform_yeastar_call_usage_summary', {
        p_since: since,
        p_until: until,
      }),
      admin.from('zernio_profiles').select('account_id, profile_id'),
    ]);

    const databaseError = yeastarError ?? profilesError;
    if (databaseError) throw databaseError;

    const yeastar = ((yeastarRows ?? []) as YeastarUsageRow[]).map((row) => ({
      account_id: row.account_id,
      calls: stringValue(row.calls),
      talk_duration_seconds: stringValue(row.talk_duration_seconds),
      transcribed_calls: stringValue(row.transcribed_calls),
    }));

    if (!process.env.ZERNIO_API_KEY?.trim()) {
      return NextResponse.json({
        period: { since, until },
        yeastar,
        zernio: { status: 'not_configured' },
      });
    }

    try {
      const zernio = await fetchZernioCallUsage(
        since,
        until,
        (profiles ?? []) as ZernioProfileAccount[]
      );
      return NextResponse.json({
        period: { since, until },
        yeastar,
        zernio: { status: 'ready', ...zernio },
      });
    } catch (error) {
      console.error('[platform voice usage] Zernio query failed:', error);
      return NextResponse.json({
        period: { since, until },
        yeastar,
        zernio: { status: 'error' },
      });
    }
  } catch (error) {
    return toErrorResponse(error);
  }
}

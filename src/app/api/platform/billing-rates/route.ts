import { NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';

import { toErrorResponse } from '@/lib/auth/account';
import {
  loadBanxicoFix,
  parseMxnRate,
  saveManualFix,
} from '@/lib/billing/banxico-fx';
import { requirePlatformOperator } from '@/lib/platform/operator';
import { encrypt } from '@/lib/whatsapp/encryption';
import {
  checkRateLimit,
  RATE_LIMITS,
  rateLimitResponse,
} from '@/lib/rate-limit';

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

async function readSettings(admin: ReturnType<typeof adminClient>) {
  const { data, error } = await admin
    .from('ai_billing_settings')
    .select(
      'mxn_per_usd_micro, mxn_fx_date, mxn_fx_fetched_at, mxn_fx_source, call_minute_price_mxn_centavos, target_margin_basis_points, banxico_token_encrypted'
    )
    .eq('id', true)
    .maybeSingle();
  if (error || !data) throw error ?? new Error('Billing settings not found');
  return {
    mxn_per_usd: data.mxn_per_usd_micro
      ? Number(data.mxn_per_usd_micro) / 1_000_000
      : null,
    fx_date: data.mxn_fx_date as string | null,
    fx_fetched_at: data.mxn_fx_fetched_at as string | null,
    fx_source: data.mxn_fx_source as string | null,
    call_minute_price_mxn_centavos: Number(data.call_minute_price_mxn_centavos),
    target_margin_basis_points: Number(data.target_margin_basis_points),
    banxico_token_configured:
      Boolean(data.banxico_token_encrypted) ||
      Boolean(process.env.BANXICO_API_TOKEN),
    banxico_token_source: data.banxico_token_encrypted
      ? 'panel'
      : process.env.BANXICO_API_TOKEN
        ? 'env'
        : null,
  };
}

export async function GET() {
  try {
    await requirePlatformOperator();
    return NextResponse.json(await readSettings(adminClient()));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const operator = await requirePlatformOperator();
    const limit = checkRateLimit(
      `platform:billing-rates:${operator.user.id}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    const action = body?.action;
    const admin = adminClient();

    if (action === 'set_banxico_token' || action === 'clear_banxico_token') {
      const token =
        action === 'set_banxico_token' && typeof body?.token === 'string'
          ? body.token.trim()
          : null;
      if (action === 'set_banxico_token' && !/^[A-Za-z0-9]{32,128}$/.test(token ?? '')) {
        return NextResponse.json(
          { error: 'El token de Banxico no tiene un formato válido.' },
          { status: 400 }
        );
      }
      const { error } = await admin
        .from('ai_billing_settings')
        .update({
          banxico_token_encrypted: token ? encrypt(token) : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', true);
      if (error) throw error;
    } else if (action === 'refresh_fx') {
      try {
        await loadBanxicoFix(admin, Date.now(), { force: true });
      } catch {
        return NextResponse.json(
          {
            error:
              'No se pudo consultar Banxico. Revisa BANXICO_API_TOKEN o captura el tipo de cambio manualmente.',
          },
          { status: 502 }
        );
      }
    } else if (action === 'set_manual_fx') {
      const rate = parseMxnRate(body?.mxn_per_usd);
      if (!rate) {
        return NextResponse.json(
          {
            error:
              'Captura un tipo de cambio válido (entre 5 y 100 MXN por USD).',
          },
          { status: 400 }
        );
      }
      await saveManualFix(admin, rate);
    } else if (action === 'set_rates') {
      const centavos = body?.call_minute_price_mxn_centavos;
      const margin = body?.target_margin_basis_points;
      if (
        typeof centavos !== 'number' ||
        !Number.isInteger(centavos) ||
        centavos < 0 ||
        centavos > 100_000 ||
        typeof margin !== 'number' ||
        !Number.isInteger(margin) ||
        margin < 0 ||
        margin > 9999
      ) {
        return NextResponse.json(
          { error: 'Revisa el precio por minuto y el margen.' },
          { status: 400 }
        );
      }
      const { error } = await admin
        .from('ai_billing_settings')
        .update({
          call_minute_price_mxn_centavos: centavos,
          target_margin_basis_points: margin,
          updated_at: new Date().toISOString(),
        })
        .eq('id', true);
      if (error) throw error;
    } else {
      return NextResponse.json({ error: 'Acción no válida.' }, { status: 400 });
    }

    return NextResponse.json(await readSettings(admin));
  } catch (error) {
    return toErrorResponse(error);
  }
}

import type { SupabaseClient } from '@supabase/supabase-js';

import { isUniqueViolation } from '@/lib/contacts/dedupe';
import {
  calculateCallCharge,
  parseCallEnded,
  type CallBillingSettings,
} from './call-billing';

type BillingMode = 'off' | 'shadow' | 'enforced';

async function loadSettings(
  db: SupabaseClient
): Promise<(CallBillingSettings & { mode: BillingMode }) | null> {
  const { data, error } = await db
    .from('ai_billing_settings')
    .select(
      'billing_mode,target_margin_basis_points,nano_usd_per_credit,call_minute_price_mxn_centavos,mxn_per_usd_micro'
    )
    .eq('id', true)
    .maybeSingle();
  if (error || !data) {
    console.error('[zernio calls] could not read billing settings:', error);
    return null;
  }
  return {
    mode: data.billing_mode as BillingMode,
    targetMarginBasisPoints: BigInt(String(data.target_margin_basis_points)),
    nanoUsdPerCredit: BigInt(String(data.nano_usd_per_credit)),
    minutePriceMxnCentavos: BigInt(String(data.call_minute_price_mxn_centavos)),
    mxnPerUsdMicro:
      data.mxn_per_usd_micro === null || data.mxn_per_usd_micro === undefined
        ? null
        : BigInt(String(data.mxn_per_usd_micro)),
  };
}

/**
 * Records one WhatsApp call from Zernio's `call.ended` webhook, attributed to
 * the tenant that owns the connected WhatsApp number. Measurement only: no
 * wallet is debited. Calls from numbers we cannot tie to a connector are
 * skipped, and redelivery of the same call is ignored.
 */
export async function recordCallEnded(
  db: SupabaseClient,
  event: unknown,
  eventId: string | null
) {
  const call = parseCallEnded(event);
  if (!call) {
    console.warn('[zernio calls] call.ended payload is missing required fields.');
    return;
  }

  const { data: connector, error: connectorError } = await db
    .from('omnichannel_connectors')
    .select('id, account_id')
    .eq('provider', 'zernio_whatsapp')
    .eq('zernio_account_id', call.zernioAccountId)
    .maybeSingle();
  if (connectorError) throw connectorError;
  if (!connector) return;

  const settings = await loadSettings(db);
  if (!settings) return;
  const charge = calculateCallCharge(call, settings);

  const { error } = await db.from('call_usage_log').insert({
    account_id: connector.account_id,
    connector_id: connector.id,
    zernio_call_id: call.callId,
    zernio_event_id: eventId,
    zernio_account_id: call.zernioAccountId,
    phone_number_id: call.phoneNumberId,
    direction: call.direction,
    end_reason: call.endReason,
    started_at: call.startedAt,
    ended_at: call.endedAt,
    duration_seconds: call.durationSeconds,
    billable_minutes: charge.billableMinutes,
    zernio_cost_nano_usd: call.zernioCostNanoUsd.toString(),
    meta_cost_nano_usd: call.metaCostNanoUsd.toString(),
    connection_price_nano_usd: charge.connectionPriceNanoUsd.toString(),
    connection_credits: charge.connectionCredits.toString(),
    minute_price_mxn_centavos: Number(settings.minutePriceMxnCentavos),
    mxn_per_usd_micro: settings.mxnPerUsdMicro?.toString() ?? null,
    minute_credits: charge.minuteCredits?.toString() ?? null,
    billing_mode: settings.mode,
  });
  if (error && !isUniqueViolation(error)) throw error;
}

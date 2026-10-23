import type { SupabaseClient } from '@supabase/supabase-js';
import { loadBanxicoFix } from '@/lib/billing/banxico-fx';
import {
  calculateCallCharge,
  parseCallEnded,
  type CallBillingSettings,
} from './call-billing';
import { pauseZernioCallsForAccount } from './call-credit-pause';

async function loadSettings(
  db: SupabaseClient
): Promise<CallBillingSettings> {
  const { data, error } = await db
    .from('ai_billing_settings')
    .select(
      'billing_mode,target_margin_basis_points,nano_usd_per_credit,call_minute_price_mxn_centavos,call_connection_price_nano_usd'
    )
    .eq('id', true)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.billing_mode !== 'enforced') {
    throw new Error('Call usage billing is not enabled.');
  }
  return {
    targetMarginBasisPoints: BigInt(String(data.target_margin_basis_points)),
    nanoUsdPerCredit: BigInt(String(data.nano_usd_per_credit)),
    minutePriceMxnCentavos: BigInt(String(data.call_minute_price_mxn_centavos)),
    mxnPerUsdMicro: null,
    connectionPriceFloorNanoUsd: BigInt(
      String(data.call_connection_price_nano_usd ?? 0)
    ),
  };
}

/**
 * Bills one WhatsApp call from Zernio's `call.ended` webhook. The RPC writes
 * the usage row and ledger debit atomically, with the stable call id as the
 * idempotency key.
 */
export async function recordCallEnded(
  db: SupabaseClient,
  event: unknown,
  eventId: string | null
) {
  const call = parseCallEnded(event);
  if (!call) {
    throw new Error('Zernio call.ended payload is missing required billing fields.');
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
  const fx = await loadBanxicoFix(db);
  const callSettings = { ...settings, mxnPerUsdMicro: fx.mxnPerUsdMicro };
  const charge = calculateCallCharge(call, callSettings);
  if (charge.minutePriceNanoUsd === null || charge.minuteCredits === null) {
    throw new Error('Banxico exchange rate is required to bill call minutes.');
  }

  const totalCredits = charge.connectionCredits + charge.minuteCredits;
  const totalPriceNanoUsd =
    charge.connectionPriceNanoUsd + charge.minutePriceNanoUsd;
  const { data, error } = await db.rpc('record_whatsapp_call_and_debit', {
    p_account_id: connector.account_id,
    p_connector_id: connector.id,
    p_call_id: call.callId,
    p_event_id: eventId,
    p_zernio_account_id: call.zernioAccountId,
    p_phone_number_id: call.phoneNumberId,
    p_direction: call.direction,
    p_end_reason: call.endReason,
    p_started_at: call.startedAt,
    p_ended_at: call.endedAt,
    p_duration_seconds: call.durationSeconds,
    p_billable_minutes: charge.billableMinutes,
    p_zernio_cost_nano_usd: call.zernioCostNanoUsd.toString(),
    p_meta_cost_nano_usd: call.metaCostNanoUsd.toString(),
    p_connection_price_nano_usd: charge.connectionPriceNanoUsd.toString(),
    p_connection_credits: charge.connectionCredits.toString(),
    p_minute_price_mxn_centavos: Number(settings.minutePriceMxnCentavos),
    p_mxn_per_usd_micro: fx.mxnPerUsdMicro.toString(),
    p_minute_price_nano_usd: charge.minutePriceNanoUsd.toString(),
    p_minute_credits: charge.minuteCredits.toString(),
    p_total_credits: totalCredits.toString(),
    p_total_price_nano_usd: totalPriceNanoUsd.toString(),
  });
  if (error) throw error;
  const result = Array.isArray(data) ? data[0] : null;
  if (result?.result === 'insufficient_credits') {
    await pauseZernioCallsForAccount(
      db,
      connector.account_id,
      BigInt(String(result.available_credits))
    );
    console.error(
      `[zernio call billing] Call ${call.callId} for account ${connector.account_id} was recorded without a debit because the available balance could not cover its full charge.`
    );
    return;
  }
  if (
    !result ||
    !['debited', 'duplicate', 'recorded'].includes(result.result)
  ) {
    throw new Error('The database did not confirm the WhatsApp call debit.');
  }
}

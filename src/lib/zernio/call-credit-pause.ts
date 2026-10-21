import type { SupabaseClient } from '@supabase/supabase-js';

import { zernioFetch } from './server';

const PAUSE_RECHECK_INTERVAL_MS = 5 * 60_000;
const MAX_PAUSE_SYNCS_PER_TICK = 3;
const WORKER_TICK_MS = 20_000;

type JsonRecord = Record<string, unknown>;
type ZernioConnector = {
  zernio_account_id: string;
};
type PausedNumber = {
  account_id: string;
  phone_number_id: string;
  zernio_account_id: string;
  pause_reason: 'balance_exhausted' | 'insufficient_call_balance';
  balance_at_pause: number | string;
  paused_at: string;
};

type PauseReason = 'balance_exhausted' | 'insufficient_call_balance';

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function profileId(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value;
  if (!isRecord(value)) return null;
  const id = value._id ?? value.id;
  return typeof id === 'string' && id.trim() ? id : null;
}

function phoneId(value: JsonRecord): string | null {
  const id = value._id ?? value.id;
  return typeof id === 'string' && id.trim() ? id : null;
}

function rotatingBatch<T>(items: T[], size: number): T[] {
  if (items.length <= size) return items;
  const start =
    (Math.floor(Date.now() / WORKER_TICK_MS) * size) % items.length;
  return [
    ...items.slice(start, start + size),
    ...items.slice(0, Math.max(0, start + size - items.length)),
  ];
}

function accountIdForPhone(
  phone: JsonRecord,
  connectors: readonly ZernioConnector[]
): string {
  const explicitId = phone.accountId ?? phone.zernioAccountId;
  if (typeof explicitId === 'string' && explicitId.trim()) {
    if (!connectors.some((connector) => connector.zernio_account_id === explicitId)) {
      throw new Error('Zernio returned a phone number for an unlinked account.');
    }
    return explicitId;
  }
  if (connectors.length === 1) return connectors[0].zernio_account_id;
  throw new Error('A Zernio phone number could not be matched to its WhatsApp account.');
}

function callingPath(phoneNumberId: string, accountId: string): string {
  return `/phone-numbers/${encodeURIComponent(phoneNumberId)}/whatsapp/calling?${new URLSearchParams({ accountId })}`;
}

async function getCallingConfig(
  phoneNumberId: string,
  accountId: string
): Promise<JsonRecord> {
  const config = await zernioFetch(callingPath(phoneNumberId, accountId));
  if (!isRecord(config) || typeof config.callingEnabled !== 'boolean') {
    throw new Error('Zernio returned an invalid WhatsApp calling configuration.');
  }
  return config;
}

async function markPauseChecked(
  db: SupabaseClient,
  accountId: string,
  reason: PauseReason,
  balanceAtPause: bigint
) {
  const { error } = await db.from('ai_credit_call_pause_accounts').upsert(
    {
      account_id: accountId,
      last_checked_at: new Date().toISOString(),
      pause_reason: reason,
      balance_at_pause: balanceAtPause.toString(),
    },
    { onConflict: 'account_id' }
  );
  if (error) throw error;
}

async function loadZernioAccount(
  db: SupabaseClient,
  accountId: string
): Promise<{ profileId: string; connectors: ZernioConnector[] } | null> {
  const { data: profile, error: profileError } = await db
    .from('zernio_profiles')
    .select('profile_id')
    .eq('account_id', accountId)
    .maybeSingle();
  if (profileError) throw profileError;
  if (typeof profile?.profile_id !== 'string' || !profile.profile_id.trim()) {
    return null;
  }

  const { data: connectors, error: connectorError } = await db
    .from('omnichannel_connectors')
    .select('zernio_account_id')
    .eq('account_id', accountId)
    .eq('provider', 'zernio_whatsapp')
    .not('zernio_account_id', 'is', null);
  if (connectorError) throw connectorError;
  const linkedConnectors = (connectors ?? []).filter(
    (connector): connector is ZernioConnector =>
      typeof connector.zernio_account_id === 'string' &&
      connector.zernio_account_id.trim().length > 0
  );
  if (linkedConnectors.length === 0) {
    throw new Error('The Zernio profile has no linked WhatsApp account.');
  }

  return { profileId: profile.profile_id, connectors: linkedConnectors };
}

async function pauseCalls(
  db: SupabaseClient,
  accountId: string,
  force = false,
  reason: PauseReason = 'balance_exhausted',
  balanceAtPause = BigInt(0)
): Promise<void> {
  const pauseBalance =
    balanceAtPause > BigInt(0) ? balanceAtPause : BigInt(0);
  const { data: currentState, error: stateError } = await db
    .from('ai_credit_call_pause_accounts')
    .select('last_checked_at')
    .eq('account_id', accountId)
    .maybeSingle();
  if (stateError) throw stateError;
  const lastCheckedAt =
    typeof currentState?.last_checked_at === 'string'
      ? Date.parse(currentState.last_checked_at)
      : Number.NaN;
  if (
    !force &&
    Number.isFinite(lastCheckedAt) &&
    Date.now() - lastCheckedAt < PAUSE_RECHECK_INTERVAL_MS
  ) {
    return;
  }

  const linkedAccount = await loadZernioAccount(db, accountId);
  if (!linkedAccount) {
    await markPauseChecked(db, accountId, reason, pauseBalance);
    return;
  }

  const phonePayload = await zernioFetch('/phone-numbers');
  if (
    !isRecord(phonePayload) ||
    !Array.isArray(phonePayload.numbers) ||
    !Array.isArray(phonePayload.connected)
  ) {
    throw new Error('Zernio returned an invalid phone-number list.');
  }

  const phones = [...phonePayload.numbers, ...phonePayload.connected];
  for (const value of phones) {
    if (!isRecord(value)) {
      throw new Error('Zernio returned an invalid phone-number record.');
    }
    if (profileId(value.profileId) !== linkedAccount.profileId) continue;

    const id = phoneId(value);
    if (!id) {
      throw new Error('A linked Zernio phone number is missing its record ID.');
    }
    const zernioAccountId = accountIdForPhone(value, linkedAccount.connectors);
    const config = await getCallingConfig(id, zernioAccountId);
    if (!config.callingEnabled) continue;

    const { error: saveError } = await db
      .from('ai_credit_call_pause_numbers')
      .upsert(
        {
          account_id: accountId,
          phone_number_id: id,
          zernio_account_id: zernioAccountId,
          pause_reason: reason,
          balance_at_pause: pauseBalance.toString(),
        },
        { onConflict: 'account_id,phone_number_id' }
      );
    if (saveError) throw saveError;

    await zernioFetch(callingPath(id, zernioAccountId), { method: 'DELETE' });
  }

  await markPauseChecked(db, accountId, reason, pauseBalance);
  if (!force) {
    const { data: wallet, error: walletError } = await db
      .from('ai_credit_wallets')
      .select('available_credits')
      .eq('account_id', accountId)
      .maybeSingle();
    if (walletError) throw walletError;
    if (
      wallet &&
      BigInt(String(wallet.available_credits)) > BigInt(0)
    ) {
      await resumeCalls(db, accountId);
    }
  }
}

export function buildZernioCallingEnableRequest(
  config: JsonRecord,
  zernioAccountId: string
): JsonRecord {
  if (typeof config.forwardTo !== 'string' || !config.forwardTo.trim()) {
    throw new Error('Zernio did not return the saved call destination for reactivation.');
  }

  const request: JsonRecord = {
    accountId: zernioAccountId,
    forwardTo: config.forwardTo,
    recordingEnabled: config.recordingEnabled === true,
  };
  if (typeof config.sipAuthUsername === 'string') {
    request.sipAuthUsername = config.sipAuthUsername;
  }
  if (
    Array.isArray(config.callIconCountries) &&
    config.callIconCountries.every((country) => typeof country === 'string')
  ) {
    request.callIconCountries = config.callIconCountries;
  }
  if (
    typeof config.maxCallDurationSeconds === 'number' &&
    Number.isInteger(config.maxCallDurationSeconds)
  ) {
    request.maxCallDurationSeconds = config.maxCallDurationSeconds;
  }
  if (typeof config.forwardCallerId === 'string') {
    request.forwardCallerId = config.forwardCallerId;
  }
  return request;
}

async function resumeCalls(db: SupabaseClient, accountId: string): Promise<void> {
  const { data: pausedNumbers, error: numbersError } = await db
    .from('ai_credit_call_pause_numbers')
    .select('account_id,phone_number_id,zernio_account_id')
    .eq('account_id', accountId);
  if (numbersError) throw numbersError;

  for (const number of (pausedNumbers ?? []) as PausedNumber[]) {
    const config = await getCallingConfig(
      number.phone_number_id,
      number.zernio_account_id
    );
    if (!config.callingEnabled) {
      await zernioFetch(
        `/phone-numbers/${encodeURIComponent(number.phone_number_id)}/whatsapp/calling`,
        {
          method: 'POST',
          body: JSON.stringify(
            buildZernioCallingEnableRequest(config, number.zernio_account_id)
          ),
        }
      );
    }

    const { error: deleteError } = await db
      .from('ai_credit_call_pause_numbers')
      .delete()
      .eq('account_id', accountId)
      .eq('phone_number_id', number.phone_number_id);
    if (deleteError) throw deleteError;
  }

  const { error: stateError } = await db
    .from('ai_credit_call_pause_accounts')
    .delete()
    .eq('account_id', accountId);
  if (stateError) throw stateError;
}

export async function syncZernioCallsWithCreditBalance(
  db: SupabaseClient,
  accountId: string,
  availableCredits: bigint
): Promise<void> {
  if (availableCredits <= BigInt(0)) {
    await pauseCalls(db, accountId);
    return;
  }
  await resumeCalls(db, accountId);
}

export async function pauseZernioCallsForAccount(
  db: SupabaseClient,
  accountId: string,
  balanceAtPause: bigint
): Promise<void> {
  await pauseCalls(
    db,
    accountId,
    true,
    'insufficient_call_balance',
    balanceAtPause
  );
}

export async function processCreditCallPauses(
  db: SupabaseClient
): Promise<{ paused: number; resumed: number; failed: number }> {
  const now = Date.now();
  const recheckBefore = new Date(now - PAUSE_RECHECK_INTERVAL_MS).toISOString();
  const { data: wallets, error: walletError } = await db
    .from('ai_credit_wallets')
    .select('account_id,available_credits')
    .lte('available_credits', 0)
    .limit(1000);
  if (walletError) throw walletError;

  const { data: pauseAccounts, error: pauseAccountError } = await db
    .from('ai_credit_call_pause_accounts')
    .select('account_id,last_checked_at,pause_reason,balance_at_pause')
    .limit(1000);
  if (pauseAccountError) throw pauseAccountError;
  const { data: pausedNumbers, error: pausedNumbersError } = await db
    .from('ai_credit_call_pause_numbers')
    .select('account_id,paused_at,pause_reason,balance_at_pause')
    .limit(1000);
  if (pausedNumbersError) throw pausedNumbersError;

  const recentlyChecked = new Set(
    (pauseAccounts ?? [])
      .filter(
        (state) =>
          typeof state.last_checked_at === 'string' &&
          state.last_checked_at > recheckBefore
      )
      .map((state) => state.account_id)
  );
  const dueAccounts = (wallets ?? [])
    .filter((wallet) => !recentlyChecked.has(wallet.account_id))
    .sort((left, right) => left.account_id.localeCompare(right.account_id));
  const pauseBatch = rotatingBatch(dueAccounts, MAX_PAUSE_SYNCS_PER_TICK);

  let paused = 0;
  let resumed = 0;
  let failed = 0;
  await Promise.all(
    pauseBatch.map(async (wallet) => {
      try {
        await pauseCalls(db, wallet.account_id);
        paused++;
      } catch (error) {
        console.error(
          `[credit call pause] Could not pause calls for account ${wallet.account_id}:`,
          error
        );
        failed++;
      }
    })
  );

  const accountIds = [
    ...new Set([
      ...(pauseAccounts ?? []).map((state) => state.account_id),
      ...(pausedNumbers ?? []).map((number) => number.account_id),
    ]),
  ];
  if (accountIds.length > 0) {
    const { data: pausedWallets, error: pausedWalletError } = await db
      .from('ai_credit_wallets')
      .select('account_id,available_credits')
      .in('account_id', accountIds);
    if (pausedWalletError) throw pausedWalletError;

    const positiveWallets = (pausedWallets ?? []).filter(
      (item) => BigInt(String(item.available_credits)) > BigInt(0)
    );
    const resumeBatch = rotatingBatch(
      positiveWallets,
      MAX_PAUSE_SYNCS_PER_TICK
    );
    await Promise.all(
      resumeBatch.map(async (wallet) => {
        try {
          const accountPause = (pauseAccounts ?? []).find(
            (state) => state.account_id === wallet.account_id
          );
          const numberPause = (pausedNumbers ?? []).find(
            (number) => number.account_id === wallet.account_id
          );
          const pauseReason =
            accountPause?.pause_reason ?? numberPause?.pause_reason;
          if (pauseReason === 'balance_exhausted') {
            await resumeCalls(db, wallet.account_id);
            resumed++;
            return;
          }
          if (pauseReason !== 'insufficient_call_balance') return;

          const balanceAtPause =
            accountPause?.balance_at_pause ?? numberPause?.balance_at_pause;
          if (
            balanceAtPause === undefined ||
            BigInt(String(wallet.available_credits)) <= BigInt(String(balanceAtPause))
          ) {
            return;
          }

          await resumeCalls(db, wallet.account_id);
          resumed++;
        } catch (error) {
          console.error(
            `[credit call pause] Could not reactivate calls for account ${wallet.account_id}:`,
            error
          );
          failed++;
        }
      })
    );
  }

  return { paused, resumed, failed };
}

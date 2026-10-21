import { zernioFetch } from './server';

export type ZernioCallMetrics = {
  calls: number;
  answered: number;
  minutes: number;
  billable_usd: number;
  meta_usd: number;
};

export type ZernioProfileAccount = {
  account_id: string;
  profile_id: string;
};

export type MappedZernioCallUsage = {
  totals: ZernioCallMetrics;
  accounts: Array<ZernioCallMetrics & { account_id: string }>;
  unassigned: ZernioCallMetrics;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseMetrics(value: unknown, source: string): ZernioCallMetrics {
  if (!isRecord(value)) {
    throw new Error(`Zernio returned invalid ${source} call metrics.`);
  }

  const readNumber = (sourceField: string) => {
    const fieldValue = value[sourceField];
    if (
      typeof fieldValue !== 'number' ||
      !Number.isFinite(fieldValue) ||
      fieldValue < 0
    ) {
      throw new Error(`Zernio returned invalid ${source}.${sourceField}.`);
    }
    return fieldValue;
  };

  return {
    calls: readNumber('calls'),
    answered: readNumber('answered'),
    minutes: readNumber('minutes'),
    billable_usd: readNumber('billableUSD'),
    meta_usd: readNumber('metaUSD'),
  };
}

function normalizePhoneNumber(value: string) {
  const digits = value.replace(/\D/g, '');
  return digits.length > 0 ? digits : null;
}

function profileIdFromPhone(value: unknown) {
  if (typeof value === 'string' && value.trim()) return value;
  if (!isRecord(value)) return null;
  return typeof value._id === 'string' && value._id.trim()
    ? value._id
    : null;
}

function addMetrics(target: ZernioCallMetrics, source: ZernioCallMetrics) {
  target.calls += source.calls;
  target.answered += source.answered;
  target.minutes += source.minutes;
  target.billable_usd += source.billable_usd;
  target.meta_usd += source.meta_usd;
}

function emptyMetrics(): ZernioCallMetrics {
  return {
    calls: 0,
    answered: 0,
    minutes: 0,
    billable_usd: 0,
    meta_usd: 0,
  };
}

export function mapZernioCallUsage(
  usagePayload: unknown,
  phonePayload: unknown,
  profileAccounts: readonly ZernioProfileAccount[]
): MappedZernioCallUsage {
  if (!isRecord(usagePayload) || !Array.isArray(usagePayload.groups)) {
    throw new Error('Zernio returned an invalid grouped call-usage response.');
  }
  if (
    !isRecord(phonePayload) ||
    !Array.isArray(phonePayload.numbers) ||
    !Array.isArray(phonePayload.connected)
  ) {
    throw new Error('Zernio returned an invalid phone-number response.');
  }

  const totals = parseMetrics(usagePayload.totals, 'totals');
  const accountByProfile = new Map(
    profileAccounts.map(({ profile_id, account_id }) => [
      profile_id,
      account_id,
    ])
  );
  const accountsByNumber = new Map<string, Set<string>>();

  for (const phone of [...phonePayload.numbers, ...phonePayload.connected]) {
    if (!isRecord(phone)) {
      throw new Error('Zernio returned an invalid phone-number record.');
    }
    const profileId = profileIdFromPhone(phone.profileId);
    if (!profileId) continue;
    const accountId = accountByProfile.get(profileId);
    if (!accountId) continue;
    if (typeof phone.phoneNumber !== 'string') {
      throw new Error('Zernio returned a phone record without a phoneNumber.');
    }
    const number = normalizePhoneNumber(phone.phoneNumber);
    if (!number) {
      throw new Error('Zernio returned an invalid phoneNumber.');
    }
    const accountIds = accountsByNumber.get(number) ?? new Set<string>();
    accountIds.add(accountId);
    accountsByNumber.set(number, accountIds);
  }

  const accountTotals = new Map<string, ZernioCallMetrics>();
  const unassigned = emptyMetrics();

  for (const [index, group] of usagePayload.groups.entries()) {
    if (!isRecord(group) || typeof group.key !== 'string') {
      throw new Error(`Zernio returned an invalid call group at index ${index}.`);
    }
    const metrics = parseMetrics(group, `groups[${index}]`);
    const number = normalizePhoneNumber(group.key);
    const accountIds = number ? accountsByNumber.get(number) : undefined;

    if (accountIds?.size === 1) {
      const accountId = accountIds.values().next().value;
      if (typeof accountId !== 'string') {
        throw new Error('Could not resolve the Zernio account for a phone number.');
      }
      const accountMetrics = accountTotals.get(accountId) ?? emptyMetrics();
      addMetrics(accountMetrics, metrics);
      accountTotals.set(accountId, accountMetrics);
    } else {
      addMetrics(unassigned, metrics);
    }
  }

  return {
    totals,
    accounts: [...accountTotals.entries()]
      .map(([account_id, metrics]) => ({ account_id, ...metrics }))
      .sort((left, right) => left.account_id.localeCompare(right.account_id)),
    unassigned,
  };
}

export async function fetchZernioCallUsage(
  since: string,
  until: string,
  profileAccounts: readonly ZernioProfileAccount[]
) {
  const query = new URLSearchParams({
    since,
    until,
    groupBy: 'number',
  });
  const [phonePayload, usagePayload] = await Promise.all([
    zernioFetch('/phone-numbers'),
    zernioFetch(`/usage/calls?${query.toString()}`),
  ]);
  return mapZernioCallUsage(usagePayload, phonePayload, profileAccounts);
}

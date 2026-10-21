'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  CircleDollarSign,
  CreditCard,
  LoaderCircle,
  RefreshCw,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type { AiCreditUsageActivity } from '@/lib/ai/credit-usage-activities';
import {
  AI_CREDIT_PACKAGES,
  type AiCreditPackageId,
} from '@/lib/billing/stripe-credit-pricing';

const PACKAGE_NAME_KEYS: Record<
  AiCreditPackageId,
  | 'packageNames.entrepreneur'
  | 'packageNames.commercial_pro'
  | 'packageNames.corporate'
> = {
  entrepreneur: 'packageNames.entrepreneur',
  commercial_pro: 'packageNames.commercial_pro',
  corporate: 'packageNames.corporate',
};

type CreditMovement = {
  id: string;
  entry_type: 'purchase' | 'adjustment' | 'usage' | 'refund' | 'expiration';
  delta_credits: string;
  balance_after: string;
  created_at: string;
};

type MonthlyUsageActivity = {
  activity: AiCreditUsageActivity;
  operation_count: string;
  credits_used: string;
};

type CreditData = {
  balance: string;
  updated_at: string | null;
  checkout_available: boolean;
  movements: CreditMovement[];
  monthly_usage: {
    month_start: string;
    total_credits_used: string;
    activities: MonthlyUsageActivity[];
  } | null;
  monthly_usage_error: boolean;
  balance_mxn_estimate: {
    centavos: string;
    fx_date: string;
  } | null;
};

function formatCredits(value: string, locale: string): string {
  if (!/^-?\d+$/.test(value)) return '—';
  return new Intl.NumberFormat(locale).format(BigInt(value));
}

function formatDate(value: string, locale: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function formatFxDate(value: string, locale: string): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(date);
}

function formatMonth(value: string, locale: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function formatMxnCentavos(value: string, locale: string): string {
  if (!/^\d+$/.test(value)) return '—';
  const centavos = BigInt(value);
  if (centavos > BigInt(Number.MAX_SAFE_INTEGER)) return '—';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'MXN',
  }).format(Number(centavos) / 100);
}

export function AiCreditBalance() {
  const t = useTranslations('AiCredits');
  const locale = useLocale();
  const [data, setData] = useState<CreditData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [checkoutMessage, setCheckoutMessage] = useState<
    'success' | 'cancelled' | null
  >(null);
  const [purchasing, setPurchasing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/account/credits', {
        cache: 'no-store',
      });
      const payload = (await response.json().catch(() => null)) as
        | CreditData
        | { error?: string }
        | null;
      if (!response.ok) {
        throw new Error(
          payload && 'error' in payload && payload.error
            ? payload.error
            : t('loadError')
        );
      }
      if (
        !payload ||
        !('balance' in payload) ||
        !Array.isArray(payload.movements) ||
        !('checkout_available' in payload) ||
        !('monthly_usage' in payload) ||
        !('monthly_usage_error' in payload) ||
        !('balance_mxn_estimate' in payload)
      ) {
        throw new Error(t('loadError'));
      }
      setData(payload);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const checkout = new URLSearchParams(window.location.search).get('checkout');
    if (checkout === 'success' || checkout === 'cancelled') {
      setCheckoutMessage(checkout);
      if (checkout === 'success') {
        const timeout = window.setTimeout(() => void load(), 2_000);
        return () => window.clearTimeout(timeout);
      }
    }
  }, [load]);

  const startCheckout = useCallback(
    async (packageId: AiCreditPackageId) => {
      setPurchasing(true);
      setCheckoutError(null);
      try {
        const response = await fetch('/api/account/credits/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ package_id: packageId }),
        });
        const payload = (await response.json().catch(() => null)) as
          | { checkout_url?: unknown; error?: unknown }
          | null;
        if (!response.ok) {
          const code =
            payload && typeof payload.error === 'string'
              ? payload.error
              : '';
          const messageKey =
            code === 'STRIPE_CHECKOUT_UNAVAILABLE'
              ? 'checkout.unavailableError'
              : code === 'AI_CREDIT_PACKAGE_INVALID'
                ? 'checkout.packageError'
                : 'checkout.error';
          throw new Error(t(messageKey));
        }
        if (
          !payload ||
          typeof payload.checkout_url !== 'string' ||
          !/^https:\/\/checkout\.stripe\.com\//.test(payload.checkout_url)
        ) {
          throw new Error(t('checkout.error'));
        }
        window.location.assign(payload.checkout_url);
      } catch (reason) {
        setCheckoutError(
          reason instanceof Error ? reason.message : t('checkout.error')
        );
        setPurchasing(false);
      }
    },
    [t]
  );

  const formatUsd = (value: number) =>
    new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(value);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          {t('title')}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('description')}
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>{t('balanceTitle')}</CardTitle>
            <CardDescription>{t('balanceDescription')}</CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void load()}
            disabled={loading}
          >
            {loading ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            {t('refresh')}
          </Button>
        </CardHeader>
        <CardContent>
          {loading && !data ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" />
              {t('loading')}
            </div>
          ) : error ? (
            <p role="alert" className="py-4 text-sm text-destructive">
              {error}
            </p>
          ) : data ? (
            <div className="flex items-center gap-4">
              <CircleDollarSign className="size-10 text-primary" />
              <div>
                <p className="text-3xl font-semibold tabular-nums">
                  {formatCredits(data.balance, locale)}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t('creditsAvailable')}
                </p>
                {data.balance_mxn_estimate ? (
                  <div className="mt-2 text-sm text-muted-foreground">
                    <p>
                      {t('balanceMxnEstimate', {
                        amount: formatMxnCentavos(
                          data.balance_mxn_estimate.centavos,
                          locale
                        ),
                      })}
                    </p>
                    <p>
                      {t('balanceMxnFxDate', {
                        date: formatFxDate(
                          data.balance_mxn_estimate.fx_date,
                          locale
                        ),
                      })}
                    </p>
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {t('balanceMxnUnavailable')}
                  </p>
                )}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('rechargeTitle')}</CardTitle>
          <CardDescription>{t('rechargeDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {checkoutMessage ? (
            <p
              role="status"
              className="rounded-md border px-3 py-2 text-sm"
            >
              {t(
                checkoutMessage === 'success'
                  ? 'checkout.success'
                  : 'checkout.cancelled'
              )}
            </p>
          ) : null}
          {checkoutError ? (
            <p role="alert" className="text-sm text-destructive">
              {checkoutError}
            </p>
          ) : null}
          {!data?.checkout_available ? (
            <p className="text-sm text-muted-foreground">
              {t('checkout.unavailable')}
            </p>
          ) : (
            <div className="grid gap-3 md:grid-cols-3">
              {AI_CREDIT_PACKAGES.map((creditPackage) => (
                <div
                  key={creditPackage.id}
                  className="flex flex-col gap-3 rounded-lg border p-4"
                >
                  <div>
                    <h3 className="font-medium">
                      {t(PACKAGE_NAME_KEYS[creditPackage.id])}
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t('packageCredits', {
                        credits: formatCredits(
                          String(creditPackage.credits),
                          locale
                        ),
                      })}
                    </p>
                    <p className="mt-2 text-sm font-medium">
                      {formatUsd(creditPackage.usdAmount)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void startCheckout(creditPackage.id)}
                    disabled={
                      purchasing ||
                      loading ||
                      !data?.checkout_available
                    }
                  >
                    {purchasing ? (
                      <LoaderCircle className="animate-spin" />
                    ) : (
                      <CreditCard />
                    )}
                    {t('checkout.buy')}
                  </Button>
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {t('checkout.priceNotice')}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('monthlyUsageTitle')}</CardTitle>
          <CardDescription>
            {t('monthlyUsageDescription', {
              month: data?.monthly_usage
                ? formatMonth(data.monthly_usage.month_start, locale)
                : formatMonth(new Date().toISOString(), locale),
            })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data?.monthly_usage_error ? (
            <p role="alert" className="mb-4 text-sm text-destructive">
              {t('monthlyUsageError')}
            </p>
          ) : null}
          {!data?.monthly_usage_error && data?.monthly_usage ? (
            data.monthly_usage.activities.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">
                {t('monthlyUsageEmpty')}
              </p>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-4 rounded-md bg-muted/50 p-3 font-medium">
                  <span>{t('monthlyUsageTotal')}</span>
                  <span className="tabular-nums">
                    {formatCredits(
                      data.monthly_usage.total_credits_used,
                      locale
                    )}{' '}
                    {t('creditsUnit')}
                  </span>
                </div>
                <ul className="divide-y divide-border">
                  {data.monthly_usage.activities.map((activity) => (
                    <li
                      key={activity.activity}
                      className="flex items-center justify-between gap-4 py-3 text-sm"
                    >
                      <div>
                        <span>{t(`usageActivities.${activity.activity}`)}</span>
                        <p className="text-xs text-muted-foreground">
                          {formatCredits(activity.operation_count, locale)}{' '}
                          {t('operationsUnit')}
                        </p>
                      </div>
                      <span className="shrink-0 tabular-nums">
                        {formatCredits(activity.credits_used, locale)}{' '}
                        {t('creditsUnit')}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('historyTitle')}</CardTitle>
          <CardDescription>{t('historyDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          {error && data ? (
            <p role="alert" className="mb-4 text-sm text-destructive">
              {error}
            </p>
          ) : null}
          {!loading && data?.movements.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">
              {t('emptyHistory')}
            </p>
          ) : null}
          {data?.movements.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th scope="col" className="py-3 pr-4 font-medium">
                      {t('date')}
                    </th>
                    <th scope="col" className="py-3 pr-4 font-medium">
                      {t('movement')}
                    </th>
                    <th scope="col" className="py-3 pr-4 text-right font-medium">
                      {t('change')}
                    </th>
                    <th scope="col" className="py-3 text-right font-medium">
                      {t('balanceAfter')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.movements.map((movement) => {
                    const positive =
                      BigInt(movement.delta_credits) > BigInt(0);
                    const amount = formatCredits(
                      positive
                        ? movement.delta_credits
                        : movement.delta_credits.slice(1),
                      locale
                    );
                    return (
                      <tr
                        key={movement.id}
                        className="border-b border-border last:border-0"
                      >
                        <td className="py-3 pr-4 text-muted-foreground">
                          {formatDate(movement.created_at, locale)}
                        </td>
                        <td className="py-3 pr-4">
                          {t(`entries.${movement.entry_type}`)}
                        </td>
                        <td
                          className={`py-3 pr-4 text-right tabular-nums ${
                            positive ? 'text-emerald-600 dark:text-emerald-400' : ''
                          }`}
                        >
                          {positive ? '+' : '−'}
                          {amount}
                        </td>
                        <td className="py-3 text-right tabular-nums">
                          {formatCredits(movement.balance_after, locale)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">{t('rechargeHelp')}</p>
    </div>
  );
}

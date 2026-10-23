'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { LoaderCircle, RefreshCw, Save } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Rates = {
  mxn_per_usd: number | null;
  fx_date: string | null;
  fx_fetched_at: string | null;
  fx_source: string | null;
  call_minute_price_mxn_centavos: number;
  target_margin_basis_points: number;
  call_connection_price_usd: number;
  yeastar_transcription_cost_usd_per_minute: number | null;
  banxico_token_configured: boolean;
  banxico_token_source: 'panel' | 'env' | null;
};

const API_ERROR_KEYS = {
  BILLING_MIGRATION_PENDING: 'migrationPending',
  BILLING_MIGRATION_159_PENDING: 'migrationPending',
  BILLING_MIGRATION_171_PENDING: 'yeastarMigrationPending',
  BILLING_MIGRATION_174_PENDING: 'migrationPending',
  BANXICO_TOKEN_INVALID: 'tokenInvalid',
  BANXICO_TOKEN_MISSING: 'tokenMissing',
  BANXICO_TOKEN_UNREADABLE: 'tokenUnreadable',
  BANXICO_REFRESH_FAILED: 'refreshError',
  MANUAL_FX_INVALID: 'manualFxInvalid',
  BILLING_RATES_INVALID: 'ratesInvalid',
  YEASTAR_RATE_INVALID: 'yeastarRateInvalid',
  BILLING_ACTION_INVALID: 'error',
} as const;

export function BillingRatesPanel() {
  const t = useTranslations('PlatformBillingRates');
  const locale = useLocale();
  const [rates, setRates] = useState<Rates | null>(null);
  const [busy, setBusy] = useState(false);
  const [manualFx, setManualFx] = useState('');
  const [minutePrice, setMinutePrice] = useState('');
  const [margin, setMargin] = useState('');
  const [connectionPrice, setConnectionPrice] = useState('');
  const [yeastarRate, setYeastarRate] = useState('');
  const [token, setToken] = useState('');

  const apply = useCallback((json: Rates) => {
    setRates(json);
    setMinutePrice((json.call_minute_price_mxn_centavos / 100).toFixed(2));
    setMargin(String(json.target_margin_basis_points / 100));
    setConnectionPrice(String(json.call_connection_price_usd));
    setYeastarRate(
      json.yeastar_transcription_cost_usd_per_minute == null
        ? ''
        : String(json.yeastar_transcription_cost_usd_per_minute)
    );
  }, []);

  const call = useCallback(
    async (init?: RequestInit) => {
      setBusy(true);
      try {
        const response = await fetch('/api/platform/billing-rates', {
          cache: 'no-store',
          ...init,
        });
        // Un 404/5xx de un proxy o de una versión sin desplegar devuelve HTML.
        const json = await response.json().catch(() => null);
        if (!json) {
          throw new Error(
            t(response.status === 404 ? 'notDeployed' : 'badResponse', {
              status: response.status,
            })
          );
        }
        if (!response.ok) {
          const key =
            typeof json.error === 'string'
              ? API_ERROR_KEYS[json.error as keyof typeof API_ERROR_KEYS]
              : undefined;
          throw new Error(t(key ?? 'error'));
        }
        apply(json);
        return true;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t('error'));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [apply, t]
  );

  useEffect(() => {
    void call();
  }, [call]);

  const post = async (payload: Record<string, unknown>) => {
    const ok = await call({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (ok) toast.success(t('saved'));
    return ok;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-center gap-4 rounded-md border p-4">
          <div>
            <p className="text-muted-foreground text-xs">{t('currentFx')}</p>
            <p className="text-lg font-semibold">
              {rates?.mxn_per_usd
                ? `${new Intl.NumberFormat(locale, { minimumFractionDigits: 4 }).format(rates.mxn_per_usd)} MXN/USD`
                : '—'}
            </p>
            <p className="text-muted-foreground text-xs">
              {rates?.fx_date ?? '—'} ·{' '}
              {rates?.fx_source === 'manual'
                ? t('sourceManual')
                : (rates?.fx_source ?? '—')}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={busy || rates?.banxico_token_configured === false}
            onClick={() => void post({ action: 'refresh_fx' })}
          >
            {busy ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
            {t('refreshBanxico')}
          </Button>
          {rates?.banxico_token_configured === false && (
            <p className="text-xs text-amber-600">{t('tokenMissing')}</p>
          )}
        </div>

        <form
          className="flex flex-wrap items-end gap-3 rounded-md border p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void post({ action: 'set_banxico_token', token }).then(
              (ok) => ok && setToken('')
            );
          }}
        >
          <div className="min-w-72 flex-1 space-y-2">
            <Label htmlFor="banxico-token">{t('token')}</Label>
            <Input
              id="banxico-token"
              type="password"
              autoComplete="off"
              placeholder={
                rates?.banxico_token_source === 'panel'
                  ? t('tokenSavedPanel')
                  : rates?.banxico_token_source === 'env'
                    ? t('tokenSavedEnv')
                    : t('tokenPlaceholder')
              }
              value={token}
              onChange={(event) => setToken(event.target.value)}
              required
            />
          </div>
          <Button type="submit" disabled={busy}>
            <Save />
            {t('saveToken')}
          </Button>
          {rates?.banxico_token_source === 'panel' && (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void post({ action: 'clear_banxico_token' })}
            >
              {t('clearToken')}
            </Button>
          )}
          <p className="text-muted-foreground w-full text-xs">
            {t('tokenHelp')}
          </p>
        </form>

        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void post({ action: 'set_manual_fx', mxn_per_usd: manualFx }).then(
              (ok) => ok && setManualFx('')
            );
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="manual-fx">{t('manualFx')}</Label>
            <Input
              id="manual-fx"
              inputMode="decimal"
              placeholder="18.2500"
              value={manualFx}
              onChange={(event) => setManualFx(event.target.value)}
              required
            />
          </div>
          <Button type="submit" disabled={busy}>
            <Save />
            {t('saveManual')}
          </Button>
          <p className="text-muted-foreground w-full text-xs">
            {t('manualHint')}
          </p>
        </form>

        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void post({
              action: 'set_rates',
              call_minute_price_mxn_centavos: Math.round(
                Number(minutePrice) * 100
              ),
              target_margin_basis_points: Math.round(Number(margin) * 100),
              call_connection_price_usd: Number(connectionPrice),
            });
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="minute-price">{t('minutePrice')}</Label>
            <Input
              id="minute-price"
              type="number"
              min={0}
              step="0.01"
              value={minutePrice}
              onChange={(event) => setMinutePrice(event.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="margin">{t('margin')}</Label>
            <Input
              id="margin"
              type="number"
              min={0}
              max={99.99}
              step="0.01"
              value={margin}
              onChange={(event) => setMargin(event.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="connection-price">{t('connectionPrice')}</Label>
            <Input
              id="connection-price"
              type="number"
              min={0}
              max={10}
              step="0.01"
              value={connectionPrice}
              onChange={(event) => setConnectionPrice(event.target.value)}
              required
            />
          </div>
          <Button type="submit" disabled={busy}>
            <Save />
            {t('saveRates')}
          </Button>
        </form>

        <form
          className="flex flex-wrap items-end gap-3 rounded-md border p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void post({
              action: 'set_yeastar_transcription_rate',
              cost_usd_per_minute: Number(yeastarRate),
            });
          }}
        >
          <div className="min-w-56 space-y-2">
            <Label htmlFor="yeastar-transcription-rate">
              {t('yeastarTranscriptionRate')}
            </Label>
            <Input
              id="yeastar-transcription-rate"
              type="number"
              min="0.000001"
              max="100"
              step="0.000001"
              value={yeastarRate}
              onChange={(event) => setYeastarRate(event.target.value)}
              required
            />
          </div>
          <Button type="submit" disabled={busy}>
            <Save />
            {t('saveYeastarRate')}
          </Button>
          <p className="text-muted-foreground w-full text-xs">
            {t('yeastarRateHelp')}
          </p>
        </form>
      </CardContent>
    </Card>
  );
}

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
  banxico_token_configured: boolean;
};

export function BillingRatesPanel() {
  const t = useTranslations('PlatformBillingRates');
  const locale = useLocale();
  const [rates, setRates] = useState<Rates | null>(null);
  const [busy, setBusy] = useState(false);
  const [manualFx, setManualFx] = useState('');
  const [minutePrice, setMinutePrice] = useState('');
  const [margin, setMargin] = useState('');

  const apply = useCallback((json: Rates) => {
    setRates(json);
    setMinutePrice((json.call_minute_price_mxn_centavos / 100).toFixed(2));
    setMargin(String(json.target_margin_basis_points / 100));
  }, []);

  const call = useCallback(
    async (init?: RequestInit) => {
      setBusy(true);
      try {
        const response = await fetch('/api/platform/billing-rates', {
          cache: 'no-store',
          ...init,
        });
        const json = await response.json();
        if (!response.ok) throw new Error(json.error ?? t('error'));
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
          <Button type="submit" disabled={busy}>
            <Save />
            {t('saveRates')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

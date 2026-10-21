'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { CircleDollarSign, LoaderCircle, Plus, RefreshCw } from 'lucide-react';
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

type CreditAccount = {
  id: string;
  name: string;
  available_credits: string;
  updated_at: string | null;
};
type AiUsageMode =
  | 'auto_reply'
  | 'draft'
  | 'analysis'
  | 'report'
  | 'call_summary'
  | 'voice_transcription'
  | 'image_description'
  | 'embeddings'
  | 'credential_test';
type UsageRow = {
  account_id: string;
  mode: AiUsageMode;
  provider: 'openai' | 'anthropic';
  model: string;
  calls: string;
  prompt_tokens: string;
  completion_tokens: string;
  estimated_cost_nano_usd: string | null;
  estimated_credits: string | null;
  unpriced_calls: string;
};
type LedgerEntry = {
  id: string;
  account_id: string;
  entry_type: 'purchase' | 'adjustment' | 'usage' | 'refund' | 'expiration';
  delta_credits: string;
  balance_after: string;
  reason: string | null;
  usage_mode: AiUsageMode | null;
  source: string | null;
  actor_user_id: string | null;
  created_at: string;
};
type CreditData = {
  accounts: CreditAccount[];
  usage: UsageRow[];
  ledger: LedgerEntry[];
};
type VoiceMetric = {
  calls: number;
  answered: number;
  minutes: number;
  billable_usd: number;
  meta_usd: number;
};
type YeastarUsageRow = {
  account_id: string;
  calls: string;
  talk_duration_seconds: string;
  transcribed_calls: string;
};
type VoiceUsageData = {
  period: { since: string; until: string };
  yeastar: YeastarUsageRow[];
  zernio:
    | {
        status: 'ready';
        totals: VoiceMetric;
        accounts: Array<VoiceMetric & { account_id: string }>;
        unassigned: VoiceMetric;
      }
    | { status: 'not_configured' | 'error' };
};

function formatInteger(value: string | null | undefined, locale: string) {
  if (!value) return '—';
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(parsed)
    : '—';
}

function formatUsdNano(value: string | null, locale: string) {
  if (value === null) return '—';
  const parsed = Number(value) / 1_000_000_000;
  return Number.isFinite(parsed)
    ? new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 4,
      }).format(parsed)
    : '—';
}

function formatNumber(value: number, locale: string, maximumFractionDigits = 1) {
  return Number.isFinite(value)
    ? new Intl.NumberFormat(locale, { maximumFractionDigits }).format(value)
    : '—';
}

function formatUsd(value: number, locale: string) {
  return Number.isFinite(value)
    ? new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 4,
      }).format(value)
    : '—';
}

export function AiCreditsPanel({
  accounts: accountOptions,
}: {
  accounts: { id: string; name: string }[];
}) {
  const t = useTranslations('PlatformCredits');
  const locale = useLocale();
  const [data, setData] = useState<CreditData>({
    accounts: [],
    usage: [],
    ledger: [],
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [accountId, setAccountId] = useState('');
  const [credits, setCredits] = useState('');
  const [entryType, setEntryType] = useState<'purchase' | 'adjustment'>(
    'purchase'
  );
  const [reason, setReason] = useState('');
  const [pendingRequest, setPendingRequest] = useState<{
    signature: string;
    id: string;
  } | null>(null);
  const [voiceData, setVoiceData] = useState<VoiceUsageData | null>(null);
  const [voiceLoading, setVoiceLoading] = useState(false);
  const [voiceError, setVoiceError] = useState(false);

  const loadVoiceUsage = useCallback(async () => {
    setVoiceLoading(true);
    setVoiceError(false);
    try {
      const response = await fetch('/api/platform/credits/voice-usage', {
        cache: 'no-store',
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? t('voiceLoadError'));
      setVoiceData(json);
    } catch {
      setVoiceData(null);
      setVoiceError(true);
    } finally {
      setVoiceLoading(false);
    }
  }, [t]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = accountId
        ? `?account_id=${encodeURIComponent(accountId)}`
        : '';
      const response = await fetch(`/api/platform/credits${query}`, {
        cache: 'no-store',
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? t('loadError'));
      setData(json);
      setAccountId((current) => current || json.accounts?.[0]?.id || '');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('loadError'));
    } finally {
      setLoading(false);
    }
  }, [accountId, t]);

  useEffect(() => {
    if (accountOptions.length > 0) void load();
  }, [accountOptions.length, load]);

  useEffect(() => {
    if (accountOptions.length > 0) void loadVoiceUsage();
  }, [accountOptions.length, loadVoiceUsage]);

  const selectedAccount = data.accounts.find(
    (account) => account.id === accountId
  );
  const accountUsage = useMemo(
    () => data.usage.filter((row) => row.account_id === accountId),
    [data.usage, accountId]
  );
  const accountLedger = useMemo(
    () => data.ledger.filter((entry) => entry.account_id === accountId),
    [data.ledger, accountId]
  );
  const yeastarUsage = voiceData?.yeastar.find(
    (row) => row.account_id === accountId
  );
  const zernioUsage =
    voiceData?.zernio.status === 'ready'
      ? voiceData.zernio.accounts.find((row) => row.account_id === accountId)
      : undefined;
  const unassignedZernioUsage =
    voiceData?.zernio.status === 'ready'
      ? voiceData.zernio.unassigned
      : undefined;
  const providerLabels = {
    openai: t('providers.openai'),
    anthropic: t('providers.anthropic'),
  };
  const modeLabels: Record<AiUsageMode, string> = {
    auto_reply: t('modes.auto_reply'),
    draft: t('modes.draft'),
    analysis: t('modes.analysis'),
    report: t('modes.report'),
    call_summary: t('modes.call_summary'),
    voice_transcription: t('modes.voice_transcription'),
    image_description: t('modes.image_description'),
    embeddings: t('modes.embeddings'),
    credential_test: t('modes.credential_test'),
  };
  const entryLabels: Record<LedgerEntry['entry_type'], string> = {
    purchase: t('entries.purchase'),
    adjustment: t('entries.adjustment'),
    usage: t('entries.usage'),
    refund: t('entries.refund'),
    expiration: t('entries.expiration'),
  };

  const grantCredits = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!accountId) return;
    const signature = JSON.stringify({
      accountId,
      credits,
      entryType,
      reason: reason.trim(),
    });
    const requestId =
      pendingRequest?.signature === signature
        ? pendingRequest.id
        : crypto.randomUUID();
    setPendingRequest({ signature, id: requestId });
    setSaving(true);
    try {
      const response = await fetch('/api/platform/credits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_id: accountId,
          credits: Number(credits),
          entry_type: entryType,
          reason: reason.trim(),
          request_id: requestId,
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? t('grantError'));
      const expirationMessage =
        entryType === 'purchase' && typeof json.expires_at === 'string'
          ? ` ${t('purchaseExpirationRecorded', {
              date: new Intl.DateTimeFormat(locale, {
                dateStyle: 'medium',
              }).format(new Date(json.expires_at)),
            })}`
          : '';
      if (json.calls_reactivated === false) {
        toast.warning(
          `${json.message}${expirationMessage} ${t('callsPending')}`
        );
      } else {
        toast.success(`${json.message}${expirationMessage}`);
      }
      setCredits('');
      setReason('');
      setPendingRequest(null);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('grantError'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CircleDollarSign className="size-5" />
          {t('title')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm">
          {t('noDebitYet')}
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1 space-y-2">
            <Label htmlFor="ai-credit-account">{t('account')}</Label>
            <select
              id="ai-credit-account"
              className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
              value={accountId}
              onChange={(event) => setAccountId(event.target.value)}
              disabled={loading || data.accounts.length === 0}
            >
              {data.accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </div>
          <div className="rounded-md border px-4 py-2">
            <p className="text-muted-foreground text-xs">
              {t('availableBalance')}
            </p>
            <p className="font-semibold">
              {formatInteger(selectedAccount?.available_credits, locale)}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void load();
              void loadVoiceUsage();
            }}
            disabled={loading || voiceLoading}
          >
            {loading ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <RefreshCw />
            )}
            {t('refresh')}
          </Button>
        </div>

        <form
          onSubmit={grantCredits}
          className="grid gap-3 rounded-lg border p-4 md:grid-cols-[minmax(0,1fr)_180px_minmax(0,2fr)_auto] md:items-end"
        >
          <div className="space-y-2">
            <Label htmlFor="ai-credit-amount">{t('amount')}</Label>
            <Input
              id="ai-credit-amount"
              type="number"
              min={1}
              max={1_000_000_000_000}
              step={1}
              required
              value={credits}
              onChange={(event) => setCredits(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ai-credit-type">{t('entryType')}</Label>
            <select
              id="ai-credit-type"
              className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
              value={entryType}
              onChange={(event) =>
                setEntryType(event.target.value as 'purchase' | 'adjustment')
              }
            >
              <option value="purchase">{t('purchase')}</option>
              <option value="adjustment">{t('adjustment')}</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="ai-credit-reason">{t('reason')}</Label>
            <Input
              id="ai-credit-reason"
              maxLength={500}
              minLength={5}
              required
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={t('reasonPlaceholder')}
            />
          </div>
          <Button type="submit" disabled={saving || loading || !accountId}>
            {saving ? <LoaderCircle className="animate-spin" /> : <Plus />}
            {t('grant')}
          </Button>
          <p className="text-muted-foreground text-xs md:col-span-4">
            {t('stripePending')}
          </p>
          <p className="text-muted-foreground text-xs md:col-span-4">
            {t('expirationPolicy')}
          </p>
        </form>

        <div className="space-y-2">
          <h3 className="font-medium">{t('usageTitle')}</h3>
          <p className="text-muted-foreground text-xs">
            {t('usageDescription')}
          </p>
          {loading ? (
            <div className="flex justify-center py-5">
              <LoaderCircle className="text-muted-foreground animate-spin" />
            </div>
          ) : accountUsage.length === 0 ? (
            <p className="text-muted-foreground rounded-md border px-3 py-5 text-center text-sm">
              {t('noUsage')}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/50 text-muted-foreground text-xs">
                  <tr>
                    <th className="p-3">{t('task')}</th>
                    <th className="p-3">{t('providerModel')}</th>
                    <th className="p-3">{t('calls')}</th>
                    <th className="p-3">{t('credits')}</th>
                    <th className="p-3">{t('estimatedCost')}</th>
                    <th className="p-3">{t('unpriced')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {accountUsage.map((row) => (
                    <tr key={`${row.mode}:${row.provider}:${row.model}`}>
                      <td className="p-3">{modeLabels[row.mode]}</td>
                      <td className="p-3">
                        {providerLabels[row.provider]} · {row.model}
                      </td>
                      <td className="p-3">
                        {formatInteger(row.calls, locale)}
                      </td>
                      <td className="p-3">
                        {formatInteger(row.estimated_credits, locale)}
                      </td>
                      <td className="p-3">
                        {formatUsdNano(row.estimated_cost_nano_usd, locale)}
                      </td>
                      <td className="p-3">
                        {formatInteger(row.unpriced_calls, locale)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="space-y-3 border-t pt-5">
          <div>
            <h3 className="font-medium">{t('voiceTitle')}</h3>
            <p className="text-muted-foreground text-xs">
              {t('voiceDescription')}
            </p>
            {voiceData ? (
              <p className="text-muted-foreground text-xs">
                {t('voicePeriod', {
                  month: new Intl.DateTimeFormat(locale, {
                    month: 'long',
                    year: 'numeric',
                    timeZone: 'UTC',
                  }).format(new Date(voiceData.period.since)),
                })}
              </p>
            ) : null}
          </div>
          {voiceLoading ? (
            <div className="flex justify-center py-5">
              <LoaderCircle className="text-muted-foreground animate-spin" />
            </div>
          ) : voiceError ? (
            <p className="rounded-md border border-destructive/30 px-3 py-3 text-sm text-destructive">
              {t('voiceLoadError')}
            </p>
          ) : voiceData ? (
            <div className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2 rounded-md border p-3">
                  <h4 className="text-sm font-medium">{t('yeastarTitle')}</h4>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-muted-foreground text-xs">
                        {t('calls')}
                      </p>
                      <p className="font-medium">
                        {formatInteger(yeastarUsage?.calls ?? '0', locale)}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">
                        {t('talkMinutes')}
                      </p>
                      <p className="font-medium">
                        {formatNumber(
                          Number(yeastarUsage?.talk_duration_seconds ?? 0) / 60,
                          locale
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">
                        {t('transcribedCalls')}
                      </p>
                      <p className="font-medium">
                        {formatInteger(
                          yeastarUsage?.transcribed_calls ?? '0',
                          locale
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">
                        {t('yeastarCost')}
                      </p>
                      <p className="font-medium">{t('notCalculated')}</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-2 rounded-md border p-3">
                  <h4 className="text-sm font-medium">{t('zernioTitle')}</h4>
                  {voiceData.zernio.status === 'not_configured' ? (
                    <p className="text-muted-foreground text-sm">
                      {t('zernioNotConfigured')}
                    </p>
                  ) : voiceData.zernio.status === 'error' ? (
                    <p className="text-sm text-destructive">
                      {t('zernioLoadError')}
                    </p>
                  ) : (
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-muted-foreground text-xs">
                          {t('calls')}
                        </p>
                        <p className="font-medium">
                          {formatNumber(zernioUsage?.calls ?? 0, locale, 0)}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">
                          {t('answeredCalls')}
                        </p>
                        <p className="font-medium">
                          {formatNumber(zernioUsage?.answered ?? 0, locale, 0)}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">
                          {t('talkMinutes')}
                        </p>
                        <p className="font-medium">
                          {formatNumber(zernioUsage?.minutes ?? 0, locale)}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">
                          {t('zernioCost')}
                        </p>
                        <p className="font-medium">
                          {formatUsd(zernioUsage?.billable_usd ?? 0, locale)}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">
                          {t('metaCost')}
                        </p>
                        <p className="font-medium">
                          {formatUsd(zernioUsage?.meta_usd ?? 0, locale)}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              {voiceData.zernio.status === 'ready' &&
              ((unassignedZernioUsage?.calls ?? 0) > 0 ||
                (unassignedZernioUsage?.billable_usd ?? 0) > 0 ||
                (unassignedZernioUsage?.meta_usd ?? 0) > 0) ? (
                <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm">
                  {t('zernioUnassigned', {
                    calls: formatNumber(
                      unassignedZernioUsage?.calls ?? 0,
                      locale,
                      0
                    ),
                    cost: formatUsd(
                      unassignedZernioUsage?.billable_usd ?? 0,
                      locale
                    ),
                    metaCost: formatUsd(
                      unassignedZernioUsage?.meta_usd ?? 0,
                      locale
                    ),
                  })}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="space-y-2">
          <h3 className="font-medium">{t('ledgerTitle')}</h3>
          {accountLedger.length === 0 ? (
            <p className="text-muted-foreground rounded-md border px-3 py-5 text-center text-sm">
              {t('noLedger')}
            </p>
          ) : (
            <div className="max-h-72 divide-y overflow-y-auto rounded-md border">
              {accountLedger.map((entry) => (
                <div
                  key={entry.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-sm"
                >
                  <div>
                    <p className="font-medium">
                      {entryLabels[entry.entry_type]} ·{' '}
                      {entry.delta_credits.startsWith('-') ? '' : '+'}
                      {formatInteger(entry.delta_credits, locale)}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {entry.reason ??
                        (entry.source === 'zernio_whatsapp_call'
                          ? t('whatsappCallEntry')
                          : entry.usage_mode
                            ? t('aiUsageEntry', {
                                mode: modeLabels[entry.usage_mode],
                              })
                            : t('systemEntry'))}
                    </p>
                  </div>
                  <span className="text-muted-foreground text-xs">
                    {new Intl.DateTimeFormat(locale, {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    }).format(new Date(entry.created_at))}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { LoaderCircle, Save, Trash2 } from 'lucide-react';
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

type StripeMode = 'test' | 'live';
type Settings = {
  active_mode: StripeMode;
  checkout_enabled: boolean;
  test_secret_configured: boolean;
  test_webhook_configured: boolean;
  live_secret_configured: boolean;
  live_webhook_configured: boolean;
  updated_at: string;
};

type SecretFields = {
  test_secret_key: string;
  test_webhook_secret: string;
  live_secret_key: string;
  live_webhook_secret: string;
};

const EMPTY_SECRETS: SecretFields = {
  test_secret_key: '',
  test_webhook_secret: '',
  live_secret_key: '',
  live_webhook_secret: '',
};

const ERROR_KEYS: Record<string, string> = {
  STRIPE_SETTINGS_MIGRATION_PENDING: 'migrationPending',
  STRIPE_SETTINGS_INVALID: 'invalidSettings',
  STRIPE_MODE_INVALID: 'invalidMode',
  STRIPE_CHECKOUT_STATE_INVALID: 'invalidSettings',
  STRIPE_CREDENTIAL_INVALID: 'invalidCredential',
  STRIPE_TEST_API_KEY_INVALID: 'testApiKeyInvalid',
  STRIPE_LIVE_API_KEY_INVALID: 'liveApiKeyInvalid',
  STRIPE_WEBHOOK_SECRET_INVALID: 'webhookSecretInvalid',
  STRIPE_LIVE_CONFIRMATION_REQUIRED: 'liveConfirmationRequired',
  STRIPE_ACTIVE_CREDENTIALS_REQUIRED: 'activeCredentialsRequired',
  STRIPE_ACTIVE_CREDENTIALS_INVALID: 'activeCredentialsInvalid',
  STRIPE_SETTINGS_CREDENTIALS_UNREADABLE: 'credentialsUnreadable',
  STRIPE_APP_URL_INVALID: 'appUrlInvalid',
};

function isSettings(value: unknown): value is Settings {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    (record.active_mode === 'test' || record.active_mode === 'live') &&
    typeof record.checkout_enabled === 'boolean' &&
    typeof record.test_secret_configured === 'boolean' &&
    typeof record.test_webhook_configured === 'boolean' &&
    typeof record.live_secret_configured === 'boolean' &&
    typeof record.live_webhook_configured === 'boolean' &&
    typeof record.updated_at === 'string'
  );
}

export function StripeSettingsPanel() {
  const t = useTranslations('PlatformStripeSettings');
  const [settings, setSettings] = useState<Settings | null>(null);
  const [activeMode, setActiveMode] = useState<StripeMode>('test');
  const [checkoutEnabled, setCheckoutEnabled] = useState(false);
  const [secrets, setSecrets] = useState<SecretFields>(EMPTY_SECRETS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch('/api/platform/stripe-settings', {
        cache: 'no-store',
      });
      const payload: unknown = await response.json().catch(() => null);
      const errorCode =
        payload && typeof payload === 'object' && 'error' in payload
          ? String(payload.error)
          : '';
      if (!response.ok) {
        throw new Error(t(ERROR_KEYS[errorCode] ?? 'loadError'));
      }
      if (!isSettings(payload)) throw new Error(t('loadError'));
      setSettings(payload);
      setActiveMode(payload.active_mode);
      setCheckoutEnabled(payload.checkout_enabled);
    } catch (error) {
      const message = error instanceof Error ? error.message : t('loadError');
      setLoadError(message);
      toast.error(message);
      setSettings(null);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (
    event: React.FormEvent<HTMLFormElement>,
    extra: Record<string, boolean> = {}
  ) => {
    event.preventDefault();
    if (activeMode === 'live' && checkoutEnabled) {
      if (!window.confirm(t('confirmLive'))) return;
    }

    setSaving(true);
    try {
      const response = await fetch('/api/platform/stripe-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          active_mode: activeMode,
          checkout_enabled: checkoutEnabled,
          confirm_live_activation: activeMode === 'live' && checkoutEnabled,
          ...secrets,
          ...extra,
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      const errorCode =
        payload && typeof payload === 'object' && 'error' in payload
          ? String(payload.error)
          : '';
      if (!response.ok) {
        throw new Error(t(ERROR_KEYS[errorCode] ?? 'saveError'));
      }
      if (!isSettings(payload)) throw new Error(t('saveError'));
      setSettings(payload);
      setSecrets(EMPTY_SECRETS);
      toast.success(t('saved'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('saveError'));
    } finally {
      setSaving(false);
    }
  };

  const clearMode = async (
    mode: StripeMode,
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    event.preventDefault();
    if (!window.confirm(t('confirmClear', { mode: t(mode) }))) return;
    if (!settings) return;

    setSaving(true);
    const clearingActiveMode = activeMode === mode;
    const nextEnabled = clearingActiveMode ? false : checkoutEnabled;
    try {
      const response = await fetch('/api/platform/stripe-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          active_mode: activeMode,
          checkout_enabled: nextEnabled,
          [`clear_${mode}_credentials`]: true,
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      const errorCode =
        payload && typeof payload === 'object' && 'error' in payload
          ? String(payload.error)
          : '';
      if (!response.ok) {
        throw new Error(t(ERROR_KEYS[errorCode] ?? 'saveError'));
      }
      if (!isSettings(payload)) throw new Error(t('saveError'));
      setSettings(payload);
      setCheckoutEnabled(payload.checkout_enabled);
      setSecrets(EMPTY_SECRETS);
      toast.success(t('cleared', { mode: t(mode) }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('saveError'));
    } finally {
      setSaving(false);
    }
  };

  const modeReady = (mode: StripeMode) => {
    if (!settings) return false;
    return mode === 'test'
      ? settings.test_secret_configured && settings.test_webhook_configured
      : settings.live_secret_configured && settings.live_webhook_configured;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {loading ? (
          <div className="flex justify-center py-6">
            <LoaderCircle className="text-muted-foreground animate-spin" />
          </div>
        ) : settings ? (
          <>
            <p className="text-muted-foreground rounded-md border px-3 py-3 text-sm">
              {t('centralStorage')}
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              {(['test', 'live'] as const).map((mode) => (
                <section key={mode} className="space-y-3 rounded-md border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-medium">{t(mode)}</h3>
                      <p className="text-muted-foreground text-xs">
                        {modeReady(mode) ? t('configured') : t('incomplete')}
                      </p>
                    </div>
                    {settings[`${mode}_secret_configured`] ||
                    settings[`${mode}_webhook_configured`] ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={(event) => void clearMode(mode, event)}
                        disabled={saving}
                      >
                        <Trash2 />
                        {t('clear')}
                      </Button>
                    ) : null}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`stripe-${mode}-api-key`}>
                      {t('apiKey')}
                    </Label>
                    <Input
                      id={`stripe-${mode}-api-key`}
                      type="password"
                      autoComplete="new-password"
                      value={secrets[`${mode}_secret_key`]}
                      onChange={(event) =>
                        setSecrets((current) => ({
                          ...current,
                          [`${mode}_secret_key`]: event.target.value,
                        }))
                      }
                      placeholder={
                        settings[`${mode}_secret_configured`]
                          ? t('stored')
                          : t('apiKeyPlaceholder')
                      }
                      maxLength={8192}
                      disabled={saving}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`stripe-${mode}-webhook-secret`}>
                      {t('webhookSecret')}
                    </Label>
                    <Input
                      id={`stripe-${mode}-webhook-secret`}
                      type="password"
                      autoComplete="new-password"
                      value={secrets[`${mode}_webhook_secret`]}
                      onChange={(event) =>
                        setSecrets((current) => ({
                          ...current,
                          [`${mode}_webhook_secret`]: event.target.value,
                        }))
                      }
                      placeholder={
                        settings[`${mode}_webhook_configured`]
                          ? t('stored')
                          : t('webhookPlaceholder')
                      }
                      maxLength={1024}
                      disabled={saving}
                    />
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {t('modeHelp', { mode: t(mode) })}
                  </p>
                </section>
              ))}
            </div>

            <form onSubmit={(event) => void save(event)} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="stripe-active-mode">{t('activeMode')}</Label>
                  <select
                    id="stripe-active-mode"
                    className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
                    value={activeMode}
                    onChange={(event) =>
                      setActiveMode(event.target.value as StripeMode)
                    }
                    disabled={saving}
                  >
                    <option value="test">{t('test')}</option>
                    <option value="live">{t('live')}</option>
                  </select>
                </div>
                <label className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={checkoutEnabled}
                    onChange={(event) =>
                      setCheckoutEnabled(event.target.checked)
                    }
                    disabled={saving}
                  />
                  <span>{t('enableCheckout')}</span>
                </label>
              </div>
              {activeMode === 'live' ? (
                <p className="rounded-md border border-amber-500/50 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-300">
                  {t('liveWarning')}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" disabled={saving}>
                  {saving ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <Save />
                  )}
                  {t('save')}
                </Button>
                <p className="text-muted-foreground text-xs">
                  {t('blankKeepsSaved')}
                </p>
              </div>
            </form>
            <p className="text-muted-foreground text-xs">
              {t('updatedAt', {
                date: new Date(settings.updated_at).toLocaleString(),
              })}
            </p>
          </>
        ) : (
          <div className="space-y-3">
            <p className="text-muted-foreground text-sm">
              {loadError ?? t('loadError')}
            </p>
            <Button type="button" variant="outline" onClick={() => void load()}>
              {t('retry')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

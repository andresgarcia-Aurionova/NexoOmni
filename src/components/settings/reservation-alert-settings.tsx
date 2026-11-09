'use client';

import { useEffect, useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

type Settings = { enabled: boolean; templateName: string; templateLanguage: string; recipientPhones: string[] };

export function ReservationAlertSettings() {
  const t = useTranslations('Settings.reservationAlert');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [phones, setPhones] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [templateLanguage, setTemplateLanguage] = useState('');

  useEffect(() => {
    fetch('/api/telephony/reservation-alert')
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const { settings } = (await response.json()) as { settings: Settings };
        setEnabled(settings.enabled);
        setPhones(settings.recipientPhones.map((phone) => `+${phone}`).join(', '));
        setTemplateName(settings.templateName);
        setTemplateLanguage(settings.templateLanguage);
      })
      .catch(() => toast.error(t('loadError')))
      .finally(() => setLoading(false));
  }, [t]);

  async function save() {
    setSaving(true);
    try {
      const response = await fetch('/api/telephony/reservation-alert', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, recipientPhones: phones, templateName, templateLanguage }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || t('saveError'));
      setPhones((body.settings as Settings).recipientPhones.map((phone) => `+${phone}`).join(', '));
      toast.success(t('saved'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('saveError'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <>
            <div className="flex items-center gap-3">
              <Switch id="reservation-alert-enabled" checked={enabled} onCheckedChange={setEnabled} />
              <Label htmlFor="reservation-alert-enabled">{t('enabled')}</Label>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reservation-alert-phones">{t('phones')}</Label>
              <Input id="reservation-alert-phones" value={phones} onChange={(event) => setPhones(event.target.value)} placeholder="+52 55 1234 5678" />
              <p className="text-xs text-muted-foreground">{t('phonesHint')}</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="reservation-alert-template">{t('templateName')}</Label>
                <Input id="reservation-alert-template" value={templateName} onChange={(event) => setTemplateName(event.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reservation-alert-language">{t('templateLanguage')}</Label>
                <Input id="reservation-alert-language" value={templateLanguage} onChange={(event) => setTemplateLanguage(event.target.value)} />
              </div>
            </div>
            <Button onClick={save} disabled={saving}>
              {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Save className="mr-2 size-4" />}
              {t('save')}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

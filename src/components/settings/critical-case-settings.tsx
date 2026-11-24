'use client';

import { useEffect, useState } from 'react';
import { Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

type Sede = { name: string; phones: string[] };
type Settings = { enabled: boolean; templateName: string; templateLanguage: string; defaultPhones: string[]; sedes: Sede[] };
type SedeDraft = { key: number; name: string; phones: string };

const formatPhones = (phones: string[]) => phones.map((phone) => `+${phone}`).join(', ');
let nextKey = 0;
const toDrafts = (sedes: Sede[]): SedeDraft[] => sedes.map((sede) => ({ key: nextKey++, name: sede.name, phones: formatPhones(sede.phones) }));

export function CriticalCaseSettings() {
  const t = useTranslations('CriticalCases.settings');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [templateLanguage, setTemplateLanguage] = useState('');
  const [defaultPhones, setDefaultPhones] = useState('');
  const [sedes, setSedes] = useState<SedeDraft[]>([]);

  function apply(settings: Settings) {
    setEnabled(settings.enabled);
    setTemplateName(settings.templateName);
    setTemplateLanguage(settings.templateLanguage);
    setDefaultPhones(formatPhones(settings.defaultPhones));
    setSedes(toDrafts(settings.sedes));
  }

  useEffect(() => {
    fetch('/api/critical-cases/settings')
      .then(async (response) => {
        if (!response.ok) throw new Error();
        apply(((await response.json()) as { settings: Settings }).settings);
      })
      .catch(() => toast.error(t('loadError')))
      .finally(() => setLoading(false));
  }, [t]);

  async function save() {
    setSaving(true);
    try {
      const response = await fetch('/api/critical-cases/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled, templateName, templateLanguage, defaultPhones,
          sedes: sedes.map((sede) => ({ name: sede.name, phones: sede.phones })),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || t('saveError'));
      apply(body.settings as Settings);
      toast.success(t('saved'));
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : t('saveError'));
    } finally {
      setSaving(false);
    }
  }

  const updateSede = (key: number, patch: Partial<SedeDraft>) =>
    setSedes((current) => current.map((sede) => (sede.key === key ? { ...sede, ...patch } : sede)));

  return (
    <Card className="mt-6">
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
              <Switch id="critical-case-enabled" checked={enabled} onCheckedChange={setEnabled} />
              <Label htmlFor="critical-case-enabled">{t('enabled')}</Label>
            </div>
            <p className="text-xs text-muted-foreground">{t('levelsHint')}</p>
            <div className="space-y-1.5">
              <Label htmlFor="critical-case-default-phones">{t('defaultPhones')}</Label>
              <Input id="critical-case-default-phones" value={defaultPhones} onChange={(event) => setDefaultPhones(event.target.value)} placeholder="+52 55 1234 5678" />
              <p className="text-xs text-muted-foreground">{t('defaultPhonesHint')}</p>
            </div>
            <div className="space-y-2">
              <Label>{t('sedes')}</Label>
              <p className="text-xs text-muted-foreground">{t('sedesHint')}</p>
              {sedes.map((sede, index) => (
                <div key={sede.key} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]">
                  <Input aria-label={t('sedeName', { index: index + 1 })} value={sede.name} onChange={(event) => updateSede(sede.key, { name: event.target.value })} placeholder={t('sedeNamePlaceholder')} />
                  <Input aria-label={t('sedePhones', { index: index + 1 })} value={sede.phones} onChange={(event) => updateSede(sede.key, { phones: event.target.value })} placeholder="+52 55 1234 5678" />
                  <Button type="button" variant="ghost" size="icon" aria-label={t('removeSede')} onClick={() => setSedes((current) => current.filter((item) => item.key !== sede.key))}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={() => setSedes((current) => [...current, { key: nextKey++, name: '', phones: '' }])}>
                <Plus className="mr-2 size-4" />
                {t('addSede')}
              </Button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="critical-case-template">{t('templateName')}</Label>
                <Input id="critical-case-template" value={templateName} onChange={(event) => setTemplateName(event.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="critical-case-language">{t('templateLanguage')}</Label>
                <Input id="critical-case-language" value={templateLanguage} onChange={(event) => setTemplateLanguage(event.target.value)} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{t('templateHint')}</p>
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

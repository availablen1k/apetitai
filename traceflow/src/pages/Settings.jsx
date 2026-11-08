import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Save, Loader2, ExternalLink } from 'lucide-react';
import { api } from '@/api/client';
import PageHeader from '@/components/PageHeader';
import AuditTrail from '@/components/AuditTrail';
import SourceBadge from '@/components/SourceBadge';
import { useI18n } from '@/lib/i18n';
import { useToast } from '@/components/ui/use-toast';
import TargetEditor from '@/components/decisions/TargetEditor';

const FIELDS = [
  { key: 'manual_minutes_per_record', fi: 'Manuaaliset minuutit / rivi', en: 'Manual minutes per record', step: '0.5' },
  { key: 'automated_seconds_per_record', fi: 'Automaatin sekunnit / rivi', en: 'Automated seconds per record', step: '0.5' },
  { key: 'hourly_cost_eur', fi: 'Tuntikustannus (EUR)', en: 'Hourly cost (EUR)', step: '1' },
  { key: 'review_minutes_per_issue', fi: 'Katselmoinnin minuutit / havainto', en: 'Review minutes per finding', step: '0.5' },
];

export default function Settings() {
  const { t, lang } = useI18n();
  const fi = lang === 'fi';
  const { toast } = useToast();
  const qc = useQueryClient();
  const health = useQuery({ queryKey: ['health'], queryFn: api.health });
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);

  const settingsQ = useQuery({
    queryKey: ['app-settings'],
    queryFn: async () => (await api.docs('app_settings', { sort: '-created_date', limit: 1 }))[0] || null,
  });

  const sourcesQ = useQuery({
    queryKey: ['source-registry'],
    queryFn: api.sourceRegistry,
  });

  useEffect(() => {
    if (settingsQ.data && (!form || settingsQ.data.id !== form.id)) setForm(settingsQ.data);
    if (settingsQ.data === null && !form) setForm({ org_name: 'Apetit Oyj' });
  }, [settingsQ.data, form]);

  const save = async () => {
    if (!form) return;
    setBusy(true);
    try {
      const payload = { ...form };
      delete payload.id;
      delete payload.created_date;
      delete payload.updated_date;
      delete payload.created_by_id;
      if (form.id) await api.updateDoc('app_settings', form.id, payload);
      else await api.createDoc('app_settings', payload);
      qc.invalidateQueries();
      toast({ title: fi ? 'Asetukset tallennettu' : 'Settings saved' });
    } catch (e) {
      toast({ title: fi ? 'Tallennus ei onnistunut' : 'Could not save', description: e.message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const sources = sourcesQ.data || [];

  return (
    <div>
      <PageHeader
        eyebrow={t('app.name')}
        title={t('settings.title')}
        description={t('settings.subtitle')}
        actions={
          <button
            onClick={save}
            disabled={busy || !form}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#1B4968] px-4 py-2 text-[12.5px] font-medium text-[#EFF6FC] disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            {t('common.save')}
          </button>
        }
      />

      <TargetEditor />
      <div className="mt-5 grid grid-cols-1 gap-3.5 lg:grid-cols-3">
        <section className="surface p-5">
          <h2 className="font-heading text-[16px]">{t('settings.assumptions')}</h2>
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
            {fi ? 'Nämä oletukset muuttavat aikasäästön ja riskikynnysten laskentaa.' : 'These assumptions drive the time-saving estimate and risk thresholds.'}
          </p>
          <div className="mt-3 space-y-2.5">
            <label className="block">
              <span className="eyebrow">{fi ? 'Organisaatio' : 'Organisation'}</span>
              <input
                value={form?.org_name || ''}
                onChange={(e) => setForm({ ...form, org_name: e.target.value })}
                className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 text-[12.5px]"
              />
            </label>
            {FIELDS.map((f) => (
              <label key={f.key} className="block">
                <span className="eyebrow">{fi ? f.fi : f.en}</span>
                <input
                  type="number"
                  step={f.step}
                  value={form?.[f.key] ?? ''}
                  onChange={(e) => setForm({ ...form, [f.key]: e.target.value === '' ? null : Number(e.target.value) })}
                  className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 text-[12.5px]"
                />
              </label>
            ))}
          </div>
        </section>

        <section className="surface p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="font-heading text-[16px]">{t('settings.sources')}</h2>
            <SourceBadge type="imported" />
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-[11.5px]">
              <thead className="text-muted-foreground">
                <tr className="border-b border-border text-left">
                  <th className="py-2 pr-3 font-medium">{t('common.source')}</th>
                  <th className="py-2 pr-3 font-medium">{fi ? 'Käyttö' : 'Used for'}</th>
                  <th className="py-2 pr-3 font-medium">{fi ? 'Lisenssi' : 'Licence'}</th>
                  <th className="py-2 font-medium">{fi ? 'Viite' : 'Reference'}</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((s) => (
                  <tr key={s.id} className="border-b border-border/60 last:border-0">
                    <td className="py-1.5 pr-3 font-medium">{s.source}</td>
                    <td className="py-1.5 pr-3 text-muted-foreground">{s.used_for || s.category || '—'}</td>
                    <td className="py-1.5 pr-3 text-muted-foreground">{s.licence || '—'}</td>
                    <td className="py-1.5">
                      {s.url ? (
                        <a href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[#2E7099] hover:underline">
                          {fi ? 'Avaa' : 'Open'} <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
                {!sources.length && (
                  <tr><td colSpan={4} className="py-4 text-center text-muted-foreground">{t('common.none')}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <div className="mt-3.5 grid grid-cols-1 gap-3.5 lg:grid-cols-2">
        <details className="surface self-start p-5" data-testid="system-information">
          <summary className="cursor-pointer font-heading text-[16px]">{fi ? 'Järjestelmän tiedot' : 'System information'}</summary>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {fi ? 'Ei kirjautumista eikä rooleja: sovellus on tarkoitettu vain tälle koneelle (127.0.0.1). Tarkastajan nimi kirjoitetaan hyväksynnän yhteydessä, eikä sitä todenneta.' : 'No login and no roles: the app is meant for this machine only (127.0.0.1). The reviewer name is typed at approval time and is not verified.'}
          </p>
          <dl className="mt-3 space-y-1 text-[12px]">
            {[
              [fi ? 'Tietokanta' : 'Database', health.data?.database?.path],
              [fi ? 'Migraatiot' : 'Migrations', (health.data?.database?.migrations || []).join(', ')],
              ['Gemini', health.data?.ai?.configured ? health.data.ai.model : `${fi ? 'ei käytössä' : 'not configured'} (${health.data?.ai?.reason || '—'})`],
              [fi ? 'Reititys' : 'Routing', `${health.data?.routing?.provider || '—'} · HERE ${health.data?.routing?.here_configured ? (fi ? 'käytössä' : 'configured') : fi ? 'ei käytössä' : 'not configured'}`],
              [fi ? 'Sääntöversio' : 'Rules version', health.data?.rules_version],
              [fi ? 'Menetelmä' : 'Method', health.data?.method_version],
              [fi ? 'Sovellusversio' : 'App version', health.data?.version],
            ].map(([k, v]) => (
              <div key={k} className="flex flex-wrap justify-between gap-x-3 gap-y-1 border-b border-border/50 py-1.5"><dt className="text-muted-foreground">{k}</dt><dd className="max-w-full break-all text-right font-mono text-[11px]">{v || '—'}</dd></div>
            ))}
          </dl>
        </details>

        <section className="surface p-5">
          <h2 className="font-heading text-[16px]">{t('settings.audit')}</h2>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {fi ? 'Jokainen korjaus, laskenta ja automaatio kirjataan.' : 'Every correction, calculation and automation is recorded.'}
          </p>
          <div className="mt-3">
            <AuditTrail limit={8} />
          </div>
        </section>
      </div>
    </div>
  );
}

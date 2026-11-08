import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Play, Loader2, Workflow, Clock3 } from 'lucide-react';
import { api } from '@/api/client';
import PageHeader from '@/components/PageHeader';
import StatusPill from '@/components/StatusPill';
import SourceBadge from '@/components/SourceBadge';
import { useI18n } from '@/lib/i18n';
import { nf, shortDate } from '@/lib/format';
import { useToast } from '@/components/ui/use-toast';
import LiveDemoPanel from '@/components/LiveDemoPanel';
import useReportingYear from '@/lib/useReportingYear';

const WORKFLOWS = [
  {
    id: 'data_intake',
    fi: 'Uuden vastuullisuusdatan käsittely',
    en: 'New sustainability data intake',
    triggerFi: 'Käsin (Aja-painike)',
    triggerEn: 'Manual (Run button)',
    descFi: 'Ajaa laatusäännöt kaikkiin tuotuihin riveihin ja nostaa uudet havainnot Poikkeamat-välilehdelle. Alkuperäiset rivit eivät muutu.',
    descEn: 'Runs the quality rules on all imported rows and lifts new findings to the review queue. Source rows are not changed.',
  },
  {
    id: 'reporting',
    fi: 'Raportointikauden sulkeminen',
    en: 'Reporting period close',
    triggerFi: 'Käsin (Aja-painike)',
    triggerEn: 'Manual (Run button)',
    descFi: 'Luo uuden tallennetun laskelman valitulle vuodelle. Aiemmat laskelmat säilyvät.',
    descEn: 'Creates a new saved calculation for the selected year. Earlier calculations are kept.',
  },
];

const TONE = { success: 'ok', partial: 'review', failed: 'error', running: 'running' };

export default function Automations() {
  const { t, lang } = useI18n();
  const fi = lang === 'fi';
  const { toast } = useToast();
  const qc = useQueryClient();
  const overview = useQuery({ queryKey: ['overview'], queryFn: () => api.overview() });
  const { year, years, setYear } = useReportingYear(overview.data);
  const [busy, setBusy] = useState(null);
  const [expanded, setExpanded] = useState(null);

  const runs = useQuery({
    queryKey: ['automation-runs'],
    queryFn: () => api.docs('automation_runs', { sort: '-created_date', limit: 30 }),
  });

  const run = async (id) => {
    setBusy(id);
    try {
      const res = { data: await api.runAutomation(id, year) };
      qc.invalidateQueries();
      setExpanded(res.data?.run?.id || null);
      toast({
        title: fi ? 'Työnkulku ajettu' : 'Workflow ran',
        description: `${res.data?.run?.records_processed ?? 0} ${fi ? 'riviä' : 'records'}, ${res.data?.run?.exceptions ?? 0} ${fi ? 'poikkeamaa' : 'exceptions'}`,
      });
    } catch (e) {
      toast({ title: fi ? 'Ajo epäonnistui' : 'Run failed', description: e.message, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const history = runs.data || [];

  return (
    <div>
      <PageHeader eyebrow={t('app.name')} title={t('automations.title')} description={t('automations.subtitle')} actions={<label className="text-[12px] text-muted-foreground">{fi ? 'Vuosi' : 'Year'} <select value={year} onChange={(event) => setYear(event.target.value)} data-testid="automation-year" className="rounded-full border border-border bg-card px-3 py-2">{years.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>} />

      <LiveDemoPanel year={year} />

      <div className="mb-3.5 rounded-xl border border-border bg-secondary/40 px-3 py-2.5 text-[11.5px] text-muted-foreground">
        {fi ? 'Alla olevat yksittäiset työnkulut käynnistyvät Aja-painikkeesta. Yllä oleva live-demo suorittaa tuonnin, tarkistuksen ja laskennan yhdellä painalluksella.' : 'The individual workflows below start when you press Run. The live demo above performs import, checks and calculation with one button.'}
      </div>

      <section className="mb-4 grid grid-cols-1 gap-3.5 lg:grid-cols-3">
        {WORKFLOWS.map((w) => {
          const last = history.find((r) => r.workflow_id === w.id);
          return (
            <article key={w.id} className="surface flex flex-col p-5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#EAF3FB]">
                    <Workflow className="h-4 w-4 text-[#2E7099]" />
                  </span>
                  <h2 className="font-heading text-[15px] leading-tight">{fi ? w.fi : w.en}</h2>
                </div>
                {last && <StatusPill tone={TONE[last.status] || 'new'}>{t(`automations.status.${last.status}`)}</StatusPill>}
              </div>
              <p className="mt-2 flex-1 text-[11.5px] leading-relaxed text-muted-foreground">{fi ? w.descFi : w.descEn}</p>
              <p className="mt-2 flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
                <Clock3 className="h-3 w-3" /> {fi ? w.triggerFi : w.triggerEn}
              </p>
              {last && (
                <p className="mt-1 text-[10.5px] text-muted-foreground">
                  {t('automations.lastRun')}: {shortDate(last.started_at)} · {nf(last.records_processed)} {fi ? 'riviä' : 'records'} · {nf(last.exceptions)} {fi ? 'poikkeamaa' : 'exceptions'}
                </p>
              )}
              <button
                onClick={() => run(w.id)}
                disabled={busy === w.id}
                className="mt-3 inline-flex items-center justify-center gap-1.5 rounded-full bg-[#1B4968] px-3.5 py-2 text-[12px] font-medium text-[#EFF6FC] disabled:opacity-60"
              >
                {busy === w.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                {t('automations.run')}
              </button>
            </article>
          );
        })}
      </section>

      <section className="surface p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-heading text-[17px]">{t('automations.history')}</h2>
          <SourceBadge type="synthetic" />
        </div>
        {runs.isLoading ? (
          <p className="text-[13px] text-muted-foreground">{t('common.loading')}</p>
        ) : !history.length ? (
          <p className="text-[13px] text-muted-foreground">{fi ? 'Ei ajoja vielä.' : 'No runs yet.'}</p>
        ) : (
          <ul className="space-y-1.5">
            {history.map((r) => (
              <li key={r.id} className="rounded-xl border border-border/70">
                <button
                  onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                  className="flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-left"
                >
                  <span className="min-w-0">
                    <span className="block text-[12.5px] font-medium leading-tight">
                      {fi ? r.workflow_name : r.workflow_name_en || r.workflow_name}
                    </span>
                    <span className="text-[10.5px] text-muted-foreground">
                      {shortDate(r.started_at)} · {nf(r.duration_ms)} ms · {nf(r.records_processed)} {fi ? 'riviä' : 'records'} · {nf(r.exceptions)} {fi ? 'poikkeamaa' : 'exceptions'}
                    </span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    {r.time_saved_min ? <span className="text-[10.5px] text-muted-foreground">−{nf(r.time_saved_min)} min</span> : null}
                    <StatusPill tone={TONE[r.status] || 'new'}>{t(`automations.status.${r.status}`)}</StatusPill>
                  </span>
                </button>
                {expanded === r.id && (
                  <div className="border-t border-border/70 px-3 py-2.5">
                    <ol className="space-y-1">
                      {((fi ? r.log : r.log_en || r.log) || []).map((l, i) => (
                        <li key={i} className="font-mono text-[10.5px] leading-relaxed text-muted-foreground">{l}</li>
                      ))}
                    </ol>
                    {r.output_ref && (
                      <p className="mt-2 text-[11px] font-medium text-[#1E5578]">
                        {fi ? r.output_ref : r.output_ref_en || r.output_ref}
                      </p>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

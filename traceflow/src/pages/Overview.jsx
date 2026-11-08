import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Upload, ShieldAlert } from 'lucide-react';
import { api } from '@/api/client';
import { useI18n } from '@/lib/i18n';
import useReportingYear from '@/lib/useReportingYear';
import { amount, periodLink } from '@/lib/decisions';
import { catLabel } from '@/lib/categories';
import { datasetName } from '@/lib/reviewLanguage';
import PageHeader from '@/components/PageHeader';
import TargetProgress from '@/components/decisions/TargetProgress';
import RootCauseButton from '@/components/assistant/RootCauseButton';
import ExplainButton from '@/components/assistant/ExplainButton';

const pct = (v, lang) => v == null ? '—' : `${new Intl.NumberFormat(lang === 'fi' ? 'fi-FI' : 'en-GB', { maximumFractionDigits: Math.abs(v) < 10 ? 1 : 0 }).format(v)} %`;
const link = 'inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#2E7099] hover:underline';

function Standing({ data, year, lang }) {
  const fi = lang === 'fi'; const run = data.run; const s = data.standing;
  if (!run || !s) return <section className="surface p-5 sm:p-6" data-testid="overview-inventory">
    <p className="text-[11px] font-medium text-muted-foreground">{year}</p>
    <h2 className="mt-2 font-heading text-[21px]">{fi ? 'Vuodelle ei ole tallennettua laskelmaa' : 'No saved calculation for this year'}</h2>
    <div className="mt-4 flex flex-wrap gap-4"><Link to={periodLink('/sustainability', year)} className={link}>{fi ? 'Laske päästöt' : 'Calculate the footprint'}<ArrowRight className="h-3.5 w-3.5" /></Link><Link to={periodLink('/data-quality?tab=import', year)} className={link}>{fi ? 'Lisää tiedostoja' : 'Upload files'}<ArrowRight className="h-3.5 w-3.5" /></Link></div>
  </section>;
  const p = s.previous; const t = s.trust;
  const footprint = periodLink('/sustainability', year, { run: run.id });
  return <section className="surface p-5 sm:p-6" data-testid="overview-inventory">
    <p className="text-[11px] font-medium text-muted-foreground">{year} · {fi ? 'Hiilijalanjälki' : 'Carbon footprint'}</p>
    <p className="mt-2 text-[30px] font-semibold tracking-tight text-[#1B4968]" data-ai-context={JSON.stringify({ run_id: run.id, year, metric: 'grand_total', label: fi ? 'Hiilijalanjälki' : 'Carbon footprint' })}>{amount(s.grand_total, lang)} <span className="text-[12px] font-normal">tCO₂e</span></p>
    {p && <p className="mt-1 text-[12px] text-muted-foreground" data-testid="overview-change">{p.comparable
      ? <>{p.change_tco2e >= 0 ? '+' : ''}{amount(p.change_tco2e, lang)} tCO₂e{p.change_pct != null && ` (${p.change_pct >= 0 ? '+' : ''}${pct(p.change_pct, lang)})`} {fi ? `vs. ${p.year}` : `vs ${p.year}`}</>
      : fi ? `Ei vertailukelpoinen vuoden ${p.year} kanssa (eri laskentatapa tai Scope 2 -perusta).` : `Not comparable with ${p.year} (different method or Scope 2 basis).`}</p>}
    <ul className="mt-5 space-y-3" data-testid="overview-drivers">{s.drivers.map((d) => <li key={`${d.scope}|${d.category}`} data-ai-context={JSON.stringify({ run_id: run.id, category: d.category, year, label: catLabel(d.category, lang) })}>
      <div className="mb-1 flex justify-between gap-3 text-[12px]"><span>{catLabel(d.category, lang)}</span><span className="tabular-nums"><strong>{pct(d.share_pct, lang)}</strong> · {amount(d.tco2e, lang)} tCO₂e</span></div>
      <div className="h-2 rounded-full bg-secondary"><div className="h-2 rounded-full bg-[#2E7099]" style={{ width: `${Math.min(100, Math.max(1, d.share_pct || 0))}%` }} /></div>
    </li>)}</ul>
    {(t.open_issue_tco2e > 0 || t.missing_activity.length > 0) && <p className="mt-5 flex items-start gap-2 text-[12px] leading-relaxed" data-testid="overview-trust"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#996222]" /><span>
      {t.open_issue_tco2e > 0 && <>{fi ? `${pct(t.open_issue_share_pct, lang)} luvusta perustuu tietoihin, joissa on avoin poikkeama` : `${pct(t.open_issue_share_pct, lang)} of this total rests on records with open incidents`}{t.critical_incidents > 0 && ` · ${t.critical_incidents} ${fi ? 'kriittistä' : 'critical'}`}. <Link to={periodLink('/data-quality', year)} className="font-semibold text-[#2E7099] hover:underline">{fi ? 'Korjaa' : 'Fix'} →</Link> </>}
      {t.missing_activity.length > 0 && <span title={t.missing_activity.map((d) => datasetName(d, lang)).join(', ')}>{fi ? `Tuomatta: ${t.missing_activity.length} tietolajia.` : `Not imported: ${t.missing_activity.length} data types.`} <Link to={periodLink('/data-quality?tab=import', year)} className="font-semibold text-[#2E7099] hover:underline">{fi ? 'Lisää' : 'Upload'} →</Link></span>}
    </span></p>}
    <div className="mt-5 flex flex-wrap items-center gap-4"><ExplainButton context={{ run_id: run.id, year, metric: 'grand_total', label: fi ? 'Hiilijalanjälki' : 'Carbon footprint' }} /><Link to={footprint} className={link}>{fi ? 'Avaa jalanjälki' : 'Open the footprint'}<ArrowRight className="h-3.5 w-3.5" /></Link></div>
  </section>;
}

function NextSteps({ year, lang, hasRun }) {
  const fi = lang === 'fi';
  const feed = useQuery({ queryKey: ['discovery', year, lang], queryFn: () => api.discovery(year, lang), refetchInterval: 5000, enabled: hasRun });
  if (!hasRun) return null;
  const d = feed.data; const open = (d?.findings || []).filter((f) => f.state === 'open');
  // The trust line and the source list already cover exposure and driver-size findings.
  const steps = open.filter((f) => f.kind !== 'open_issue_exposure' && f.effect?.basis !== 'driver_size');
  const all = periodLink('/actions#findings', year);
  return <section className="surface mt-5 overflow-hidden" data-testid="overview-next-steps">
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border p-5"><h2 className="font-heading text-[21px]">{fi ? 'Mitä tehdä seuraavaksi' : 'What to do next'}</h2>{open.length > steps.slice(0, 3).length && <Link to={all} className={link}>{fi ? `Kaikki löydökset (${open.length})` : `All findings (${open.length})`}<ArrowRight className="h-3.5 w-3.5" /></Link>}</div>
    {feed.error && <p role="alert" className="p-5 text-[12px] text-[#8C3B2E]">{feed.error.message}</p>}
    {d && !steps.length && <p className="p-5 text-[12.5px] text-muted-foreground">{d.pending ? (fi ? 'Tietoja tarkastellaan…' : 'Reviewing the data…') : <Link to={all} className={link}>{fi ? 'Etsi seuraavat askeleet' : 'Find next steps'}<ArrowRight className="h-3.5 w-3.5" /></Link>}</p>}
    <div className="grid divide-y divide-border/70 lg:grid-cols-3 lg:divide-x lg:divide-y-0">{steps.slice(0, 3).map((f) => {
      const e = f.effect; const scenario = ['what_if', 'recomputed'].includes(e.basis);
      const to = f.facts?.lever_id ? periodLink('/actions', year, { action: f.facts.lever_id, run: d.run?.calc_run_id }) : f.action.to;
      return <article key={f.key} className="flex min-w-0 flex-col p-5" data-testid="overview-finding" data-ai-context={JSON.stringify({ finding_key: f.key, year, label: f.found.slice(0, 240) })}>
        <p className="break-words text-[14px] font-medium leading-relaxed">{f.found}</p>
        <p className="mt-2 break-words text-[12.5px] leading-relaxed text-muted-foreground">{f.suggest}</p>
        <p className="mt-3 text-[12px]"><strong className="tabular-nums">{e.tco2e === null ? (fi ? 'Ei laskettu' : 'Not quantified') : `${scenario && e.tco2e > 0 ? '+' : ''}${amount(e.tco2e, lang)} tCO₂e`}</strong> <span className="text-muted-foreground">· {e.note?.[lang]}</span></p>
        <div className="mt-auto flex flex-wrap items-center gap-3 pt-4"><Link to={to} className={link} data-testid="overview-finding-action">{f.facts?.lever_id ? (fi ? 'Arvioi toimenpide' : 'Assess the measure') : f.action.label[lang]}<ArrowRight className="h-3.5 w-3.5" /></Link><ExplainButton context={{ finding_key: f.key, year, label: f.found.slice(0, 240) }} />{f.facts?.issue_id && <RootCauseButton issue={{ id: f.facts.issue_id, year }} />}</div>
      </article>;
    })}</div>
  </section>;
}

export default function Overview() {
  const { lang } = useI18n(); const fi = lang === 'fi';
  const overview = useQuery({ queryKey: ['overview'], queryFn: () => api.overview(), refetchInterval: 5000 });
  const { year, years, setYear } = useReportingYear(overview.data);
  const query = useQuery({ queryKey: ['decision-workspace', year], queryFn: () => api.decisionWorkspace({ year }), refetchInterval: 10000 });
  const data = query.data;
  return <div>
    <PageHeader title={fi ? 'Missä olemme ja mitä tehdä seuraavaksi' : 'Where you stand and what to do next'} actions={<div className="flex flex-wrap items-center gap-2"><select value={year} onChange={(e) => setYear(e.target.value)} aria-label={fi ? 'Raportointivuosi' : 'Reporting year'} className="rounded-full border border-border bg-card px-3 py-2 text-[12px]" data-testid="overview-year">{years.map((y) => <option key={y} value={y}>{y}</option>)}</select><Link to={periodLink('/data-quality?tab=import', year)} className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-[12px]"><Upload className="h-3.5 w-3.5" />{fi ? 'Lisää tiedostoja' : 'Upload files'}</Link></div>} />
    {(query.error || overview.error) && <p role="alert" className="surface p-5 text-[13px] text-[#8C3B2E]">{query.error?.message || overview.error?.message}</p>}
    {query.isLoading && <p role="status" className="py-5 text-[13px] text-muted-foreground">{fi ? 'Ladataan…' : 'Loading…'}</p>}
    {data && <>
      <div className="grid items-start gap-4 xl:grid-cols-3"><div className="xl:col-span-2"><Standing data={data} year={year} lang={lang} /></div><TargetProgress data={data} /></div>
      <NextSteps year={year} lang={lang} hasRun={!!data.run} />
    </>}
  </div>;
}

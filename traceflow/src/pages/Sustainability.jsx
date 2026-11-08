import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Loader2, Download, Search, CheckCircle2, XCircle } from 'lucide-react';
import { api } from '@/api/client';
import PageHeader from '@/components/PageHeader';
import StatusPill from '@/components/StatusPill';
import ScenarioSimulator from '@/components/sustainability/ScenarioSimulator';
import TrendChart from '@/components/sustainability/TrendChart';
import FootprintSources from '@/components/decisions/FootprintSources';
import { periodLink } from '@/lib/decisions';
import FootprintFlow from '@/components/sustainability/FootprintFlow';
import { useI18n } from '@/lib/i18n';
import { nf, shortDate, tco2 } from '@/lib/format';
import { catLabel, runLines, scopeName } from '@/lib/categories';
import { useToast } from '@/components/ui/use-toast';
import useReportingYear from '@/lib/useReportingYear';

export function RunHistory({ runs, selected, onSelect, fi }) {
  if (!runs.length) return null;
  return (
    <div className="surface overflow-hidden">
      <div className="border-b border-border px-4 py-2.5 text-[12px] font-medium">{fi ? 'Laskenta-ajot (muuttumattomat)' : 'Calculation runs (immutable)'}</div>
      <ul className="max-h-[260px] divide-y divide-border/60 overflow-y-auto text-[11.5px]">
        {runs.map((r) => (
          <li key={r.id}>
            <button onClick={() => onSelect(r.id)} className={`flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-secondary/40 ${selected === r.id ? 'bg-secondary/60' : ''}`}>
              <span className="font-mono text-[10.5px]">{r.id.slice(0, 16)}</span>
              <span className="text-muted-foreground">{shortDate(r.created_at)} {r.created_at.slice(11, 16)}</span>
              <span className="text-muted-foreground">{r.scope2_basis}</span>
              <span className="ml-auto numeral">{tco2(r.totals.grand_total, 0)} t</span>
              <span className="text-muted-foreground">{r.correction_ids.length} {fi ? 'korj.' : 'corr.'}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Contributions({ runId, category, fi, year }) {
  const [q, setQ] = useState('');
  const [offset,setOffset]=useState(0);
  useEffect(()=>setOffset(0),[q,category,runId]);
  const c = useQuery({ queryKey: ['contribs', runId, category, q,offset], queryFn: () => api.contributions(runId, { category, q, limit: 25,offset }), enabled: !!runId && !!category });
  if (!category) return null;
  return (
    <div className="mt-3 rounded-xl border border-border bg-secondary/20 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-medium">{fi ? 'Suurimmat rivit' : 'Largest contributions'} · {catLabel(category, fi ? 'fi' : 'en')}</span>
        <span className="text-[11px] text-muted-foreground">{c.data ? `${nf(c.data.total)} ${fi ? 'riviä' : 'rows'}` : ''}</span>
        <div className="relative ml-auto">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={fi ? 'Hae' : 'Search'} className="rounded-full border border-border bg-card py-1 pl-7 pr-2 text-[11.5px]" />
        </div>
      </div>
      <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-[11.5px]">
        <tbody>
          {(c.data?.items || []).map((x) => (
            <tr key={x.id} className="border-t border-border/50">
              <td className="max-w-[260px] truncate py-1.5 pr-2 font-mono text-[10.5px]" title={x.line_item}>{x.line_item}</td>
              <td className="py-1.5 pr-2 text-muted-foreground">{x.factor_id}</td>
              <td className="py-1.5 pr-2"><StatusPill tone={x.value_status === 'original' ? 'ok' : x.value_status === 'corrected' ? 'approved' : 'review'} dot={false}>{x.value_status}</StatusPill></td>
              <td className="py-1.5 pr-2 text-right numeral">{tco2(x.tco2e, 2)}</td>
              <td className="py-1.5 text-right"><Link to={periodLink('/traceability',year,{run:runId,c:x.id})} className="text-[#2E7099] hover:underline" data-testid="explain-link">{fi ? 'Selitä luku' : 'Explain this number'}</Link></td>
            </tr>
          ))}
        </tbody>
      </table></div>
      {c.error&&<p role="alert" className="mt-2 text-[12px] text-[#8C3B2E]">{c.error.message}</p>}
      {c.data?.total>25&&<div className="mt-3 flex justify-between gap-3 text-[11px]"><button disabled={!offset} onClick={()=>setOffset(Math.max(0,offset-25))} className="disabled:opacity-30">{fi?'Edelliset':'Previous'}</button><span>{offset+1}–{Math.min(offset+25,c.data.total)} / {c.data.total}</span><button disabled={offset+25>=c.data.total} onClick={()=>setOffset(offset+25)} className="disabled:opacity-30">{fi?'Seuraavat':'Next'}</button></div>}
    </div>
  );
}

export default function Sustainability() {
  const { t, lang } = useI18n();
  const fi = lang === 'fi';
  const { toast } = useToast();
  const qc = useQueryClient();
  const overview = useQuery({ queryKey: ['overview'], queryFn: () => api.overview(), refetchInterval: 5000 });
  const { year: y, years } = useReportingYear(overview.data);
  const [basis, setBasis] = useState('market');
  const [params,setParams]=useSearchParams();
  const selected=params.get('run');const category=params.get('category');
  const setSelected=(value)=>setParams(p=>{if(value)p.set('run',value);else p.delete('run');return p;});
  const setCategory=(value)=>setParams(p=>{if(value)p.set('category',value);else p.delete('category');return p;});
  const [flowOpen,setFlowOpen]=useState(/(?:^|&)flow_/.test(params.toString()));
  useEffect(()=>{if(/(?:^|&)flow_/.test(params.toString()))setFlowOpen(true);},[params]);
  const [busy, setBusy] = useState(false);
  const runs = useQuery({ queryKey: ['runs', y], queryFn: () => api.runs({ year: y, kind: 'inventory' }), refetchInterval: 3000 });
  const runId = selected || runs.data?.[0]?.id;
  const run = useQuery({ queryKey: ['run', runId], queryFn: () => api.run(runId), enabled: !!runId });
  const bench = useQuery({ queryKey: ['bench', runId], queryFn: () => api.benchmark(runId), enabled: !!runId });
  const trend = useQueries({ queries: years.map((yy) => ({ queryKey: ['runs', yy], queryFn: () => api.runs({ year: yy, kind: 'inventory' }) })) });
  const points = useMemo(() => trend.map((q, i) => q.data?.[0] && !q.data[0].completeness?.contains_demo_data && { year: years[i], scope3: q.data[0].totals.scope3_total, total: q.data[0].totals.grand_total }).filter(Boolean), [trend, years]);

  const recompute = async () => {
    setBusy(true);
    try {
      const r = await api.calculate('inventory', { year: y, scope2_basis: basis });
      qc.invalidateQueries({ queryKey: ['runs'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
      setSelected(r.id);
      toast({ title: fi ? 'Uusi laskenta-ajo luotu' : 'New calculation run created', description: `${r.id} · ${nf(r.totals.grand_total)} tCO₂e · ${nf(r.contribution_count)} ${fi ? 'riviä' : 'contributions'}` });
    } catch (e) {
      toast({ title: fi ? 'Laskenta epäonnistui' : 'Calculation failed', description: e.message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const r = run.data;
  const lines = runLines(r);
  const totals = r?.totals || {};
  const precision = r?.completeness?.contains_demo_data ? 3 : 0;

  return (
    <div>
      <PageHeader
        eyebrow={t('app.name')}
        title={t('sustain.title')}
        description={fi ? 'Löydä suurimmat päästölähteet ja jäljitä luvut alkuperäisiin tietoihin. Tietokorjaukset muuttavat inventaariota; toiminnan muutokset arvioidaan Toimenpiteissä.' : 'Find the largest emissions sources and trace their figures to the original evidence. Data corrections adjust the inventory; operational changes are assessed in Actions.'}
        actions={
          <>
            <select value={y} onChange={(event) => setParams(p=>{p.set('year',event.target.value);p.delete('run');p.delete('category');return p;})} aria-label={fi ? 'Vuosi' : 'Year'} data-testid="sustainability-year" className="rounded-full border border-border bg-card px-3 py-2 text-[12px]">{years.map((yy) => <option key={yy} value={yy}>{yy}</option>)}</select>
            <select value={basis} onChange={(e) => setBasis(e.target.value)} className="rounded-full border border-border bg-card px-3 py-2 text-[12px]" data-testid="scope2-basis">
              <option value="market">{fi ? 'Scope 2: markkina' : 'Scope 2: market'}</option>
              <option value="location">{fi ? 'Scope 2: sijainti' : 'Scope 2: location'}</option>
            </select>
            <button onClick={recompute} disabled={busy} className="inline-flex items-center gap-2 rounded-full bg-[#1B4968] px-4 py-2 text-[12.5px] font-medium text-[#EFF6FC] transition hover:bg-[#22557A] disabled:opacity-60" data-testid="recalculate">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {fi ? 'Laske (uusi ajo)' : 'Calculate (new run)'}
            </button>
            {r && (
              <a href={api.workbookUrl(r.id)} className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-[12.5px] font-medium" data-testid="export-xlsx">
                <Download className="h-3.5 w-3.5" />Excel
              </a>
            )}
          </>
        }
      />



      {runs.isLoading || (runId && run.isLoading) ? (
        <p className="text-[13px] text-muted-foreground">{t('common.loading')}</p>
      ) : !r ? (
        <div className="surface p-8 text-center">
          <p className="text-[13px] text-muted-foreground">{overview.data?.empty ? (fi ? 'Tuo ensin aineistot Validointi-sivulla.' : 'Import data on the Validation page first.') : fi ? `Vuodelle ${y} ei ole vielä laskenta-ajoa.` : `No calculation run for ${y} yet.`}</p>
          {!overview.data?.empty && <button onClick={recompute} className="mt-3 rounded-full bg-[#1B4968] px-4 py-2 text-[12.5px] font-medium text-[#EFF6FC]">{fi ? 'Laske päästöt' : 'Calculate emissions'}</button>}
        </div>
      ) : (
        <>
          <section data-testid="inventory-metrics" data-run-id={r.id} className="surface mb-4 flex flex-wrap items-start justify-between gap-5 p-5"><div><p className="text-[12px] text-muted-foreground">{fi?'Tallennettu inventaario':'Saved inventory'} · {r.year}</p><p className="mt-1 text-[30px] font-semibold text-[#1B4968]" data-ai-context={JSON.stringify({run_id:r.id,year:r.year,metric:'grand_total',label:fi?'Kokonaispäästöt':'Total emissions'})}>{tco2(totals.grand_total,precision)} <span className="text-[12px] font-normal">tCO₂e</span></p><p className="mt-2 text-[11px] text-muted-foreground">{r.status==='complete'?(fi?'Laskettu, odottaa raportin tarkistusta':'Calculated; report review remains'):(fi?'Alustava: tarkistuksia tai tietopuutteita':'Provisional: review items or gaps')} · Scope 2 {r.scope2_basis}</p></div><dl className="flex flex-wrap gap-6 text-[12px]">{[['Scope 1','scope1_total'],['Scope 2','scope2_reported'],['Scope 3','scope3_total']].map(([label,metric])=><div key={metric} data-ai-context={JSON.stringify({run_id:r.id,year:r.year,metric,label})}><dt className="text-muted-foreground">{label}</dt><dd className="mt-1 font-semibold tabular-nums">{tco2(totals[metric],precision)} tCO₂e</dd></div>)}</dl></section>
          {r.year!==y&&<p role="alert" className="mb-4 rounded-xl bg-[#FBF4E7] p-4 text-[12px]">{fi?'Valittu laskelma kuuluu eri vuodelle. Valitse oikea raportointivuosi.':'The selected calculation belongs to a different year. Choose the matching reporting year.'}</p>}
          <FootprintSources lines={lines} runId={r.id} year={r.year} category={category} onSelect={setCategory}><Contributions runId={r.id} year={r.year} category={category} fi={fi} /></FootprintSources>
          <details open={flowOpen} onToggle={event=>setFlowOpen(event.currentTarget.open)} className="mb-4 rounded-xl border border-border bg-card" data-testid="show-footprint-flow"><summary className="cursor-pointer px-5 py-4 text-[12.5px] font-medium">{fi?'Tutki lähteiden, Scopejen ja FLAG-jaon yhteyksiä':'Explore source, scope and FLAG relationships'} · Sankey</summary>{flowOpen&&<div className="px-3 pb-1"><FootprintFlow year={y} runId={r.year===y?r.id:undefined} scope2Basis={r.scope2_basis} /></div>}</details>
          <details className="mb-4 rounded-xl border border-border bg-card"><summary className="cursor-pointer px-5 py-4 text-[12.5px] font-medium">{fi?'Tallennetut laskelmat ja havaittu vuosikehitys':'Saved calculations and recorded annual history'}</summary><div className="grid gap-4 p-4 lg:grid-cols-2"><RunHistory runs={runs.data||[]} selected={runId} onSelect={setSelected} fi={fi} /><div className="surface p-4">{points.length>=2?<><TrendChart points={points} /><p className="mt-2 text-[11px] text-muted-foreground">{fi?'Tallennettu vuosihistoria, ei ennuste tai vahvistettu vertailukelpoinen tavoitepolku.':'Recorded annual inventories, not a forecast or confirmed like-for-like target trajectory.'}</p></>:<p className="text-[12px] text-muted-foreground">{fi?'Vuosihistoria edellyttää vähintään kahta tallennettua vuotta.':'Annual history needs at least two saved years.'}</p>}</div></div></details>

          <details className="mb-4 surface overflow-hidden"><summary className="cursor-pointer px-5 py-4 text-[12.5px] font-medium">{fi?'Kaikki laskentaluokat ja vaihtoehtoiset perusteet':'All calculation categories and alternative bases'}</summary>
            <div className="border-b border-border px-4 py-3 font-heading text-[16px]">{fi ? 'Luokat' : 'Categories'}</div>
            <div className="overflow-x-auto p-4 pt-0">
              <table className="w-full text-left text-[12.5px]">
                <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr><th className="py-2.5 font-medium">{fi ? 'Luokka' : 'Category'}</th><th className="py-2.5 font-medium">Scope</th><th className="py-2.5 text-right font-medium">tCO₂e</th><th className="py-2.5 text-right font-medium">{fi ? 'Rivit' : 'Rows'}</th><th className="py-2.5 font-medium">{fi ? 'Summassa' : 'In total'}</th><th /></tr>
                </thead>
                <tbody>
                  {lines.sort((a, b) => b.tco2e - a.tco2e).map((l) => (
                    <tr key={l.id} className="border-t border-border/60">
                      <td className="py-2 font-medium">{catLabel(l.category, lang)}<div className="font-mono text-[10px] text-muted-foreground">{l.category}</div></td>
                      <td className="py-2 text-[11px] text-muted-foreground">{scopeName(l.scope, lang)}</td>
                      <td className="py-2 text-right numeral">{tco2(l.tco2e, 1)}</td>
                      <td className="py-2 text-right numeral">{nf(l.count)}</td>
                      <td className="py-2">{l.in_total ? <StatusPill tone="ok" dot={false}>{fi ? 'kyllä' : 'yes'}</StatusPill> : <StatusPill tone="draft" dot={false}>{l.scope === 'memo' ? (fi ? 'muistio' : 'memo') : fi ? 'vaihtoehtoinen perusta' : 'alternative basis'}</StatusPill>}</td>
                      <td className="py-2 text-right"><button onClick={() => setCategory(category === l.category ? null : l.category)} className="text-[11.5px] text-[#2E7099] hover:underline">{fi ? 'Rivit' : 'Rows'}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          <section id="calculation-evidence" className="mb-4 grid scroll-mt-24 grid-cols-1 gap-3.5 lg:grid-cols-3">
            <div className="surface p-5 lg:col-span-2">
              <h2 className="font-heading text-[17px]">{fi ? 'Tarkistukset ja puutteet' : 'Checks and gaps'}</h2>
              <ul className="mt-2 space-y-1 text-[12px]">
                {r.checks.map((c) => <li key={c.id} className="flex items-start gap-2">{c.passed ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 text-[#2E7099]" /> : <XCircle className="mt-0.5 h-3.5 w-3.5 text-[#8C3B2E]" />}<span><span className="font-mono text-[11px]">{c.id}</span> · {c.detail}</span></li>)}
              </ul>
              <p className="mt-3 text-[12px]">{fi ? 'Hyväksyttyjä korjauksia käytössä' : 'Approved corrections used'}: <b>{r.correction_ids.length}</b> · {fi ? 'Rivejä, joihin avoin havainto liittyy' : 'Contributions touched by an open issue'}: <b>{nf(r.completeness.contributions_with_open_issues)}</b> · {fi ? 'Rajauksen ulkopuolella' : 'Outside boundary'}: <b>{nf(r.completeness.excluded_outside_boundary)}</b></p>
              {r.gaps.length > 0 && (
                <ul className="mt-2 max-h-40 overflow-y-auto rounded-lg bg-[#F8EEDF]/60 p-2 text-[11.5px] text-[#8A5A1E]">
                  {r.gaps.map((g, i) => <li key={i}>[{g.area}] {g.message}</li>)}
                </ul>
              )}
            </div>
            <details className="surface p-5"><summary className="cursor-pointer text-[12.5px] font-medium">{fi?'Havainnollistava herkkyystarkastelu':'Illustrative sensitivity exercise'}</summary><p className="mt-3 text-[11px] text-muted-foreground">{fi?'Prosenttimuutos ei ole toteutettu toimenpide tai todistettu säästö.':'A percentage change is not an implemented measure or evidenced savings.'}</p><ScenarioSimulator lines={lines.filter((l)=>l.in_total)} /><Link to={periodLink('/actions',y,{run:r.id})} className="mt-3 block text-[12px] text-[#2E7099]">{fi?'Arvioi toimenpiteitä näytön perusteella':'Assess evidence-based measures'} →</Link></details>
          </section>

          {bench.data?.available && (
            <section className="surface overflow-hidden">
              <div className="border-b border-border px-4 py-3"><h2 className="font-heading text-[16px]">{fi ? 'Vertailu julkaistuun vertailuarvoon' : 'Comparison with the published benchmark'}</h2><p className="text-[11.5px] text-muted-foreground">{bench.data.note}</p></div>
              <div className="overflow-x-auto p-4 pt-2">
                <table className="w-full text-left text-[12px]">
                  <thead className="text-[11px] uppercase tracking-wide text-muted-foreground"><tr><th className="py-2 font-medium">{fi ? 'Rivi' : 'Line'}</th><th className="py-2 text-right font-medium">{fi ? 'Vertailu' : 'Benchmark'}</th><th className="py-2 text-right font-medium">{fi ? 'Tämä ajo' : 'This run'}</th><th className="py-2 text-right font-medium">Δ %</th></tr></thead>
                  <tbody>
                    {bench.data.rows.map((b) => (
                      <tr key={`${b.scope}|${b.category}`} className="border-t border-border/60">
                        <td className="py-1.5">{b.scope} · {catLabel(b.category, lang)}</td>
                        <td className="py-1.5 text-right numeral">{tco2(b.benchmark_tco2e, 1)}</td>
                        <td className="py-1.5 text-right numeral">{tco2(b.run_tco2e, 1)}</td>
                        <td className={`py-1.5 text-right numeral ${b.diff_pct !== null && Math.abs(b.diff_pct) > 5 ? 'text-[#8C3B2E]' : 'text-[#1C5B85]'}`}>{b.diff_pct === null ? '—' : `${b.diff_pct > 0 ? '+' : ''}${nf(b.diff_pct, 1)}`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

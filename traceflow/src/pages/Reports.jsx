import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Download, Loader2, Plus } from 'lucide-react';
import { api } from '@/api/client';
import PageHeader from '@/components/PageHeader';
import StatusPill from '@/components/StatusPill';
import ReportCard from '@/components/reports/ReportCard';
import { useI18n } from '@/lib/i18n';
import { localizeReport } from '@/lib/reportExport';
import { shortDate, tco2 } from '@/lib/format';
import { useToast } from '@/components/ui/use-toast';
import useReportingYear from '@/lib/useReportingYear';

export default function Reports() {
  const { lang } = useI18n();
  const fi = lang === 'fi';
  const { toast } = useToast();
  const qc = useQueryClient();
  const overview = useQuery({ queryKey: ['overview'], queryFn: () => api.overview(), refetchInterval: 5000 });
  const { year, years, setYear } = useReportingYear(overview.data);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(undefined);
  const reports = useQuery({ queryKey: ['reports',year], queryFn: () => api.docs('reports', { period:String(year),sort: '-created_date', limit: 30 }) });
  const runs = useQuery({ queryKey: ['report-calculations'], queryFn: () => api.runs({ limit: 200 }), refetchInterval: 3000 });
  const workspace=useQuery({queryKey:['decision-workspace',year],queryFn:()=>api.decisionWorkspace({year}),refetchInterval:10000});
  const inventory = (runs.data || []).filter((run) => run.kind === 'inventory');
  const canCreate = inventory.some((run) => run.year === year);
  const generate = async () => {
    if (!canCreate || busy) return;
    setBusy(true);
    try {
      const result = await api.createReportDraft({ year, lang });
      qc.invalidateQueries({ queryKey: ['reports'] });
      setOpen(result.report.id);
      toast({ title: fi ? 'Raporttiluonnos luotu' : 'Report draft created', description: fi ? 'Lue tulos ja tarkistettavat kohdat ennen hyväksyntää.' : 'Read the result and items to check before approving.' });
    } catch (error) { toast({ title: fi ? 'Raporttia ei voitu luoda' : 'Could not create the report', description: error.message, variant: 'destructive' }); }
    finally { setBusy(false); }
  };
  const rows = (reports.data || []).map((report) => localizeReport(report, lang));
  const [latest, ...earlier] = rows;
  const selectedId = open === undefined ? latest?.id : open;
  const all = workspace.data?.reporting.requirements;
  const steps = all && { all, done: all.filter((r) => r.state === 'recorded').length, next: all.find((r) => r.state !== 'recorded') };
  return (
    <div>
      <PageHeader title={fi ? 'Raportointi' : 'Reporting'}
        actions={<div className="flex flex-wrap items-center gap-2"><label className="flex items-center gap-2 text-[12px] text-muted-foreground" htmlFor="report-year">{fi ? 'Vuosi' : 'Year'}<select id="report-year" value={year ?? ''} disabled={!years.length || busy} onChange={(event) => setYear(event.target.value)} className="rounded-full border border-input bg-card px-3 py-2" data-testid="report-year">{!years.length && <option value="">—</option>}{years.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><button onClick={generate} disabled={busy || !canCreate} className="inline-flex min-h-10 items-center gap-2 rounded-full bg-primary px-4 py-2 text-[12px] font-medium text-primary-foreground disabled:opacity-50" data-testid="create-report">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}{fi ? 'Luo raporttiluonnos' : 'Create report draft'}</button></div>}
      />
      {runs.isError && <p role="alert" className="surface mb-4 p-5 text-[13px] text-[#8C3B2E]">{fi ? 'Tallennettuja laskelmia ei voitu ladata.' : 'Saved calculations could not be loaded.'} {runs.error.message}</p>}
      {runs.isSuccess && !canCreate && <div className="surface mb-4 p-5 text-[13px] leading-relaxed"><p>{fi ? 'Tallenna ensin päästölaskelma, jotta raportin luvut voidaan jäljittää lähteisiin.' : 'Save an emissions calculation for the selected year first so the report can show where its figures came from.'}</p><Link to={`/sustainability?year=${year}`} className="mt-2 inline-block font-medium text-[#2E7099] hover:underline">{fi ? 'Avaa päästölaskenta →' : 'Open emissions calculations →'}</Link></div>}
      {workspace.error&&<p role="alert" className="mb-4 text-[12px] text-[#8C3B2E]">{workspace.error.message}</p>}
      {steps && <div className="surface mb-4 flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 text-[12.5px]" data-testid="reporting-progress">
        <span><strong>{steps.done} / {steps.all.length}</strong> {fi ? 'vaihetta valmiina ennen hyväksyntää' : 'steps done before sign-off'}</span>
        {steps.next ? <Link to={steps.next.to} className="inline-flex items-center gap-1.5 font-semibold text-[#2E7099] hover:underline">{fi ? 'Seuraavaksi' : 'Next'}: {steps.next.label[lang]}{steps.next.count ? ` (${steps.next.count})` : ''}<ArrowRight className="h-3.5 w-3.5" /></Link> : <span className="text-muted-foreground">{fi ? 'Valmis hyväksyttäväksi.' : 'Ready for sign-off.'}</span>}
      </div>}
      {reports.isLoading ? <p role="status" className="py-6 text-[13px] text-muted-foreground">{fi ? 'Ladataan raportteja…' : 'Loading reports…'}</p>
        : reports.isError ? <p role="alert" className="surface p-5 text-[13px] text-[#8C3B2E]">{reports.error.message}</p>
          : latest ? <div className="space-y-4">
            <ReportCard report={latest} latestRunId={workspace.data?.run?.id} open={selectedId === latest.id} onToggle={() => setOpen(selectedId === latest.id ? null : latest.id)} />
            {earlier.length > 0 && <details className="rounded-xl border border-border bg-card" data-testid="earlier-reports"><summary className="cursor-pointer px-5 py-3 text-[12.5px] font-medium">{fi ? 'Aiemmat versiot' : 'Earlier versions'} ({earlier.length})</summary><div className="space-y-3 p-3">{earlier.map((report) => <ReportCard key={report.id} report={report} latestRunId={workspace.data?.run?.id} open={selectedId === report.id} onToggle={() => setOpen(selectedId === report.id ? null : report.id)} />)}</div></details>}
          </div>
            : canCreate && <div className="surface p-7 text-[13px] text-muted-foreground">{fi ? 'Ei raporttia tälle vuodelle. Luo raportti viimeisimmästä laskelmasta.' : 'No report for this year yet. Create one from the latest calculation.'}</div>}
      <details className="mt-7 rounded-xl border border-border bg-card" data-testid="saved-calculations">
        <summary className="cursor-pointer px-4 py-3 text-[12px] font-medium">{fi ? 'Tallennetut laskelmat ja Excel-erittelyt' : 'Saved calculations and detailed Excel files'}</summary>
        <p className="border-t border-border px-4 py-3 text-[11.5px] leading-relaxed text-muted-foreground">{fi ? 'Aiemmat laskelmat säilyvät. Excel sisältää lähderivit, laskentakertoimet ja muutoshistorian tarkempaa tarkistusta varten.' : 'Earlier calculations remain available. Excel includes original entries, conversion factors and change history for a detailed review.'}</p>
        {runs.isError && <p role="alert" className="px-4 pb-3 text-[12px] text-[#8C3B2E]">{runs.error.message}</p>}
        <ul className="divide-y divide-border/60">{(runs.data || []).map((run) => <li key={run.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-[12px]"><span>{run.year} · {shortDate(run.created_at)} {run.created_at.slice(11, 16)}</span><span>{tco2(run.totals.grand_total, 1)} tCO₂e</span><StatusPill tone={run.status === 'complete' ? 'draft' : 'review'} dot={false}>{run.status === 'complete' ? fi ? 'Laskettu' : 'Calculated' : fi ? 'Tarkistettavia tietoja' : 'Information needs checking'}</StatusPill><details className="text-[11px] text-muted-foreground"><summary className="cursor-pointer">{fi ? 'Laskelman tiedot' : 'Calculation details'}</summary><p className="mt-1 break-all">{run.id} · {run.kind} · Scope 2 {run.scope2_basis} · {run.correction_ids.length} {fi ? 'hyväksyttyä korjausta' : 'approved corrections'}</p></details><a href={api.workbookUrl(run.id)} className="ml-auto inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-[11.5px]" data-testid="run-xlsx"><Download className="h-3 w-3" />{fi ? 'Lataa Excel' : 'Download Excel'}</a></li>)}</ul>
      </details>
    </div>
  );
}

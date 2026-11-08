import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, FileText, Loader2 } from 'lucide-react';
import { api, getReviewerLabel, setReviewerLabel } from '@/api/client';
import StatusPill from '@/components/StatusPill';
import ReportExport from '@/components/reports/ReportExport';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { useI18n } from '@/lib/i18n';
import { shortDate } from '@/lib/format';
import { amount, periodLink } from '@/lib/decisions';
import { catLabel } from '@/lib/categories';

export default function ReportCard({ report, open, onToggle, latestRunId=undefined }) {
  const { lang } = useI18n();
  const fi = lang === 'fi';
  const qc = useQueryClient();
  const { toast } = useToast();
  const [approving, setApproving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reviewer, setReviewer] = useState(() => { const name = getReviewerLabel(); return name === 'Local reviewer' ? '' : name; });
  const [error, setError] = useState(null);
  const limited = report.reader_snapshot?.provisional || report.insufficient_evidence;
  const ai = report.report_type === 'assistant_answer';
  const sourceSections = ai ? (report.sections || []).filter((section) => ['Cited evidence', 'Viitatut lähteet'].includes(section.heading)) : [];
  const sections = (report.sections || []).filter((section) => !sourceSections.includes(section));
  const approve = async () => {
    if (!reviewer.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await api.updateDoc('reports', report.id, { status: 'approved', approved_by: reviewer.trim(), approved_by_note: 'typed reviewer label, not a verified identity', approved_at: new Date().toISOString() });
      setReviewerLabel(reviewer.trim());
      qc.invalidateQueries({ queryKey: ['reports'] });
      setApproving(false);
      toast({ title: fi ? 'Hyväksyntä tallennettu' : 'Approval recorded' });
    } catch (failure) { setError(failure.message); }
    finally { setSaving(false); }
  };
  return (
    <article className="surface min-w-0 overflow-hidden" data-testid="report-card" data-ai-context={report.run_id?JSON.stringify({run_id:report.run_id,year:Number(report.period),label:report.title.slice(0,240)}):undefined}>
      <div className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <button onClick={onToggle} aria-expanded={open} className="flex min-w-0 items-start gap-2 text-left" data-testid="report-toggle">
            <FileText className="mt-1 h-4 w-4 shrink-0 text-[#2E7099]" />
            <span className="min-w-0"><span className="block font-heading text-[20px] leading-snug">{report.title}</span><span className="mt-1 block text-[11.5px] text-muted-foreground">{report.period} · {fi ? 'Luotu' : 'Created'} {shortDate(report.created_date)}</span></span>
            <ChevronDown className={`mt-1.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
          <div className="flex flex-wrap gap-1.5">
            <StatusPill tone={report.status === 'approved' ? 'approved' : 'draft'}>{report.status === 'approved' ? fi ? 'Hyväksytty' : 'Approved' : fi ? 'Luonnos · odottaa tarkistusta' : 'Draft · awaiting review'}</StatusPill>
            {ai && <StatusPill tone="draft" dot={false}>{fi ? 'AI:n tuottama' : 'AI generated'}</StatusPill>}
          </div>
        </div>
        {!open && report.summary && <p className="mt-3 line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">{report.summary}</p>}
      </div>
      {open && <div className="space-y-5 border-t border-border px-5 pb-5 pt-4" data-testid="report-reader">
        {latestRunId&&report.run_id&&latestRunId!==report.run_id&&<p className="text-[12px] text-muted-foreground">{fi?'Uudempi laskelma on saatavilla. Luo uusi raportti käyttääksesi sitä.':'A newer calculation is available. Create a new report to use it.'}</p>}
        {!report.reader_version && !ai && <p className="text-[11.5px] text-muted-foreground">{fi ? 'Aiemmin tallennettu raportti säilyy alkuperäisessä muodossaan.' : 'This earlier report retains its saved wording.'}</p>}
        <div className="space-y-5">
          {sections.filter(section=>!report.reader_snapshot||!['coverage','unit'].includes(section.key)).map((section, index) => <section key={index}>
            <h3 className="mb-1.5 text-[14px] font-semibold">{section.heading}</h3>
            {section.key==='result'?<div className="rounded-xl bg-[#EDF4F8] p-4 text-[#214A65]">{section.body.split('\n').filter(Boolean).map((line,i)=><p key={i} className={i===0?'text-[16px] font-medium':'mt-1 text-[12.5px]'}>{line}</p>)}</div>
              :section.key==='contributors'&&report.reader_snapshot?.categories?.length?<ol className="divide-y divide-border/70 text-[12.5px]">{report.reader_snapshot.categories.map(category=><li key={category.category}><Link to={periodLink('/sustainability',Number(report.period),{run:report.run_id,category:category.category})} className="flex justify-between gap-3 py-2 hover:text-[#2E7099]"><span>{catLabel(category.category,lang)}</span><span className="shrink-0 tabular-nums"><strong>{amount(category.tco2e,lang)}</strong> tCO₂e{category.share_pct!=null&&<span className="ml-2 inline-block w-14 text-right text-muted-foreground">{category.share_pct<0.1&&category.share_pct>0?'<0.1':amount(category.share_pct,lang)} %</span>}</span></Link></li>)}</ol>
              :['review','next'].includes(section.key)?<ul className="list-disc space-y-1.5 pl-5 text-[12.5px] leading-relaxed text-foreground/85">{section.body.split('\n').filter(Boolean).map((text,i)=><li key={i} className="break-words">{text.replace(/^\d+\.\s/,'')}</li>)}</ul>
              :<p className="whitespace-pre-line break-words text-[13px] leading-relaxed text-foreground/85">{section.body}</p>}
            {section.key==='next'&&<Link to={periodLink('/data-quality',Number(report.period))} className="mt-2 inline-block text-[12px] font-medium text-[#2E7099]">{fi?'Avaa Validointi':'Open Validation'} →</Link>}
          </section>)}
        </div>
        {report.reader_snapshot&&<details className="rounded-xl border border-border p-3 text-[12px]"><summary className="cursor-pointer font-medium">{fi?'Rajaus ja käsitteet':'Coverage and terms'}</summary><div className="mt-3 space-y-3">{sections.filter(section=>['coverage','unit'].includes(section.key)).map(section=><section key={section.key}><h4 className="font-semibold">{section.heading}</h4><p className="mt-1 whitespace-pre-line leading-relaxed text-muted-foreground">{section.body}</p></section>)}</div></details>}
        <details className="rounded-xl border border-border bg-muted/20 px-3.5 py-3 text-[12px]" data-testid="report-details">
          <summary className="cursor-pointer font-medium">{fi ? 'Lähteet ja laskennan lisätiedot' : 'Sources and calculation details'}</summary>
          <div className="mt-3 space-y-4">
            {[...(report.technical_sections || []), ...sourceSections].map((section, index) => <div key={index}><h4 className="font-semibold">{section.heading}</h4><p className="mt-1 whitespace-pre-line break-all leading-relaxed text-muted-foreground">{section.body}</p></div>)}
            {report.run_id && <p className="break-all text-muted-foreground">{fi ? 'Laskelman viite' : 'Calculation reference'}: {report.run_id}</p>}
            {report.generated_by && <p className="break-all text-muted-foreground">{fi ? 'Luotu käyttäen' : 'Created using'}: {report.generated_by}</p>}
            {(report.citations || []).length > 0 && <ul className="space-y-1">{report.citations.map((citation, index) => <li key={index} className="break-all text-muted-foreground">{typeof citation === 'string' ? citation : [citation.label, citation.source, citation.ref || citation.id].filter(Boolean).join(' · ')}</li>)}</ul>}
            {sections.some((section) => section.citations?.length) && <ul className="space-y-1">{sections.filter((section) => section.citations?.length).map((section, index) => <li key={index} className="break-all text-muted-foreground">{section.heading}: {section.citations.join(' · ')}</li>)}</ul>}
            {report.run_id && <Link to={periodLink('/traceability',Number(report.period),{run:report.run_id})} className="inline-block font-medium text-[#2E7099] hover:underline">{fi ? 'Tutki laskennan lähteitä →' : 'Explore how the figures were calculated →'}</Link>}
          </div>
        </details>
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-4">
          <ReportExport report={report} />
          {report.status === 'approved' ? <p className="text-[11.5px] text-muted-foreground">{fi ? 'Hyväksynyt' : 'Approved by'} {report.approved_by} · {shortDate(report.approved_at)}</p>
            : <button onClick={() => { setApproving(true); setError(null); }} className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-border px-3.5 py-2 text-[12px]" data-testid="report-approve"><Check className="h-3.5 w-3.5" />{fi ? 'Tarkista ja hyväksy' : 'Review and approve'}</button>}
        </div>
      </div>}
      <Dialog open={approving} onOpenChange={setApproving}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>{fi ? 'Hyväksy tarkistettu raportti' : 'Approve the reviewed report'}</DialogTitle><DialogDescription>{fi ? 'Vahvista, että olet tarkistanut tuloksen, lähteet ja rajoitukset. Nimesi ja päätöksen päivämäärä tallennetaan raporttiin.' : 'Confirm that you have reviewed the result, sources and limitations. Your name and the decision date will be recorded with the report.'}</DialogDescription></DialogHeader>
        {limited && <p className="rounded-lg bg-[#FBF4E7] p-3 text-[12px] leading-relaxed text-[#7A5A2E]">{fi ? 'Hyväksyntä ei poista raportin avoimia kohtia tai tietopuutteita. Ne jäävät näkyviin myös ladattuun raporttiin.' : 'Approval keeps the open items and information gaps visible, including in the downloaded report.'}</p>}
        <label className="space-y-1 text-[12px]">{fi ? 'Nimesi' : 'Your name'}<input value={reviewer} onChange={(event) => setReviewer(event.target.value)} maxLength={80} className="mt-1 block w-full rounded-lg border border-input bg-card px-3 py-2.5" data-testid="report-reviewer" /></label>
        {error && <p role="alert" className="text-[12px] text-[#8C3B2E]">{error}</p>}
        <DialogFooter><button onClick={() => setApproving(false)} className="rounded-full border border-border px-4 py-2 text-[12px]">{fi ? 'Peruuta' : 'Cancel'}</button><button onClick={approve} disabled={saving || !reviewer.trim()} className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-[12px] font-medium text-primary-foreground disabled:opacity-50" data-testid="confirm-report-approval">{saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{fi ? 'Hyväksyn tämän raportin' : 'I approve this report'}</button></DialogFooter>
      </DialogContent></Dialog>
    </article>
  );
}

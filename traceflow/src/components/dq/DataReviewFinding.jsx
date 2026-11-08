import { ChevronRight } from 'lucide-react';
import RootCauseButton from '@/components/assistant/RootCauseButton';
import StatusPill from '@/components/StatusPill';
import { fieldName, priorityName } from '@/lib/reviewLanguage';
import { findingContext, findingExplanation, findingStatus, findingSummary } from '@/lib/agentReviewLanguage';

export default function DataReviewFinding({ finding, dataset, lang, onOpenIssue }) {
  const fi = lang === 'fi';
  const closed = finding.withdrawn || finding.review_status !== 'open';
  return <li className="border-t border-border/70 px-4 py-4 sm:px-5" data-testid="agent-finding" data-ai-context={JSON.stringify({issue_id:finding.issue_id,year:finding.year,label:findingSummary(finding,lang).slice(0,200)})}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1 basis-60">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2"><h4 className="text-[14px] font-semibold">{fieldName(finding.field, lang) || (fi ? 'Tarkistettava tieto' : 'Information to check')}</h4><StatusPill tone={closed ? 'draft' : 'review'} dot={false}>{findingStatus(finding, lang)}</StatusPill></div>
        <p className="mt-2 break-words text-[11.5px] leading-relaxed text-muted-foreground">{findingContext(finding, dataset, lang)}</p>
      </div>
      {!closed && <span className="shrink-0 text-[11px] text-muted-foreground">{priorityName(finding.criticality || finding.severity, lang)}</span>}
    </div>
    <p className="mt-2.5 break-words text-[12.5px] leading-relaxed">{findingSummary(finding, lang)}</p>
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
      <p className="min-w-0 break-words text-[12px] text-muted-foreground">{fi ? 'Kirjattu arvo' : 'Recorded value'}: <span className="font-medium text-foreground">{finding.observed_value ?? '—'}</span></p>
      <RootCauseButton issue={finding} />
      <button onClick={() => onOpenIssue(finding.issue_id)} className="inline-flex min-h-9 items-center gap-1 rounded-full border border-border px-3 py-1.5 text-[12px] font-medium text-[#2E7099] hover:bg-secondary/50" data-testid="agent-concern" aria-label={`${closed ? fi ? 'Näytä merkintä' : 'View entry' : fi ? 'Tarkista merkintä' : 'Check entry'}: ${fieldName(finding.field, lang)}, ${findingContext(finding, dataset, lang)}`}>{closed ? fi ? 'Näytä merkintä' : 'View entry' : fi ? 'Tarkista merkintä' : 'Check entry'}<ChevronRight className="h-3.5 w-3.5" /></button>
    </div>
    <details className="mt-2 text-[11.5px] text-muted-foreground" data-testid="agent-finding-details"><summary className="w-fit cursor-pointer py-1">{fi ? 'Vertailu ja tarkistuksen lisätiedot' : 'Comparison and check details'}</summary>
      <div className="mt-2 space-y-2 rounded-lg bg-secondary/30 p-3 leading-relaxed">
        <p className="break-words">{findingExplanation(finding, lang)}</p>
        {finding.withdrawn && <p className="break-words"><strong>{fi ? 'Uusin arvio' : 'Latest assessment'}:</strong> {finding.current_assessment}</p>}
        <p className="break-words">{finding.next_action}</p>
        {(finding.related_checks || []).filter((check) => check.id !== finding.id).map((check) => <div key={check.id} className="space-y-1 border-t border-border pt-2"><p className="font-medium">{check.origin === 'ai' ? fi ? 'AI:n lisähuomio' : 'Additional AI check' : fi ? 'Perustarkistuksen lisähuomio' : 'Additional built-in check'}</p><p className="break-words">{check.explanation}</p><p className="break-words">{check.next_action}</p><details><summary className="cursor-pointer">{fi ? 'Viitteet' : 'References'}</summary><p className="mt-1 break-all font-mono text-[10px]">{check.id} · {check.concern_status} · {(check.evidence_ids || []).join(', ')}</p></details></div>)}
        {finding.source_file && <p className="break-all">{fi ? 'Lähdetiedosto' : 'Source file'}: {finding.source_file} · {fi ? 'rivi' : 'line'} {finding.source_row}</p>}
        <details><summary className="cursor-pointer">{fi ? 'Tekniset viitteet' : 'Technical references'}</summary><div className="mt-2 space-y-1 break-all font-mono text-[10.5px]"><p>{finding.record_key} · {finding.field}</p><p>{finding.origin} · {finding.concern_status} · {finding.review_status} · {finding.severity}</p><p>{finding.issue_id} · {finding.id}</p><p>{(finding.evidence_ids || []).join(', ')}</p><p>{finding.explanation}</p></div></details>
      </div>
    </details>
  </li>;
}

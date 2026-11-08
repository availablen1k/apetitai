import { ChevronRight } from 'lucide-react';
import StatusPill from '@/components/StatusPill';
import { useI18n } from '@/lib/i18n';
import { issueLabel } from '@/lib/format';
import { amount } from '@/lib/decisions';
import { datasetName, priorityName, reviewStatus } from '@/lib/reviewLanguage';

export default function IssueRow({ issue, onOpen }) {
  const { lang } = useI18n();
  const fi = lang === 'fi';
  return (
    <li className="border-b border-border/70 last:border-0" data-ai-context={JSON.stringify({issue_id:issue.id,year:issue.year,label:issueLabel(issue.issue_type,lang)})}>
      <button onClick={() => onOpen(issue.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-secondary/40" data-testid="issue-row">
        <span className="w-[74px] shrink-0"><StatusPill tone={issue.criticality || issue.severity}>{priorityName(issue.criticality || issue.severity, lang)}</StatusPill></span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-medium text-foreground">{issueLabel(issue.issue_type, lang)}{issue.status !== 'open' && <span className="ml-2 text-[11px] font-normal text-muted-foreground">· {reviewStatus(issue, lang)}</span>}</span>
          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{datasetName(issue.table_name, lang)}{issue.year ? ` · ${issue.year}` : ''}{issue.source_file ? ` · ${issue.source_file}${issue.source_row ? ` · ${fi ? 'rivi' : 'line'} ${issue.source_row}` : ''}` : ''}</span>
        </span>
        {'tco2e_affected' in issue && <span className="hidden w-40 shrink-0 text-right text-[12px] tabular-nums sm:block" data-testid="issue-impact" title={fi ? 'Niiden laskentarivien päästöt, joihin tämä tieto vaikuttaa viimeisimmässä laskelmassa. Useat poikkeamat voivat koskea samaa riviä.' : 'Emissions of the calculation lines this record feeds in the latest calculation. Several incidents can share a line.'}>{issue.tco2e_affected ? <><span className="text-[10.5px] text-muted-foreground">{fi ? 'enint. ' : 'up to '}</span><strong>{amount(issue.tco2e_affected, lang)}</strong> <span className="text-[11px] text-muted-foreground">tCO₂e</span></> : <span className="text-muted-foreground">—</span>}</span>}
        <span className="inline-flex shrink-0 items-center gap-1 text-[11.5px] font-medium text-[#2E7099]">{fi ? 'Tarkista' : 'Check'}<ChevronRight className="h-3.5 w-3.5" /></span>
      </button>
    </li>
  );
}

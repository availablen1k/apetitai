import { GitBranch } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { openAssistant } from '@/lib/assistantContext';

export default function RootCauseButton({ issue, onBeforeOpen = undefined }) {
  const { lang } = useI18n();
  return <button type="button" data-testid="incident-root-cause" onClick={(event) => {
    event.stopPropagation(); onBeforeOpen?.();
    openAssistant({ issue_id: issue.issue_id || issue.id, year: issue.year, label: String(issue.type_label?.[lang] || issue.record_key || issue.issue_type).slice(0,240) }, 'root_cause');
  }} className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-[#C9DDE9] bg-white px-3 py-1.5 text-[11.5px] font-medium text-[#235B7E] hover:bg-[#EEF5FA] focus-visible:outline-[#1B4968]">
    <GitBranch className="h-3.5 w-3.5" />{lang === 'fi' ? 'Juurisyy' : 'Root cause'}
  </button>;
}

import { Sparkles } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { openAssistant } from '@/lib/assistantContext';

// Opens the floating assistant with this item as context and asks it to explain it.
export default function ExplainButton({ context, label = undefined }) {
  const { lang } = useI18n();
  return <button type="button" data-testid="explain-this" onClick={(event) => { event.stopPropagation(); openAssistant(context, 'explain'); }} className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-[#C9DDE9] bg-white px-3 py-1.5 text-[11.5px] font-medium text-[#235B7E] hover:bg-[#EEF5FA] focus-visible:outline-[#1B4968]">
    <Sparkles className="h-3.5 w-3.5" />{label || (lang === 'fi' ? 'Selitä' : 'Explain this')}
  </button>;
}

import { useI18n } from '@/lib/i18n';
import { Info } from 'lucide-react';

const STYLES = {
  imported: { dot: 'bg-[#2E7099]', chip: 'bg-[#E7F1FA] text-[#1E5578] border-[#C9DEEE]' },
  calculated: { dot: 'bg-[#2E6D9A]', chip: 'bg-[#E6EFF9] text-[#1F4E75] border-[#CBDDEE]' },
  synthetic: { dot: 'bg-[#8A7A55]', chip: 'bg-[#F1ECE0] text-[#5E5334] border-[#E2D8C2]' },
  illustrative: { dot: 'bg-[#B4762E]', chip: 'bg-[#F8EEDF] text-[#8A5A1E] border-[#EDDCC0]' },
  forecast: { dot: 'bg-[#6B5C8A]', chip: 'bg-[#EFEAF5] text-[#4C3F6B] border-[#DDD4EA]' },
};

export default function SourceBadge({ type = 'synthetic', compact = false, className = '' }) {
  const { t } = useI18n();
  const s = STYLES[type] || STYLES.synthetic;
  return (
    <span
      title={t(`source.${type}.hint`)}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-[3px] text-[10.5px] font-medium leading-none ${s.chip} ${className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {!compact && t(`source.${type}`)}
      {compact && <Info className="hidden" />}
    </span>
  );
}

export { STYLES as SOURCE_STYLES };
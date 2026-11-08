import { ArrowUpRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import SourceBadge from '@/components/SourceBadge';

export default function MetricCard({ label, value, unit = undefined, hint = undefined, sourceType = undefined, to = undefined, tone = 'default', footer = undefined, assistantContext = undefined }) {
  const inner = (
    <div data-ai-context={assistantContext ? JSON.stringify({...assistantContext, label}) : undefined} className={`surface flex h-full min-w-0 flex-col justify-between gap-4 p-5 ${to ? 'surface-hover' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[12.5px] font-medium leading-snug text-muted-foreground">{label}</p>
        {to && <ArrowUpRight aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/50 transition group-hover:text-[#2E7099]" />}
      </div>
      <div>
        <div className="flex flex-wrap items-baseline gap-1.5">
          <span
            className={`numeral text-[30px] leading-none tracking-tight ${
              tone === 'warning' ? 'text-[#A2611F]' : tone === 'good' ? 'text-[#1C5B85]' : 'text-foreground'
            }`}
          >
            {value}
          </span>
          {unit && <span className="text-[12.5px] font-medium text-muted-foreground">{unit}</span>}
        </div>
        {hint && <p className="mt-2 text-[11.5px] leading-snug text-muted-foreground">{hint}</p>}
      </div>
      {(sourceType || footer) && <div className="flex flex-wrap items-center justify-between gap-2">
        {sourceType && <SourceBadge type={sourceType} />}
        {footer}
      </div>}
    </div>
  );

  if (to) {
    return (
      <Link to={to} className="group block h-full min-w-0 rounded-2xl">
        {inner}
      </Link>
    );
  }
  return <div className="h-full min-w-0">{inner}</div>;
}

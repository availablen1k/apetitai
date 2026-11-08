import { Info } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useI18n } from '@/lib/i18n';
import CONCEPTS from '@/lib/glossary';

/** Info button that opens a plain-language explanation of a term. */
export function Explainer({ concept, className = '' }) {
  const { lang } = useI18n();
  const entry = CONCEPTS[concept];
  if (!entry) return null;
  const c = entry[lang] || entry.fi;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${lang === 'fi' ? 'Selitys' : 'Explanation'}: ${c.term}`}
          className={`inline-flex shrink-0 items-center justify-center rounded-full text-muted-foreground/70 transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 ${className}`}
        >
          <Info className="h-3 w-3" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-3">
        <p className="text-[12px] font-semibold leading-snug">{c.term}</p>
        <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">{c.text}</p>
      </PopoverContent>
    </Popover>
  );
}

/**
 * A label that carries its own explanation.
 * @param {{ concept: string, children?: any, className?: string, as?: any }} props
 */
export default function Term({ concept, children, className = '', as = 'span' }) {
  /** @type {any} */
  const Tag = as;
  return (
    <Tag className={`inline-flex items-center gap-1 ${className}`}>
      <span>{children}</span>
      <Explainer concept={concept} />
    </Tag>
  );
}
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { catLabel } from '@/lib/categories';
import { amount, periodLink } from '@/lib/decisions';

const scopeShort = (s) => s.startsWith('scope3') ? 'Scope 3' : s === 'scope1' ? 'Scope 1' : 'Scope 2';

export default function FootprintSources({lines,runId,year,category,onSelect,children}){
  const {lang}=useI18n();const fi=lang==='fi';const [all,setAll]=useState(false);
  const source=lines.filter(l=>l.in_total).sort((a,b)=>b.tco2e-a.tco2e);
  const positive=source.reduce((s,l)=>s+Math.max(0,l.tco2e),0);
  const rows=all?source:source.slice(0,7);
  return <section className="surface mb-4 overflow-hidden scroll-mt-24" id="footprint-sources" data-testid="footprint-sources">
    <div className="border-b border-border p-5"><h2 className="font-heading text-[22px]">{fi?'Päästölähteet':'Emission sources'}</h2></div>
    <ol className="divide-y divide-border/70">{rows.map(line=><li key={line.id}>
      <button onClick={()=>onSelect(category===line.category?null:line.category)} aria-expanded={category===line.category} data-testid="footprint-source" data-tco2e={line.tco2e} data-ai-context={JSON.stringify({run_id:runId,category:line.category,year,label:catLabel(line.category,lang)})} className={`flex w-full items-baseline gap-3 px-5 py-3 text-left text-[12.5px] hover:bg-secondary/60 ${category===line.category?'bg-[#EAF2F7]':''}`}>
        <ChevronRight className={`h-3.5 w-3.5 shrink-0 self-center text-muted-foreground transition-transform ${category===line.category?'rotate-90':''}`} />
        <span className="min-w-0 flex-1 font-medium">{catLabel(line.category,lang)} <span className="ml-1 text-[11px] font-normal text-muted-foreground">{scopeShort(line.scope)}</span></span>
        <span className="tabular-nums"><strong>{amount(line.tco2e,lang)}</strong> <span className="text-[11px] text-muted-foreground">tCO₂e</span></span>
        <span className="w-14 text-right tabular-nums text-[11.5px] text-muted-foreground">{positive&&line.tco2e>=0?`${amount(line.tco2e/positive*100,lang)} %`:fi?'Oikaisu':'Adj.'}</span>
      </button>
      {category===line.category&&<div className="px-5 pb-4">{children}</div>}
    </li>)}</ol>
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3 text-[12px] font-medium">
      {source.length>7?<button onClick={()=>setAll(value=>!value)} className="text-[#2E7099]">{all?(fi?'Näytä suurimmat':'Show largest'):`${fi?'Näytä kaikki':'Show all'} ${source.length}`}</button>:<span />}
      <Link to={periodLink('/actions',year,{run:runId})} className="text-[#2E7099]">{fi?'Arvioi toimenpiteitä':'Assess actions'} →</Link>
    </div>
  </section>;
}

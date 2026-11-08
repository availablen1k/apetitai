import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import IssueRow from './IssueRow';
import { useI18n } from '@/lib/i18n';
import { priorityName } from '@/lib/reviewLanguage';

export default function IncidentTracePanel() {
  const { lang } = useI18n(); const fi = lang === 'fi'; const navigate = useNavigate();
  const [criticality, setCriticality] = useState(''); const [q, setQ] = useState(''); const [offset, setOffset] = useState(0);
  const result = useQuery({ queryKey: ['incident-trace', criticality, q, offset], queryFn: () => api.issues({ criticality, q, limit: 15, offset }) });
  return <section className="surface overflow-hidden" data-testid="incident-trace" data-ai-incidents={JSON.stringify({criticality:criticality || undefined,q})}>
    <div className="space-y-3 border-b border-border p-4"><h2 className="font-heading text-[20px]">{fi ? 'Mikä selittää havainnon?' : 'What explains the incident?'}</h2>
      <p className="max-w-3xl text-[12.5px] text-muted-foreground">{fi ? 'Juurisyyagentti tarkastelee alkuperäistä riviä, sääntöä, asiakirjoja ja liittyviä löydöksiä. Selitys erottaa havainnot oletuksista ja näyttää puuttuvan näytön.' : 'The root-cause specialist examines the original row, rule, documents and related discoveries. Each explanation separates observations from inferences and identifies missing evidence.'}</p>
      <div className="flex flex-wrap gap-2"><input aria-label={fi ? 'Hae havaintoa' : 'Search incidents'} placeholder={fi ? 'Hae havaintoa…' : 'Search incidents…'} value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} className="min-w-0 flex-1 rounded-lg border border-input bg-card px-3 py-2 text-[12px]" /><select aria-label={fi ? 'Havainnon kriittisyys' : 'Incident criticality'} value={criticality} onChange={(e) => { setCriticality(e.target.value); setOffset(0); }} className="rounded-lg border border-input bg-card p-2 text-[12px]"><option value="">{fi ? 'Kaikki kriittisyydet' : 'All criticalities'}</option>{['critical','high','medium','low'].map((level)=><option key={level} value={level}>{priorityName(level, lang)}</option>)}</select></div>
    </div>
    {result.error && <p role="alert" className="p-4 text-[12px]">{result.error.message}</p>}
    <ul>{(result.data?.items || []).map((issue) => <IssueRow key={issue.id} issue={issue} onOpen={(id)=>navigate(`/data-quality?issue=${encodeURIComponent(id)}`)} />)}</ul>
    {!result.isLoading && result.data?.total === 0 && <p className="p-4 text-[12px]">{fi ? 'Ei havaintoja tällä valinnalla.' : 'No incidents match this selection.'}</p>}
    <div className="flex items-center justify-between border-t border-border p-4 text-[12px]"><span>{result.data?.total || 0} {fi ? 'havaintoa' : 'incidents'}</span><div className="flex gap-3"><button disabled={!offset} onClick={()=>setOffset(Math.max(0,offset-15))} className="disabled:opacity-30">{fi ? 'Edelliset' : 'Previous'}</button><button disabled={offset+15 >= (result.data?.total || 0)} onClick={()=>setOffset(offset+15)} className="disabled:opacity-30">{fi ? 'Seuraavat' : 'Next'}</button></div></div>
  </section>;
}

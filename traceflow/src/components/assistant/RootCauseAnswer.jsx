import { Link } from 'react-router-dom';
import { GitBranch, FileSearch } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

export default function RootCauseAnswer({ result }) {
  const { lang } = useI18n(); const fi = lang === 'fi';
  const a = result.analysis;
  return <div className="space-y-3 text-[12px] leading-relaxed" data-testid="root-cause-answer">
    <p className="flex items-center gap-2 text-[11px] font-semibold text-[#2E7099]"><GitBranch className="h-4 w-4" />{fi ? 'Juurisyyanalyytikko' : 'Root-cause specialist'}</p>
    <div className="rounded-xl border border-[#D5E3EC] bg-[#F3F8FB] p-3"><h3 className="mb-1 font-semibold">{fi ? 'Mahdollinen juurisyy · vahvistamaton' : 'Suspected root cause · unconfirmed'}</h3><p className="whitespace-pre-wrap">{a.suspected_cause}</p></div>
    {a.summary && <p>{a.summary}</p>}
    {[[fi ? 'Havainnot lähteistä' : 'Observed evidence', a.observations], [fi ? 'Mahdolliset selitykset' : 'Inferences to check', a.inferences], [fi ? 'Puuttuva näyttö' : 'Evidence still needed', a.missing_evidence]].map(([title, items]) => items?.length > 0 && <section key={title}><h4 className="font-semibold">{title}</h4><ul className="mt-1 list-disc space-y-1 pl-4">{items.map((item, i) => <li key={i}>{item}</li>)}</ul></section>)}
    {a.uncertainty && <p className="rounded-lg bg-[#FBF4E7] p-3 text-[#745421]">{a.uncertainty}</p>}
    <p><strong>{fi ? 'Seuraava tarkistus' : 'Next human check'}:</strong> {a.next_human_action}</p>
    {a.calculated_impact?.value != null && <p>{fi ? 'Laskettu muutos, jos ehdotus hyväksyttäisiin' : 'Calculated change if the proposal were approved'}: <strong>{a.calculated_impact.value.toLocaleString(fi ? 'fi-FI' : 'en-GB', { maximumFractionDigits: 2 })} tCO₂e</strong></p>}
    <details className="rounded-xl border border-border p-3" data-testid="root-cause-evidence"><summary className="cursor-pointer font-medium"><FileSearch className="mr-1.5 inline h-3.5 w-3.5" />{fi ? 'Jäljitä näyttö lähteisiin' : 'Trace the evidence to its sources'}</summary><div className="mt-2 space-y-2">{result.original && <p className="break-words">{result.original.file} · {fi ? 'rivi' : 'line'} {result.original.row}</p>}{result.citations.map((item) => <Link key={item.id} to={item.link} className="block break-words font-medium text-[#2E7099] hover:underline">{item.label} →</Link>)}</div></details>
    {result.discoveries.length > 0 && <details className="rounded-xl border border-border p-3"><summary className="cursor-pointer font-medium">{fi ? 'Liittyvät löydökset' : 'Related discoveries'} ({result.discoveries.length})</summary><div className="mt-2 space-y-2">{result.discoveries.map((d) => <p key={d.id}>{d.found[lang]} <span className="text-muted-foreground">{d.suggest[lang]}</span></p>)}</div></details>}
    <p className="border-t border-border pt-2 text-[10.5px] text-muted-foreground">{fi ? 'Analyysi ei muuta tai hyväksy tietoja. Varmista syy alkuperäisistä asiakirjoista.' : 'Analysis does not change or approve records. Confirm the cause against the original evidence.'}</p>
  </div>;
}

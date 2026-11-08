import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { GitBranch, FileText, Sigma, Wrench, AlertTriangle, Search } from 'lucide-react';
import { api } from '@/api/client';
import PageHeader from '@/components/PageHeader';
import StatusPill from '@/components/StatusPill';
import { useI18n } from '@/lib/i18n';
import { nf, shortDate, tco2 } from '@/lib/format';
import { catLabel } from '@/lib/categories';
import IncidentTracePanel from '@/components/dq/IncidentTracePanel';
import RootCauseButton from '@/components/assistant/RootCauseButton';
import { openAssistant } from '@/lib/assistantContext';

function Section({ icon: Icon, title, children }) {
  return (
    <section className="surface mb-3.5 overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3"><Icon className="h-4 w-4 text-[#2E7099]" /><h2 className="font-heading text-[16px]">{title}</h2></div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Picker({ fi, onPick, initialRun=undefined }) {
  const runs = useQuery({ queryKey: ['runs-all'], queryFn: () => api.runs({ limit: 30 }) });
  const [run, setRun] = useState(initialRun||'');
  const [q, setQ] = useState('');
  const runId = run || runs.data?.[0]?.id;
  const c = useQuery({ queryKey: ['contribs-pick', runId, q], queryFn: () => api.contributions(runId, { q, limit: 30 }), enabled: !!runId });
  if (runs.data && !runs.data.length) return <p className="surface p-6 text-[13px] text-muted-foreground">{fi ? 'Ei laskenta-ajoja vielä. Laske inventaario Vastuullisuus-sivulla.' : 'No calculation runs yet. Calculate the inventory on the Sustainability page.'}</p>;
  return (
    <div className="surface p-4">
      <div className="mb-3 flex flex-wrap gap-2">
        <select value={runId || ''} onChange={(e) => setRun(e.target.value)} className="rounded-full border border-border bg-card px-3 py-2 text-[12px]">
          {(runs.data || []).map((r) => <option key={r.id} value={r.id}>{r.year} · {r.kind} · {r.id.slice(0, 16)} · {shortDate(r.created_at)}</option>)}
        </select>
        <div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={fi ? 'Hae riviä (esim. SH000, M104, S-SAK)' : 'Search line (e.g. SH000, M104, S-SAK)'} className="w-full rounded-full border border-border bg-card py-2 pl-9 pr-3 text-[12.5px]" /></div>
      </div>
      <table className="w-full text-left text-[12px]">
        <tbody>
          {(c.data?.items || []).map((x) => (
            <tr key={x.id} data-ai-context={JSON.stringify({run_id: runId, contribution_id: x.id, label: x.line_item})} className="cursor-pointer border-t border-border/60 hover:bg-secondary/40" onClick={() => onPick(runId, x.id)}>
              <td className="py-1.5 pr-2">{catLabel(x.category, fi ? 'fi' : 'en')}</td>
              <td className="max-w-[300px] truncate py-1.5 pr-2 font-mono text-[10.5px]">{x.line_item}</td>
              <td className="py-1.5 text-right numeral">{tco2(x.tco2e, 3)} t</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Traceability() {
  const { lang } = useI18n();
  const fi = lang === 'fi';
  const [params, setParams] = useSearchParams();
  const runId = params.get('run');
  const cId = params.get('c');
  const incidents = params.get('tab') === 'incidents';
  const lin = useQuery({ queryKey: ['lineage', runId, cId], queryFn: () => api.lineage(runId, cId), enabled: !!runId && !!cId });
  const d = lin.data;
  const c = d?.contribution;

  return (
    <div>
      <PageHeader
        eyebrow={fi ? 'Selitä luku' : 'Explain this number'}
        title={fi ? 'Jäljitettävyys' : 'Traceability'}
        description={fi ? 'Jäljitä raportoidut luvut alkuperäisiin lähteisiin tai selvitä havaintojen mahdolliset juurisyyt.' : 'Trace reported figures to their original sources, or investigate what explains an incident.'}
        actions={cId && <button onClick={() => setParams({})} className="rounded-full border border-border px-4 py-2 text-[12.5px]">{fi ? 'Valitse toinen rivi' : 'Pick another line'}</button>}
      />
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label={fi ? 'Jäljitettävyyden näkymä' : 'Traceability view'}>{[['figures',fi ? 'Lukujen lähteet' : 'Reported figures'],['incidents',fi ? 'Havaintojen juurisyyt' : 'Incident root causes']].map(([id,label])=><button key={id} onClick={()=>setParams((p)=>{p.set('tab',id);return p;})} aria-pressed={incidents === (id === 'incidents')} className={`rounded-full border px-4 py-2 text-[12px] ${incidents === (id === 'incidents') ? 'border-[#1B4968] bg-[#1B4968] text-white' : 'border-border bg-card'}`}>{label}</button>)}</div>
      {incidents ? <IncidentTracePanel /> : !cId ? (
        <Picker fi={fi} initialRun={runId||undefined} onPick={(r, id) => setParams(previous=>{previous.set('run',r);previous.set('c',id);return previous;})} />
      ) : lin.isLoading ? (
        <p className="text-[13px] text-muted-foreground">…</p>
      ) : lin.error ? (
        <p className="surface p-6 text-[13px] text-[#8C3B2E]">{lin.error.message}</p>
      ) : (
        <>
          <Section icon={Sigma} title={fi ? 'Tulos ja kaava' : 'Result and formula'}>
            <button className="mb-3 text-[12px] font-medium text-[#2E7099]" onClick={()=>openAssistant({run_id: runId, contribution_id: cId, year: d.run.year, label: c.line_item})}>{fi ? 'Selitä tämä luku AI:n avulla' : 'Explain this figure with AI'} →</button>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div><div className="eyebrow">{fi ? 'Tulos' : 'Result'}</div><div className="numeral text-[24px]">{nf(c.kgco2e, 3)} kgCO₂e</div><div className="text-[12px] text-muted-foreground">= {nf(c.tco2e, 6)} tCO₂e · {c.in_total ? (fi ? 'lasketaan kokonaissummaan' : 'counted in the total') : fi ? 'raportoidaan, ei kokonaissummassa' : 'reported, not in the total'}</div></div>
              <div className="sm:col-span-2 text-[12px]">
                <div><span className="text-muted-foreground">{fi ? 'Luokka' : 'Category'}:</span> {c.scope} · {catLabel(c.category, lang)}</div>
                <div><span className="text-muted-foreground">{fi ? 'Rivi' : 'Line item'}:</span> <span className="font-mono text-[11px]">{c.line_item}</span></div>
                <div><span className="text-muted-foreground">{fi ? 'Kaava' : 'Formula'}:</span> {c.formula}</div>
                <div><span className="text-muted-foreground">{fi ? 'Kerroin' : 'Factor'}:</span> {c.factor_id} = {c.factor_value ?? '—'} {c.factor_unit} <span className="text-muted-foreground">({c.factor_source})</span></div>
                <div className="mt-1"><StatusPill tone={c.value_status === 'original' ? 'ok' : c.value_status === 'corrected' ? 'approved' : 'review'} dot={false}>{c.value_status}</StatusPill> <span className="ml-1 text-muted-foreground">{fi ? 'ajo' : 'run'} <span className="font-mono">{d.run.id}</span> · {d.run.year} · Scope 2 {d.run.scope2_basis} · {d.run.method_version}</span></div>
              </div>
            </div>
            <div className="mt-3 overflow-x-auto rounded-lg bg-secondary/40 p-2">
              <table className="text-[11.5px]"><tbody>{Object.entries(c.inputs).map(([k, v]) => <tr key={k}><td className="pr-4 text-muted-foreground">{k}</td><td className="font-mono">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</td></tr>)}</tbody></table>
            </div>
          </Section>

          <Section icon={FileText} title={`${fi ? 'Lähderivit' : 'Source rows'} (${d.records.length})`}>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11.5px]">
                <thead className="text-[10.5px] uppercase tracking-wide text-muted-foreground"><tr><th className="py-1.5">record_id</th><th>{fi ? 'Taulu / avain' : 'Table / key'}</th><th>{fi ? 'Tiedosto : rivi' : 'File : row'}</th><th>SHA-256</th><th>{fi ? 'Arvot' : 'Values'}</th></tr></thead>
                <tbody>
                  {d.records.slice(0, 60).map((r) => (
                    <tr key={r.id} data-ai-context={JSON.stringify({record_id: r.id, label: r.record_key, year: d.run.year})} className="border-t border-border/60 align-top">
                      <td className="py-1.5 pr-2 font-mono text-[10.5px]">{r.id}</td>
                      <td className="py-1.5 pr-2">{r.table}<div className="font-mono text-[10.5px] text-muted-foreground">{r.record_key}</div></td>
                      <td className="py-1.5 pr-2">{r.source_file}{r.source_row ? `:${r.source_row}` : ''}{r.synthetic && <StatusPill tone="review" dot={false}>{fi ? 'lisätty korjauksella' : 'added by correction'}</StatusPill>}</td>
                      <td className="py-1.5 pr-2 font-mono text-[10px] text-muted-foreground">{r.batch?.sha256?.slice(0, 12) || '—'}</td>
                      <td className="max-w-[380px] py-1.5 font-mono text-[10px] text-muted-foreground">{Object.entries(r.payload || {}).filter(([k]) => k !== '_document').slice(0, 10).map(([k, v]) => `${k}=${v}`).join(' · ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {d.records.length > 60 && <p className="mt-1 text-[11px] text-muted-foreground">+{d.records.length - 60} {fi ? 'riviä lisää' : 'more rows'}</p>}
            </div>
          </Section>

          {d.linked?.length > 0 && (
            <Section icon={GitBranch} title={`${fi ? 'Linkitetyt tietueet (tunnisteiden perusteella)' : 'Linked records (by identifier)'} (${d.linked.length})`}>
              <p className="mb-2 text-[11.5px] text-muted-foreground">{fi ? 'Eivät ole tämän luvun syötteitä; näyttävät ketjun materiaali → toimittaja → ostorivi → kuljetus. Vain täsmälleen samat tunnisteet linkitetään.' : 'Not inputs of this number; they show the chain material → supplier → purchase line → shipment. Only exact identifier matches are linked.'}</p>
              <table className="w-full text-left text-[11.5px]"><tbody>{d.linked.map((l, i) => (
                <tr key={i} className="border-t border-border/60 align-top"><td className="py-1.5 pr-3 text-muted-foreground">{l.relation}</td><td className="py-1.5 pr-3 font-mono text-[10.5px]">{l.record?.id || '—'}</td><td className="py-1.5 pr-3">{l.record ? `${l.record.table}:${l.record.record_key}` : ''}</td><td className="py-1.5 text-muted-foreground">{l.record ? `${l.record.source_file}:${l.record.source_row}` : ''}</td></tr>
              ))}</tbody></table>
            </Section>
          )}

          <Section icon={Wrench} title={`${fi ? 'Hyväksytyt korjaukset' : 'Approved corrections'} (${d.corrections.length})`}>
            {d.corrections.length ? (
              <table className="w-full text-left text-[11.5px]"><tbody>{d.corrections.map((k) => (
                <tr key={k.id} className="border-t border-border/60"><td className="py-1.5 pr-2 font-mono text-[10.5px]">{k.id}</td><td className="pr-2">{k.record_key} · {k.field || k.action}</td><td className="pr-2 font-mono">{k.original_value ?? '—'} → {k.approved_value ?? '—'}</td><td className="pr-2">{k.reviewer_label} ({fi ? 'ei todennettu' : 'unverified'})</td><td className="pr-2 text-muted-foreground">{shortDate(k.decided_at)}</td><td className="text-muted-foreground">{k.reason}</td></tr>
              ))}</tbody></table>
            ) : <p className="text-[12px] text-muted-foreground">{fi ? 'Tämä rivi käyttää alkuperäisiä arvoja.' : 'This line uses original values.'}</p>}
          </Section>

          {d.open_issues.length > 0 && (
            <Section icon={AlertTriangle} title={`${fi ? 'Avoimet havainnot' : 'Open issues'} (${d.open_issues.length})`}>
              <ul className="space-y-2 text-[12px]">{d.open_issues.map((i) => <li key={i.id} className="flex flex-wrap items-center gap-2"><Link to={`/data-quality?issue=${encodeURIComponent(i.id)}`} className="font-mono text-[11px] text-[#2E7099]">{i.record_key}</Link> · {i.issue_type} · {i.field}: {i.observed_value} → {i.candidate_value ?? '—'} <RootCauseButton issue={i} /></li>)}</ul>
            </Section>
          )}

          {c.kind === 'transport_leg' && (
            <Section icon={GitBranch} title={fi ? 'Reittitieto' : 'Route provenance'}>
              <p className="text-[12px]">{fi ? 'Matka on lähdetiedostossa ilmoitettu (calculated_from_supplied_distance). Tarkkoja lähtö- ja määräpaikkoja ei ole lähdedatassa, joten karttaa ei piirretä.' : 'The distance is the one supplied in the source file (calculated_from_supplied_distance). Exact origin and destination are not in the source data, so no map is drawn.'}</p>
              {d.routes.length > 0 && <ul className="mt-2 text-[12px]">{d.routes.map((r) => <li key={r.id}>{r.id} · {r.provider} · {r.status}{r.is_demo ? ' · DEMO' : ''} · {nf(r.total_km, 1)} km</li>)}</ul>}
            </Section>
          )}

          <Section icon={GitBranch} title={fi ? 'Solmut ja yhteydet' : 'Nodes and edges'}>
            <table className="w-full text-left text-[11px]"><tbody>{d.edges.slice(0, 80).map((e, i) => <tr key={i} className="border-t border-border/50"><td className="py-1 pr-2 font-mono">{e.from}</td><td className="pr-2 text-muted-foreground">— {e.label} →</td><td className="font-mono">{e.to}</td></tr>)}</tbody></table>
          </Section>
        </>
      )}
    </div>
  );
}

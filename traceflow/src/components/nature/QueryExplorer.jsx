import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { GitBranch, Loader2, Play, Save } from 'lucide-react';
import { api, getReviewerLabel, setReviewerLabel } from '@/api/client';
import { useI18n } from '@/lib/i18n';
import { nf } from '@/lib/format';
import LineagePanel from './LineagePanel';
import { useNatureJob } from './useNatureJob';

const PAGE = 50;
// Years, ids and other integer codes are shown as-is; measures get locale formatting.
const cell = (column, v) => (v === null || v === undefined ? '—' : typeof v !== 'number' ? String(v) : /year|_id$|^lat$|^lon$/.test(column) ? String(v) : nf(v, Number.isInteger(v) ? 0 : 2));

// A form value is a string; convert it to the parameter's declared type ('' = null).
function toParams(schema, form) {
  const out = {};
  for (const [name, rule] of Object.entries(schema)) {
    const raw = form[name];
    if (raw === undefined || raw === '') {
      if (rule.nullable) out[name] = null;
      continue;
    }
    out[name] = rule.type === 'integer' ? Number(raw) : raw;
  }
  return out;
}

const initialForm = (schema) => Object.fromEntries(Object.entries(schema).map(([k, r]) => [k, r.default === null || r.default === undefined ? '' : String(r.default)]));

export default function QueryExplorer({ queryId, onQueryChange }) {
  const { lang } = useI18n();
  const fi = lang === 'fi';
  const catalog = useQuery({ queryKey: ['nature', 'queries'], queryFn: api.natureQueries });
  const def = catalog.data?.find((q) => q.id === queryId) || catalog.data?.[0];
  const [form, setForm] = useState({});
  const [submitted, setSubmitted] = useState(null);
  const [page, setPage] = useState(0);
  const [trace, setTrace] = useState(null);
  const [reviewer, setReviewer] = useState(() => { const n = getReviewerLabel(); return n === 'Local reviewer' ? '' : n; });
  const saveJob = useNatureJob();

  useEffect(() => {
    if (def) {
      const f = initialForm(def.parameters);
      setForm(f);
      setSubmitted({ id: def.id, params: toParams(def.parameters, f) });
      setPage(0);
    }
  }, [def?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const result = useQuery({ queryKey: ['nature', 'run', submitted], queryFn: () => api.natureRunQuery(submitted.id, submitted.params), enabled: !!submitted });
  const r = result.data;
  const runId = r?.lineage_runs?.[0]?.run_id;
  const rows = useMemo(() => (r?.rows || []).slice(page * PAGE, page * PAGE + PAGE), [r, page]);
  const run = () => { setSubmitted({ id: def.id, params: toParams(def.parameters, form) }); setPage(0); };
  const save = async () => {
    setReviewerLabel(reviewer);
    await saveJob.submit({ kind: 'save_query', requested_by: reviewer.trim(), query_id: def.id, params: submitted.params });
  };
  useEffect(() => { if (saveJob.job?.status === 'succeeded') result.refetch(); }, [saveJob.job?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  if (catalog.error) return <p className="text-[12.5px] text-[#9E3B2C]">{catalog.error.message}</p>;
  if (!def) return <p className="text-[12.5px] text-muted-foreground">{fi ? 'Ladataan…' : 'Loading…'}</p>;

  return (
    <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-4">
      <aside className="surface max-h-[640px] overflow-y-auto p-3 lg:col-span-1">
        <ul className="space-y-1">
          {catalog.data.map((q) => (
            <li key={q.id}>
              <button onClick={() => onQueryChange(q.id)} className={`w-full rounded-lg px-2.5 py-2 text-left text-[11.5px] leading-snug transition ${q.id === def.id ? 'bg-[#1B4968] text-[#EFF6FC]' : 'hover:bg-secondary'}`} data-query={q.id}>
                <span className="font-medium">{q.id}</span>
                {q.saved_runs > 0 && <span className="ml-1 opacity-70">· {q.saved_runs} {fi ? 'tallennettu' : 'saved'}</span>}
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <div className="min-w-0 space-y-3.5 lg:col-span-3">
        <section className="surface p-5">
          <h2 className="font-heading text-[17px]">{def.id}</h2>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{def.description}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">{fi ? 'Tulosrivin taso' : 'One row per'}: {def.grain}</p>
          {Object.keys(def.parameters).length > 0 && (
            <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
              {Object.entries(def.parameters).map(([name, rule]) => (
                <label key={name} className="block text-[11.5px]">
                  <span className="font-medium">{name}</span>
                  <span className="ml-1 text-muted-foreground">{rule.type}{rule.nullable ? (fi ? ', valinnainen' : ', optional') : ''}</span>
                  {rule.enum ? (
                    <select value={form[name] ?? ''} onChange={(e) => setForm((f) => ({ ...f, [name]: e.target.value }))} className="mt-1 w-full rounded-lg border border-input bg-card px-2.5 py-2">
                      {rule.nullable && <option value="">{fi ? '— kaikki —' : '— all —'}</option>}
                      {rule.enum.map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                  ) : (
                    <input value={form[name] ?? ''} onChange={(e) => setForm((f) => ({ ...f, [name]: e.target.value }))} inputMode={rule.type === 'integer' ? 'numeric' : undefined} placeholder={rule.nullable ? (fi ? 'tyhjä = kaikki' : 'empty = all') : ''} className="mt-1 w-full rounded-lg border border-input bg-card px-2.5 py-2" />
                  )}
                </label>
              ))}
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button onClick={run} disabled={result.isFetching} className="inline-flex items-center gap-2 rounded-full bg-[#1B4968] px-4 py-2 text-[12.5px] font-medium text-[#EFF6FC] hover:bg-[#22557A] disabled:opacity-50" data-testid="nature-run-query">
              {result.isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}{fi ? 'Suorita' : 'Run'}
            </button>
            {r && <span className="text-[12px] text-muted-foreground">{nf(r.row_count)} {fi ? 'riviä' : 'rows'}</span>}
          </div>
          {result.error && <p className="mt-2 text-[12px] text-[#9E3B2C]">{result.error.message}</p>}
        </section>

        {r && (
          <section className="surface p-5">
            <div className="mb-3 rounded-xl border border-border/70 p-3 text-[11.5px] leading-relaxed">
              {runId ? (
                <p>{fi ? 'Jäljitys käytettävissä tallennetusta ajosta' : 'Lineage available from saved run'} <span className="font-mono">{runId}</span>. {fi ? 'Valitse rivin “Lähteet”.' : 'Choose “Sources” on a row.'}</p>
              ) : (
                <div className="flex flex-wrap items-end gap-2">
                  <p className="min-w-[220px] flex-1">{fi ? 'Näillä parametreilla ei ole tallennettua ajoa, joten rivejä ei voi vielä jäljittää. Tallennus kirjaa ajon, tulokset ja lähderivit luontomallin tietokantaan (uudelleenrakennus poistaa ne).' : 'No saved run exists for these parameters, so rows cannot be traced yet. Saving records the execution, results and contributing rows in the nature database (a rebuild removes them).'}</p>
                  <label className="text-[11.5px]"><span className="font-medium">{fi ? 'Nimesi' : 'Your name'}</span><input value={reviewer} onChange={(e) => setReviewer(e.target.value)} maxLength={80} className="mt-1 block rounded-lg border border-input bg-card px-2.5 py-1.5" /></label>
                  <button onClick={save} disabled={!reviewer.trim() || saveJob.busy} className="inline-flex items-center gap-2 rounded-full border border-border px-3.5 py-2 hover:bg-secondary disabled:opacity-50" data-testid="nature-save-run">
                    {saveJob.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}{fi ? 'Tallenna ajo jäljitystä varten' : 'Save run for tracing'}
                  </button>
                </div>
              )}
              {saveJob.error && <p className="mt-1 text-[#9E3B2C]">{saveJob.error}</p>}
              {saveJob.job?.status === 'failed' && <p className="mt-1 text-[#9E3B2C]">{saveJob.job.error}</p>}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-[11.5px]">
                <thead><tr className="border-b border-border text-muted-foreground">{r.columns.map((c) => <th key={c} className="whitespace-nowrap py-2 pr-3 font-medium">{c}</th>)}<th /></tr></thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.result_key} className="border-b border-border/60 align-top">
                      {r.columns.map((c) => <td key={c} className="max-w-[260px] truncate py-1.5 pr-3 tabular-nums" title={row[c] === null ? '' : String(row[c])}>{cell(c, row[c])}</td>)}
                      <td className="py-1.5">{runId && <button onClick={() => setTrace({ queryId: def.id, resultKey: row.result_key, runId })} className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 hover:bg-secondary" data-testid="nature-trace"><GitBranch className="h-3 w-3" />{fi ? 'Lähteet' : 'Sources'}</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {r.row_count > PAGE && (
              <div className="mt-3 flex items-center gap-2 text-[12px]">
                <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="rounded-full border border-border px-3 py-1 disabled:opacity-40">←</button>
                <span>{page * PAGE + 1}–{Math.min((page + 1) * PAGE, r.row_count)} / {nf(r.row_count)}</span>
                <button disabled={(page + 1) * PAGE >= r.row_count} onClick={() => setPage((p) => p + 1)} className="rounded-full border border-border px-3 py-1 disabled:opacity-40">→</button>
              </div>
            )}
          </section>
        )}
      </div>
      <LineagePanel target={trace} onClose={() => setTrace(null)} />
    </div>
  );
}

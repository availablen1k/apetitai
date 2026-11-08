import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Plus } from 'lucide-react';
import { api } from '@/api/client';
import { useI18n } from '@/lib/i18n';
import { nf, shortDate } from '@/lib/format';

const running = (job) => ['queued', 'running'].includes(job?.status);

export default function LiveDemoPanel({ year }) {
  const { lang } = useI18n();
  const fi = lang === 'fi';
  const qc = useQueryClient();
  const [selection, setSelection] = useState(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef(null);
  const latest = useQuery({ queryKey: ['live-demo-latest', year], queryFn: () => api.docs('automation_runs', { workflow_id: 'live_demo', year, sort: '-created_date', limit: 1 }), refetchInterval: 5000 });
  const fallback = selection?.year === year ? selection : latest.data?.[0];
  const id = fallback?.id;
  const progress = useQuery({ queryKey: ['live-demo-job', id], queryFn: () => api.liveDemo(id), enabled: !!id, refetchInterval: (query) => running(query.state.data) ? 1000 : false });
  const job = progress.data || fallback;
  const active = starting || running(job);
  useEffect(() => {
    if (job?.status === 'success' || job?.status === 'failed') for (const queryKey of [['overview'], ['datasets'], ['runs'], ['runs-transport'], ['run'], ['report-calculations'], ['automation-runs'], ['live-demo-latest']]) qc.invalidateQueries({ queryKey });
  }, [job?.id, job?.status, qc]);
  const start = async () => {
    setStarting(true); setError('');
    requestId.current ||= crypto.randomUUID();
    try { const result = await api.startLiveDemo(year, requestId.current); setSelection(result); requestId.current = null; }
    catch (failure) { setError(failure.message); }
    finally { setStarting(false); }
  };
  const stage = { queued: -1, importing: 0, checking: 1, calculating: 2, completed: 3 }[job?.phase] ?? -1;
  return <section id="live-demo" className="surface mb-5 scroll-mt-20 p-5" data-testid="live-demo">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[11px] font-semibold tracking-wide text-[#8A5A1E]">DEMO · {year}</p><h2 className="mt-1 font-heading text-[22px]">{fi ? 'Katso automaatio toiminnassa' : 'See the automation working'}</h2></div><button onClick={start} disabled={active} className="inline-flex min-h-10 items-center gap-2 rounded-full bg-primary px-4 py-2 text-[12px] font-medium text-primary-foreground disabled:opacity-50" data-testid="add-demo-batch">{active ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}{active ? fi ? 'Käsitellään…' : 'Processing…' : fi ? 'Lisää esimerkkierä' : 'Add mock batch'}</button></div>
    <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-muted-foreground">{fi ? `Lisää pieni, DEMO-merkinnällä tallennettava ${year} esimerkkierä: uusi esimerkkitoimipaikka, materiaalihankinta, kuljetus, sähkö ja kylmäaine. Sovellus tarkistaa tiedot ja laskee päästöt automaattisesti oikealla laskentamoottorilla.` : `Add a small, clearly labelled ${year} DEMO batch: a new example site, material purchase, delivery, electricity and refrigerant use. The app checks the records and automatically calculates emissions with the real calculation engine.`}</p>
    <p className="mt-2 text-[11.5px] leading-relaxed text-[#8A5A1E]">{fi ? 'Painike tallentaa synteettiset tiedostot tähän tietokantaan. Mukana on erikseen merkityt esimerkkisähkökertoimet. Demo käynnistyy vain painikkeesta; tarkistuspäätökset ja raportin hyväksyntä kuuluvat ihmiselle.' : 'The button saves synthetic files in this database, including explicitly labelled example electricity factors. Each button press starts one batch; review decisions and report approval remain with a person.'}</p>
    <ol className="mt-4 grid gap-2 sm:grid-cols-3" aria-live="polite">{[fi ? 'Tuo tiedostot' : 'Import files', fi ? 'Tarkista tiedot' : 'Check information', fi ? 'Laske ja tallenna' : 'Calculate and save'].map((label, index) => <li key={label} className={`flex items-center gap-2 rounded-xl p-3 text-[12px] ${stage > index ? 'bg-[#E7F1FA]' : 'bg-secondary/40'}`}>{stage > index ? <Check className="h-4 w-4 text-[#2E7099]" /> : stage === index && active ? <Loader2 className="h-4 w-4 animate-spin" /> : <span className="text-muted-foreground">{index + 1}.</span>}{label}</li>)}</ol>
    {(error || progress.error || latest.error || job?.error) && <p role="alert" className="mt-3 rounded-lg bg-[#F5E4E1] p-3 text-[12px] text-[#8C3B2E]">{error || progress.error?.message || latest.error?.message || job?.error}</p>}
    {job?.status === 'success' && <div className="mt-4 space-y-2" data-testid="demo-result"><p className="text-[15px] font-medium">{fi ? 'DEMO-laskelma tallennettu' : 'DEMO calculation saved'}: {nf(job.total_tco2e, 3)} tCO₂e</p>{job.change_tco2e !== null && <p className="text-[12px] text-muted-foreground">{fi ? 'Muutos edelliseen saman vuoden laskelmaan' : 'Change since the previous saved calculation for this year'}: {job.change_tco2e > 0 ? '+' : ''}{nf(job.change_tco2e, 3)} tCO₂e</p>}<p className="text-[11.5px] text-muted-foreground">{shortDate(job.finished_at)} {job.finished_at?.slice(11, 19)} · {nf(job.records_processed)} {fi ? 'uutta merkintää' : 'new entries'}. {fi ? 'Tulos koskee vain tuotuja tietoja.' : 'The result covers the imported information only.'}</p><div className="flex flex-wrap gap-x-5 gap-y-2 text-[12px] font-medium text-[#2E7099]"><Link to={`/sustainability?year=${year}`}>{fi ? 'Katso päästöt →' : 'View emissions →'}</Link><Link to={`/raw-materials?year=${year}`}>{fi ? 'Katso raaka-aineet →' : 'View raw materials →'}</Link><Link to={`/transport?year=${year}`}>{fi ? 'Katso kuljetukset →' : 'View transport →'}</Link><Link to={`/traceability?run=${job.inventory_run_id}`}>{fi ? 'Tarkista lähteet →' : 'Check sources →'}</Link></div></div>}
    {job && <details className="mt-4 text-[11.5px] text-muted-foreground"><summary className="w-fit cursor-pointer py-1">{fi ? 'Erän käsittelyloki' : 'Batch activity log'}</summary><ul className="mt-2 space-y-1 break-words">{(job.log_en || []).map((line, index) => <li key={index}>{line}</li>)}</ul><p className="mt-2 break-all font-mono text-[10px]">{job.id} · {job.inventory_run_id}</p></details>}
  </section>;
}

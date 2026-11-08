import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, ChevronLeft, ChevronRight, Loader2, Search } from 'lucide-react';
import { api } from '@/api/client';
import StatusPill from '@/components/StatusPill';
import DataReviewFinding from '@/components/dq/DataReviewFinding';
import { useI18n } from '@/lib/i18n';
import { nf, shortDate } from '@/lib/format';
import { datasetName, priorityName } from '@/lib/reviewLanguage';
import { reviewRunLabel, reviewSearch } from '@/lib/agentReviewLanguage';

const field = 'min-h-10 max-w-full rounded-xl border border-border bg-card px-3 py-2 text-[12px]';
const PAGE = 10;
const inProgress = (run) => ['queued', 'running'].includes(run?.status);

export default function DataReviewAgent({ onOpenIssue }) {
  const { lang } = useI18n();
  const fi = lang === 'fi';
  const qc = useQueryClient();
  const [batch, setBatch] = useState('');
  const [selected, setSelected] = useState('');
  const [filters, setFilters] = useState({ q: '', status: 'open', criticality: '' });
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const imports = useQuery({ queryKey: ['datasets'], queryFn: api.datasets });
  const reviews = useQuery({ queryKey: ['data-reviews'], queryFn: () => api.dataReviews(), refetchInterval: (query) => query.state.data?.runs.some(inProgress) ? 1500 : false });
  const runs = reviews.data?.runs || [];
  const signature = runs.map((run) => `${run.id}:${run.status}`).join('|');
  useEffect(() => {
    for (const queryKey of [['dq-issues'], ['dq-stats'], ['data-review']]) qc.invalidateQueries({ queryKey });
  }, [signature, qc]);
  const current = runs.find((run) => run.id === selected) || runs[0];
  const detail = useQuery({ queryKey: ['data-review', current?.id, filters, offset], queryFn: () => api.dataReview(current.id, { ...filters, q: reviewSearch(filters.q), limit: PAGE, offset, group_by_issue: true }), enabled: !!current?.id, refetchInterval: (query) => inProgress(query.state.data) ? 1500 : false });
  const result = detail.data || current;
  const findings = detail.data?.findings || [];
  const total = detail.data?.findings_total || 0;
  useEffect(() => {
    if (detail.isSuccess && offset > 0 && offset >= total) setOffset(Math.max(0, Math.floor((total - 1) / PAGE) * PAGE));
  }, [detail.isSuccess, offset, total]);
  const batches = (imports.data?.batches || []).filter((item) => item.imported_rows > 0);
  const resetFilters = () => { setFilters({ q: '', status: 'open', criticality: '' }); setOffset(0); };
  const setFilter = (key) => (event) => { setFilters((old) => ({ ...old, [key]: event.target.value })); setOffset(0); };
  const start = async (retry) => {
    setBusy(true); setError('');
    try { const run = await api.startDataReview(batch, retry); setSelected(run.id); resetFilters(); qc.invalidateQueries({ queryKey: ['data-reviews'] }); }
    catch (failure) { setError(failure.message); } finally { setBusy(false); }
  };
  const pending = inProgress(result);
  const limited = ['failed', 'degraded', 'interrupted'].includes(result?.status);
  return <div className="space-y-4" data-testid="data-review-agent">
    <section className="surface p-5">
      <h2 className="flex items-center gap-2 font-heading text-[20px]"><Bot className="h-5 w-5 text-[#2E7099]" />{fi ? 'Tietojen tarkistusagentti' : 'Data review agent'}</h2>
      <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-muted-foreground">{fi ? 'Valitse tiedosto ja etsi mahdollisia virheitä. Avaa tarkistettava kohta, vertaa sitä alkuperäisiin tietoihin ja tallenna päätöksesi.' : 'Choose a file to find possible errors. Open an item, check it against the original information and record your decision.'}</p>
      <div className="mt-4 flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1 basis-64 text-[11.5px] text-muted-foreground">{fi ? 'Tarkistettava tiedosto' : 'File to check'}<select value={batch} onChange={(event) => setBatch(event.target.value)} className={`${field} mt-1 block w-full`} data-testid="agent-batch"><option value="">{fi ? 'Valitse tuotu tiedosto…' : 'Choose an imported file…'}</option>{batches.map((item) => <option key={item.id} value={item.id}>{datasetName(item.dataset, lang)} · {item.filename}{item.sheet_name ? ` / ${item.sheet_name}` : ''} · {nf(item.imported_rows)} {fi ? 'merkintää' : 'entries'}</option>)}</select></label>
        <button onClick={() => start(false)} disabled={!batch || busy} className="inline-flex min-h-10 items-center gap-2 rounded-full bg-[#1B4968] px-4 py-2 text-[12px] font-medium text-white disabled:opacity-50" data-testid="start-agent-review">{busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{fi ? 'Tarkista tiedosto' : 'Check this file'}</button>
        <button onClick={() => start(true)} disabled={!batch || busy} className="min-h-10 rounded-full border border-border px-3.5 py-2 text-[12px] disabled:opacity-50">{fi ? 'Tarkista uudelleen' : 'Run checks again'}</button>
      </div>
      <details className="mt-3 text-[11.5px] text-muted-foreground" data-testid="agent-how-it-works"><summary className="w-fit cursor-pointer py-1">{fi ? 'Miten tarkistus toimii?' : 'How checks work'}</summary><div className="mt-2 space-y-2 leading-relaxed">
        <p>{fi ? 'Perustarkistukset käyvät läpi jokaisen merkinnän. AI voi lisäksi tarkistaa otoksen, vertailla aiempia tietoja ja lukea liitettyjä asiakirjoja. Ihminen päättää muutoksista.' : 'Built-in checks screen every entry. AI can also inspect a sample, compare earlier information and read attached documents. A person decides whether anything changes.'}</p>
        <p>{fi ? 'Uudet tiedostot' : 'New files'}: {reviews.isLoading ? '…' : reviews.isError ? fi ? 'automaattisen tarkistuksen tila ei ole saatavilla' : 'automatic checking status unavailable' : reviews.data?.automatic ? fi ? 'tarkistetaan automaattisesti' : 'checked automatically' : fi ? 'tarkistetaan pyynnöstä' : 'checked on request'}.</p>
        <p>{reviews.data?.ai.configured ? fi ? 'AI on käytettävissä. Uusi tarkistus voi käyttää AI:ta uudelleen.' : 'AI is available. Running checks again may use AI again.' : fi ? 'AI ei ole käytettävissä. Perustarkistukset toimivat silti.' : 'AI is unavailable. Built-in checks still work.'}</p>
        {reviews.data?.ai.model && <p>{fi ? 'AI-malli' : 'AI model'}: {reviews.data.ai.model}</p>}
      </div></details>
      {error && <p role="alert" className="mt-2 text-[12px] text-[#8C3B2E]">{error}</p>}
      {imports.error && <p role="alert" className="mt-2 text-[12px] text-[#8C3B2E]">{imports.error.message}</p>}
      {reviews.error && <p role="alert" className="mt-2 text-[12px] text-[#8C3B2E]">{reviews.error.message}</p>}
    </section>
    {result ? <section className="surface overflow-hidden" data-testid="agent-review-result">
      <div className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h3 className="font-heading text-[21px]">{datasetName(result.dataset, lang)}</h3><p className="mt-1 break-all text-[11.5px] text-muted-foreground">{result.filename}</p></div><StatusPill tone={pending ? 'running' : limited ? 'review' : 'draft'} dot={false}>{pending && <Loader2 className="h-3 w-3 animate-spin" />}{reviewRunLabel(result.status, lang)}</StatusPill></div>
        <label className="block text-[11.5px] text-muted-foreground">{fi ? 'Näytettävä tarkistus' : 'Review to view'}<select value={current.id} onChange={(event) => { setSelected(event.target.value); resetFilters(); }} className={`${field} mt-1 block w-full sm:w-auto`} aria-label={fi ? 'Tarkistushistoria' : 'Review history'}>{runs.map((run) => <option key={run.id} value={run.id}>{datasetName(run.dataset, lang)} · {shortDate(run.created_at)} {run.created_at.slice(11, 16)} · {reviewRunLabel(run.status, lang)} · {run.filename}</option>)}</select></label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[{ label: fi ? 'Merkintöjä tiedostossa' : 'Entries in file', value: result.total_rows }, { label: fi ? 'Perustarkistettu' : 'Entries checked', value: pending ? null : result.local_rows }, { label: fi ? 'AI:n tarkistama otos' : 'Entries checked by AI', value: pending ? null : result.ai_rows }, { label: fi ? 'Odottaa tarkistusta' : 'Needs your review', value: result.awaiting_human }].map((item, index) => <div key={index} className={`rounded-xl p-3 ${index === 3 ? 'bg-[#FBF6EE]' : 'bg-secondary/40'}`}><span className="block text-[11px] leading-relaxed text-muted-foreground">{item.label}</span><strong className={`mt-1 block text-[21px] font-medium tabular-nums ${index === 3 ? 'text-[#8A5A1E]' : ''}`}>{item.value === null ? '—' : nf(item.value)}</strong></div>)}
        </div>
        <p className="text-[12px] leading-relaxed text-muted-foreground">{pending ? fi ? 'Tarkistus on käynnissä. Tulokset päivittyvät tähän automaattisesti.' : 'Checks are still running. Results will appear here automatically.' : fi ? 'Havainnot ovat mahdollisia virheitä. Tarkista lähde ennen muutosta. Korjaukset tulevat raporttiin, kun lasket päästöt uudelleen.' : 'These are possible errors. Check the source before changing anything. Confirmed corrections enter the report when you calculate again.'}</p>
        {limited && <p role="status" className="rounded-xl bg-[#FBF6EE] p-3 text-[12px] leading-relaxed text-[#8A5A1E]">{fi ? 'Tarkistus jäi puutteelliseksi. Saatavilla olevat havainnot säilyvät. Tarkista kohdat itse tai käynnistä tarkistus uudelleen.' : 'This review is incomplete. Available findings are kept. Check the items yourself or run the review again.'}</p>}
        <details className="text-[11.5px] text-muted-foreground" data-testid="agent-review-details"><summary className="w-fit cursor-pointer py-1">{fi ? 'Tarkistuksen kattavuus ja lisätiedot' : 'Check coverage and details'}</summary><div className="mt-2 space-y-2 rounded-xl border border-border p-3 leading-relaxed">
          <p>{result.ai_rows > 0 ? fi ? `AI tarkisti ${nf(result.ai_rows)} merkintää ${nf(result.total_rows)} merkinnästä. Otos ei takaa koko aineiston oikeellisuutta. Muita merkintöjä ei ole arvioitu AI:lla.` : `AI checked ${nf(result.ai_rows)} of ${nf(result.total_rows)} entries. A sample does not establish that the whole file is correct. Other entries have no AI assessment.` : fi ? 'Merkintöjä ei ole arvioitu AI:lla.' : 'No entries received an AI assessment.'}</p>
          {result.summary && <p>{result.summary}</p>}
          {result.error && <p className="break-words text-[#8C3B2E]">{result.error}</p>}
          <ul className="space-y-1">{(result.notes || []).map((note, index) => <li key={index} className="break-words">{note}</li>)}</ul>
          <p className="break-all font-mono text-[10px]">{result.id} · {result.status} · {result.mode} · {result.model}</p>
        </div></details>
      </div>
      <div className="border-t border-border bg-secondary/20 px-4 py-4 sm:px-5">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2"><h3 className="text-[14px] font-semibold">{fi ? 'Tarkistettavat kohdat' : 'Items to check'}</h3><span className="text-[11.5px] text-muted-foreground">{detail.isFetching ? fi ? 'Päivitetään…' : 'Updating…' : `${nf(total)} ${fi ? 'kohtaa' : 'items'}`}</span></div>
        <div className="flex flex-wrap gap-2">
          <label className="relative min-w-0 flex-1 basis-56"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><input value={filters.q} onChange={setFilter('q')} placeholder={fi ? 'Hae tilaa, kasvia tai viitettä' : 'Search a farm, crop or reference'} aria-label={fi ? 'Hae tarkistettavia kohtia' : 'Search review items'} className={`${field} w-full pl-9`} data-testid="agent-search" maxLength={200} /></label>
          <select value={filters.status} onChange={setFilter('status')} aria-label={fi ? 'Käsittelytilanne' : 'Review status'} className={field} data-testid="agent-status-filter"><option value="open">{fi ? 'Odottaa tarkistusta' : 'Needs checking'}</option><option value="all">{fi ? 'Kaikki kohdat' : 'All items'}</option><option value="reviewed">{fi ? 'Käsitelty' : 'Already reviewed'}</option><option value="withdrawn">{fi ? 'Ei enää poikkeamaa' : 'No longer flagged'}</option></select>
          <select value={filters.criticality} onChange={setFilter('criticality')} aria-label={fi ? 'Kiireellisyys' : 'Priority'} className={field}><option value="">{fi ? 'Kaikki kiireellisyydet' : 'All priorities'}</option>{['critical', 'high', 'medium', 'low'].map((severity) => <option key={severity} value={severity}>{priorityName(severity, lang)}</option>)}</select>
        </div>
      </div>
      {detail.isLoading ? <p role="status" className="p-5 text-[12px] text-muted-foreground">{fi ? 'Haetaan tarkistettavia kohtia…' : 'Loading review items…'}</p> : detail.isError ? <p role="alert" className="p-5 text-[12px] text-[#8C3B2E]">{detail.error.message}</p> : findings.length ? <ul data-testid="agent-findings">{findings.map((finding) => <DataReviewFinding key={finding.id} finding={finding} dataset={result.dataset} lang={lang} onOpenIssue={onOpenIssue} />)}</ul> : <div className="border-t border-border p-5 text-[12px] leading-relaxed text-muted-foreground"><p>{fi ? 'Näillä suodattimilla ei löytynyt kohtia. Tämä ei vahvista koko aineiston oikeellisuutta.' : 'No items match these filters. This does not confirm that the whole file is correct.'}</p><button onClick={resetFilters} className="mt-2 font-medium text-[#2E7099] hover:underline">{fi ? 'Palauta suodattimet' : 'Reset filters'}</button></div>}
      {total > PAGE && <nav aria-label={fi ? 'Tarkistustulosten sivut' : 'Review result pages'} className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-[12px] text-muted-foreground"><span>{nf(offset + 1)}–{nf(Math.min(offset + PAGE, total))} / {nf(total)}</span><div className="flex gap-2"><button onClick={() => setOffset(Math.max(0, offset - PAGE))} disabled={offset === 0 || detail.isFetching} aria-label={fi ? 'Edellinen sivu' : 'Previous page'} className="inline-flex min-h-9 items-center gap-1 rounded-full border border-border px-3 py-1.5 disabled:opacity-40"><ChevronLeft className="h-3.5 w-3.5" />{fi ? 'Edellinen' : 'Previous'}</button><button onClick={() => setOffset(offset + PAGE)} disabled={offset + PAGE >= total || detail.isFetching} aria-label={fi ? 'Seuraava sivu' : 'Next page'} className="inline-flex min-h-9 items-center gap-1 rounded-full border border-border px-3 py-1.5 disabled:opacity-40" data-testid="agent-next-page">{fi ? 'Seuraava' : 'Next'}<ChevronRight className="h-3.5 w-3.5" /></button></div></nav>}
    </section> : <p role="status" className="p-4 text-[12px] text-muted-foreground">{reviews.isLoading ? fi ? 'Haetaan tarkistuksia…' : 'Loading reviews…' : fi ? 'Ei tarkistuksia vielä. Valitse tiedosto aloittaaksesi.' : 'No reviews yet. Choose a file to get started.'}</p>}
  </div>;
}

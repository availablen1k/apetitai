import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { UploadCloud, Loader2, Bot, CheckCircle2, Search } from 'lucide-react';
import { api, getReviewerLabel, setReviewerLabel } from '@/api/client';
import { useI18n } from '@/lib/i18n';
import { nf } from '@/lib/format';
import { EvidenceDocument } from './EvidencePanel';

const field = 'rounded-lg border border-border bg-card px-3 py-2 text-[12px]';
const category = {
  unclassified: ['Valitse luokka…', 'Choose category…'], supplier_pcf: ['Toimittajan hiilijalanjälki', 'Supplier carbon footprint'],
  invoice: ['Lasku', 'Invoice'], freight: ['Rahti / kuljetus', 'Freight / transport'], certificate: ['Todistus', 'Certificate'], report: ['Raportti', 'Report'], other: ['Muu asiakirja', 'Other document'],
};
const linkKey = (l) => `${l.entity_type}:${l.entity_id}`;

function LinkPicker({ suggestions, selected, existing, onChange, fi }) {
  const [type, setType] = useState('supplier');
  const [q, setQ] = useState('');
  const found = useQuery({ queryKey: ['upload-targets', type, q], queryFn: () => api.uploadTargets(type, q), enabled: q.trim().length >= 2 });
  const options = [...new Map([...selected, ...suggestions, ...(q.trim().length >= 2 ? found.data || [] : [])].map((l) => [linkKey(l), l])).values()].filter((l) => !existing.some((x) => linkKey(x) === linkKey(l)));
  return <div className="rounded-xl border border-border p-3">
    <p className="text-[12px] font-medium">{fi ? 'Linkitä olemassa oleviin tietoihin' : 'Link to existing records'}</p>
    <p className="mt-1 text-[11px] text-muted-foreground">{fi ? 'Ehdotukset perustuvat tunnisteisiin tai nimiin. Valitse vain oikeat kohteet.' : 'Suggestions use identifiers or names found in the file. Select the correct matches.'}</p>
    <div className="mt-2 flex flex-wrap gap-2">
      <select className={field} value={type} onChange={(e) => setType(e.target.value)} aria-label={fi ? 'Linkin tyyppi' : 'Link type'}>{['supplier', 'material', 'shipment', 'dq_issue', 'source_record', 'route_proposal'].map((t) => <option key={t}>{t}</option>)}</select>
      <input className={`${field} min-w-44 flex-1`} value={q} onChange={(e) => setQ(e.target.value)} placeholder={fi ? 'Hae nimellä tai tunnisteella…' : 'Search name or ID…'} aria-label={fi ? 'Hae linkitettävää tietoa' : 'Search records to link'} />
    </div>
    {found.error && <p className="mt-1 text-[11px] text-[#8C3B2E]">{found.error.message}</p>}
    <div className="mt-2 max-h-48 space-y-1 overflow-auto">
      {options.map((l) => <label key={linkKey(l)} className="flex items-start gap-2 rounded-lg bg-secondary/40 p-2 text-[11.5px]">
        <input type="checkbox" checked={selected.some((s) => linkKey(s) === linkKey(l))} onChange={(e) => onChange(e.target.checked ? [...selected, l] : selected.filter((s) => linkKey(s) !== linkKey(l)))} className="mt-0.5" />
        <span><span className="font-medium">{l.entity_type} · {l.label || l.entity_id}</span>{l.reason && <span className="block text-muted-foreground">{l.reason}</span>}</span>
      </label>)}
      {!options.length && <p className="text-[11px] text-muted-foreground">{fi ? 'Ei ehdotuksia. Hae kohdetta tai jätä linkittämättä.' : 'No suggested matches. Search for a record, or leave the file unlinked.'}</p>}
    </div>
  </div>;
}

function UploadReview({ data, fi, onConfirmed }) {
  const [destination, setDestination] = useState(data.last_decision?.destination || (data.table?.headers.length > 1 ? 'dataset' : 'evidence'));
  const [dataset, setDataset] = useState(data.last_import?.dataset || data.table?.dataset || '');
  const [mapping, setMapping] = useState(data.last_import?.mapping || data.table?.mapping || {});
  const [docType, setDocType] = useState(data.last_decision?.document_type || data.suggested_document_type);
  const [year, setYear] = useState(data.last_decision?.reporting_year ? String(data.last_decision.reporting_year) : data.suggested_years.length === 1 ? String(data.suggested_years[0]) : '');
  const [reviewer, setReviewer] = useState(getReviewerLabel());
  const [links, setLinks] = useState([]);
  const [wholeFile, setWholeFile] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notes, setNotes] = useState('');
  const def = data.catalog.find((d) => d.id === dataset);
  const headers = data.table?.headers || [];
  const columns = def?.columns || [];
  const canConfirm = reviewer.trim() && (destination === 'dataset' ? def && data.table : docType !== 'unclassified');

  const suggest = async () => {
    setBusy('suggest'); setError('');
    try {
      const r = await api.suggestUploadMapping(data.id, { dataset: dataset || undefined, sheet: data.table?.sheet || undefined });
      if (r.dataset) setDataset(r.dataset);
      setMapping(r.mapping || {});
      setNotes([r.notes, ...(r.errors || []), ...(r.dropped || []).map((x) => `${fi ? 'Ohitettu' : 'Dropped'}: ${x}`)].filter(Boolean).join(' · '));
    } catch (e) { setError(e.message); } finally { setBusy(''); }
  };
  const confirm = async () => {
    setBusy('confirm'); setError('');
    try {
      const r = await api.confirmUpload(data.id, {
        destination, dataset: destination === 'dataset' ? dataset : undefined,
        sheet: destination === 'dataset' || !wholeFile ? data.table?.sheet || undefined : undefined,
        mapping: destination === 'dataset' ? mapping : undefined,
        document_type: destination === 'dataset' && docType === 'unclassified' ? 'other' : docType,
        reporting_year: year ? Number(year) : null, reviewer_label: reviewer,
        expected_revision: data.revision, links: links.map(({ entity_type, entity_id }) => ({ entity_type, entity_id })),
      });
      setReviewerLabel(reviewer);
      onConfirmed(r);
    } catch (e) { setError(e.message + (e.details?.errors ? ` ${JSON.stringify(e.details.errors)}` : '')); } finally { setBusy(''); }
  };
  return <div className="mt-4 space-y-4" data-testid="upload-review">
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="space-y-1 text-[12px]"><span className="block font-medium">{fi ? 'Kohde' : 'Destination'}</span><select className={`${field} w-full`} value={destination} onChange={(e) => setDestination(e.target.value)} data-testid="upload-destination"><option value="evidence">{fi ? 'Asiakirjakirjasto (näyttö)' : 'Document library (evidence)'}</option>{data.table && <option value="dataset">{fi ? 'Tuo rivit aineistoon' : 'Import rows into a dataset'}</option>}</select></label>
      <label className="space-y-1 text-[12px]"><span className="block font-medium">{fi ? 'Asiakirjan luokka' : 'Document category'}</span><select className={`${field} w-full`} value={docType} onChange={(e) => setDocType(e.target.value)} data-testid="upload-category">{Object.entries(category).map(([k, labels]) => <option key={k} value={k}>{labels[fi ? 0 : 1]}</option>)}</select></label>
      <label className="space-y-1 text-[12px]"><span className="block font-medium">{fi ? 'Raportointivuosi (valinnainen)' : 'Reporting year (optional)'}</span><input type="number" min="2000" max="2100" className={`${field} w-full`} value={year} onChange={(e) => setYear(e.target.value)} data-testid="upload-year" />{data.suggested_years.length > 0 && <span className="block text-[11px] text-muted-foreground">{fi ? 'Tiedostosta löytyneet vuodet' : 'Years found in file'}: {data.suggested_years.join(', ')}</span>}</label>
      <label className="space-y-1 text-[12px]"><span className="block font-medium">{fi ? 'Tarkastajan nimi' : 'Reviewer name'}</span><input className={`${field} w-full`} value={reviewer} onChange={(e) => setReviewer(e.target.value)} maxLength={80} data-testid="upload-reviewer" /><span className="block text-[11px] text-muted-foreground">{fi ? 'Vapaa nimi ilman kirjautumista.' : 'A typed name without login.'}</span></label>
    </div>
    {destination === 'evidence' && data.table?.sheets.length > 0 && <label className="flex items-center gap-2 text-[12px]"><input type="checkbox" checked={wholeFile} onChange={(e) => setWholeFile(e.target.checked)} />{fi ? 'Luokittele koko työkirja asiakirjaksi (muuten vain valittu välilehti).' : 'Classify the entire workbook as a document (otherwise only the selected worksheet).'}</label>}
    {destination === 'dataset' && <div className="rounded-xl border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-[12px] font-medium">{fi ? 'Aineisto' : 'Dataset'} <select className={`${field} ml-2 max-w-full`} value={dataset} onChange={(e) => { setDataset(e.target.value); setMapping({}); }} data-testid="upload-dataset"><option value="">{fi ? 'Valitse aineisto…' : 'Choose dataset…'}</option>{data.catalog.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}</select></label>
        <button type="button" onClick={suggest} disabled={!!busy} className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-2 text-[11.5px] disabled:opacity-50"><Bot className="h-3 w-3" />{busy === 'suggest' ? '…' : fi ? 'Ehdota sarakkeita' : 'Suggest columns'}</button>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">{nf(data.table.total_rows)} {fi ? 'riviä. Tarkista sarakkeet, päivämäärät ja yksiköt (t, kg, km). Arvoja ei muunneta automaattisesti. Raportointivuosi yllä ei muuta rivien vuosia.' : 'rows. Check columns, dates and units (t, kg, km). Values are imported as written, without automatic conversion. The year above does not change the years in the rows.'}</p>
      {notes && <p className="mt-2 text-[11px] text-[#8A5A1E]">{notes}</p>}
      <div className="mt-2 max-h-72 overflow-auto"><table className="w-full text-left text-[11.5px]"><thead className="text-muted-foreground"><tr><th>{fi ? 'Kohdesarake' : 'Target column'}</th><th>{fi ? 'Tiedoston sarake' : 'File column'}</th><th>{fi ? 'Esimerkki' : 'Sample'}</th></tr></thead><tbody>{columns.map((c) => {
        const source = mapping[c] || (headers.includes(c) ? c : '');
        return <tr key={c} className="border-t border-border/60"><td className="py-1 pr-2 font-mono">{c}{def.required.includes(c) ? ' *' : ''}</td><td className="py-1 pr-2"><select className="w-full rounded border border-border bg-card p-1" value={source} onChange={(e) => setMapping({ ...mapping, [c]: e.target.value })} aria-label={`Map ${c}`}><option value="">—</option>{headers.map((h) => <option key={h}>{h}</option>)}</select></td><td className="max-w-40 truncate">{data.table.sample[0]?.[headers.indexOf(source)] || ''}</td></tr>;
      })}</tbody></table></div>
      {!def && <p className="mt-2 text-[11.5px] text-[#8A5A1E]">{fi ? 'Tiedoston rakennetta ei tunnistettu. Valitse aineisto ja yhdistä sarakkeet.' : 'Unrecognised layout. Choose a dataset and map its columns.'}</p>}
      <details className="mt-2 text-[11px]"><summary className="cursor-pointer">{fi ? 'Esikatsele lähderivejä' : 'Preview source rows'}</summary><div className="mt-1 overflow-auto"><table className="text-left"><thead><tr>{headers.map((h) => <th key={h} className="pr-3">{h}</th>)}</tr></thead><tbody>{data.table.sample.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} className="pr-3">{v}</td>)}</tr>)}</tbody></table></div></details>
    </div>}
    <LinkPicker suggestions={data.suggested_links} selected={links} existing={data.evidence.links} onChange={setLinks} fi={fi} />
    {error && <p role="alert" className="rounded-lg bg-[#F5E4E1] p-3 text-[12px] text-[#8C3B2E]">{error}</p>}
    <button type="button" onClick={confirm} disabled={!canConfirm || !!busy} className="inline-flex items-center gap-2 rounded-full bg-[#1B4968] px-4 py-2 text-[12px] font-medium text-[#EFF6FC] disabled:opacity-50" data-testid="confirm-upload">{busy === 'confirm' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}{destination === 'dataset' ? fi ? 'Vahvista kohde ja tuo rivit' : 'Confirm destination and import rows' : fi ? 'Vahvista luokka ja linkit' : 'Confirm category and links'}</button>
    <p className="text-[11px] text-muted-foreground">{fi ? 'Luokittelu tallennetaan muutoshistoriaan. Mahdolliset laskentakorjaukset hyväksytään erikseen.' : 'Classification is recorded in the audit history. Accounting corrections still need separate approval.'}</p>
  </div>;
}

function UploadDetails({ id, fi }) {
  const qc = useQueryClient();
  const [sheet, setSheet] = useState('');
  const [result, setResult] = useState(null);
  const detail = useQuery({ queryKey: ['upload-detail', id, sheet], queryFn: () => api.upload(id, sheet || undefined) });
  if (detail.isLoading) return <p className="p-4 text-[12px]">{fi ? 'Luetaan tiedostoa…' : 'Reading file…'}</p>;
  if (detail.error) return <p role="alert" className="p-4 text-[12px] text-[#8C3B2E]">{detail.error.message}</p>;
  const d = detail.data;
  return <div className="surface mt-4 p-4" data-testid="upload-detail">
    <div className="mb-3 flex flex-wrap items-center gap-3"><h3 className="font-heading text-[18px]">{d.evidence.filename}</h3><span className="text-[11px] text-muted-foreground">{d.state === 'confirmed' ? fi ? 'Luokiteltu' : 'Classified' : fi ? 'Odottaa luokittelua' : 'Needs classification'}</span></div>
    <ul><EvidenceDocument d={d.evidence} fi={fi} /></ul>
    {d.table?.sheets.length > 0 && <label className="mt-3 block text-[12px] font-medium">{fi ? 'Laskentataulukko' : 'Worksheet'} <select className={`${field} ml-2`} value={d.table.sheet} onChange={(e) => { setSheet(e.target.value); setResult(null); }} data-testid="upload-sheet">{d.table.sheets.map((s) => <option key={s} value={s}>{s}{d.decisions.some((x) => x.sheet === s) ? ' ✓' : ''}</option>)}</select><span className="ml-2 text-[11px] font-normal text-muted-foreground">{fi ? 'Tarkista jokainen välilehti erikseen.' : 'Review every worksheet separately.'}</span></label>}
    {d.table_error && <p className="mt-2 rounded-lg bg-[#FBF6EE] p-2 text-[11.5px] text-[#8A5A1E]">{d.table_error}</p>}
    {result && <div role="status" className="mt-3 rounded-xl bg-[#E7F1FA] p-3 text-[12px]" data-testid="upload-confirmed">{fi ? 'Luokittelu tallennettu.' : 'Classification saved.'}{result.imported && <> {nf(result.imported.batch.imported_rows)} {fi ? 'uutta riviä' : 'new rows'} · {nf(result.imported.batch.duplicate_rows)} {fi ? 'jo olemassa' : 'already present'} · {nf(result.imported.batch.rejected_rows)} {fi ? 'hylätty' : 'rejected'}.</>}{result.imported?.batch.errors?.map((e, i) => <p key={i}>{fi ? 'Rivi' : 'Line'} {e.line}: {e.reason}</p>)}{result.remaining_sheets?.length > 0 && <p>{fi ? 'Vielä luokittelematta' : 'Still to classify'}: {result.remaining_sheets.join(', ')}</p>}</div>}
    {result?.agent_review && <p className="mt-2 rounded-lg bg-[#FBF6EE] p-3 text-[12px] text-[#8A5A1E]">{fi ? 'Tietojen tarkistus on jonossa. Katso Tietoagentti- ja Poikkeamat-välilehdet. Korjaukset vaativat ihmisen päätöksen.' : 'Data review is queued. See the Data review agent and Incidents tabs. Corrections require a human decision.'}</p>}
    <UploadReview key={`${id}:${d.table?.sheet || ''}`} data={d} fi={fi} onConfirmed={(r) => { setResult(r); qc.invalidateQueries(); }} />
    {d.decisions.length > 0 && <details className="mt-4 text-[11px]"><summary className="cursor-pointer">{fi ? 'Luokitteluhistoria' : 'Classification history'} ({d.decisions.length})</summary>{d.decisions.map((x) => <p key={x.id} className="mt-1">{x.sheet || d.evidence.filename} · {x.dataset || category[x.document_type]?.[fi ? 0 : 1] || x.document_type} · {x.reporting_year || '—'} · {x.reviewer_label}</p>)}</details>}
  </div>;
}

export default function UploadInbox() {
  const { lang } = useI18n();
  const fi = lang === 'fi';
  const qc = useQueryClient();
  const fileInput = useRef(null);
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [state, setState] = useState('');
  const [kind, setKind] = useState('');
  const [year, setYear] = useState('');
  const [offset, setOffset] = useState(0);
  const [active, setActive] = useState('');
  const list = useQuery({ queryKey: ['upload-inbox', q, state, kind, year, offset], queryFn: () => api.uploads({ q, state, kind, year, limit: 20, offset }) });
  const capabilities = useQuery({ queryKey: ['upload-capabilities'], queryFn: api.uploadCapabilities });
  const submit = async () => {
    setBusy(true); setError('');
    try {
      const r = await api.queueUploads(files);
      setFiles([]); setOffset(0); setQ(''); setState(''); setKind(''); setYear('');
      if (fileInput.current) fileInput.current.value = '';
      const first = r.results.find((x) => x.id);
      if (first) setActive(first.id);
      setError(r.results.filter((x) => x.error).map((x) => `${x.filename}: ${x.error}`).join(' · '));
      qc.invalidateQueries();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const items = list.data?.items || [];
  return <div>
    <div className="surface p-5">
      <h2 className="font-heading text-[20px]">{fi ? 'Tiedostot' : 'Uploads'}</h2>
      <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{fi ? 'Lisää taulukot, PDF:t, Word-tiedostot tai muut asiakirjat tähän. Tarkista ehdotettu kohde ja linkit ennen vahvistusta. Epäselvät tiedostot odottavat luokittelua.' : 'Add tables, PDFs, Word files or other documents here. Review the proposed destination and links before confirming. Uncertain files stay in Needs classification.'}</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <input ref={fileInput} type="file" multiple onChange={(e) => setFiles(Array.from(e.target.files || []))} className="min-w-0 flex-1 text-[12px]" aria-label={fi ? 'Lisää tiedostoja' : 'Choose files'} data-testid="inbox-files" />
        <button onClick={submit} disabled={!files.length || busy} className="inline-flex items-center gap-2 rounded-full bg-[#1B4968] px-4 py-2 text-[12px] font-medium text-[#EFF6FC] disabled:opacity-50" data-testid="queue-files">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}{fi ? 'Lisää tiedostot' : 'Add to Uploads'}</button>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">{capabilities.data ? `${nf(capabilities.data.max_upload_bytes / 1048576)} MB / ${fi ? 'tiedosto' : 'file'}. ` : ''}{fi ? 'Alkuperäinen tiedosto säilyy. Rivien tuonti alkaa vasta vahvistuksesta.' : 'The original file is kept. Rows are imported only after confirmation.'}</p>
      {error && <p role="alert" className="mt-2 text-[12px] text-[#8C3B2E]">{error}</p>}
    </div>
    <div className="surface mt-3 overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        <Search className="h-4 w-4 text-muted-foreground" /><input value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} placeholder={fi ? 'Hae tiedostoa tai tekstiä…' : 'Search filename or text…'} aria-label={fi ? 'Hae tiedostoista' : 'Search uploads'} className={`${field} min-w-40 flex-1`} />
        <select value={state} onChange={(e) => { setState(e.target.value); setOffset(0); }} className={field} aria-label={fi ? 'Luokittelun tila' : 'Classification status'}><option value="">{fi ? 'Kaikki tilat' : 'All statuses'}</option><option value="needs_classification">{fi ? 'Odottaa luokittelua' : 'Needs classification'}</option><option value="confirmed">{fi ? 'Luokiteltu' : 'Classified'}</option></select>
        <select value={kind} onChange={(e) => { setKind(e.target.value); setOffset(0); }} className={field} aria-label={fi ? 'Tiedostotyyppi' : 'Upload file type'}><option value="">{fi ? 'Kaikki tyypit' : 'All types'}</option>{['pdf', 'docx', 'text', 'spreadsheet', 'office', 'image', 'other'].map((k) => <option key={k}>{k}</option>)}</select>
        <input type="number" min="2000" max="2100" value={year} onChange={(e) => { setYear(e.target.value); setOffset(0); }} className={`${field} w-24`} placeholder={fi ? 'Vuosi' : 'Year'} aria-label={fi ? 'Vahvistettu raportointivuosi' : 'Confirmed reporting year'} />
      </div>
      {list.error && <p className="p-3 text-[12px] text-[#8C3B2E]">{list.error.message}</p>}
      {items.map((u) => <button key={u.id} onClick={() => setActive(u.id)} className={`flex w-full flex-wrap items-center gap-2 border-b border-border/60 px-4 py-3 text-left text-[12px] ${active === u.id ? 'bg-[#E7F1FA]' : 'hover:bg-secondary/40'}`} data-testid="upload-inbox-row"><span className="font-medium">{u.filename}</span><span className="text-[10.5px] text-muted-foreground">{u.kind}{u.decision?.dataset ? ` · ${u.decision.dataset}` : ''}{u.decision?.reporting_year ? ` · ${u.decision.reporting_year}` : ''}</span><span className={`ml-auto rounded-full px-2 py-1 text-[10.5px] ${u.state === 'confirmed' ? 'bg-[#E3EFE7] text-[#275840]' : 'bg-[#FBF6EE] text-[#8A5A1E]'}`}>{u.state === 'confirmed' ? fi ? 'Luokiteltu' : 'Classified' : fi ? 'Odottaa luokittelua' : 'Needs classification'}</span></button>)}
      {!items.length && <p className="p-5 text-[12px] text-muted-foreground">{list.isLoading ? '…' : fi ? 'Ei tiedostoja näillä suodattimilla.' : 'No uploads match these filters.'}</p>}
      <div className="flex items-center gap-2 p-3 text-[11px]"><span className="mr-auto">{nf(list.data?.total || 0)} {fi ? 'tiedostoa' : 'files'}</span><button disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 20))} className="rounded border border-border px-2 py-1 disabled:opacity-40">←</button><button disabled={offset + items.length >= (list.data?.total || 0)} onClick={() => setOffset(offset + 20)} className="rounded border border-border px-2 py-1 disabled:opacity-40">→</button></div>
    </div>
    {active && <UploadDetails key={active} id={active} fi={fi} />}
  </div>;
}

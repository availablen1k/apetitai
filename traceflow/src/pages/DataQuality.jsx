import { useEffect, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Search, Loader2, ScanSearch, ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '@/api/client';
import PageHeader from '@/components/PageHeader';
import IssueRow from '@/components/dq/IssueRow';
import IncidentFlow from '@/components/dq/IncidentFlow';
import IssueDrawer from '@/components/dq/IssueDrawer';
import UploadInbox from '@/components/dq/UploadInbox';
import DataReviewAgent from '@/components/dq/DataReviewAgent';
import { useI18n } from '@/lib/i18n';
import { nf, issueLabel } from '@/lib/format';
import { datasetName, priorityName } from '@/lib/reviewLanguage';
import { periodLink } from '@/lib/decisions';
import { useToast } from '@/components/ui/use-toast';

const TABS = [
  { id: 'inbox', fi: 'Poikkeamat', en: 'Incidents' },
  { id: 'import', fi: 'Tiedostot', en: 'Uploads' },
];
// Earlier tab links: the file checker now sits under Uploads; the rest moved to other pages.
const MOVED = { agent: 'import', discovery: '/actions#findings', datasets: '/platform', documents: '/platform#documents', audit: '/platform#history' };
const PAGE = 50;

export default function DataQuality() {
  const { t, lang } = useI18n();
  const fi = lang === 'fi';
  const { toast } = useToast();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const moved = MOVED[requestedTab];
  const tab = TABS.some((item) => item.id === requestedTab) ? requestedTab : moved === 'import' ? 'import' : 'inbox';
  const setTab = (value) => setSearchParams((params) => { params.set('tab', value); return params; });
  const [filters, setFilters] = useState({ status: 'open', criticality: '', rule_id: '', table: '', year: searchParams.get('year') || '', issue_type: '', q: '' });
  const includeShared=searchParams.get('shared')!=='false';
  const effectiveFilters={...filters,include_shared:!!filters.year&&includeShared};
  const [offset, setOffset] = useState(0);
  const [openId, setOpenId] = useState(searchParams.get('issue'));
  useEffect(() => setOpenId(searchParams.get('issue')), [searchParams]);
  useEffect(() => { setFilters((previous) => ({...previous, year: searchParams.get('year') || ''})); }, [searchParams]);
  const [flowOpen,setFlowOpen]=useState(searchParams.get('view')==='flow');
  const [scanning, setScanning] = useState(false);
  useEffect(() => setOffset(0), [filters]);

  const stats = useQuery({ queryKey: ['dq-stats'], queryFn: api.issueStats });
  const records = useQuery({ queryKey: ['datasets'], queryFn: api.datasets });
  const issues = useQuery({ queryKey: ['dq-issues', effectiveFilters, offset], queryFn: () => api.issues({ ...effectiveFilters, sort: 'impact', limit: PAGE, offset }), placeholderData: (prev) => prev });
  const set = (k) => (e) => {
    const value = e.target.value;
    setFilters((f) => ({ ...f, [k]: value }));
    if (k === 'year') setSearchParams((p) => { if (value) p.set('year', value); else p.delete('year'); return p; });
  };
  const s = stats.data || {};
  const totalRecords = (records.data?.datasets || []).reduce((sum, d) => sum + d.record_count, 0);

  const scan = async () => {
    setScanning(true);
    try {
      const r = await api.scan();
      qc.invalidateQueries();
      toast({ title: fi ? 'Tarkistus valmis' : 'Checks finished', description: `${nf(r.created)} ${fi ? 'uutta tarkistettavaa kohtaa' : 'new items to check'} · ${nf(r.unchanged + r.updated)} ${fi ? 'aiempaa kohtaa tarkistettu uudelleen' : 'existing items checked again'}` });
    } catch (e) {
      toast({ title: fi ? 'Ajo epäonnistui' : 'Scan failed', description: e.message, variant: 'destructive' });
    } finally {
      setScanning(false);
    }
  };

  if (moved && moved !== 'import') return <Navigate to={periodLink(moved, searchParams.get('year'))} replace />;
  const total = issues.data?.total || 0;
  const rows = issues.data?.items || [];
  return (
    <div data-ai-incidents={tab==='inbox'?JSON.stringify(Object.fromEntries(Object.entries(effectiveFilters).filter(([,value])=>value!==''))):undefined}>
      <PageHeader
        eyebrow={t('dq.eyebrow')}
        title={t('dq.title')}
        description={t('dq.subtitle')}
        actions={
          <button onClick={scan} disabled={scanning} className="inline-flex items-center gap-2 rounded-full bg-[#1B4968] px-4 py-2 text-[12.5px] font-medium text-[#EFF6FC] transition hover:bg-[#22557A] disabled:opacity-50" data-testid="run-scan">
            {scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScanSearch className="h-3.5 w-3.5" />}
            {fi ? 'Etsi mahdollisia virheitä' : 'Check for possible errors'}
          </button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-1.5 rounded-full border border-border bg-card p-1">
        {TABS.map((tb) => (
          <button key={tb.id} data-tab={tb.id} onClick={() => setTab(tb.id)} className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-medium transition ${tab === tb.id ? 'bg-[#1B4968] text-[#EFF6FC]' : 'text-muted-foreground hover:text-foreground'}`}>
            {fi ? tb.fi : tb.en}
          </button>
        ))}
      </div>

      {tab === 'inbox' && (
        <>
          <p className="mb-3 text-[12.5px] text-muted-foreground" data-testid="incident-summary"><strong className="text-foreground">{issues.isLoading?'…':nf(total)}</strong> {fi?'poikkeamaa, suurin päästövaikutus ensin. Merkintä ei vielä tarkoita virhettä: tarkista lähde ennen korjausta.':'incidents, largest footprint impact first. A flag is not yet an error: check the source before correcting.'}</p>
          <details open={flowOpen} onToggle={e=>setFlowOpen(e.currentTarget.open)} className="mb-4 rounded-xl border border-border bg-card" data-testid="show-incident-flow"><summary className="cursor-pointer px-5 py-3 text-[12px] font-medium">{fi?'Tutki aineistojen, poikkeamien ja kriittisyyden yhteyksiä':'Explore connections between datasets, incidents and criticality'} · Sankey</summary>{flowOpen&&<div className="px-3"><IncidentFlow filters={effectiveFilters} onFilter={(patch)=>setFilters((previous)=>({...previous,...patch}))} onOpen={setOpenId} /></div>}</details>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[190px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input value={filters.q} onChange={set('q')} aria-label={fi ? 'Hae viitteellä tai kuvauksella' : 'Search a reference or description'} placeholder={fi ? 'Hae viitteellä tai kuvauksella' : 'Search a reference or description'} className="w-full rounded-full border border-border bg-card py-2 pl-9 pr-3 text-[12.5px]" />
            </div>
            <select value={filters.status} onChange={set('status')} aria-label={fi ? 'Käsittelytilanne' : 'Review status'} className="max-w-full rounded-full border border-border bg-card px-3 py-2 text-[12px]">
              <option value="open">{fi ? 'Odottaa tarkistusta' : 'Needs checking'}</option>
              <option value="approved">{fi ? 'Päätös tallennettu' : 'Decision saved'}</option>
              <option value="rejected">{fi ? 'Suljettu ilman muutosta' : 'Closed without a change'}</option>
              <option value="">{fi ? 'Kaikki' : 'All'}</option>
            </select>
            <select value={filters.year} onChange={set('year')} aria-label={fi ? 'Vuosi' : 'Year'} className="rounded-full border border-border bg-card px-3 py-2 text-[12px]">
              <option value="">{fi ? 'Kaikki vuodet' : 'All years'}</option>
              {(s.years || []).filter(y=>y.year!=null).map((y) => <option key={y.year} value={y.year}>{y.year}</option>)}
            </select>
            {Object.entries(filters).some(([key, value]) => key === 'status' ? value !== 'open' : !!value) && <button onClick={() => { setFilters({ status: 'open', criticality: '', rule_id: '', table: '', year: '', issue_type: '', q: '' }); setSearchParams((p)=>{p.delete('year');return p;}); }} className="text-[12px] font-medium text-[#2E7099]">{fi ? 'Tyhjennä suodattimet' : 'Clear filters'}</button>}
          </div>
          <details className="mb-4 rounded-xl border border-border bg-card text-[12px]">
            <summary className="cursor-pointer px-3 py-2.5 font-medium">{fi ? 'Lisää suodattimia' : 'More filters'}{[filters.criticality, filters.table, filters.issue_type].filter(Boolean).length > 0 ? ` (${[filters.criticality, filters.table, filters.issue_type].filter(Boolean).length})` : ''}</summary>
            <div className="flex flex-wrap gap-2 border-t border-border p-3">
            <select value={filters.criticality} onChange={set('criticality')} aria-label={fi ? 'Kiireellisyys' : 'Priority'} className="max-w-full rounded-lg border border-input bg-card px-3 py-2">
              <option value="">{fi ? 'Kaikki kiireellisyydet' : 'All priorities'}</option>
              {['critical', 'high', 'medium', 'low'].map((value) => <option key={value} value={value}>{priorityName(value, lang)}</option>)}
            </select>
            <select value={filters.table} onChange={set('table')} aria-label={fi ? 'Tietojen tyyppi' : 'Type of information'} className="max-w-full rounded-lg border border-input bg-card px-3 py-2">
              <option value="">{fi ? 'Kaikki aineistot' : 'All datasets'}</option>
              {(s.open_by_table || []).map((x) => <option key={x.table} value={x.table}>{datasetName(x.table, lang)} ({x.count})</option>)}
            </select>
            <select value={filters.issue_type} onChange={set('issue_type')} aria-label={fi ? 'Tarkistettava asia' : 'What needs checking'} className="max-w-full rounded-lg border border-input bg-card px-3 py-2">
              <option value="">{fi ? 'Kaikki tyypit' : 'All types'}</option>
              {(s.types || []).map((x) => <option key={x.issue_type} value={x.issue_type}>{issueLabel(x.issue_type, lang)} ({x.count})</option>)}
            </select>
            {filters.year&&<label className="flex w-full items-center gap-2 text-[11.5px] text-muted-foreground"><input type="checkbox" checked={includeShared} onChange={e=>{setOffset(0);setSearchParams(p=>{p.set('shared',String(e.target.checked));return p;});}} data-testid="include-shared-incidents" />{fi?'Sisällytä myös yhteisten viitetietojen poikkeamat ilman vuotta':'Include incidents in shared reference data with no assigned year'}</label>}
            </div>
          </details>

          <div className="surface overflow-hidden">
            {issues.isLoading ? (
              <p className="p-6 text-[13px] text-muted-foreground">{t('common.loading')}</p>
            ) : issues.error ? (
              <p className="p-6 text-[13px] text-[#8C3B2E]">{issues.error.message}</p>
            ) : rows.length ? (
              <ul>{rows.map((i) => <IssueRow key={i.id} issue={i} onOpen={setOpenId} />)}</ul>
            ) : (
              <div className="p-8 text-center">
                <CheckCircle2 className="mx-auto h-6 w-6 text-[#2E7099]" />
                <p className="mt-2 text-[13px] text-muted-foreground">{totalRecords ? (fi ? 'Näillä suodattimilla ei ole poikkeamia. Tuonnin jälkeen voit valita Etsi mahdollisia virheitä.' : 'No incidents match these filters. After importing, choose Check for possible errors.') : fi ? 'Ei tuotuja tietoja vielä. Aloita Tiedostot-välilehdeltä.' : 'No information imported yet. Start from the Uploads tab.'}</p>
              </div>
            )}
            {total > PAGE && (
              <div className="flex items-center justify-between border-t border-border px-4 py-2 text-[12px] text-muted-foreground">
                <span>{nf(offset + 1)}–{nf(Math.min(offset + PAGE, total))} / {nf(total)}</span>
                <span className="flex gap-1">
                  <button aria-label={fi ? 'Edellinen sivu' : 'Previous page'} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))} className="rounded-full border border-border p-1.5 disabled:opacity-40"><ChevronLeft className="h-3.5 w-3.5" /></button>
                  <button aria-label={fi ? 'Seuraava sivu' : 'Next page'} disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)} className="rounded-full border border-border p-1.5 disabled:opacity-40"><ChevronRight className="h-3.5 w-3.5" /></button>
                </span>
              </div>
            )}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">{t('dq.immutable')} <Link to="/platform#history" className="font-medium text-[#2E7099] hover:underline">{t('dq.audit')} →</Link></p>
        </>
      )}

      {tab === 'import' && <div className="space-y-6"><UploadInbox /><DataReviewAgent onOpenIssue={setOpenId} /></div>}

      <IssueDrawer issueId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

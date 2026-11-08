import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ChevronLeft, ChevronRight, Loader2, Search, X } from 'lucide-react';
import { api } from '@/api/client';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import FlowDiagram, { FLOW_COLORS as COLORS } from './FlowDiagram';

const LAND = { all: { en: 'All emissions', fi: 'Kaikki päästöt' }, flag: { en: 'FLAG', fi: 'FLAG' }, non_flag: { en: 'Non-FLAG', fi: 'Ei-FLAG' }, unclassified: { en: 'Not classified', fi: 'Luokittelematon' } };
const METHOD = {
  energy_and_industry: { en: 'Energy and industrial emissions', fi: 'Energian ja teollisuuden päästöt' },
  saved_farm_components: { en: 'Land-related components in the saved farm calculation', fi: 'Tallennetun tilalaskennan maankäyttöön liittyvät osat' },
  source_factor_flag_share: { en: 'FLAG share supplied with the source factor', fi: 'Lähdekertoimen mukana ilmoitettu FLAG-osuus' },
  classification_unavailable: { en: 'The saved evidence does not contain a usable FLAG split', fi: 'Tallennetuissa lähteissä ei ole käyttökelpoista FLAG-jakoa' },
};
const validYear = (value, fallback) => /^\d{4}$/.test(value || '') && Number(value) >= 2000 && Number(value) <= 2100 ? Number(value) : fallback;

export default function FootprintFlow({ year, runId, scope2Basis }) {
  const { lang } = useI18n();
  const fi = lang === 'fi';
  const [params, setParams] = useSearchParams();
  // Default: a rolling two-year window ending at the selected year.
  const from = validYear(params.get('flow_from'), year - 1);
  const to = validYear(params.get('flow_to'), year);
  const scope = ['scope1', 'scope2', 'scope3'].includes(params.get('flow_scope')) ? params.get('flow_scope') : 'all';
  const requestedLand = params.get('flow_land');
  const land = Object.keys(LAND).includes(requestedLand) ? requestedLand : 'all';
  const query = (params.get('flow_q') || '').slice(0, 120);
  const group = params.get('flow_group') || '';
  const source = params.get('flow_source') || '';
  const [search, setSearch] = useState(query);
  const [draftFrom, setDraftFrom] = useState(String(from));
  const [draftTo, setDraftTo] = useState(String(to));
  const [error, setError] = useState('');
  const [focus, setFocus] = useState(null);
  const [offset, setOffset] = useState(0);
  const [recordsOpen, setRecordsOpen] = useState(false);
  const table = useRef(null);
  useEffect(() => { setDraftFrom(String(from)); setDraftTo(String(to)); }, [from, to]);
  useEffect(() => { setSearch(query); }, [query]);
  useEffect(() => { setFocus(null); setOffset(0); setRecordsOpen(false); }, [from, to, scope, land, scope2Basis, runId, query, group, source]);
  useEffect(() => { const timer = setTimeout(() => { if (search !== query) update({ flow_q: search }); }, 350); return () => clearTimeout(timer); }, [search, query]);
  const filter = { from_year: from, to_year: to, scope, land, q: query, group: group || undefined, source: source || undefined, scope2_basis: scope2Basis, run_id: from === to && from === year ? runId : undefined, focus, offset, limit: 15 };
  const flow = useQuery({ queryKey: ['footprint-flow', filter], queryFn: () => api.footprintFlow(filter), enabled: from <= to, refetchInterval: 5000, placeholderData: (previous) => previous });
  const data = flow.data;
  const flowReady = !!data;
  useEffect(() => { if (focus && recordsOpen && flowReady) table.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [focus, recordsOpen, flowReady]);
  const format = (n) => new Intl.NumberFormat(fi ? 'fi-FI' : 'en-GB', { maximumFractionDigits: Math.abs(n) < 10 ? 3 : 1 }).format(n);
  const update = (values) => {
    setError(''); setOffset(0); setFocus(null);
    // Merge with the latest URL: scope and range changes can arrive before a router render commits.
    const next = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(values)) { if (value === '') next.delete(key); else next.set(key, String(value)); }
    if (['scope1', 'scope2'].includes(values.flow_scope) && ['flag', 'unclassified'].includes(next.get('flow_land'))) next.set('flow_land', 'all');
    setParams(next);
  };
  const applyRange = (event) => {
    event.preventDefault();
    if (Number(draftFrom) > Number(draftTo)) { setError(fi ? 'Alkuvuosi ei voi olla loppuvuoden jälkeen.' : 'From year must not be after to year.'); return; }
    update({ flow_from: draftFrom, flow_to: draftTo });
  };
  const selectScope = (next) => update({ flow_scope: next, flow_group: '', flow_source: '' });
  const landOptions = [...new Set(['all', ...(data?.available_land || (scope === 'scope1' || scope === 'scope2' ? ['non_flag'] : ['flag', 'non_flag'])), land])];
  const focusLabel = data?.graph.nodes.find((n) => n.id === focus)?.label[lang];
  const selectNode = (id) => { setFocus(id); setOffset(0); setRecordsOpen(false); };

  return <section className="surface mb-5 overflow-hidden" aria-labelledby="footprint-flow-title" aria-busy={flow.isFetching} data-basis={scope2Basis} data-run-id={runId || undefined} data-testid="footprint-flow" data-from-year={data?.from_year} data-to-year={data?.to_year} data-scope={data?.scope} data-land={data?.land} data-query={data?.context.q} data-group={data?.context.group} data-source={data?.context.source}>
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border p-5 sm:p-6">
      <div><h2 id="footprint-flow-title" className="font-heading text-[23px] tracking-tight">{fi ? 'Mistä päästömme syntyvät' : 'Where our carbon comes from'}</h2><p className="mt-1.5 max-w-2xl text-[12.5px] leading-relaxed text-muted-foreground">{fi ? 'Seuraa päästöjä materiaaleista ja toiminnasta Scope 1-, 2- ja 3 -luokkiin. Virran leveys kuvaa päästömäärää.' : 'Follow emissions from materials and activities into Scopes 1, 2 and 3. Wider flows mean more emissions.'}</p></div>
      <div className="text-left sm:text-right"><p className="text-[11px] text-muted-foreground">{from === to ? from : `${from}–${to} · ${fi ? 'vuosien yhteensä' : 'combined total'}`}</p><p className="mt-1 text-[25px] font-semibold tabular-nums text-[#1B4968]" data-testid="flow-total">{data ? format(data.totals.net_tco2e) : '—'} <span className="text-[13px] font-normal text-muted-foreground">tCO₂e</span></p></div>
    </div>
    <div className="space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
        <form onSubmit={applyRange} className="flex flex-wrap items-end gap-2" aria-label={fi ? 'Valitse vuosiväli' : 'Choose year range'}>
          <label className="block text-[11px] font-medium text-muted-foreground" htmlFor="flow-from">{fi ? 'Alkuvuosi' : 'From year'}<input id="flow-from" data-testid="flow-from" type="number" min="2000" max="2100" required value={draftFrom} onChange={(e) => setDraftFrom(e.target.value)} className="mt-1.5 block w-[100px] rounded-lg border border-input bg-card px-3 py-2 text-[13px] text-foreground" /></label>
          <span className="pb-2 text-muted-foreground" aria-hidden="true">–</span>
          <label className="block text-[11px] font-medium text-muted-foreground" htmlFor="flow-to">{fi ? 'Loppuvuosi' : 'To year'}<input id="flow-to" data-testid="flow-to" type="number" min="2000" max="2100" required value={draftTo} onChange={(e) => setDraftTo(e.target.value)} className="mt-1.5 block w-[100px] rounded-lg border border-input bg-card px-3 py-2 text-[13px] text-foreground" /></label>
          <Button type="submit" variant="outline" size="sm" className="h-[38px]" data-testid="flow-apply">{fi ? 'Näytä' : 'Apply'}</Button>
          <button type="button" onClick={() => update({ flow_from: year, flow_to: year })} className="min-h-[38px] px-1 text-[11.5px] text-[#2E7099] hover:underline">{fi ? `Vain ${year}` : `${year} only`}</button>
        </form>
        <div><p className="mb-1.5 text-[11px] font-medium text-muted-foreground">Scope</p><div className="flex flex-wrap gap-1 rounded-xl bg-[#F0F3F4] p-1" role="group" aria-label={fi ? 'Päästöluokka' : 'Emissions scope'}>{[['all', fi ? 'Kaikki luokat' : 'All scopes'], ['scope1', 'Scope 1'], ['scope2', 'Scope 2'], ['scope3', 'Scope 3']].map(([id, label]) => <button key={id} onClick={() => selectScope(id)} aria-pressed={scope === id} className={`rounded-lg px-3 py-2 text-[12px] transition ${scope === id ? 'bg-white font-semibold text-[#1B4968] shadow-sm' : 'text-muted-foreground hover:text-foreground'}`} data-testid={`flow-${id}`}>{label}</button>)}</div></div>
        <div><p className="mb-1.5 text-[11px] font-medium text-muted-foreground">{fi ? 'FLAG-jako' : 'Land-related emissions'}</p><div className="flex flex-wrap gap-1" role="group" aria-label={fi ? 'FLAG-suodatin' : 'FLAG filter'}>{landOptions.map((id) => <button key={id} onClick={() => update({ flow_land: id })} aria-pressed={land === id} className={`rounded-lg border px-3 py-2 text-[12px] transition ${land === id ? 'border-[#1B4968] bg-[#1B4968] text-white' : 'border-border text-muted-foreground hover:text-foreground'}`} data-testid={`flow-land-${id}`}>{LAND[id][lang]}</button>)}</div></div>
      </div>
      <div className="flex flex-wrap items-end gap-3 rounded-xl bg-[#F5F8FA] p-3">
        <label className="block min-w-[180px] flex-1 text-[10.5px] font-medium text-muted-foreground" htmlFor="flow-search">{fi ? 'Etsi materiaali tai toiminta' : 'Find a material or activity'}<span className="relative mt-1.5 block"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><input id="flow-search" data-testid="flow-search" type="search" maxLength={120} value={search} onChange={(e) => setSearch(e.target.value)} placeholder={fi ? 'Esim. rypsi, Säkylä, pakkaus…' : 'Try rapeseed, Säkylä, packaging…'} className="w-full rounded-lg border border-input bg-white py-2 pl-9 pr-3 text-[12px] font-normal text-foreground" /></span></label>
        <label className="block min-w-[180px] flex-1 text-[10.5px] font-medium text-muted-foreground" htmlFor="flow-group">{fi ? 'Rajaa lähderyhmään' : 'Explore a source group'}<select id="flow-group" data-testid="flow-group" value={group} onChange={(e) => update({ flow_group: e.target.value, flow_source: '' })} className="mt-1.5 w-full rounded-lg border border-input bg-white px-3 py-2 text-[12px] font-normal text-foreground"><option value="">{fi ? 'Kaikki lähderyhmät' : 'All source groups'}</option>{data?.options.groups.map((item) => <option key={item.id} value={item.id}>{item.label[lang]}</option>)}</select></label>
        {(query || group || source) && <Button size="sm" variant="outline" className="h-[35px]" onClick={() => { setSearch(''); update({ flow_q: '', flow_group: '', flow_source: '' }); }} data-testid="flow-reset-exploration"><X className="mr-1 h-3.5 w-3.5" />{fi ? 'Takaisin yleiskuvaan' : 'Back to overview'}</Button>}
      </div>
      {source && <p className="text-[12px] font-medium text-[#2E7099]" data-testid="flow-isolated-source">{fi ? 'Rajattu materiaali tai toiminta' : 'Isolated material or activity'}: {data?.context.source === source ? data.graph.nodes.find((n) => n.kind === 'source')?.label[lang] || source : '…'}</p>}
      {data?.yearly.length > 1 && <div className="flex flex-wrap gap-2" data-testid="flow-year-summary">{data.yearly.map((item) => <div key={item.year} className="flex min-w-[165px] flex-1 items-center justify-between gap-4 rounded-lg border border-border/80 px-3 py-2.5"><span className="text-[12px] font-semibold text-[#36576C]">{item.year}</span><span className="text-[11px] tabular-nums text-muted-foreground">{format(item.net_tco2e)} tCO₂e</span></div>)}</div>}
      <p className="text-[11px] leading-relaxed text-muted-foreground">{fi ? 'Alku- ja loppuvuosi sisältyvät valintaan. Käytössä on yksi tallennettu vuosilaskelma kultakin vuodelta, ei päivätason rajaus.' : 'Both years are included. This view uses one saved annual calculation per year; it does not prorate daily activity.'} {fi ? 'Scope 2 -perusta' : 'Scope 2 basis'}: {scope2Basis === 'market' ? fi ? 'markkinaperusteinen' : 'market-based' : fi ? 'sijaintiperusteinen' : 'location-based'}.</p>
      {(error || from > to || flow.error) && <p role="alert" className="rounded-xl bg-[#FBF0EE] p-3 text-[12px] text-[#8C3B2E]">{error || (from > to ? fi ? 'Tarkista vuosiväli.' : 'Check the year range.' : flow.error.message)}</p>}
      {flow.isLoading && <p role="status" className="flex items-center gap-2 text-[13px] text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{fi ? 'Ladataan päästövirtoja…' : 'Loading emissions flow…'}</p>}
      {data?.demo && <p className="rounded-xl bg-[#FBF4E7] p-3 text-[12px] text-[#7A5A2E]">{fi ? 'DEMO: valinta sisältää synteettisiä esimerkkitietoja.' : 'DEMO: this selection includes synthetic example inputs.'}</p>}
      {data?.missing_years.length > 0 && <p role="status" className="rounded-xl bg-[#FBF4E7] p-3 text-[12px] leading-relaxed text-[#7A5A2E]" data-testid="flow-missing-years">{fi ? 'Tältä Scope 2 -perustalta puuttuvat vuosilaskelmat' : 'No saved calculations for this Scope 2 basis in'}: {data.missing_years.join(', ')}. {fi ? 'Puuttuvat vuodet eivät ole nollapäästöisiä; ne puuttuvat summasta.' : 'Missing years are excluded from the total, not treated as zero.'}</p>}
      {data && ['scope1', 'scope2'].includes(scope) && !data.available_land.includes('flag') && <p className="text-[12px] text-muted-foreground">{scope === 'scope2' ? fi ? 'Scope 2 kattaa ostetun energian, joten se on ei-FLAG-päästöä.' : 'Scope 2 covers purchased energy and is Non-FLAG.' : fi ? 'Tämän aineiston Scope 1 -lähteet ovat polttoaineita ja kylmäaineita. Ne ovat ei-FLAG-päästöjä.' : 'Scope 1 sources in this dataset are fuel combustion and refrigerants. They are Non-FLAG.'}</p>}
      {data?.totals.unclassified_tco2e !== 0 && data?.totals.unclassified_tco2e != null && <p className="text-[12px] leading-relaxed text-muted-foreground" data-testid="flow-unclassified">{format(data.totals.unclassified_tco2e)} tCO₂e: {fi ? 'FLAG-jako puuttuu lähteistä. Nämä päästöt näkyvät erikseen luokittelemattomina.' : 'the source evidence has no FLAG split. These emissions remain separately labelled Not classified.'}</p>}
      {data?.totals.negative_tco2e < 0 && <p className="text-[12px] text-muted-foreground">{fi ? 'Virrat näyttävät positiiviset päästöt. Negatiiviset oikaisut näkyvät lähderiveissä ja sisältyvät yllä olevaan nettosummaan' : 'Flows show positive emissions. Negative adjustments are listed in the records and included in the net total above'}: {format(data.totals.negative_tco2e)} tCO₂e.</p>}
      {data?.graph.nodes.length ? <>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-[11px] text-muted-foreground" aria-label={fi ? 'Selite' : 'Legend'}>{[['scope1', 'Scope 1'], ['scope2', 'Scope 2'], ['scope3', 'Scope 3'], ['flag', 'FLAG'], ['unclassified', fi ? 'Luokittelematon' : 'Not classified']].filter(([id]) => data.graph.nodes.some((n) => id === n.land || id === n.scope)).map(([id, label]) => <span key={id} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: COLORS[id] }} />{label}</span>)}</div>
        <FlowDiagram graph={data.graph} lang={lang} format={format} focus={focus} onFocus={selectNode} onExplore={update} onRecords={() => setRecordsOpen(true)} />
      </> : data && <div className="rounded-xl border border-dashed border-border p-8 text-center text-[13px] text-muted-foreground" data-testid="flow-empty">{fi ? 'Valinnalla ei ole piirrettäviä positiivisia päästöjä. Tarkista vuosi-, Scope- ja FLAG-suodattimet tai tallenna puuttuva vuosilaskelma.' : 'No positive emissions to draw for this selection. Check the year, scope and FLAG filters, or save the missing annual calculation.'}</div>}
      {data && <details ref={table} open={recordsOpen} onToggle={(e) => setRecordsOpen(e.currentTarget.open)} className="rounded-xl border border-border" data-testid="flow-records">
        <summary className="cursor-pointer px-4 py-3 text-[12.5px] font-medium">{focusLabel || (fi ? 'Valinnan lähderivit' : 'Contributing records')} <span className="font-normal text-muted-foreground">({data.records.total})</span></summary>
        <div className="border-t border-border p-4">
          {focus && <button onClick={() => { setFocus(null); setOffset(0); }} className="mb-3 text-[12px] text-[#2E7099] hover:underline">{fi ? 'Näytä koko valinta' : 'Show all selected records'}</button>}
          <p className="mb-3 text-[11px] text-muted-foreground">{fi ? 'Rivin luku on tässä näkymässä valittu FLAG- tai ei-FLAG-osuus. Lähdelinkki avaa alkuperäisen koko laskentarivin.' : 'Each amount is the FLAG or Non-FLAG portion selected in this view. The source link opens the complete original contribution.'}</p>
          <ul className="divide-y divide-border/60">{data.records.rows.map((record) => <li key={record.id} className="flex flex-wrap items-start justify-between gap-3 py-3 text-[12px]" data-testid="flow-record">
            <div className="min-w-0 flex-1"><p className="break-words font-medium">{record.label[lang]}</p><p className="mt-1 text-[11px] text-muted-foreground">{record.year} · Scope {record.scope.slice(-1)} · {LAND[record.land][lang]}</p><p className="mt-1 text-[11px] text-muted-foreground">{METHOD[record.method]?.[lang]}</p></div>
            <div className="text-right"><p className="tabular-nums">{format(record.tco2e)} tCO₂e</p><Link to={record.link} className="mt-1 inline-flex items-center gap-1 font-medium text-[#2E7099] hover:underline">{fi ? 'Lähde ja laskenta' : 'Source and calculation'}<ArrowRight className="h-3 w-3" /></Link></div>
          </li>)}</ul>
          {!data.records.rows.length && <p className="py-3 text-[12px] text-muted-foreground">{fi ? 'Ei lähderivejä tällä valinnalla.' : 'No records for this selection.'}</p>}
          {data.records.total > 15 && <div className="mt-3 flex items-center justify-between gap-3"><Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 15))}><ChevronLeft className="mr-1 h-3.5 w-3.5" />{fi ? 'Edellinen' : 'Previous'}</Button><span className="text-[11px] text-muted-foreground">{offset + 1}–{Math.min(offset + 15, data.records.total)} / {data.records.total}</span><Button variant="outline" size="sm" disabled={offset + 15 >= data.records.total} onClick={() => setOffset(offset + 15)}>{fi ? 'Seuraava' : 'Next'}<ChevronRight className="ml-1 h-3.5 w-3.5" /></Button></div>}
        </div>
      </details>}
      <details className="text-[11.5px] leading-relaxed text-muted-foreground"><summary className="cursor-pointer font-medium">{fi ? 'Miten Scope- ja FLAG-jako toimii?' : 'How do scopes and FLAG work?'}</summary><div className="mt-3 max-w-3xl space-y-2">
        <p>{fi ? 'Scope 1: omistetun tai hallitun toiminnan suorat päästöt. Scope 2: ostetun sähkön, lämmön ja höyryn päästöt. Scope 3: muut arvoketjun epäsuorat päästöt.' : 'Scope 1: direct emissions from owned or controlled operations. Scope 2: emissions from purchased electricity, heat and steam. Scope 3: other indirect emissions across the value chain.'}</p>
        <p>{fi ? 'FLAG tarkoittaa metsien, maankäytön ja maatalouden päästöjä. Sitä voi esiintyä Scope 1- ja Scope 3 -luokissa. Tämän aineiston sopimusviljelyssä siihen lasketaan peltojen dityppioksidi, kalkitus ja eloperäiset maat. Muissa lähteissä käytetään lähdekertoimen ilmoitettua FLAG-osuutta.' : 'FLAG means forest, land and agriculture emissions and can occur in Scopes 1 and 3. In this dataset’s contract farming it includes field nitrous oxide, liming and organic soils. Other sources use the FLAG share supplied with the source factor.'}</p>
        <p>{fi ? 'Jos jako puuttuu, esimerkiksi toimittajan tuotekohtaisesta päästöluvusta tai vanhasta tilalaskelmasta, päästöt säilyvät luokittelemattomina. Näkymä ei ole SBTi:n validoima inventaario.' : 'If the split is missing, for example in a supplier product footprint or an older farm calculation, the emissions remain unclassified. This view is not an SBTi-validated inventory.'}</p>
        <p><a className="text-[#2E7099] underline" href="https://sciencebasedtargets.org/faqs" target="_blank" rel="noreferrer">{fi ? 'SBTi: päästöluokat' : 'SBTi: emissions scopes'}</a> · <a className="text-[#2E7099] underline" href="https://sciencebasedtargets.org/sectors/forest-land-and-agriculture" target="_blank" rel="noreferrer">{fi ? 'SBTi: FLAG-ohjeistus' : 'SBTi: FLAG guidance'}</a></p>
      </div></details>
    </div>
  </section>;
}

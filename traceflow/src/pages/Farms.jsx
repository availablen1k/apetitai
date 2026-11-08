import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '@/api/client';
import PageHeader from '@/components/PageHeader';
import ExplainButton from '@/components/assistant/ExplainButton';
import { useI18n } from '@/lib/i18n';
import useReportingYear from '@/lib/useReportingYear';
import { amount, periodLink } from '@/lib/decisions';
import { regionName } from '@/lib/glossary';

const PAGE = 50;
const STATUS = {
  measured: { en: 'Farm survey', fi: 'Tilakysely', tone: 'text-[#36866B]' },
  mixed: { en: 'Partly estimated', fi: 'Osin arvioitu', tone: 'text-[#996222]' },
  estimated: { en: 'Estimated', fi: 'Arvioitu', tone: 'text-[#996222]' },
  missing: { en: 'No farm data', fi: 'Ei tilatietoja', tone: 'text-[#8C3B2E]' },
  none: { en: 'No delivery', fi: 'Ei toimitusta', tone: 'text-muted-foreground' },
};
const crop = (c) => c.replace(/_/g, ' ');

export default function Farms() {
  const { t, lang } = useI18n(); const fi = lang === 'fi';
  const overview = useQuery({ queryKey: ['overview'], queryFn: () => api.overview(), refetchInterval: 5000 });
  const { year, years, setYear } = useReportingYear(overview.data);
  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  useEffect(() => setOffset(0), [status, q, year]);
  const query = useQuery({ queryKey: ['farm-footprint', year, status, q, offset], queryFn: () => api.farmFootprint({ year, status, q: q.trim() || undefined, limit: PAGE, offset }), enabled: !!year, placeholderData: (previous) => previous });
  const d = query.data; const s = d?.summary;
  const chips = s && [['all', fi ? 'Kaikki' : 'All', s.farms], ['measured', STATUS.measured[lang], s.measured.farms], ['estimated', STATUS.estimated[lang], s.estimated.farms], ['missing', STATUS.missing[lang], s.missing.farms], ['none', fi ? `Ei toimitusta ${year}` : `No delivery in ${year}`, s.none]];

  return <div>
    <PageHeader title={t('farms.title')} actions={<select value={year} onChange={(e) => setYear(e.target.value)} aria-label={fi ? 'Raportointivuosi' : 'Reporting year'} className="rounded-full border border-border bg-card px-3 py-2 text-[12px]" data-testid="farms-year">{years.map((y) => <option key={y} value={y}>{y}</option>)}</select>} />
    {query.error && <p role="alert" className="surface mb-4 p-5 text-[13px] text-[#8C3B2E]">{query.error.message}</p>}
    {d && !d.run_id && <div className="surface mb-4 p-5 text-[13px]">{fi ? 'Vuodelle ei ole tallennettua laskelmaa.' : 'No saved calculation for this year.'} <Link to={periodLink('/sustainability', year)} className="font-semibold text-[#2E7099] hover:underline">{fi ? 'Laske päästöt' : 'Calculate the footprint'} →</Link></div>}
    {s && <section className="surface mb-4 p-5" data-testid="farm-summary">
      <p className="text-[11px] font-medium text-muted-foreground">{year} · {fi ? 'Sopimustilojen päästöt' : 'Contract-farm emissions'}</p>
      <p className="mt-2 text-[28px] font-semibold tracking-tight text-[#1B4968]">{amount(s.total_tco2e, lang)} <span className="text-[12px] font-normal">tCO₂e</span></p>
      <p className="mt-1 text-[12.5px] text-muted-foreground">{fi ? `${s.with_footprint} tilalta` : `from ${s.with_footprint} farms`}{s.top20_share_pct != null && (fi ? ` · 20 suurinta tilaa = ${amount(s.top20_share_pct, lang)} %` : ` · the 20 largest = ${amount(s.top20_share_pct, lang)} %`)}{s.estimated.farms > 0 && (fi ? ` · ${amount(s.estimated.tco2e, lang)} t perustuu arvioihin` : ` · ${amount(s.estimated.tco2e, lang)} t rests on estimates`)}{s.missing.farms > 0 && (fi ? ` · ${s.missing.farms} toimitusta ilman tilatietoja` : ` · ${s.missing.farms} deliveries with no farm data`)}</p>
    </section>}
    {s && <div className="mb-3 flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={fi ? 'Tietojen tila' : 'Data status'}>{chips.map(([id, label, n]) => <button key={id} aria-pressed={status === id} onClick={() => setStatus(id)} data-testid={`farm-status-${id}`} className={`rounded-full px-3 py-1.5 text-[11.5px] ${status === id ? 'bg-[#1B4968] text-white' : 'border border-border bg-card hover:bg-muted'}`}>{label} ({n})</button>)}</div>
      <label className="relative ml-auto min-w-[200px] flex-1 sm:max-w-xs"><Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('farms.search')} aria-label={t('farms.search')} className="w-full rounded-full border border-border bg-card py-2 pl-9 pr-3 text-[12.5px]" /></label>
    </div>}
    {s && <section className="surface overflow-x-auto" data-testid="farm-table">
      <table className="w-full min-w-[760px] text-left text-[12.5px]">
        <thead className="border-b border-border text-[10.5px] uppercase tracking-wide text-muted-foreground"><tr>
          <th className="px-4 py-2.5 font-medium">{fi ? 'Tila' : 'Farm'}</th><th className="px-3 py-2.5 font-medium">{fi ? 'Kasvi' : 'Crop'}</th>
          <th className="px-3 py-2.5 text-right font-medium">{fi ? 'Toimitettu t' : 'Delivered t'}</th><th className="px-3 py-2.5 text-right font-medium">tCO₂e</th>
          <th className="px-3 py-2.5 text-right font-medium">kg CO₂e/kg</th><th className="px-3 py-2.5 font-medium">{fi ? 'Tiedot' : 'Data'}</th><th className="px-3 py-2.5" />
        </tr></thead>
        <tbody className="divide-y divide-border/70">{d.rows.map((r) => <tr key={r.farm_id} data-testid="farm-row" data-ai-context={JSON.stringify({ farm_id: r.farm_id, year, label: `${fi ? 'Tila' : 'Farm'} ${r.farm_id}` })}>
          <td className="px-4 py-2.5"><Link to={`/farms/${encodeURIComponent(r.farm_id)}`} className="font-medium text-[#2E7099] hover:underline">{r.farm_id}</Link><span className="block text-[11px] text-muted-foreground">{r.region ? regionName(r.region, lang) : (fi ? 'Ei rekisterissä' : 'Not in registry')}{r.area_ha ? ` · ${amount(r.area_ha, lang)} ha` : ''}</span></td>
          <td className="px-3 py-2.5 capitalize">{r.crops.map(crop).join(', ') || '—'}</td>
          <td className="px-3 py-2.5 text-right tabular-nums">{r.delivered_kg ? amount(r.delivered_kg / 1000, lang) : '—'}</td>
          <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{r.tco2e != null ? amount(r.tco2e, lang) : '—'}</td>
          <td className="px-3 py-2.5 text-right tabular-nums">{r.kg_per_kg != null ? amount(r.kg_per_kg, lang) : '—'}</td>
          <td className={`px-3 py-2.5 text-[11.5px] ${STATUS[r.status].tone}`}>{STATUS[r.status][lang]}{r.open_issues > 0 && <span className="block text-[#8C3B2E]">{r.open_issues} {fi ? 'avointa poikkeamaa' : r.open_issues === 1 ? 'open incident' : 'open incidents'}</span>}</td>
          <td className="px-3 py-2 text-right">{r.status !== 'none' && <ExplainButton context={{ farm_id: r.farm_id, year, label: `${fi ? 'Tila' : 'Farm'} ${r.farm_id}` }} />}</td>
        </tr>)}</tbody>
      </table>
      {!d.rows.length && <p className="p-6 text-[13px] text-muted-foreground">{fi ? 'Ei tiloja tällä valinnalla.' : 'No farms match this selection.'}</p>}
      {d.total > PAGE && <div className="flex items-center justify-between border-t border-border px-4 py-2 text-[12px] text-muted-foreground"><span>{offset + 1}–{Math.min(offset + PAGE, d.total)} / {d.total}</span><span className="flex gap-1">
        <button aria-label={fi ? 'Edellinen sivu' : 'Previous page'} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))} className="rounded-full border border-border p-1.5 disabled:opacity-40"><ChevronLeft className="h-3.5 w-3.5" /></button>
        <button aria-label={fi ? 'Seuraava sivu' : 'Next page'} disabled={offset + PAGE >= d.total} onClick={() => setOffset(offset + PAGE)} className="rounded-full border border-border p-1.5 disabled:opacity-40"><ChevronRight className="h-3.5 w-3.5" /></button>
      </span></div>}
    </section>}
  </div>;
}

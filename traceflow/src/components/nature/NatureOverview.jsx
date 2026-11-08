import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import ExplainButton from '@/components/assistant/ExplainButton';
import { useI18n } from '@/lib/i18n';
import { nf } from '@/lib/format';
import CatchmentMap, { STATUS_COLOR, STATUS_LABEL } from './CatchmentMap';
import { MonitoringChart } from './NatureCharts';

const YEARS = Array.from({ length: 15 }, (_, i) => 2026 - i);
const WEAK = new Set(['moderate', 'poor', 'bad']);
const RANK = { bad: 0, poor: 1, moderate: 2, good: 3, high: 4 };

// Which catchments with Apetit contract area have weak water status, and what could be discussed
// with the farms there. A filter over recorded facts, not a validated priority ranking.
export default function NatureOverview({ onOpenQuery }) {
  const { lang } = useI18n();
  const fi = lang === 'fi';
  const [year, setYear] = useState(2025);
  const [weakOnly, setWeakOnly] = useState(true);
  const [selected, setSelected] = useState(null);
  const catchments = useQuery({ queryKey: ['nature', 'catchments'], queryFn: api.natureCatchments });
  const contract = useQuery({ queryKey: ['nature', 'q', '01', year], queryFn: () => api.natureRunQuery('01_contract_area', { year }) });

  const list = useMemo(() => {
    const area = new Map((contract.data?.rows || []).map((r) => [r.result_key, r]));
    return (catchments.data?.features || []).map((f) => ({ id: f.id, region: f.properties.region, status: f.properties.ecological_status_class, contract: area.get(f.id) }))
      .filter((c) => c.contract?.contract_area_ha > 0)
      .sort((a, b) => (RANK[a.status] ?? 9) - (RANK[b.status] ?? 9) || b.contract.contract_area_ha - a.contract.contract_area_ha);
  }, [catchments.data, contract.data]);
  const shown = weakOnly ? list.filter((c) => WEAK.has(c.status)) : list;
  useEffect(() => { if (shown.length && !shown.some((c) => c.id === selected)) setSelected(shown[0].id); }, [shown, selected]);

  const actions = useQuery({ queryKey: ['nature', 'q', '18', year, selected], queryFn: () => api.natureRunQuery('18_nature_action_opportunities', { year, catchment_id: selected }), enabled: !!selected });
  const parcels = useQuery({ queryKey: ['nature', 'parcels', selected, year], queryFn: () => api.natureCatchmentParcels(selected, year), enabled: !!selected });
  const feature = catchments.data?.features.find((f) => f.id === selected);
  const p = feature?.properties;
  const row = list.find((c) => c.id === selected)?.contract;
  const series = useMemo(() => (catchments.data?.monitoring || []).filter((m) => m.catchment_id === selected), [catchments.data, selected]);
  const farms = useMemo(() => {
    const by = new Map();
    for (const f of parcels.data?.features || []) {
      const q = f.properties; if (!q.is_contract_crop_provisional || !q.farm_id) continue;
      const e = by.get(q.farm_id) || { farm_id: q.farm_id, area: 0, fields: 0, actions: 0 };
      e.area += q.area_ha || 0; e.fields++; e.actions += q.action_candidates || 0; by.set(q.farm_id, e);
    }
    return [...by.values()].sort((a, b) => b.actions - a.actions || b.area - a.area);
  }, [parcels.data]);
  const status = (s) => <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: STATUS_COLOR[s] || '#9AA9B3' }} />{STATUS_LABEL[lang][s] || s}</span>;
  const label = selected ? `${fi ? 'Valuma-alue' : 'Catchment'} ${selected} · ${year}` : '';

  return <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
    <section className="surface overflow-hidden lg:col-span-2" data-testid="nature-shortlist">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-4">
        <h2 className="font-heading text-[18px]">{fi ? 'Valuma-alueet, joilla on sopimusalaa' : 'Catchments with contract area'}</h2>
        <select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label={fi ? 'Vuosi' : 'Year'} className="rounded-full border border-border bg-card px-3 py-1.5 text-[12px]">{YEARS.map((y) => <option key={y} value={y}>{y}</option>)}</select>
        <div className="flex w-full gap-1.5" role="group">{[[true, fi ? 'Heikko vesistön tila' : 'Weak water status', list.filter((c) => WEAK.has(c.status)).length], [false, fi ? 'Kaikki' : 'All', list.length]].map(([value, text, n]) => <button key={String(value)} aria-pressed={weakOnly === value} onClick={() => setWeakOnly(value)} className={`rounded-full px-3 py-1.5 text-[11.5px] ${weakOnly === value ? 'bg-[#1B4968] text-white' : 'border border-border bg-card hover:bg-muted'}`}>{text} ({n})</button>)}</div>
      </div>
      {(catchments.error || contract.error) && <p role="alert" className="p-4 text-[12px] text-[#8C3B2E]">{(catchments.error || contract.error).message}</p>}
      <ul className="max-h-[520px] divide-y divide-border/70 overflow-y-auto">{shown.map((c) => <li key={c.id}><button onClick={() => setSelected(c.id)} aria-pressed={selected === c.id} data-testid="nature-catchment-row" className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-[12.5px] hover:bg-secondary/60 ${selected === c.id ? 'bg-[#EAF2F7]' : ''}`}>
        <span className="w-14 font-medium">{c.id}</span><span className="flex-1 text-[11.5px] text-muted-foreground">{status(c.status)}</span>
        <span className="text-right tabular-nums"><strong>{nf(c.contract.contract_area_ha, 0)}</strong> ha<span className="block text-[10.5px] text-muted-foreground">{c.contract.contract_farm_count} {fi ? 'tilaa' : 'farms'}</span></span>
      </button></li>)}</ul>
      {contract.data && !shown.length && <p className="p-4 text-[12.5px] text-muted-foreground">{fi ? 'Ei valuma-alueita tällä valinnalla.' : 'No catchments match this selection.'}</p>}
      <p className="border-t border-border px-4 py-2.5 text-[10.5px] leading-snug text-muted-foreground">{fi ? 'Järjestetty vesistön tilan ja sopimusalan mukaan. Suodatin, ei validoitu priorisointi. Synteettinen data.' : 'Sorted by water status, then contract area. A filter, not a validated priority ranking. Synthetic data.'}</p>
    </section>

    <div className="space-y-4 lg:col-span-3">
      {selected && <section className="surface p-5" data-testid="nature-selected" data-ai-context={JSON.stringify({ label })}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="font-heading text-[20px]">{selected} <span className="text-[13px] font-normal text-muted-foreground">{p?.region}</span></h2>
            {p && <p className="mt-1 text-[12px] text-muted-foreground">{status(p.ecological_status_class)} · {p.receiving_water_type} · {fi ? 'P-herkkyys' : 'P sensitivity'} {nf(p.p_sensitivity, 2)}{row ? ` · ${nf(row.contract_area_ha, 0)} ha ${fi ? 'sopimusalaa' : 'contract area'}` : ''}</p>}</div>
          <ExplainButton context={{ label }} />
        </div>
        {catchments.data && <div className="mt-4"><CatchmentMap catchments={catchments.data} parcels={parcels.data} selected={selected} onSelect={setSelected} /></div>}
        {series.length > 0 && <><h3 className="mt-4 text-[12.5px] font-medium">{fi ? 'Seurattu kuormitus' : 'Monitored load'}</h3><MonitoringChart rows={series} /></>}
      </section>}

      {selected && <section className="surface overflow-hidden" data-testid="nature-actions">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-4"><h2 className="font-heading text-[17px]">{fi ? 'Mistä keskustella tilojen kanssa' : 'What to discuss with the farms'}</h2><button onClick={() => onOpenQuery('18_nature_action_opportunities')} className="text-[12px] font-medium text-[#2E7099] hover:underline">{fi ? 'Lähteet' : 'Sources'} →</button></div>
        <ul className="divide-y divide-border/70 text-[12.5px]">{(actions.data?.rows || []).map((a) => <li key={a.lever_id} className="flex items-baseline justify-between gap-3 px-4 py-2.5"><span><span className="mr-2 text-[11px] text-muted-foreground">{a.lever_id}</span>{a.name}</span><span className="shrink-0 tabular-nums text-muted-foreground">{nf(a.candidate_area_ha, 1)} ha · {a.candidate_field_count} {fi ? 'peltoa' : 'fields'}</span></li>)}</ul>
        {actions.data && !actions.data.rows.length && <p className="p-4 text-[12.5px] text-muted-foreground">{fi ? 'Yksikään seulontasääntö ei täyty tällä valuma-alueella.' : 'No screening rule applies in this catchment.'}</p>}
        {farms.length > 0 && <div className="border-t border-border p-4"><h3 className="mb-2 text-[12px] font-medium">{fi ? 'Sopimustilat tällä alueella' : 'Contract farms in this catchment'} ({farms.length})</h3>
          <div className="flex flex-wrap gap-2">{farms.slice(0, 12).map((f) => <Link key={f.farm_id} to={`/farms/${encodeURIComponent(f.farm_id)}`} className="rounded-full border border-border px-3 py-1 text-[11.5px] hover:bg-secondary">{f.farm_id} · {nf(f.area, 0)} ha{f.actions ? ` · ${f.actions} ${fi ? 'kohdetta' : 'leads'}` : ''}</Link>)}{farms.length > 12 && <span className="px-1 py-1 text-[11.5px] text-muted-foreground">+{farms.length - 12}</span>}</div></div>}
        <p className="border-t border-border px-4 py-2.5 text-[10.5px] text-muted-foreground">{fi ? 'Seulontasääntöjen kohteita. Tehoa ei ole määritetty; ala ei ole ravinnevähennys.' : 'Leads from screening rules. Efficacy is not quantified; area is not a nutrient reduction.'}</p>
      </section>}
    </div>
  </div>;
}

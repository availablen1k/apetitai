import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Droplets } from 'lucide-react';
import { api } from '@/api/client';
import SourceBadge from '@/components/SourceBadge';
import { useI18n } from '@/lib/i18n';
import { nf } from '@/lib/format';
import { STATUS_LABEL } from './CatchmentMap';

// The farm's fields as the nature model sees them for one year. Hidden when the model is not built.
export default function FarmNaturePanel({ farmId }) {
  const { lang } = useI18n();
  const fi = lang === 'fi';
  const [year, setYear] = useState(2025);
  const q = useQuery({ queryKey: ['nature', 'farm', farmId, year], queryFn: () => api.natureFarm(farmId, year), retry: false });
  if (/** @type {{ status?: number } | null} */ (q.error)?.status === 409) return null;
  const d = q.data;

  return (
    <section className="surface mt-3.5 p-5" data-testid="farm-nature">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="inline-flex items-center gap-2 font-heading text-[17px]"><Droplets className="h-4 w-4 text-[#2E7099]" />{fi ? 'Luonto ja vesistöt' : 'Nature and water'}</h2>
        <div className="flex items-center gap-2">
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label={fi ? 'Vuosi' : 'Year'} className="rounded-full border border-border bg-card px-3 py-1.5 text-[12px]">
            {Array.from({ length: 15 }, (_, i) => 2026 - i).map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <SourceBadge type="synthetic" />
        </div>
      </div>
      {q.error && <p className="mt-2 text-[12px] text-muted-foreground">{q.error.message}</p>}
      {d && (
        <>
          <p className="mt-1 text-[11.5px] text-muted-foreground">{d.scope}</p>
          <div className="mt-3 grid grid-cols-2 gap-2 text-[11.5px] sm:grid-cols-4">
            <div className="rounded-xl bg-secondary/60 px-2.5 py-2"><p className="text-muted-foreground">{fi ? 'Peltoja' : 'Fields'} {year}</p><p className="numeral text-[15px] font-semibold">{nf(d.fields.length)}</p></div>
            <div className="rounded-xl bg-secondary/60 px-2.5 py-2"><p className="text-muted-foreground">{fi ? 'Sopimuskasvi' : 'Contract crop'}</p><p className="numeral text-[15px] font-semibold">{nf(d.fields.filter((f) => f.is_contract_crop_provisional).length)}</p></div>
            <div className="rounded-xl bg-secondary/60 px-2.5 py-2"><p className="text-muted-foreground">{fi ? 'Seulottuja toimenpiteitä' : 'Screened actions'}</p><p className="numeral text-[15px] font-semibold">{nf(d.action_levers.reduce((s, l) => s + l.fields, 0))}</p></div>
            <div className="rounded-xl bg-secondary/60 px-2.5 py-2"><p className="text-muted-foreground">{fi ? 'Tila- ja peltohavainnot' : 'Farm/field findings'}</p><p className="numeral text-[15px] font-semibold">{nf(d.quality_findings)}</p></div>
          </div>
          {d.catchments.length > 0 && (
            <ul className="mt-3 space-y-1.5 text-[12px]">
              {d.catchments.map((c) => (
                <li key={c.catchment_id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/70 px-2.5 py-2">
                  <span><span className="font-medium">{c.catchment_id}</span> · {STATUS_LABEL[lang][c.ecological_status_class] || c.ecological_status_class} · {c.receiving_water_type} · P {fi ? 'herkkyys' : 'sensitivity'} {nf(c.p_sensitivity, 2)}</span>
                  <span className="text-muted-foreground">{nf(c.fields)} {fi ? 'peltoa' : 'fields'} · {nf(c.area_ha, 1)} ha</span>
                </li>
              ))}
            </ul>
          )}
          {d.action_levers.length > 0 && <p className="mt-2 text-[11.5px] text-muted-foreground">{d.action_levers.map((l) => `${l.lever_id} ${l.name} (${l.fields})`).join(' · ')}</p>}
          <Link to="/nature?tab=queries&query=15_farm_context" className="mt-3 inline-block text-[12px] text-[#1E5578] hover:underline">{fi ? 'Avaa luontomallin kyselyt ja lähteet →' : 'Open nature queries and sources →'}</Link>
        </>
      )}
    </section>
  );
}

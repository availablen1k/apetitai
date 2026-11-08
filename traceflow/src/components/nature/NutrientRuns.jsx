import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FlaskConical, Loader2 } from 'lucide-react';
import { api, getReviewerLabel, setReviewerLabel } from '@/api/client';
import StatusPill from '@/components/StatusPill';
import { useI18n } from '@/lib/i18n';
import { nf, shortDate } from '@/lib/format';
import CatchmentMap, { esc } from './CatchmentMap';
import { LossChart } from './NatureCharts';
import { useNatureJob } from './useNatureJob';

const variantKey = (v) => (v ? `${v.input_variant}|${v.input_point}|${v.stress_case}` : '');

export default function NutrientRuns() {
  const { lang } = useI18n();
  const fi = lang === 'fi';
  const [reviewer, setReviewer] = useState(() => { const n = getReviewerLabel(); return n === 'Local reviewer' ? '' : n; });
  const [year, setYear] = useState(2025);
  const [catchment, setCatchment] = useState('CA01');
  const [inputRun, setInputRun] = useState('');
  const [lossRun, setLossRun] = useState('');
  const [variant, setVariant] = useState('');
  const [scope, setScope] = useState('registry_selected');
  const inputs = useQuery({ queryKey: ['nature', 'nutrient', 'inputs'], queryFn: () => api.natureNutrientRuns('inputs') });
  const losses = useQuery({ queryKey: ['nature', 'nutrient', 'losses'], queryFn: () => api.natureNutrientRuns('losses') });
  const catchments = useQuery({ queryKey: ['nature', 'catchments'], queryFn: api.natureCatchments });
  const inputJob = useNatureJob();
  const lossJob = useNatureJob();
  const completeInputs = (inputs.data || []).filter((r) => r.complete && r.year === year);
  useEffect(() => { if (!completeInputs.some((r) => r.id === inputRun)) setInputRun(completeInputs[0]?.id || ''); }, [inputs.data, year]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!lossRun && losses.data?.find((r) => r.complete)) setLossRun(losses.data.find((r) => r.complete).id); }, [losses.data, lossRun]);

  const [iv, ip, sc] = variant.split('|');
  const detail = useQuery({ queryKey: ['nature', 'nutrient', 'loss', lossRun, variant], queryFn: () => api.natureLossRun(lossRun, variant ? { input_variant: iv, input_point: ip, stress_case: sc } : undefined), enabled: !!lossRun });
  const d = detail.data;
  const parcels = useQuery({ queryKey: ['nature', 'parcels', d?.run.meta?.catchment_id, d?.run.meta?.year], queryFn: () => api.natureCatchmentParcels(d.run.meta.catchment_id, d.run.meta.year), enabled: !!d?.run.meta });
  const delivered = useMemo(() => {
    const m = new Map();
    for (const f of d?.fields || []) if (f.nutrient === 'P') m.set(f.parcel_id, f);
    return m;
  }, [d]);
  const maxP = Math.max(1e-9, ...[...delivered.values()].map((f) => f.delivered_kg || 0));

  const remember = () => setReviewerLabel(reviewer);
  const startInputs = () => { remember(); inputJob.submit({ kind: 'nutrient_inputs', requested_by: reviewer.trim(), year }); };
  const startLoss = () => { remember(); lossJob.submit({ kind: 'nutrient_losses', requested_by: reviewer.trim(), input_run_id: inputRun, catchment_id: catchment, year }); };

  return (
    <div className="space-y-3.5">
      <div className="flex items-start gap-2 rounded-xl border border-[#EDDCC0] bg-[#F8EEDF] px-3.5 py-2.5 text-[12px] leading-relaxed text-[#8A5A1E]">
        <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" />
        {fi ? 'Kokeelliset ajot: syötepolitiikka 0.2.0 on luonnos ja kuormituspilotti on kalibroimaton. Numerotarkistukset eivät validoi tiedettä, eikä tuloksia saa käyttää valuma-alueiden priorisointiin.' : 'Experimental runs: input policy 0.2.0 is a draft and the loss pilot is uncalibrated. Numerical checks do not validate the science; do not use results to prioritise catchments.'}
      </div>

      <section className="surface p-5">
        <h2 className="font-heading text-[17px]">{fi ? 'Käynnistä ajo' : 'Start a run'}</h2>
        <div className="mt-3 grid grid-cols-1 gap-2.5 text-[11.5px] sm:grid-cols-2 xl:grid-cols-4">
          <label><span className="font-medium">{fi ? 'Nimesi' : 'Your name'}</span><input value={reviewer} onChange={(e) => setReviewer(e.target.value)} maxLength={80} className="mt-1 w-full rounded-lg border border-input bg-card px-2.5 py-2" /></label>
          <label><span className="font-medium">{fi ? 'Vuosi' : 'Year'}</span><input type="number" value={year} min={2012} max={2031} onChange={(e) => setYear(Number(e.target.value))} className="mt-1 w-full rounded-lg border border-input bg-card px-2.5 py-2" /></label>
          <label><span className="font-medium">{fi ? 'Valuma-alue (pilotti)' : 'Catchment (pilot)'}</span>
            <select value={catchment} onChange={(e) => setCatchment(e.target.value)} className="mt-1 w-full rounded-lg border border-input bg-card px-2.5 py-2">{(catchments.data?.features || []).map((f) => <option key={f.id} value={f.id}>{f.id}</option>)}</select>
          </label>
          <label><span className="font-medium">{fi ? 'Syöteajo (pilotti)' : 'Input run (pilot)'}</span>
            <select value={inputRun} onChange={(e) => setInputRun(e.target.value)} className="mt-1 w-full rounded-lg border border-input bg-card px-2.5 py-2">{completeInputs.length ? completeInputs.map((r) => <option key={r.id} value={r.id}>{r.id}</option>) : <option value="">{fi ? '— luo ensin syöteajo —' : '— create an input run first —'}</option>}</select>
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={startInputs} disabled={!reviewer.trim() || inputJob.busy} className="inline-flex items-center gap-2 rounded-full bg-[#1B4968] px-4 py-2 text-[12.5px] font-medium text-[#EFF6FC] disabled:opacity-50" data-testid="nature-start-inputs">{inputJob.busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{fi ? `1. Luo syöteajo ${year}` : `1. Create input run ${year}`}</button>
          <button onClick={startLoss} disabled={!reviewer.trim() || !inputRun || lossJob.busy} className="inline-flex items-center gap-2 rounded-full bg-[#1B4968] px-4 py-2 text-[12.5px] font-medium text-[#EFF6FC] disabled:opacity-50" data-testid="nature-start-loss">{lossJob.busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{fi ? `2. Aja kuormituspilotti ${catchment}` : `2. Run loss pilot ${catchment}`}</button>
        </div>
        {[inputJob, lossJob].map((j, i) => (j.job || j.error) && <p key={i} className={`mt-2 text-[12px] ${j.error || j.job?.status === 'failed' ? 'text-[#9E3B2C]' : 'text-muted-foreground'}`}>{j.error || `${j.job.kind}: ${j.job.status} · ${j.job.phase}${j.job.error ? ` · ${j.job.error}` : ''}`}</p>)}
      </section>

      <section className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
        {[{ title: fi ? 'Syöteajot' : 'Input runs', q: inputs }, { title: fi ? 'Kuormituspilotit' : 'Loss pilots', q: losses, pick: setLossRun, current: lossRun }].map(({ title, q, pick, current }) => (
          <div key={title} className="surface p-5">
            <h2 className="font-heading text-[17px]">{title}</h2>
            <ul className="mt-2 space-y-1.5 text-[11.5px]">
              {(q.data || []).map((r) => (
                <li key={r.id}>
                  <button disabled={!pick || !r.complete} onClick={() => { pick?.(r.id); setVariant(''); }} className={`flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-left ${current === r.id ? 'border-[#1B4968]' : 'border-border/70'} disabled:cursor-default`}>
                    <span className="min-w-0 truncate font-mono">{r.id}</span>
                    <span className="flex shrink-0 items-center gap-2">{shortDate(r.created_at)}<StatusPill tone={r.complete ? 'ok' : 'error'}>{r.complete ? (fi ? 'valmis' : 'complete') : (fi ? 'keskeneräinen' : 'incomplete')}</StatusPill></span>
                  </button>
                </li>
              ))}
              {!q.data?.length && <li className="text-muted-foreground">{fi ? 'Ei ajoja vielä.' : 'No runs yet.'}</li>}
            </ul>
          </div>
        ))}
      </section>

      {d && (
        <section className="surface p-5" data-testid="nature-loss-detail">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-heading text-[17px]">{fi ? 'Toimitettu kuorma' : 'Delivered load'} · {d.run.meta?.catchment_id} · {d.run.meta?.year}</h2>
            <select value={variant || variantKey(d.selected_variant)} onChange={(e) => setVariant(e.target.value)} aria-label={fi ? 'Syötevariantti' : 'Input variant'} className="max-w-full rounded-full border border-border bg-card px-3 py-1.5 text-[11.5px]">
              {d.variants.map((v) => <option key={variantKey(v)} value={variantKey(v)}>{v.input_variant} · {v.input_point} · {v.stress_case}</option>)}
            </select>
          </div>
          <p className="mb-3 text-[11.5px] text-muted-foreground">{d.scope} {fi ? 'Tila' : 'Status'}: {d.run.meta?.scientific_status}</p>
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[11.5px]">
            <span className="text-muted-foreground">{fi ? 'Rajaus' : 'Scope'}</span>
            {[...new Set(d.summary.map((r) => r.scope))].map((sc) => <button key={sc} onClick={() => setScope(sc)} aria-pressed={scope === sc} className={`rounded-full border px-2.5 py-1 ${scope === sc ? 'border-[#1B4968] bg-[#1B4968] text-[#EFF6FC]' : 'border-border'}`}>{sc}</button>)}
            {d.summary[0]?.monitored_whole_catchment_kg != null && <span className="text-muted-foreground">{fi ? 'Vertailu: seurattu koko valuma-alueen kuorma' : 'Reference: monitored whole-catchment load'} N {nf(d.summary.find((r) => r.nutrient === 'N')?.monitored_whole_catchment_kg)} kg · P {nf(d.summary.find((r) => r.nutrient === 'P')?.monitored_whole_catchment_kg)} kg</span>}
          </div>
          <LossChart summary={d.summary} scope={scope} />
          {catchments.data && parcels.data && (
            <div className="mt-4">
              <h3 className="mb-2 text-[13px] font-medium">{fi ? 'Peltojen toimitettu P-kuorma valitulla variantilla' : 'Field delivered P load for the selected variant'}</h3>
              <CatchmentMap
                catchments={catchments.data}
                parcels={parcels.data}
                selected={d.run.meta.catchment_id}
                height={360}
                parcelStyle={{ key: variant || variantKey(d.selected_variant), fn: (f) => { const x = delivered.get(f.id); return x ? { color: '#5F3A1C', weight: 0.5, fillColor: x.status === 'unavailable' ? '#C9CED2' : '#C1773F', fillOpacity: x.status === 'unavailable' ? 0.5 : 0.15 + 0.8 * ((x.delivered_kg || 0) / maxP) } : { color: '#9AA9B3', weight: 0.3, fillOpacity: 0 }; } }}
                parcelTooltip={(f) => { const x = delivered.get(f.id); return x ? `${esc(f.id)} · P ${x.delivered_kg === null ? (fi ? 'tuntematon' : 'unknown') : `${esc(nf(x.delivered_kg, 2))} kg`}<br/>${esc(x.reason)}` : `${esc(f.id)} · ${fi ? 'ei pilotissa' : 'not in pilot'}`; }}
              />
            </div>
          )}
        </section>
      )}
    </div>
  );
}

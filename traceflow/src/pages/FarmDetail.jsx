import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, MapPin, Plus, Check } from 'lucide-react';
import { api } from '@/api/client';
import StatusPill from '@/components/StatusPill';
import SourceBadge from '@/components/SourceBadge';
import YieldChart from '@/components/farms/YieldChart';
import { useI18n } from '@/lib/i18n';
import { nf } from '@/lib/format';
import Term from '@/components/Term';
import { regionName, severityLabel } from '@/lib/glossary';
import FarmNaturePanel from '@/components/nature/FarmNaturePanel';

export default function FarmDetail() {
  const { id } = useParams();
  const { t, lang } = useI18n();
  const fi = lang === 'fi';
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const farmQ = useQuery({ queryKey: ['farm', id], queryFn: () => api.farm(id) });
  const farm = farmQ.data?.farm;
  const parcelsQ = { data: farmQ.data?.parcels };
  const alertsQ = useQuery({ queryKey: ['farm-alerts', id], queryFn: () => api.docs('farm_alerts', { farm_id: id, limit: 20 }) });
  const tasksQ = useQuery({ queryKey: ['farm-tasks', id], queryFn: () => api.docs('consultant_tasks', { farm_id: id, sort: '-created_date', limit: 30 }) });

  if (farmQ.isLoading) return <p className="text-[13px] text-muted-foreground">{t('common.loading')}</p>;
  if (!farm) return <div className="surface p-8 text-center text-[13px] text-muted-foreground">{fi ? 'Tilaa ei löytynyt.' : 'Farm not found.'}</div>;

  const parcels = parcelsQ.data || [];
  const alerts = alertsQ.data || [];
  const tasks = tasksQ.data || [];

  const addTask = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try {
      await api.createDoc('consultant_tasks', {
        farm_id: farm.farm_id,
        title: title.trim(),
        status: 'open',
        owner: 'Viljelyneuvoja',
        created_by_name: 'Työtila',
      });
      setTitle('');
      qc.invalidateQueries({ queryKey: ['farm-tasks'] });
    } finally {
      setBusy(false);
    }
  };

  const closeTask = async (task) => {
    await api.updateDoc('consultant_tasks', task.id, { status: 'done' });
    qc.invalidateQueries({ queryKey: ['farm-tasks'] });
  };

  return (
    <div>
      <Link to="/farms" className="mb-3 inline-flex items-center gap-1.5 text-[11.5px] font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> {t('common.back')}
      </Link>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="eyebrow mb-1">{fi ? 'Tilaprofiili' : 'Farm profile'}</div>
          <h1 className="font-heading text-[28px] leading-tight">{farm.farm_id}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
            <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{regionName(farm.region, lang)} · {farm.country}</span>
            <span>{nf(farm.area_ha, 1)} {fi ? 'hehtaaria' : 'hectares'}</span>
            <span>{farm.parcel_count} {fi ? 'lohkoa' : 'parcels'}</span>
            <span>{fi ? 'Liittynyt' : 'Joined'} {farm.joined_year}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {farm.organic_certified && <StatusPill tone="ok">{fi ? 'Luomu' : 'Organic'}</StatusPill>}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-3">
        <section className="surface p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="font-heading text-[17px]">{t('farms.history')} · {farm.yield_crop}</h2>
            <SourceBadge type="imported" />
          </div>
          <YieldChart series={farm.yield_series} crop={farm.yield_crop} lang={lang} />
          <div className="mt-2 grid grid-cols-3 gap-2 border-t border-border pt-3 text-[11.5px]">
            <div>
              <p className="text-muted-foreground"><Term concept="yield">{fi ? 'Viimeisin sato' : 'Latest yield'}</Term></p>
              <p className="numeral text-[15px] font-semibold">{nf(farm.avg_yield, 2)} {fi ? 'tonnia/ha' : 't/ha'}</p>
            </div>
            <div>
              <p className="text-muted-foreground">{fi ? 'Kylvö 2027' : 'Planned 2027'}</p>
              <p className="text-[13px] font-medium">{farm.planned_crop || '—'}</p>
            </div>
            <div>
              <p className="text-muted-foreground">{fi ? 'Eloperäinen maa' : 'Organic soil'}</p>
              <p className="numeral text-[15px] font-semibold">{nf(farm.organic_share, 1)} %</p>
            </div>
          </div>
        </section>

        <section className="surface p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-heading text-[17px]">{t('farms.riskExplanation')}</h2>
            <SourceBadge type="imported" />
          </div>
          <p className="mt-3 text-[12px] leading-snug text-muted-foreground">{fi ? 'Alla ovat tuodut maaperä- ja valuma-aluetiedot. Kuivuus- ja ravinneriskit vaativat validoidun riskimallin.' : 'Imported soil and catchment indicators are shown below. Drought and nutrient risk scores require a validated risk model.'}</p>
          <div className="mt-3 grid grid-cols-2 gap-2 text-[11.5px]">
            <div className="rounded-xl bg-secondary/60 px-2.5 py-2"><p className="text-muted-foreground">{fi ? 'Fosforiluku (mediaani)' : 'P test (median)'}</p><p className="numeral text-[15px] font-semibold">{farm.p_test_avg === null ? '—' : `${nf(farm.p_test_avg, 1)} mg/l`}</p></div>
            <div className="rounded-xl bg-secondary/60 px-2.5 py-2"><p className="text-muted-foreground">{fi ? 'Valuma-alueet' : 'Catchments'}</p><p className="text-[13px] font-semibold">{(farm.catchments || []).join(', ') || '—'}</p></div>
          </div>

        </section>
      </div>

      <div className="mt-3.5 grid grid-cols-1 gap-3.5 lg:grid-cols-3">
        <section className="surface p-5 lg:col-span-2">
          <h2 className="font-heading text-[17px]">{t('farms.parcels')}</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-[11.5px]">
              <thead className="text-muted-foreground">
                <tr className="border-b border-border text-left">
                  <th className="py-2 pr-3 font-medium">{fi ? 'Lohko' : 'Parcel'}</th>
                  <th className="py-2 pr-3 font-medium"><Term concept="area">{fi ? 'Ala (ha)' : 'Area (ha)'}</Term></th>
                  <th className="py-2 pr-3 font-medium">{t('farms.soil')}</th>
                  <th className="py-2 pr-3 font-medium"><Term concept="p_test">{fi ? 'Fosforiluku, mg/l' : 'Phosphorus, mg/l'}</Term></th>
                  <th className="py-2 pr-3 font-medium">{t('farms.catchment')}</th>
                  <th className="py-2 font-medium">{fi ? 'Puskuri' : 'Buffer'}</th>
                </tr>
              </thead>
              <tbody>
                {parcels.map((p) => (
                  <tr key={p.id} className="border-b border-border/60 last:border-0">
                    <td className="py-1.5 pr-3 font-medium">{p.parcel_id}</td>
                    <td className="py-1.5 pr-3 numeral">{nf(p.area_ha, 2)}</td>
                    <td className="py-1.5 pr-3">{p.soil_class || '—'}{p.organic ? ' · luomu' : ''}</td>
                    <td className="py-1.5 pr-3 numeral">{p.p_test === null || p.p_test === undefined ? '—' : nf(p.p_test, 1)}</td>
                    <td className="py-1.5 pr-3">{p.catchment_id || '—'}</td>
                    <td className="py-1.5">{p.buffer_strip ? <Check className="h-3.5 w-3.5 text-[#2E7099]" /> : <span className="text-muted-foreground">—</span>}</td>
                  </tr>
                ))}
                {!parcels.length && (
                  <tr><td colSpan={6} className="py-4 text-center text-muted-foreground">{t('common.none')}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="surface p-5">
          <h2 className="font-heading text-[17px]">{t('farms.task')}</h2>
          <form onSubmit={addTask} className="mt-3 flex gap-2">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={fi ? 'Esim. tarkista puskurikaistat' : 'e.g. check buffer strips'}
              aria-label={fi ? 'Tehtävän kuvaus' : 'Task description'}
              className="min-w-0 flex-1 rounded-xl border border-border bg-card px-3 py-2 text-[12px] outline-none focus:border-[#4A89B5]/50"
            />
            <button
              type="submit"
              aria-label={fi ? 'Lisää tehtävä' : 'Add task'}
              disabled={busy || !title.trim()}
              className="inline-flex items-center gap-1 rounded-xl bg-[#1B4968] px-3 py-2 text-[12px] font-medium text-[#EFF6FC] disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </form>
          <ul className="mt-3 space-y-2">
            {tasks.map((task) => (
              <li key={task.id} className="flex items-start gap-2 rounded-xl border border-border/70 px-2.5 py-2">
                <button
                  onClick={() => closeTask(task)}
                  aria-label={fi ? `Merkitse valmiiksi: ${task.title}` : `Mark as done: ${task.title}`}
                  disabled={task.status === 'done'}
                  className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-border disabled:border-[#C9DEEE] disabled:bg-[#E7F1FA]"
                >
                  {task.status === 'done' && <Check className="h-2.5 w-2.5 text-[#1E5578]" />}
                </button>
                <div className="min-w-0">
                  <p className={`text-[12px] leading-snug ${task.status === 'done' ? 'text-muted-foreground line-through' : ''}`}>{task.title}</p>
                  <p className="text-[10.5px] text-muted-foreground">{task.owner || '—'}</p>
                </div>
              </li>
            ))}
            {!tasks.length && <li className="text-[12px] text-muted-foreground">{fi ? 'Ei avoimia tehtäviä.' : 'No open tasks.'}</li>}
          </ul>
        </section>
      </div>

      <FarmNaturePanel farmId={id} />

      {alerts.length > 0 && (
        <section className="surface mt-3.5 p-5">
          <h2 className="font-heading text-[17px]">{fi ? 'Ilmasto- ja datahälytykset' : 'Climate and data alerts'}</h2>
          <div className="mt-3 grid grid-cols-1 gap-2.5 md:grid-cols-2">
            {alerts.map((a) => (
              <div key={a.id} className="rounded-xl border border-border/70 p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[12.5px] font-medium leading-snug">{fi ? a.title : a.title_en || a.title}</p>
                  <StatusPill tone={a.severity === 'high' ? 'error' : 'review'}>{severityLabel(a.severity, lang)}</StatusPill>
                </div>
                <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
                  {fi ? a.explanation : a.explanation_en || a.explanation}
                </p>
                <p className="mt-1.5 text-[11px] text-[#1E5578]">
                  {fi ? a.recommended_action : a.recommended_action_en || a.recommended_action}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

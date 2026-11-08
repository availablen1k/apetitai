import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Wheat, Loader2, Search, Download, Info } from 'lucide-react';
import { api } from '@/api/client';
import PageHeader from '@/components/PageHeader';
import MetricCard from '@/components/MetricCard';
import StatusPill from '@/components/StatusPill';
import { useI18n } from '@/lib/i18n';
import { nf, tco2 } from '@/lib/format';
import { useToast } from '@/components/ui/use-toast';
import useReportingYear from '@/lib/useReportingYear';

const KINDS = [
  { id: 'material_purchase', fi: 'Ostetut raaka-aineet (kg × kerroin)', en: 'Purchased materials (kg × factor)' },
  { id: 'contract_farm', fi: 'Sopimusviljely (tilan jalanjälki)', en: 'Contract farming (farm footprint)' },
  { id: 'spend_purchase', fi: 'Palvelut ja investoinnit (EUR × kerroin)', en: 'Services and capex (EUR × factor)' },
];
const BASIS = {
  supplier_pcf: { fi: 'toimittajan PCF', en: 'supplier PCF' },
  default_factor: { fi: 'materiaalin oletuskerroin', en: 'material default factor' },
  farm_survey: { fi: 'tilakyselyn tiedot', en: 'farm survey inputs' },
  norm_estimate: { fi: 'normiarvio (ei kyselyä)', en: 'norm estimate (no survey)' },
};

export default function RawMaterials() {
  const { lang } = useI18n();
  const fi = lang === 'fi';
  const { toast } = useToast();
  const qc = useQueryClient();
  const overview = useQuery({ queryKey: ['overview'], queryFn: () => api.overview(), refetchInterval: 5000 });
  const { year, years, setYear } = useReportingYear(overview.data);
  const [kind, setKind] = useState('material_purchase');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const runs = useQuery({ queryKey: ['runs', year], queryFn: () => api.runs({ year, kind: 'inventory' }), enabled: !!year, refetchInterval: 3000 });
  const run = runs.data?.[0];
  const detail = useQuery({ queryKey: ['run', run?.id], queryFn: () => api.run(run.id), enabled: !!run });
  const rows = useQuery({ queryKey: ['contribs-kind', run?.id, kind, q], queryFn: () => api.contributions(run.id, { kind, q, limit: 100 }), enabled: !!run });
  const byCat = new Map((detail.data?.completeness?.by_category || []).map((c) => [c.category, c]));
  const goods = byCat.get('cat01_purchased_goods');
  const services = byCat.get('cat01_purchased_services');
  const capex = byCat.get('cat02_capital_goods');
  const transport = byCat.get('cat04_upstream_transport');
  const precision = detail.data?.completeness?.contains_demo_data ? 3 : 0;

  const calc = async () => {
    setBusy(true);
    try {
      const r = await api.calculate('inventory', { year: Number(year) });
      qc.invalidateQueries({ queryKey: ['runs'] });
      toast({ title: fi ? 'Uusi laskenta-ajo' : 'New calculation run', description: r.id });
    } catch (e) {
      toast({ title: fi ? 'Laskenta epäonnistui' : 'Calculation failed', description: e.message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow={fi ? 'Scope 3 luokka 1' : 'Scope 3 Category 1'}
        title={fi ? 'Raaka-aineet ja viljely' : 'Raw materials and farming'}
        description={fi ? 'Ostetun materiaalin tuotannon päästöt: toimittajan voimassa oleva PCF → materiaalin oletuskerroin. Sopimusviljelyn materiaalit lasketaan vain tilakohtaisella jalanjäljellä, ei lisäksi PCF:llä. Kuljetukset ovat erikseen luokassa 4.' : 'Production emissions of purchased materials: valid supplier PCF → material default factor. Contract-farmed materials are counted only through the farm footprint, never also with a PCF. Transport is separate in Category 4.'}
        actions={
          <>
            <select value={year} onChange={(e) => setYear(e.target.value)} aria-label={fi ? 'Vuosi' : 'Year'} data-testid="raw-materials-year" className="rounded-full border border-border bg-card px-3 py-2 text-[12px]">{years.map((y) => <option key={y} value={y}>{y}</option>)}</select>
            <button onClick={calc} disabled={busy || !year} className="inline-flex items-center gap-2 rounded-full bg-[#1B4968] px-4 py-2 text-[12.5px] font-medium text-[#EFF6FC] disabled:opacity-50">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wheat className="h-3.5 w-3.5" />}{fi ? 'Laske (uusi ajo)' : 'Calculate (new run)'}</button>
            {run && <a href={api.workbookUrl(run.id)} className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-[12.5px] font-medium"><Download className="h-3.5 w-3.5" />Excel</a>}
          </>
        }
      />
      {!run ? (
        <p className="surface p-8 text-center text-[13px] text-muted-foreground">{runs.isLoading ? '…' : fi ? `Vuodelle ${year ?? ''} ei ole laskenta-ajoa.` : `No calculation run for ${year ?? ''}.`}</p>
      ) : (
        <>
          <section className="mb-4 grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label={fi ? 'Kat 1 tuotteet' : 'Cat 1 goods'} value={tco2(goods?.tco2e, precision)} unit="tCO₂e" sourceType="calculated" hint={`${nf(goods?.count)} ${fi ? 'riviä (ostot + tilat)' : 'rows (purchases + farms)'}`} />
            <MetricCard label={fi ? 'Kat 1 palvelut' : 'Cat 1 services'} value={tco2(services?.tco2e, precision)} unit="tCO₂e" sourceType="calculated" hint={fi ? 'Kulupohjainen.' : 'Spend-based.'} />
            <MetricCard label={fi ? 'Kat 2 investoinnit' : 'Cat 2 capital goods'} value={tco2(capex?.tco2e, precision)} unit="tCO₂e" sourceType="calculated" />
            <MetricCard label={fi ? 'Kat 4 (erikseen)' : 'Cat 4 (separate)'} value={tco2(transport?.tco2e, precision)} unit="tCO₂e" sourceType="calculated" to="/transport" hint={fi ? 'Saapuvat kuljetukset, ei sisälly luokkaan 1.' : 'Inbound transport, not included in Category 1.'} />
          </section>
          <p className="mb-3 flex items-start gap-2 text-[11.5px] text-muted-foreground"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />{fi ? `Ajo ${run.id} (${run.created_at.slice(0, 16)}). Toimittajan PCF hyväksytään vain, jos sen viitejakso kattaa vuoden ja yksikkö on kg. Viljelyn jalanjälki: lannoitteet, N₂O, diesel, kalkitus, eloperäinen maa (maaperäkartta), torjunta ja sähkö; jaetaan toimitetuille kiloille.` : `Run ${run.id} (${run.created_at.slice(0, 16)}). A supplier PCF is used only if its reference period covers the year and its unit is kg. Farm footprint: fertiliser, N₂O, diesel, lime, organic soil (soil map), sprays and electricity; allocated to delivered kg.`}</p>

          <div className="mb-3 flex flex-wrap gap-2">
            <div className="flex flex-wrap items-center gap-1 rounded-full border border-border bg-card p-1">
              {KINDS.map((k) => <button key={k.id} onClick={() => setKind(k.id)} className={`rounded-full px-3 py-1.5 text-[12px] font-medium ${kind === k.id ? 'bg-[#1B4968] text-[#EFF6FC]' : 'text-muted-foreground'}`}>{fi ? k.fi : k.en}</button>)}
            </div>
            <div className="relative min-w-[180px] flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={fi ? 'Hae materiaalia, toimittajaa tai tilaa' : 'Search material, supplier or farm'} className="w-full rounded-full border border-border bg-card py-2 pl-9 pr-3 text-[12.5px]" /></div>
          </div>
          <div className="surface overflow-x-auto">
            <table className="w-full text-left text-[12px]">
              <thead className="bg-secondary/50 text-[10.5px] uppercase tracking-wide text-muted-foreground"><tr><th className="px-4 py-2.5">{fi ? 'Rivi' : 'Line'}</th><th className="px-2">{fi ? 'Määrä' : 'Activity'}</th><th className="px-2">{fi ? 'Kerroin' : 'Factor'}</th><th className="px-2">{fi ? 'Peruste' : 'Basis'}</th><th className="px-2">{fi ? 'Tila' : 'Status'}</th><th className="px-2 text-right">tCO₂e</th><th className="px-4" /></tr></thead>
              <tbody>
                {(rows.data?.items || []).map((c) => (
                  <tr key={c.id} className="border-t border-border/60">
                    <td className="max-w-[280px] truncate px-4 py-2 font-mono text-[10.5px]" title={c.line_item}>{c.line_item}</td>
                    <td className="px-2 numeral">{c.kind === 'contract_farm' ? `${nf(c.inputs.area_ha, 2)} ha · ${nf(c.inputs.delivered_kg)} kg` : c.kind === 'spend_purchase' ? `${nf(c.inputs.amount_eur)} EUR` : `${nf(c.inputs.kg)} kg`}</td>
                    <td className="px-2 text-[11px]">{c.factor_id} = {nf(c.factor_value, 4)} <span className="text-muted-foreground">{c.factor_unit}</span></td>
                    <td className="px-2 text-[11px]">{BASIS[c.basis]?.[fi ? 'fi' : 'en'] || c.basis || '—'}</td>
                    <td className="px-2"><StatusPill tone={c.value_status === 'original' ? 'ok' : c.value_status === 'corrected' ? 'approved' : 'review'} dot={false}>{c.value_status}</StatusPill></td>
                    <td className="px-2 text-right numeral">{tco2(c.tco2e, 2)}</td>
                    <td className="px-4 text-right"><Link to={`/traceability?run=${run.id}&c=${c.id}`} className="text-[11.5px] text-[#2E7099] hover:underline">{fi ? 'Selitä' : 'Explain'}</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.data && <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">{fi ? `Näytetään ${Math.min(100, rows.data.total)} / ${nf(rows.data.total)} suurinta riviä.` : `Showing ${Math.min(100, rows.data.total)} of ${nf(rows.data.total)} largest rows.`} {fi ? 'Tilan ja toimituksen välinen yhteys perustuu ERP-rivin toimittajatunnisteeseen (tilatunnus); muuta yhteyttä ei päätellä.' : 'The farm-to-delivery link is the ERP supplier id (farm id); no other link is inferred.'}</p>}
          </div>
        </>
      )}
    </div>
  );
}

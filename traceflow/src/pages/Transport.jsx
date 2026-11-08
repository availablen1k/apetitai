import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Truck, Ship, Search, ChevronLeft, ChevronRight, Loader2, Download, MapPinOff } from 'lucide-react';
import { api, getReviewerLabel, setReviewerLabel } from '@/api/client';
import PageHeader from '@/components/PageHeader';
import MetricCard from '@/components/MetricCard';
import StatusPill from '@/components/StatusPill';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { useI18n } from '@/lib/i18n';
import { nf, tco2 } from '@/lib/format';
import { useToast } from '@/components/ui/use-toast';
import useReportingYear from '@/lib/useReportingYear';

const PAGE = 50;
const JOIN_LABEL = {
  linked: { fi: 'linkitetty ERP:iin', en: 'linked to ERP' },
  linked_multi_line: { fi: 'useita ERP-rivejä: kohdistus tarvitaan', en: 'multiple ERP lines: allocation needed' },
  unlinked_no_erp_document: { fi: 'ei ERP-dokumenttia', en: 'no ERP document' },
  outbound_sales_reference: { fi: 'lähtevä (myyntiviite)', en: 'outbound (sales reference)' },
};
const ROUTE_LABEL = {
  calculated_from_supplied_distance: { fi: 'ilmoitettu matka', en: 'supplied distance' },
  route_proposed: { fi: 'reittiehdotus (ei todennettu)', en: 'route proposed (not verified)' },
  verified_route: { fi: 'reitti vahvistettu', en: 'route verified' },
  distance_missing: { fi: 'matka puuttuu', en: 'distance missing' },
};

function LegSheet({ id, onClose, fi }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const q = useQuery({ queryKey: ['shipment', id], queryFn: () => api.shipment(id), enabled: !!id });
  const [legs, setLegs] = useState([{ mode: 'truck', distance_km: '' }]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [evidence, setEvidence] = useState({ type: 'carrier_document', note: '' });
  const d = q.data;
  const refresh = () => { qc.invalidateQueries({ queryKey: ['shipment', id] }); qc.invalidateQueries({ queryKey: ['shipments'] }); };

  const propose = async (provider) => {
    setBusy(true);
    try {
      const body = { shipment_record_id: id, provider };
      if (provider === 'manual') Object.assign(body, { legs: legs.filter((l) => Number(l.distance_km) > 0).map((l) => ({ mode: l.mode, distance_km: Number(l.distance_km) })), evidence_note: note });
      const r = await api.proposeRoute(body);
      toast({ title: fi ? 'Reittiehdotus tallennettu' : 'Route proposal saved', description: `${nf(r.total_km, 1)} km · ${r.deviation_pct === null ? '' : `${r.deviation_pct > 0 ? '+' : ''}${nf(r.deviation_pct, 1)} % ${fi ? 'vs ilmoitettu' : 'vs supplied'}`}` });
      refresh();
    } catch (e) {
      toast({ title: fi ? 'Ehdotus epäonnistui' : 'Proposal failed', description: e.message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };
  const review = async (route, decision) => {
    try {
      const reviewer = getReviewerLabel();
      setReviewerLabel(reviewer);
      await api.reviewRoute(route.id, { decision, reviewer_label: reviewer, expected_revision: route.revision, evidence_type: decision === 'approve' ? evidence.type : undefined, evidence_note: decision === 'approve' ? evidence.note : undefined });
      refresh();
    } catch (e) {
      toast({ title: fi ? 'Päätös epäonnistui' : 'Decision failed', description: e.message, variant: 'destructive' });
    }
  };

  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {!d ? <p className="p-4 text-[13px] text-muted-foreground">{q.error?.message || '…'}</p> : (
          <div className="space-y-4 text-[12px]">
            <SheetHeader>
              <SheetTitle className="font-heading text-[19px]">{d.shipment.shipment_id} · {d.shipment.mode}</SheetTitle>
              <SheetDescription>{d.shipment.direction} · ref {d.shipment.ref_doc} · {d.shipment.year}</SheetDescription>
            </SheetHeader>
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl border border-border p-2.5"><div className="eyebrow">t</div><div className="numeral text-[16px]">{nf(d.shipment.freight_t, 3)}</div></div>
              <div className="rounded-xl border border-border p-2.5"><div className="eyebrow">km</div><div className="numeral text-[16px]">{nf(d.shipment.distance_km, 1)}</div></div>
              <div className="rounded-xl border border-border p-2.5"><div className="eyebrow">t × km</div><div className="numeral text-[16px]">{nf(d.shipment.freight_t * d.shipment.distance_km, 4)}</div></div>
            </div>
            <p>{fi ? 'Kerroin' : 'Factor'}: <b>{d.shipment.ef_id}</b> = {d.factor?.kgco2e_per_unit ?? '—'} kgCO₂e/tkm ({d.factor?.reference_source}, v{d.factor?.version}) → <b>{d.factor ? nf(d.shipment.freight_t * d.shipment.distance_km * d.factor.kgco2e_per_unit, 3) : '—'} kgCO₂e</b></p>
            <p className="flex items-start gap-2 rounded-xl bg-secondary/50 p-2.5 text-muted-foreground"><MapPinOff className="mt-0.5 h-3.5 w-3.5 shrink-0" />{fi ? 'Lähdedata sisältää matkan ja kulkumuodon, mutta ei tarkkoja lähtö- ja määräpaikkoja. Laskenta käyttää ilmoitettua matkaa; karttaa ei piirretä.' : 'The source data contains distance and mode but no exact origin or destination. The calculation uses the supplied distance; no map is drawn.'}</p>
            <div>
              <div className="eyebrow mb-1">{fi ? 'ERP-linkki' : 'ERP link'}</div>
              <StatusPill tone={d.shipment.join_status === 'linked' ? 'ok' : 'review'} dot={false}>{JOIN_LABEL[d.shipment.join_status]?.[fi ? 'fi' : 'en'] || d.shipment.join_status}</StatusPill>
              {d.erp && <p className="mt-1 font-mono text-[11px]">{d.erp.record_key} · {d.erp.payload.material_id} {d.erp.payload.material_text} · {d.erp.payload.supplier_id} · {d.erp.payload.quantity} {d.erp.payload.uom} · {d.erp.payload.origin_country}</p>}
            </div>
            {d.siblings.length > 0 && <div><div className="eyebrow mb-1">{fi ? 'Saman dokumentin muut osuudet' : 'Other legs of the document'}</div><ul>{d.siblings.map((s) => <li key={s.record_id} className="font-mono text-[11px]">{s.shipment_id} · {s.mode} · {nf(s.freight_t, 3)} t · {nf(s.distance_km, 1)} km</li>)}</ul></div>}
            {d.issues.length > 0 && <div><div className="eyebrow mb-1">{fi ? 'Laatuhavainnot' : 'Quality issues'}</div><ul>{d.issues.map((i) => <li key={i.id}>{i.issue_type} · {i.status} · {i.field}: {i.observed_value ?? '—'} → {i.candidate_value ? String(i.candidate_value).slice(0, 60) : '—'}</li>)}</ul></div>}

            <div className="rounded-xl border border-border p-3">
              <div className="eyebrow mb-2">{fi ? 'Reittiehdotukset' : 'Route proposals'}</div>
              {d.routes.map((r) => (
                <div key={r.id} className="mb-2 rounded-lg bg-secondary/40 p-2">
                  <div className="flex flex-wrap items-center gap-2"><span className="font-mono text-[10.5px]">{r.id}</span><StatusPill tone={r.status === 'verified' ? 'ok' : r.status === 'rejected' ? 'rejected' : 'review'} dot={false}>{r.status}</StatusPill><span>{r.provider}</span>{r.is_demo ? <StatusPill tone="draft" dot={false}>DEMO</StatusPill> : null}<span className="numeral">{nf(r.total_km, 1)} km</span></div>
                  <ul className="mt-1 text-[11px] text-muted-foreground">{r.legs.map((l) => <li key={l.id}>{l.leg_order}. {l.mode} {nf(l.distance_km, 1)} km {l.start_label ? `· ${l.start_label} → ${l.end_label}` : ''}</li>)}</ul>
                  {r.evidence_note && <p className="text-[11px]">{fi ? 'Näyttö' : 'Evidence'}: {r.evidence_note}</p>}
                  {r.status === 'proposed' && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <select value={evidence.type} onChange={(e) => setEvidence({ ...evidence, type: e.target.value })} className="rounded border border-border bg-card px-2 py-1 text-[11px]">
                        <option value="carrier_document">{fi ? 'rahtiasiakirja' : 'carrier document'}</option>
                        <option value="ferry_booking">{fi ? 'lauttavaraus' : 'ferry booking'}</option>
                        <option value="gps_log">GPS</option>
                        <option value="reviewer_confirmation">{fi ? 'tarkastajan vahvistus' : 'reviewer confirmation'}</option>
                      </select>
                      <input value={evidence.note} onChange={(e) => setEvidence({ ...evidence, note: e.target.value })} placeholder={fi ? 'Asiakirjan viite' : 'Document reference'} className="min-w-[140px] flex-1 rounded border border-border bg-card px-2 py-1 text-[11px]" />
                      <button disabled={!!r.is_demo || !evidence.note.trim()} onClick={() => review(r, 'approve')} className="rounded-full bg-[#1B4968] px-2.5 py-1 text-[11px] text-[#EFF6FC] disabled:opacity-40">{fi ? 'Vahvista' : 'Verify'}</button>
                      <button onClick={() => review(r, 'reject')} className="rounded-full border border-border px-2.5 py-1 text-[11px]">{fi ? 'Hylkää' : 'Reject'}</button>
                    </div>
                  )}
                </div>
              ))}
              <div className="mt-2 space-y-2">
                <p className="text-[11px] text-muted-foreground">{fi ? 'Reittiehdotus on näyttöä, ei todiste toteutuneesta matkasta tai lauttavarauksesta. Vahvistus vaatii asiakirjaviitteen.' : 'A route proposal is evidence, not proof of the actual journey or a ferry booking. Verifying requires a document reference.'}</p>
                {legs.map((l, i) => (
                  <div key={i} className="flex gap-1.5">
                    <select value={l.mode} onChange={(e) => setLegs(legs.map((x, j) => (j === i ? { ...x, mode: e.target.value } : x)))} className="rounded border border-border bg-card px-2 py-1 text-[11px]">
                      {['truck', 'truck-reefer', 'ropax', 'ship-reefer', 'ship-bulk', 'rail'].map((m) => <option key={m}>{m}</option>)}
                    </select>
                    <input value={l.distance_km} onChange={(e) => setLegs(legs.map((x, j) => (j === i ? { ...x, distance_km: e.target.value } : x)))} placeholder="km" className="w-24 rounded border border-border bg-card px-2 py-1 text-[11px]" />
                  </div>
                ))}
                <div className="flex flex-wrap gap-1.5">
                  <button onClick={() => setLegs([...legs, { mode: 'ropax', distance_km: '' }])} className="rounded-full border border-border px-2.5 py-1 text-[11px]">+ {fi ? 'osuus' : 'leg'}</button>
                  <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={fi ? 'Lähde / näyttö (pakollinen)' : 'Source / evidence (required)'} className="min-w-[160px] flex-1 rounded border border-border bg-card px-2 py-1 text-[11px]" />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button disabled={busy || !note.trim()} onClick={() => propose('manual')} className="rounded-full bg-[#1B4968] px-3 py-1.5 text-[11px] text-[#EFF6FC] disabled:opacity-40">{fi ? 'Tallenna manuaalinen reitti' : 'Save manual route'}</button>
                  <button disabled={busy} onClick={() => propose('provided_distance')} className="rounded-full border border-border px-3 py-1.5 text-[11px]">{fi ? 'Kirjaa ilmoitettu matka' : 'Record supplied distance'}</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

export default function Transport() {
  const { lang } = useI18n();
  const fi = lang === 'fi';
  const { toast } = useToast();
  const qc = useQueryClient();
  const overview = useQuery({ queryKey: ['overview'], queryFn: () => api.overview(), refetchInterval: 5000 });
  const { year, years, setYear } = useReportingYear(overview.data);
  const [f, setF] = useState({ year: '', direction: '', mode: '', join_status: '', route_status: '', q: '' });
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setOffset(0), [f]);
  const q = useQuery({ queryKey: ['shipments', { ...f, year }, offset], queryFn: () => api.shipments({ ...f, year, limit: PAGE, offset }), enabled: !!year || overview.isFetched, refetchInterval: 3000 });
  const runs = useQuery({ queryKey: ['runs-transport', year], queryFn: () => api.runs({ year, kind: 'transport' }), enabled: !!year, refetchInterval: 3000 });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const d = q.data;
  const sum = (key) => (d?.summary || []).reduce((s, r) => s + Number(r[key] || 0), 0);
  const inbound = (d?.summary || []).filter((r) => r.direction === 'inbound').reduce((s, r) => s + Number(r.kgco2e || 0), 0);
  const calc = async () => {
    setBusy(true);
    try {
      const r = await api.calculate('transport', { year: Number(year) });
      qc.invalidateQueries({ queryKey: ['runs-transport'] });
      toast({ title: fi ? 'Kuljetuslaskenta tallennettu' : 'Transport run saved', description: `${r.id} · ${nf(r.totals.grand_total, 1)} tCO₂e · ${nf(r.contribution_count)} ${fi ? 'osuutta' : 'legs'}` });
    } catch (e) {
      toast({ title: fi ? 'Laskenta epäonnistui' : 'Calculation failed', description: e.message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };
  const latest = runs.data?.[0];
  const precision = latest?.completeness?.contains_demo_data ? 3 : 1;

  return (
    <div>
      <PageHeader
        eyebrow={fi ? 'RouteFlow' : 'RouteFlow'}
        title={fi ? 'Kuljetukset' : 'Transport'}
        description={fi ? 'Jokainen kuljetusosuus: massa × matka = tkm × kulkumuodon WTW-kerroin. Saapuvat kuljetukset ovat Scope 3 luokka 4 ja lähtevät luokka 9 – erillään raaka-aineiden tuotannosta (luokka 1).' : 'Every transport leg: mass × distance = tkm × mode-specific WTW factor. Inbound is Scope 3 Category 4 and outbound Category 9 – kept separate from raw-material production (Category 1).'}
        actions={
          <>
            <button onClick={calc} disabled={busy || !year} className="inline-flex items-center gap-2 rounded-full bg-[#1B4968] px-4 py-2 text-[12.5px] font-medium text-[#EFF6FC] disabled:opacity-50">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Truck className="h-3.5 w-3.5" />}{fi ? 'Laske kuljetukset (uusi ajo)' : 'Calculate transport (new run)'}</button>
            {latest && <a href={api.workbookUrl(latest.id)} className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-[12.5px] font-medium"><Download className="h-3.5 w-3.5" />Excel</a>}
          </>
        }
      />
      <section className="mb-4 grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label={fi ? 'Osuudet (suodatettu)' : 'Legs (filtered)'} value={nf(d?.total)} sourceType="imported" hint={(d?.joins || []).map((j) => `${JOIN_LABEL[j.join_status]?.[fi ? 'fi' : 'en'] || j.join_status}: ${nf(j.n)}`).join(' · ')} />
        <MetricCard label="tkm" value={nf(sum('tkm'))} sourceType="calculated" hint={fi ? 'Σ t × km ilmoitetuilla matkoilla.' : 'Σ t × km with supplied distances.'} />
        <MetricCard label={fi ? 'Saapuvat (kat 4), esikatselu' : 'Inbound (Cat 4), preview'} value={tco2(inbound / 1000, 1)} unit="tCO₂e" sourceType="calculated" hint={fi ? 'Ilman hyväksyttyjä korjauksia; virallinen luku on laskenta-ajossa.' : 'Without approved corrections; the official figure is in a calculation run.'} />
        <MetricCard label={fi ? 'Viimeisin kuljetusajo' : 'Latest transport run'} value={latest ? tco2(latest.totals.grand_total, precision) : '—'} unit={latest ? 'tCO₂e' : ''} sourceType="calculated" hint={latest ? `${latest.id} · ${latest.correction_ids.length} ${fi ? 'korjausta' : 'corrections'}` : fi ? 'Ei ajoa vielä.' : 'No run yet.'} />
      </section>

      <div className="surface mb-3.5 overflow-x-auto p-4">
        <table className="w-full text-left text-[12px]">
          <thead className="text-[11px] uppercase tracking-wide text-muted-foreground"><tr><th className="py-1.5">{fi ? 'Kulkumuoto' : 'Mode'}</th><th>{fi ? 'Suunta' : 'Direction'}</th><th className="text-right">{fi ? 'Osuudet' : 'Legs'}</th><th className="text-right">tkm</th><th className="text-right">tCO₂e</th></tr></thead>
          <tbody>{(d?.summary || []).map((r) => <tr key={`${r.mode}${r.direction}`} className="border-t border-border/60"><td className="py-1.5">{r.mode.includes('ship') || r.mode === 'ropax' ? <Ship className="mr-1 inline h-3.5 w-3.5" /> : <Truck className="mr-1 inline h-3.5 w-3.5" />}{r.mode}</td><td>{r.direction}</td><td className="text-right numeral">{nf(r.legs)}</td><td className="text-right numeral">{nf(r.tkm)}</td><td className="text-right numeral">{tco2(r.kgco2e / 1000, precision)}</td></tr>)}</tbody>
        </table>
        <p className="mt-2 text-[11px] text-muted-foreground">{fi ? 'Rekka- ja lauttaosuudet lasketaan erikseen omilla kertoimillaan; rekan kerrointa ei käytetä lauttaosuudelle.' : 'Truck and ferry legs are calculated separately with their own factors; a truck factor is never applied to a ferry leg.'}</p>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" /><input value={f.q} onChange={set('q')} placeholder={fi ? 'Hae osuutta, dokumenttia, materiaalia tai toimittajaa' : 'Search leg, document, material or supplier'} className="w-full rounded-full border border-border bg-card py-2 pl-9 pr-3 text-[12.5px]" /></div>
        <select value={year} onChange={(event) => { setYear(event.target.value); setOffset(0); }} aria-label={fi ? 'Vuosi' : 'Year'} data-testid="transport-year" className="rounded-full border border-border bg-card px-3 py-2 text-[12px]">{years.map((y) => <option key={y} value={y}>{y}</option>)}</select>
        <select value={f.direction} onChange={set('direction')} className="rounded-full border border-border bg-card px-3 py-2 text-[12px]"><option value="">{fi ? 'Molemmat suunnat' : 'Both directions'}</option><option value="inbound">inbound</option><option value="outbound">outbound</option></select>
        <select value={f.mode} onChange={set('mode')} className="rounded-full border border-border bg-card px-3 py-2 text-[12px]"><option value="">{fi ? 'Kaikki kulkumuodot' : 'All modes'}</option>{['truck', 'truck-reefer', 'ropax', 'ship-reefer', 'ship-bulk'].map((m) => <option key={m}>{m}</option>)}</select>
        <select value={f.join_status} onChange={set('join_status')} className="rounded-full border border-border bg-card px-3 py-2 text-[12px]"><option value="">{fi ? 'Kaikki linkit' : 'All links'}</option>{Object.keys(JOIN_LABEL).map((k) => <option key={k} value={k}>{JOIN_LABEL[k][fi ? 'fi' : 'en']}</option>)}</select>
        <select value={f.route_status} onChange={set('route_status')} className="rounded-full border border-border bg-card px-3 py-2 text-[12px]"><option value="">{fi ? 'Kaikki reitit' : 'All routes'}</option><option value="supplied_distance">{ROUTE_LABEL.calculated_from_supplied_distance[fi ? 'fi' : 'en']}</option><option value="proposed">{ROUTE_LABEL.route_proposed[fi ? 'fi' : 'en']}</option><option value="verified">{ROUTE_LABEL.verified_route[fi ? 'fi' : 'en']}</option></select>
      </div>

      <div className="surface overflow-x-auto">
        <table className="w-full text-left text-[12px]">
          <thead className="bg-secondary/50 text-[10.5px] uppercase tracking-wide text-muted-foreground">
            <tr><th className="px-4 py-2.5">{fi ? 'Osuus' : 'Leg'}</th><th className="px-2">{fi ? 'Dok.' : 'Doc'}</th><th className="px-2">{fi ? 'Muoto' : 'Mode'}</th><th className="px-2 text-right">t</th><th className="px-2 text-right">km</th><th className="px-2 text-right">tkm</th><th className="px-2">{fi ? 'Kerroin' : 'Factor'}</th><th className="px-2 text-right">kgCO₂e</th><th className="px-2">{fi ? 'Linkki' : 'Link'}</th><th className="px-2">{fi ? 'Matka' : 'Distance'}</th><th className="px-4" /></tr>
          </thead>
          <tbody>
            {(d?.items || []).map((s) => (
              <tr key={s.record_id} className="cursor-pointer border-t border-border/60 hover:bg-secondary/40" onClick={() => setOpen(s.record_id)} data-testid="shipment-row">
                <td className="px-4 py-2 font-mono text-[11px]">{s.shipment_id}</td>
                <td className="px-2 font-mono text-[10.5px] text-muted-foreground">{s.ref_doc}</td>
                <td className="px-2">{s.mode}</td>
                <td className="px-2 text-right numeral">{nf(s.freight_t, 3)}</td>
                <td className="px-2 text-right numeral">{nf(s.distance_km, 1)}</td>
                <td className="px-2 text-right numeral">{nf(s.tkm_calculated, 2)}</td>
                <td className="px-2 text-[10.5px] text-muted-foreground">{s.ef_id}</td>
                <td className="px-2 text-right numeral">{nf(s.kgco2e_preview, 1)}</td>
                <td className="px-2"><StatusPill tone={s.join_status === 'linked' ? 'ok' : s.join_status === 'outbound_sales_reference' ? 'draft' : 'review'} dot={false}>{JOIN_LABEL[s.join_status]?.[fi ? 'fi' : 'en'] || s.join_status}</StatusPill></td>
                <td className="px-2 text-[11px] text-muted-foreground">{ROUTE_LABEL[s.route_label]?.[fi ? 'fi' : 'en'] || s.route_label}</td>
                <td className="px-4">{Number(s.open_issues) > 0 && <StatusPill tone="high" dot={false}>{s.open_issues}</StatusPill>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!d?.items?.length && <p className="p-6 text-center text-[13px] text-muted-foreground">{fi ? 'Ei kuljetusosuuksia. Tuo shipments.csv Validointi-sivulla.' : 'No transport legs. Import shipments.csv on the Validation page.'}</p>}
        {d?.total > PAGE && (
          <div className="flex items-center justify-between border-t border-border px-4 py-2 text-[12px] text-muted-foreground">
            <span>{nf(offset + 1)}–{nf(Math.min(offset + PAGE, d.total))} / {nf(d.total)}</span>
            <span className="flex gap-1"><button disabled={!offset} onClick={() => setOffset(Math.max(0, offset - PAGE))} className="rounded-full border border-border p-1.5 disabled:opacity-40"><ChevronLeft className="h-3.5 w-3.5" /></button><button disabled={offset + PAGE >= d.total} onClick={() => setOffset(offset + PAGE)} className="rounded-full border border-border p-1.5 disabled:opacity-40"><ChevronRight className="h-3.5 w-3.5" /></button></span>
          </div>
        )}
      </div>
      <LegSheet id={open} onClose={() => setOpen(null)} fi={fi} />
    </div>
  );
}

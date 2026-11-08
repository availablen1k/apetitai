// GHG inventory engine: a TypeScript port of the challenge reference calculator
// (tools/ccn_tools/reference_calculator.py + farm_calculator.py), extended so every
// line item is a contribution that lists the exact source records, factor record,
// formula, inputs, approved corrections and open quality issues behind it.
//
// Inputs are raw imported rows plus an overlay of human-approved corrections; the raw
// rows are never modified. Scope 2 location- and market-based lines are both computed
// but only the chosen basis counts toward the total.
import * as M from './method.ts';
import { parseBool, parseNumber, round } from './util.ts';

export type Src = {
  id: string;
  table: string;
  record_key: string;
  year: number | null;
  source_file: string;
  source_row: number;
  payload: Record<string, string>;
  added_by_correction?: string;
};

export type Overlay = {
  values: Map<string, Map<string, { value: string; correction_id: string }>>;
  excluded: Map<string, string>;
  added: Src[];
};

export type Scope2Basis = 'location' | 'market';

export type Contribution = {
  scope: 'scope1' | 'scope2_location' | 'scope2_market' | 'scope3' | 'memo';
  category: string;
  line_item: string;
  kind: string;
  source_record_ids: string[];
  factor_id: string | null;
  factor_value: number | null;
  factor_unit: string | null;
  factor_source: string | null;
  formula: string;
  inputs: Record<string, unknown>;
  kgco2e: number;
  tco2e: number;
  value_status: 'original' | 'corrected' | 'estimated' | 'has_open_issue';
  correction_ids: string[];
  open_issue_ids: string[];
  in_total: boolean;
  basis: string | null;
};

export type Gap = { area: string; message: string; record_ids?: string[]; count?: number };

export type InventoryResult = {
  contributions: Contribution[];
  summary: { scope: string; category: string; tco2e: number }[];
  totals: Record<string, number>;
  gaps: Gap[];
  excluded: { record_id: string; correction_id: string; reason: string }[];
  boundary_excluded: string[];
  checks: { id: string; passed: boolean; detail: string }[];
};

type FactorRec = { ef_id: string; value: number; unit: string; record_id: string; version: string; source: string };

export type InventoryInput = {
  year: number;
  scope2Basis: Scope2Basis;
  tables: Record<string, Src[]>;
  overlay: Overlay;
  openIssues: Map<string, string[]>;
};

class Tracker {
  sources = new Set<string>();
  corrections = new Set<string>();
  issues = new Set<string>();
  estimated = false;
  private overlay: Overlay;
  private openIssues: Map<string, string[]>;
  constructor(overlay: Overlay, openIssues: Map<string, string[]>) {
    this.overlay = overlay;
    this.openIssues = openIssues;
  }
  use(rec: Src) {
    this.sources.add(rec.id);
    if (rec.added_by_correction) this.corrections.add(rec.added_by_correction);
    for (const i of this.openIssues.get(rec.id) || []) this.issues.add(i);
    return this;
  }
  get(rec: Src, field: string): string {
    const o = this.overlay.values.get(rec.id)?.get(field);
    if (o) {
      this.corrections.add(o.correction_id);
      return o.value;
    }
    return rec.payload[field] ?? '';
  }
  num(rec: Src, field: string): number | null {
    return parseNumber(this.get(rec, field));
  }
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function computeInventory(input: InventoryInput): InventoryResult {
  const { year, overlay, openIssues } = input;
  const contributions: Contribution[] = [];
  const gaps: Gap[] = [];
  const excluded: InventoryResult['excluded'] = [];
  const boundaryExcluded: string[] = [];

  const tbl = (name: string): Src[] => {
    const base = (input.tables[name] || []).concat(overlay.added.filter((a) => a.table === name));
    return base.filter((r) => {
      const c = overlay.excluded.get(r.id);
      if (c) {
        excluded.push({ record_id: r.id, correction_id: c, reason: 'excluded by approved correction' });
        return false;
      }
      return true;
    });
  };
  const inYear = (name: string) => tbl(name).filter((r) => r.year === year);
  const tracker = () => new Tracker(overlay, openIssues);

  // ---------- factor library (emission_factor_library.csv)
  const factors = new Map<string, FactorRec>();
  const factorRecords = new Map<string, Src>();
  for (const r of tbl('emission_factors')) {
    const t = tracker();
    const v = t.num(r, 'kgco2e_per_unit');
    if (v === null) continue;
    factors.set(r.payload.ef_id, {
      ef_id: r.payload.ef_id, value: v, unit: t.get(r, 'unit'), record_id: r.id,
      version: r.payload.version || '', source: r.payload.reference_source || r.payload.source_type || '',
    });
    factorRecords.set(r.payload.ef_id, r);
  }
  const missingFactors = new Set<string>();
  const factor = (id: string): FactorRec | null => {
    const f = factors.get(id);
    if (!f) missingFactors.add(id);
    return f || null;
  };

  const push = (c: Omit<Contribution, 'tco2e' | 'value_status' | 'source_record_ids' | 'correction_ids' | 'open_issue_ids'> & { t: Tracker; extraSources?: string[] }) => {
    const { t, extraSources, ...rest } = c;
    const ids = [...t.sources, ...(extraSources || [])];
    contributions.push({
      ...rest,
      kgco2e: round(rest.kgco2e, 6),
      tco2e: round(rest.kgco2e / 1000, 9),
      source_record_ids: [...new Set(ids)],
      correction_ids: [...t.corrections],
      open_issue_ids: [...t.issues],
      value_status: t.issues.size ? 'has_open_issue' : t.estimated ? 'estimated' : t.corrections.size ? 'corrected' : 'original',
    });
  };
  const factorFields = (f: FactorRec | null) => ({
    factor_id: f?.ef_id ?? null, factor_value: f?.value ?? null, factor_unit: f ? `kgCO2e/${f.unit}` : null,
    factor_source: f ? `emission_factor_library.csv (${f.source}, v${f.version})` : null,
  });

  // ---------- master data
  const sites = new Map<string, Src>();
  for (const r of tbl('sites')) sites.set(r.payload.site_id, r);
  const country = (site: string) => sites.get(site)?.payload.country || 'FI';
  const materials = new Map<string, Src>();
  for (const r of tbl('materials')) materials.set(r.payload.material_id, r);

  const inBoundary = (site: string, ym: string) => {
    const b = M.SITE_BOUNDARY[site];
    return !b || ym >= b.from;
  };

  // ---------- canonical energy (MWh per site × carrier), METHODOLOGY §2
  type EnergyAgg = { site: string; carrier: string; mwh: number; t: Tracker; parts: Record<string, number> };
  const energy = new Map<string, EnergyAgg>();
  const agg = (site: string, carrier: string) => {
    const k = `${site}|${carrier}`;
    let e = energy.get(k);
    if (!e) {
      e = { site, carrier, mwh: 0, t: tracker(), parts: {} };
      energy.set(k, e);
    }
    return e;
  };
  for (const r of inYear('energy_meter_readings')) {
    const site = r.payload.site_id;
    const month = String(r.payload.month || '').padStart(2, '0');
    if (!inBoundary(site, `${year}-${month}`)) {
      boundaryExcluded.push(r.id);
      continue;
    }
    const e = agg(site, r.payload.carrier);
    const v = e.t.num(r, 'value');
    const unit = e.t.get(r, 'unit');
    const factorToMwh = unit === 'MWh' ? 1 : unit === 'kWh' ? 0.001 : unit === 'GJ' ? 1 / 3.6 : null;
    if (v === null || factorToMwh === null) {
      gaps.push({ area: 'energy', message: `Meter reading ${r.record_key} has no usable value/unit and is left out`, record_ids: [r.id] });
      continue;
    }
    e.t.use(r);
    e.mwh += v * factorToMwh;
    e.parts.meter_mwh = (e.parts.meter_mwh || 0) + v * factorToMwh;
  }
  const stock = new Map<string, { change: number; rec: Src }[]>();
  for (const r of inYear('fuel_stock_changes')) {
    const k = `${r.payload.site_id}|${r.payload.carrier}`;
    stock.set(k, [...(stock.get(k) || []), { change: 0, rec: r }]);
  }
  const deliveredNative = new Map<string, number>();
  for (const r of inYear('fuel_deliveries')) {
    const site = r.payload.site_id;
    const ym = String(r.payload.delivery_date || '').slice(0, 7) || `${year}-01`;
    if (!inBoundary(site, ym)) {
      boundaryExcluded.push(r.id);
      continue;
    }
    const carrier = r.payload.carrier;
    const conv = M.NCV[carrier];
    if (!conv) {
      gaps.push({ area: 'energy', message: `Fuel delivery ${r.record_key}: no NCV for carrier ${carrier}`, record_ids: [r.id] });
      continue;
    }
    const e = agg(site, carrier);
    const q = e.t.num(r, 'quantity');
    const unit = e.t.get(r, 'unit');
    if (q === null) {
      gaps.push({ area: 'energy', message: `Fuel delivery ${r.record_key} cannot be converted to MWh (carrier ${carrier}, unit ${unit})`, record_ids: [r.id] });
      continue;
    }
    let native = q;
    if (unit !== conv.unit) {
      if (unit === 'm3' && conv.unit === 'l') native = q * 1000;
      else if (unit === 'kg' && conv.unit === 't') native = q / 1000;
      else {
        gaps.push({ area: 'energy', message: `Fuel delivery ${r.record_key} unit ${unit} differs from expected ${conv.unit}`, record_ids: [r.id] });
        continue;
      }
    }
    e.t.use(r);
    deliveredNative.set(`${site}|${carrier}`, (deliveredNative.get(`${site}|${carrier}`) || 0) + native);
  }
  for (const k of new Set([...deliveredNative.keys(), ...[...stock.keys()].filter((x) => M.NCV[x.split('|')[1]])])) {
    const native = deliveredNative.get(k) || 0;
    const [site, carrier] = k.split('|');
    const e = agg(site, carrier);
    let change = 0;
    for (const s of stock.get(k) || []) {
      const v = e.t.num(s.rec, 'stock_change');
      if (v !== null) {
        change += v;
        e.t.use(s.rec);
      }
    }
    const consumed = native - change;
    const mwh = consumed * M.NCV[carrier].mwh_per_unit;
    e.mwh += mwh;
    e.parts.delivered_native = native;
    e.parts.stock_change_native = change;
    e.parts.delivery_mwh = mwh;
  }

  // ---------- Scope 1: combustion + biogenic memo
  let biogenic = 0;
  const fuelAggs = [...energy.values()].filter((e) => !M.NON_FUEL_CARRIERS.has(e.carrier));
  for (const e of fuelAggs) {
    const ef = M.FUEL_EF_T_PER_MWH[e.carrier];
    if (ef === undefined) {
      gaps.push({ area: 'scope1', message: `No fossil CO2 factor for carrier ${e.carrier}`, record_ids: [...e.t.sources] });
      continue;
    }
    push({
      scope: 'scope1', category: 'stationary_and_mobile_combustion', line_item: `${e.site}:${e.carrier}`, kind: 'activity', t: e.t,
      factor_id: `method:fuel_fossil:${e.carrier}`, factor_value: ef, factor_unit: 'tCO2/MWh', factor_source: M.METHOD_SOURCE,
      formula: 'MWh × fossil CO2 factor (t/MWh); fuels in native units converted with NCV, consumption = deliveries − stock change',
      inputs: { mwh: round(e.mwh, 6), ...e.parts }, kgco2e: e.mwh * ef * 1000, in_total: true, basis: null,
    });
    const bio = M.FUEL_BIOGENIC_T_PER_MWH[e.carrier] || 0;
    biogenic += e.mwh * bio;
    if (bio) {
      const t = tracker();
      for (const s of e.t.sources) t.sources.add(s);
      push({
        scope: 'memo', category: 'biogenic_co2_scope1', line_item: `${e.site}:${e.carrier}`, kind: 'memo', t,
        factor_id: `method:fuel_biogenic:${e.carrier}`, factor_value: bio, factor_unit: 'tCO2/MWh', factor_source: M.METHOD_SOURCE,
        formula: 'MWh × biogenic CO2 factor (memo item, not in Scope 1)', inputs: { mwh: round(e.mwh, 6) }, kgco2e: e.mwh * bio * 1000,
        in_total: false, basis: null,
      });
    }
  }
  for (const r of inYear('refrigerant_service_log')) {
    const t = tracker().use(r);
    const gas = t.get(r, 'refrigerant');
    const kg = t.num(r, 'kg_added');
    const gwp = M.REFRIGERANT_GWP[gas];
    if (kg === null || gwp === undefined) {
      gaps.push({ area: 'scope1', message: `Refrigerant event ${r.record_key}: ${gwp === undefined ? `unknown gas ${gas}` : 'no kg value'}`, record_ids: [r.id] });
      continue;
    }
    push({
      scope: 'scope1', category: 'fugitive_refrigerants', line_item: `${r.payload.site_id}:${gas}:${r.payload.event_id}`, kind: 'activity', t,
      factor_id: `method:gwp:${gas}`, factor_value: gwp, factor_unit: 'kgCO2e/kg (GWP100 AR6)', factor_source: M.METHOD_SOURCE,
      formula: 'kg top-up × GWP100 (mass balance: top-up = emitted)', inputs: { kg_added: kg, refrigerant: gas }, kgco2e: kg * gwp,
      in_total: true, basis: null,
    });
  }

  // ---------- Scope 2
  const scope2 = (s: 'scope2_location' | 'scope2_market') => (input.scope2Basis === 'location' ? s === 'scope2_location' : s === 'scope2_market');
  const goo = new Map<string, { mwh: number; recs: Src[] }>();
  const registry = inYear('goo_registry');
  const gooSource = registry.length ? 'goo_registry' : 'goo_cancellations';
  for (const r of registry.length ? registry : inYear('goo_cancellations')) {
    const t = tracker();
    const site = registry.length ? r.payload.beneficiary_site : r.payload.site_id;
    const vintage = registry.length ? parseNumber(String(t.get(r, 'production_period_start')).slice(0, 4)) : t.num(r, 'vintage_year');
    const mwh = registry.length ? t.num(r, 'mwh') : t.num(r, 'mwh_cancelled');
    if (vintage !== year || mwh === null) continue; // a GoO counts only for its own production year
    const g = goo.get(site) || { mwh: 0, recs: [] };
    g.mwh += mwh;
    g.recs.push(r);
    goo.set(site, g);
  }
  const heatSup = new Map<string, Src>();
  for (const r of inYear('heat_supplier_factors')) heatSup.set(r.payload.site_id, r);
  for (const e of [...energy.values()].filter((x) => x.carrier === 'electricity')) {
    const c = country(e.site);
    const importedLb = factors.get(`EF-ELEC-LB:${e.site}:${year}`);
    const importedRes = factors.get(`EF-ELEC-MB:${e.site}:${year}`);
    if ([importedLb, importedRes].some((f) => f && (f.unit !== 'MWh' || f.value < 0))) {
      gaps.push({ area: 'scope2', message: `Invalid site electricity factor for ${e.site} ${year}: expected non-negative kgCO2e per MWh`, record_ids: [...e.t.sources] });
      continue;
    }
    const lb = importedLb ? importedLb.value / 1000 : (c === 'FI' ? M.GRID_FI_LB : M.GRID_SE_LB)[year];
    const res = importedRes ? importedRes.value / 1000 : (c === 'FI' ? M.RESIDUAL_FI : M.RESIDUAL_SE)[year];
    if (lb === undefined || res === undefined) {
      gaps.push({ area: 'scope2', message: `No grid factor for ${c} ${year}`, record_ids: [...e.t.sources] });
      continue;
    }
    const lt = tracker();
    for (const source of e.t.sources) lt.sources.add(source);
    for (const correction of e.t.corrections) lt.corrections.add(correction);
    for (const issue of e.t.issues) lt.issues.add(issue);
    if (importedLb) { const source = factorRecords.get(importedLb.ef_id)!; lt.use(source); lt.get(source, 'kgco2e_per_unit'); lt.get(source, 'unit'); }
    push({
      scope: 'scope2_location', category: 'purchased_electricity', line_item: e.site, kind: 'activity', t: lt,
      factor_id: importedLb?.ef_id || `method:grid_location:${c}:${year}`, factor_value: lb, factor_unit: 'tCO2e/MWh', factor_source: importedLb ? `Imported site/year factor: ${importedLb.source}; kg/MWh converted to t/MWh` : M.METHOD_SOURCE,
      formula: 'MWh × national grid average', inputs: { mwh: round(e.mwh, 6), country: c }, kgco2e: e.mwh * lb * 1000,
      in_total: scope2('scope2_location'), basis: 'location',
      extraSources: importedLb ? [importedLb.record_id] : [],
    });
    const g = goo.get(e.site);
    const t = tracker();
    for (const s of e.t.sources) t.sources.add(s);
    for (const s of e.t.corrections) t.corrections.add(s);
    for (const s of e.t.issues) t.issues.add(s);
    if (importedRes) { const source = factorRecords.get(importedRes.ef_id)!; t.use(source); t.get(source, 'kgco2e_per_unit'); t.get(source, 'unit'); }
    for (const r of g?.recs || []) t.use(r);
    const covered = Math.min(e.mwh, g?.mwh || 0);
    push({
      scope: 'scope2_market', category: 'purchased_electricity', line_item: e.site, kind: 'activity', t,
      factor_id: importedRes?.ef_id || `method:residual_mix:${c}:${year}`, factor_value: res, factor_unit: 'tCO2e/MWh', factor_source: importedRes ? `Imported site/year factor: ${importedRes.source}; kg/MWh converted to t/MWh` : M.METHOD_SOURCE,
      formula: '(MWh − valid GoO MWh, capped at consumption) × residual mix', inputs: { mwh: round(e.mwh, 6), goo_mwh_valid: round(g?.mwh || 0, 6), goo_mwh_covered: round(covered, 6), goo_source: gooSource },
      kgco2e: (e.mwh - covered) * res * 1000, in_total: scope2('scope2_market'), basis: 'market',
      extraSources: importedRes ? [importedRes.record_id] : [],
    });
  }
  const heatBySite = new Map<string, EnergyAgg[]>();
  for (const e of [...energy.values()].filter((x) => M.HEAT_CARRIERS.has(x.carrier))) heatBySite.set(e.site, [...(heatBySite.get(e.site) || []), e]);
  for (const [site, list] of heatBySite) {
    const mwh = sum(list.map((x) => x.mwh));
    const t = tracker();
    for (const e of list) {
      for (const s of e.t.sources) t.sources.add(s);
      for (const s of e.t.corrections) t.corrections.add(s);
      for (const s of e.t.issues) t.issues.add(s);
    }
    const lb = M.HEAT_LB_EF[year] ?? 0;
    push({
      scope: 'scope2_location', category: 'purchased_heat_steam', line_item: site, kind: 'activity', t,
      factor_id: `method:heat_location:${year}`, factor_value: lb, factor_unit: 'tCO2e/MWh', factor_source: M.METHOD_SOURCE,
      formula: 'MWh × national district-heat average', inputs: { mwh: round(mwh, 6) }, kgco2e: mwh * lb * 1000,
      in_total: scope2('scope2_location'), basis: 'location',
    });
    const sup = heatSup.get(site);
    const tm = tracker();
    for (const s of t.sources) tm.sources.add(s);
    for (const s of t.corrections) tm.corrections.add(s);
    for (const s of t.issues) tm.issues.add(s);
    let mb = 0;
    if (sup) {
      tm.use(sup);
      mb = tm.num(sup, 't_per_mwh') ?? 0;
    } else gaps.push({ area: 'scope2', message: `No supplier-specific heat factor for ${site} ${year}; market-based heat counted as 0 per reference method`, record_ids: [...t.sources] });
    push({
      scope: 'scope2_market', category: 'purchased_heat_steam', line_item: site, kind: 'activity', t: tm,
      factor_id: sup ? sup.record_key : null, factor_value: mb, factor_unit: 'tCO2e/MWh', factor_source: sup ? `heat_supplier_factors.csv row ${sup.source_row}` : null,
      formula: 'MWh × supplier-specific factor', inputs: { mwh: round(mwh, 6) }, kgco2e: mwh * mb * 1000,
      in_total: scope2('scope2_market'), basis: 'market',
    });
  }

  // ---------- Scope 3 cat 1/2: purchases
  const pcfValid = new Map<string, { value: number; rec: Src }>();
  const pcfInvalid: { rec: Src; reason: string }[] = [];
  for (const r of tbl('supplier_pcf')) {
    const t = tracker();
    const claimed = parseNumber(r.payload.year);
    if (claimed !== year) continue;
    const unit = t.get(r, 'declared_unit').toLowerCase();
    const start = t.get(r, 'reference_period_start');
    const end = t.get(r, 'reference_period_end');
    // PACT reference periods are [start, end); the period must cover the whole reporting year.
    const covers = !!start && !!end && start.slice(0, 10) <= `${year}-01-01` && end.slice(0, 10) >= `${year}-12-31`;
    const v = t.num(r, 'pcf_value');
    if (unit !== 'kilogram' && unit !== 'kg') pcfInvalid.push({ rec: r, reason: `declared unit ${unit || '(empty)'} is not kg` });
    else if (!covers) pcfInvalid.push({ rec: r, reason: `reference period ${start}–${end} does not cover ${year}` });
    else if (v === null || v <= 0) pcfInvalid.push({ rec: r, reason: 'no positive PCF value' });
    else pcfValid.set(`${r.payload.supplier_id}|${r.payload.material_id}`, { value: v, rec: r });
  }
  if (pcfInvalid.length) gaps.push({ area: 'cat01', message: `${pcfInvalid.length} supplier PCF(s) for ${year} not used (invalid unit or period); material default factor used instead`, record_ids: pcfInvalid.map((p) => p.rec.id) });

  const farmDeliveries = new Map<string, { kg: number; recs: Src[]; crop: string; material: string }>();
  for (const r of inYear('erp_purchase_lines')) {
    const t = tracker().use(r);
    const mat = t.get(r, 'material_id');
    const m = materials.get(mat);
    if (!m) {
      gaps.push({ area: 'cat01', message: `ERP line ${r.record_key}: material ${mat} not in material master`, record_ids: [r.id] });
      continue;
    }
    t.use(m);
    const group = m.payload.material_group;
    const efId = m.payload.default_ef_id;
    const uom = t.get(r, 'uom').toUpperCase();
    const qty = t.num(r, 'quantity');
    const supplier = t.get(r, 'supplier_id');
    if (efId === 'FARM') {
      if (qty === null) continue;
      const kg = uom === 'TO' ? qty * 1000 : qty;
      const k = `${supplier}|${mat}`;
      const d = farmDeliveries.get(k) || { kg: 0, recs: [], crop: M.FARM_MATERIAL_CROP[mat] || '', material: mat };
      d.kg += kg;
      d.recs.push(r);
      farmDeliveries.set(k, d);
      continue;
    }
    if (group === 'service' || group === 'capex') {
      const amount = t.num(r, 'net_amount');
      const cur = t.get(r, 'currency').toUpperCase() || 'EUR';
      const fx = M.FX_PER_EUR[cur];
      const f = factor(efId);
      if (amount === null || !fx || !f) {
        gaps.push({ area: group === 'service' ? 'cat01' : 'cat02', message: `ERP line ${r.record_key}: spend not calculable (${amount === null ? 'no amount' : !fx ? `currency ${cur}` : `factor ${efId} missing`})`, record_ids: [r.id] });
        continue;
      }
      if (f) t.sources.add(f.record_id);
      const eur = amount / fx;
      push({
        scope: 'scope3', category: group === 'service' ? 'cat01_purchased_services' : 'cat02_capital_goods', line_item: `${mat}:${r.record_key}`,
        kind: 'spend_purchase', t, ...factorFields(f),
        formula: group === 'service' ? 'spend (EUR) × EEIO-style factor' : 'capex spend (EUR) × EEIO-style factor (no depreciation)',
        inputs: { net_amount: amount, currency: cur, fx_per_eur: fx, amount_eur: round(eur, 6) }, kgco2e: eur * (f?.value ?? 0), in_total: true, basis: null,
      });
      continue;
    }
    if (qty === null) {
      gaps.push({ area: 'cat01', message: `ERP line ${r.record_key}: quantity missing`, record_ids: [r.id] });
      continue;
    }
    const kg = uom === 'TO' ? qty * 1000 : uom === 'KG' ? qty : null;
    if (kg === null) {
      gaps.push({ area: 'cat01', message: `ERP line ${r.record_key}: unit ${uom} cannot be converted to kg`, record_ids: [r.id] });
      continue;
    }
    const pcf = pcfValid.get(`${supplier}|${mat}`);
    let fval: number;
    let fields;
    if (pcf) {
      t.use(pcf.rec);
      fval = t.num(pcf.rec, 'pcf_value') ?? pcf.value;
      fields = { factor_id: pcf.rec.record_key, factor_value: fval, factor_unit: 'kgCO2e/kg', factor_source: `supplier PCF (PACT) ${pcf.rec.source_file}` };
    } else {
      const f = factor(efId);
      if (!f) {
        gaps.push({ area: 'cat01', message: `ERP line ${r.record_key}: no factor ${efId}`, record_ids: [r.id] });
        continue;
      }
      t.sources.add(f.record_id);
      fval = f.value;
      fields = factorFields(f);
    }
    push({
      scope: 'scope3', category: 'cat01_purchased_goods', line_item: `${mat}:${supplier}:${r.record_key}`, kind: 'material_purchase', t, ...fields,
      formula: pcf ? 'kg × supplier PCF (valid for the year, per kg)' : 'kg × material default factor (no valid supplier PCF)',
      inputs: { quantity: qty, uom, kg, movement_type: r.payload.movement_type, supplier_id: supplier, material_id: mat, factor_basis: pcf ? 'supplier_pcf' : 'default_factor' },
      kgco2e: kg * fval, in_total: true, basis: pcf ? 'supplier_pcf' : 'default_factor',
    });
  }

  // ---------- Scope 3 cat 1: contract farming (cradle to farm gate), METHODOLOGY §5
  computeContractFarming(input, tbl, tracker, farmDeliveries, push, gaps);

  // ---------- Scope 3 cat 3: fuel- and energy-related activities
  for (const e of fuelAggs) {
    const wtt = M.FUEL_WTT[e.carrier];
    const f = wtt ? factor(wtt) : null;
    if (!f) {
      if (e.mwh) gaps.push({ area: 'cat03', message: `No WTT factor for ${e.carrier}`, record_ids: [...e.t.sources] });
      continue;
    }
    const t = tracker();
    for (const s of e.t.sources) t.sources.add(s);
    for (const s of e.t.corrections) t.corrections.add(s);
    for (const s of e.t.issues) t.issues.add(s);
    t.sources.add(f.record_id);
    push({ scope: 'scope3', category: 'cat03_fuel_energy', line_item: `wtt:${e.site}:${e.carrier}`, kind: 'activity', t, ...factorFields(f), formula: 'fuel MWh × well-to-tank factor', inputs: { mwh: round(e.mwh, 6) }, kgco2e: e.mwh * f.value, in_total: true, basis: null });
  }
  for (const e of [...energy.values()].filter((x) => x.carrier === 'electricity')) {
    const f = factor(`EF-ELEC-UPSTREAM-${country(e.site)}`);
    if (!f) continue;
    const t = tracker();
    for (const s of e.t.sources) t.sources.add(s);
    for (const s of e.t.corrections) t.corrections.add(s);
    for (const s of e.t.issues) t.issues.add(s);
    t.sources.add(f.record_id);
    push({ scope: 'scope3', category: 'cat03_fuel_energy', line_item: `elec_upstream:${e.site}`, kind: 'activity', t, ...factorFields(f), formula: 'electricity MWh × upstream + T&D factor', inputs: { mwh: round(e.mwh, 6) }, kgco2e: e.mwh * f.value, in_total: true, basis: null });
  }
  const heatAll = [...energy.values()].filter((x) => M.HEAT_CARRIERS.has(x.carrier));
  if (heatAll.length) {
    const f = factor('EF-HEAT-UPSTREAM');
    if (f) {
      const t = tracker();
      for (const e of heatAll) for (const s of e.t.sources) t.sources.add(s);
      t.sources.add(f.record_id);
      const mwh = sum(heatAll.map((x) => x.mwh));
      push({ scope: 'scope3', category: 'cat03_fuel_energy', line_item: 'heat_upstream', kind: 'activity', t, ...factorFields(f), formula: 'purchased heat MWh × upstream factor', inputs: { mwh: round(mwh, 6) }, kgco2e: mwh * f.value, in_total: true, basis: null });
    }
  }

  // ---------- Scope 3 cat 4 / cat 9: transport legs (tkm = t × km)
  for (const r of inYear('shipments')) {
    const t = tracker().use(r);
    const direction = t.get(r, 'direction');
    const efId = t.get(r, 'ef_id');
    const tonnes = t.num(r, 't');
    const km = t.num(r, 'km');
    const recorded = t.num(r, 'tkm');
    const f = factor(efId);
    let tkm: number | null = null;
    let formula = 'tkm = t × km; kgCO2e = tkm × WTW factor (kgCO2e/tkm)';
    if (tonnes !== null && km !== null) tkm = tonnes * km;
    else if (recorded !== null) {
      tkm = recorded;
      formula = 'recorded tkm (t or km missing) × WTW factor';
    }
    if (tkm === null || !f) {
      gaps.push({ area: 'transport', message: `Leg ${r.record_key}: ${!f ? `factor ${efId} missing` : 'no t/km/tkm'}`, record_ids: [r.id] });
      continue;
    }
    t.sources.add(f.record_id);
    if (r.added_by_correction) t.estimated = true;
    push({
      scope: 'scope3', category: direction === 'inbound' ? 'cat04_upstream_transport' : 'cat09_downstream_transport',
      line_item: `${direction}:${efId}:${r.payload.shipment_id || r.record_key}`, kind: 'transport_leg', t, ...factorFields(f), formula,
      inputs: { freight_t: tonnes, distance_km: km, tkm: round(tkm, 6), tkm_recorded: recorded, mode: t.get(r, 'mode'), ref_doc: t.get(r, 'ref_doc'), route_status: r.added_by_correction ? 'estimated_missing_leg' : 'calculated_from_supplied_distance' },
      kgco2e: tkm * f.value, in_total: true, basis: null,
    });
  }
  const wh = inYear('frozen_warehousing');
  if (wh.length) {
    const f = factor('EF-PALLETDAY-FROZEN');
    const t = tracker();
    let pd = 0;
    for (const r of wh) {
      t.use(r);
      pd += t.num(r, 'pallet_days') ?? 0;
    }
    if (f) {
      t.sources.add(f.record_id);
      push({ scope: 'scope3', category: 'cat09_downstream_transport', line_item: 'frozen_warehousing', kind: 'activity', t, ...factorFields(f), formula: 'pallet-days × factor', inputs: { pallet_days: pd }, kgco2e: pd * f.value, in_total: true, basis: null });
    }
  }

  // ---------- Scope 3 cat 5: waste and wastewater
  for (const r of inYear('waste_transfer_notes')) {
    const t = tracker().use(r);
    const stream = t.get(r, 'waste_stream');
    const treatment = t.get(r, 'treatment');
    const efId = M.WASTE_EF[`${stream}|${treatment}`];
    const q = t.num(r, 'quantity');
    const unit = t.get(r, 'unit');
    const tonnes = q === null ? null : unit === 't' ? q : unit === 'kg' ? q / 1000 : null;
    const f = efId ? factor(efId) : null;
    if (tonnes === null || !f) {
      gaps.push({ area: 'cat05', message: `Waste note ${r.record_key}: ${!efId ? `no factor mapping for ${stream}/${treatment}` : tonnes === null ? `quantity/unit not usable` : `factor ${efId} missing`}`, record_ids: [r.id] });
      continue;
    }
    t.sources.add(f.record_id);
    push({ scope: 'scope3', category: 'cat05_waste', line_item: `${r.payload.site_id}:${stream}:${r.payload.transfer_note}`, kind: 'activity', t, ...factorFields(f), formula: 't × treatment factor', inputs: { quantity: q, unit, tonnes: round(tonnes, 9), waste_stream: stream, treatment }, kgco2e: tonnes * f.value, in_total: true, basis: null });
  }
  const ww = inYear('wastewater_third_party');
  if (ww.length) {
    const f = factor('EF-WASTEWATER-MUNI');
    const t = tracker();
    let m3 = 0;
    for (const r of ww) {
      t.use(r);
      m3 += t.num(r, 'm3') ?? 0;
    }
    if (f) {
      t.sources.add(f.record_id);
      push({ scope: 'scope3', category: 'cat05_waste', line_item: 'wastewater_third_party', kind: 'activity', t, ...factorFields(f), formula: 'm3 × factor', inputs: { m3 }, kgco2e: m3 * f.value, in_total: true, basis: null });
    }
  }

  // ---------- Scope 3 cat 6: business travel
  const travel = inYear('travel_bookings');
  if (travel.length) {
    const groups: { item: string; efId: string; field: 'pkm' | 'nights'; filter: (r: Src, t: Tracker) => boolean }[] = [
      { item: 'flights', efId: 'EF-PKM-FLIGHT-SHORT', field: 'pkm', filter: (r, t) => t.get(r, 'mode') === 'flight' },
      { item: 'rail', efId: 'EF-PKM-TRAIN', field: 'pkm', filter: (r, t) => t.get(r, 'mode') === 'train' },
      { item: 'hotels', efId: 'EF-HOTEL-NIGHT', field: 'nights', filter: () => true },
    ];
    for (const g of groups) {
      const f = factor(g.efId);
      if (!f) continue;
      const t = tracker();
      let qty = 0;
      for (const r of travel) {
        if (!g.filter(r, t)) continue;
        t.use(r);
        qty += t.num(r, g.field) ?? 0;
      }
      t.sources.add(f.record_id);
      push({ scope: 'scope3', category: 'cat06_business_travel', line_item: g.item, kind: 'activity', t, ...factorFields(f), formula: `${g.field} × factor`, inputs: { [g.field]: qty }, kgco2e: qty * f.value, in_total: true, basis: null });
    }
  }

  // ---------- Scope 3 cat 7: commuting (survey mean × headcount)
  const survey = tbl('commuting_survey');
  const headcount = inYear('headcount');
  if (survey.length && headcount.length) {
    const car = factor('EF-PKM-CAR');
    const bus = factor('EF-PKM-BUS');
    const train = factor('EF-PKM-TRAIN');
    if (car && bus && train) {
      const modeEf: Record<string, number> = { car: car.value, carpool: car.value / 2, bus: bus.value, train: train.value, bike_walk: 0, ev_car: 0.03 };
      const bySite = new Map<string, Src[]>();
      for (const r of survey) bySite.set(r.payload.site_id, [...(bySite.get(r.payload.site_id) || []), r]);
      for (const [site, rows] of bySite) {
        const t = tracker();
        const per = rows.map((r) => {
          t.use(r);
          const km = t.num(r, 'one_way_km') ?? 0;
          const days = t.num(r, 'days_on_site_per_week') ?? 0;
          const ef = modeEf[t.get(r, 'mode')] ?? car.value;
          return km * 2 * days * M.COMMUTE_WEEKS * ef;
        });
        const mean = sum(per) / per.length;
        const hc = headcount.find((h) => h.payload.site_id === site);
        const n = hc ? (t.use(hc), t.num(hc, 'headcount') ?? 0) : 0;
        for (const f of [car, bus, train]) t.sources.add(f.record_id);
        push({ scope: 'scope3', category: 'cat07_employee_commuting', line_item: site, kind: 'activity', t, factor_id: 'EF-PKM-CAR/BUS/TRAIN', factor_value: null, factor_unit: 'kgCO2e/pkm', factor_source: 'emission_factor_library.csv; carpool = car/2, EV car 0.03 (reference)', formula: 'mean annual kg per respondent (km × 2 × days/week × 46 × mode factor) × site headcount', inputs: { respondents: rows.length, mean_kg_per_respondent: round(mean, 6), headcount: n }, kgco2e: mean * n, in_total: true, basis: null });
      }
    }
  }

  // ---------- Scope 3 cat 11 / 12: use phase and end of life of sold products
  const sales = inYear('sales_volumes');
  const salesGroups = new Map<string, Src[]>();
  for (const r of sales) {
    const k = `${r.payload.product_group}|${r.payload.market}`;
    salesGroups.set(k, [...(salesGroups.get(k) || []), r]);
  }
  for (const [k, rows] of salesGroups) {
    const [grp, market] = k.split('|');
    const t = tracker();
    let tSold = 0;
    for (const r of rows) {
      const site = r.payload.site_id;
      const ym = `${year}-${String(r.payload.month || '').padStart(2, '0')}`;
      if (site && !inBoundary(site, ym)) {
        boundaryExcluded.push(r.id);
        continue;
      }
      t.use(r);
      tSold += t.num(r, 't_sold') ?? 0;
    }
    const kwhKg = M.USE_PHASE_KWH_PER_KG[grp];
    const grid = M.MARKET_GRID(market, year);
    if (kwhKg === undefined || grid === null) {
      gaps.push({ area: 'cat11', message: `No use-phase factor for ${grp}/${market}`, record_ids: [...t.sources] });
    } else if (kwhKg > 0) {
      const kwh = tSold * 1000 * kwhKg;
      push({ scope: 'scope3', category: 'cat11_use_of_sold_products', line_item: `${grp}:${market}`, kind: 'activity', t, factor_id: `method:use_phase:${grp}`, factor_value: kwhKg, factor_unit: 'kWh/kg × market grid kgCO2e/kWh', factor_source: M.METHOD_SOURCE, formula: 't sold × 1000 × kWh/kg × market grid factor', inputs: { t_sold: round(tSold, 6), kwh: round(kwh, 3), grid_kg_per_kwh: grid }, kgco2e: kwh * grid, in_total: true, basis: null });
    }
    const pack = M.PACK_KG_PER_T[grp];
    if (pack) {
      const t2 = tracker();
      for (const s of t.sources) t2.sources.add(s);
      for (const s of t.corrections) t2.corrections.add(s);
      for (const s of t.issues) t2.issues.add(s);
      const [pl, bd] = pack;
      const tco2 = tSold * (pl / 1000) * M.EOL_PLASTIC_EF_T + tSold * (bd / 1000) * M.EOL_BOARD_EF_T;
      push({ scope: 'scope3', category: 'cat12_end_of_life', line_item: `${grp}:${market}`, kind: 'activity', t: t2, factor_id: `method:packaging_eol:${grp}`, factor_value: null, factor_unit: 'tCO2e/t packaging', factor_source: M.METHOD_SOURCE, formula: 't sold × plastic kg/t × plastic EoL EF + t sold × board kg/t × board EoL EF', inputs: { t_sold: round(tSold, 6), plastic_kg_per_t: pl, board_kg_per_t: bd, plastic_ef_t: M.EOL_PLASTIC_EF_T, board_ef_t: M.EOL_BOARD_EF_T }, kgco2e: tco2 * 1000, in_total: true, basis: null });
    }
  }

  if (missingFactors.size) gaps.push({ area: 'factors', message: `Factors referenced but not in the imported library: ${[...missingFactors].join(', ')}` });

  const farmMaterials = new Set([...materials.values()].filter((m) => m.payload.default_ef_id === 'FARM').map((m) => m.payload.material_id));
  const doubleCounted = contributions.filter((c) => c.kind === 'material_purchase' && farmMaterials.has(String(c.inputs.material_id)));
  const extraChecks = [
    { id: 'no_farm_double_count', passed: doubleCounted.length === 0, detail: `Contract-farm (FARM) materials are counted only through farm footprints, never also with a purchased-goods factor (${doubleCounted.length} violations).` },
  ];
  return finalize(contributions, gaps, excluded, boundaryExcluded, input.scope2Basis, extraChecks);
}

type Push = (c: Omit<Contribution, 'tco2e' | 'value_status' | 'source_record_ids' | 'correction_ids' | 'open_issue_ids'> & { t: Tracker; extraSources?: string[] }) => void;

function computeContractFarming(
  input: InventoryInput,
  tbl: (name: string) => Src[],
  tracker: () => Tracker,
  deliveries: Map<string, { kg: number; recs: Src[]; crop: string; material: string }>,
  push: Push,
  gaps: Gap[],
) {
  const { year } = input;
  if (!deliveries.size) return;
  const farms = new Map<string, Src>();
  for (const r of tbl('farm_registry')) farms.set(r.payload.farm_id, r);
  const surveys = new Map<string, Src>();
  for (const r of tbl('farm_survey').filter((x) => x.year === year)) surveys.set(`${r.payload.farm_id}|${r.payload.crop}`, r);
  const parcels = new Map<string, Src>();
  for (const r of tbl('parcels')) parcels.set(r.payload.parcel_id, r);
  const history = new Map<string, Src[]>();
  for (const r of tbl('parcel_crop_history').filter((x) => x.year === year)) {
    const k = `${r.payload.farm_id}|${r.payload.crop}`;
    history.set(k, [...(history.get(k) || []), r]);
  }
  const grid = M.GRID_FI_LB[year] ?? 0.03;
  const E = M.FARM_EF;
  const n2o = E.n2o_n_to_n2o * E.n2o_gwp;
  let farmsCalculated = 0;
  const notCalculated: string[] = [];

  for (const [k, d] of deliveries) {
    const [farmId] = k.split('|');
    const t = tracker();
    for (const r of d.recs) t.use(r);
    const farm = farms.get(farmId);
    if (farm) t.use(farm);
    const crop = d.crop;
    if (!crop || !M.MGMT_NORMS[crop]) {
      gaps.push({ area: 'cat01_farm', message: `Material ${d.material} has no contract crop mapping`, record_ids: d.recs.map((r) => r.id) });
      continue;
    }
    const country = farm?.payload.country || (farmId.startsWith('S') ? 'SE' : 'FI');
    const s = surveys.get(`${farmId}|${crop}`);
    const hist = history.get(`${farmId}|${crop}`) || [];
    let parcelArea = 0;
    let organicArea = 0;
    for (const h of hist) {
      const p = parcels.get(h.payload.parcel_id);
      if (!p) continue;
      const a = parseNumber(p.payload.area_ha) ?? 0;
      parcelArea += a;
      if (p.payload.soil_class_soilmap === 'organic') organicArea += a;
    }
    const mapShare = parcelArea > 0 ? organicArea / parcelArea : 0;
    let inputs: Record<string, number | string | boolean>;
    let area: number;
    let organicShare: number;
    let method: string;
    if (s) {
      t.use(s);
      area = t.num(s, 'area_ha') ?? parcelArea;
      const reported = t.get(s, 'soil_type_reported').toLowerCase();
      const reportedOrganic = reported.includes('organic') || reported.includes('turve') || reported.includes('eloper');
      // The soil map (parcels.csv) is the evidence for organic soil; the self-reported soil type is
      // checked against it by the soil_misreport rule. Without parcel data the survey answer is used.
      organicShare = parcelArea > 0 ? mapShare : reportedOrganic ? 1 : 0;
      inputs = {
        n_mineral_kg_ha: t.num(s, 'n_mineral_kg_ha') ?? 0, n_manure_kg_ha: t.num(s, 'n_manure_kg_ha') ?? 0, p_kg_ha: t.num(s, 'p_kg_ha') ?? 0,
        diesel_l_ha: t.num(s, 'diesel_l_ha') ?? 0, lime_t_ha: t.num(s, 'lime_t_ha') ?? 0, sprays: t.num(s, 'sprays') ?? 0,
        yield_t_ha: t.num(s, 'yield_t_ha') ?? 0, irrigated: parseBool(t.get(s, 'irrigated')) ?? false,
        lowcarbon_fert: t.get(s, 'fertiliser_product').toLowerCase().includes('low-carbon'), soil_type_reported: t.get(s, 'soil_type_reported'),
      };
      method = 'farm survey inputs';
    } else {
      if (parcelArea <= 0) {
        notCalculated.push(farmId);
        gaps.push({ area: 'cat01_farm', message: `Contract farm ${farmId} (${crop}) delivered ${Math.round(d.kg)} kg in ${year} but has neither a survey response nor declared parcels; footprint not calculated`, record_ids: d.recs.map((r) => r.id) });
        continue;
      }
      const norm = M.MGMT_NORMS[crop];
      area = parcelArea;
      organicShare = mapShare;
      t.estimated = true;
      inputs = { n_mineral_kg_ha: norm.n, n_manure_kg_ha: 0, p_kg_ha: norm.p, diesel_l_ha: norm.diesel, lime_t_ha: norm.lime, sprays: norm.sprays, yield_t_ha: d.kg / 1000 / area, irrigated_share: norm.irr, lowcarbon_fert: false, soil_type_reported: '(no survey response)' };
      method = 'management norms (no survey response); yield = delivered t / declared parcel area';
    }
    for (const h of hist) {
      t.sources.add(h.id);
      const p = parcels.get(h.payload.parcel_id);
      if (p) t.sources.add(p.id);
    }
    const nmin = Number(inputs.n_mineral_kg_ha), nman = Number(inputs.n_manure_kg_ha), pkg = Number(inputs.p_kg_ha);
    const yld = Number(inputs.yield_t_ha);
    const resN = (M.RESIDUE_N_PER_T[crop] ?? 0) * yld;
    const fert = inputs.lowcarbon_fert ? E.fert_n_prod_lowcarbon : E.fert_n_prod;
    const cFert = nmin * fert + pkg * E.fert_p_prod + pkg * 2.2 * E.fert_k_prod;
    const cDir = (nmin * E.ef1_synthetic + (nman + resN) * E.ef1_organic) * n2o;
    const cInd = ((nmin * E.frac_gasf + nman * E.frac_gasm) * E.ef4_n2o_n + (nmin + nman + resN) * E.frac_leach * E.ef5_n2o_n) * n2o;
    const dieselTtw = country === 'SE' ? 2.45 : E.diesel_ttw;
    const cDsl = Number(inputs.diesel_l_ha) * (dieselTtw + E.diesel_wtt);
    const cLime = Number(inputs.lime_t_ha) * E.lime * 1000;
    const orgCo2 = (crop === 'grass_ley' ? E.org_soil_co2_grass_t_ha : E.org_soil_co2_t_ha) * 1000;
    const cOrg = organicShare * (orgCo2 + E.org_soil_n2o_n_kg_ha * n2o);
    const cSpr = Number(inputs.sprays) * E.spray_pass;
    const irrigatedShare = 'irrigated_share' in inputs ? Number(inputs.irrigated_share) : inputs.irrigated ? 1 : 0;
    const kwh = (M.MGMT_NORMS[crop].kwh_t ?? 0) * yld + irrigatedShare * E.irrigation_kwh_ha;
    const perHa = cFert + cDir + cInd + cDsl + cLime + cOrg + cSpr + kwh * grid;
    const flagPerHa = cDir + cInd + cLime + cOrg;
    const totalKg = perHa * area;
    farmsCalculated++;
    push({
      scope: 'scope3', category: 'cat01_purchased_goods', line_item: `contract_farming:${farm?.payload.region || country}:${crop}:${farmId}`, kind: 'contract_farm', t,
      factor_id: 'method:farm_footprint_per_ha', factor_value: round(perHa, 6), factor_unit: 'kgCO2e/ha', factor_source: `${M.METHOD_SOURCE} (farm_calculator.py, IPCC 2019 Tier 1 + Finnish organic-soil factors)`,
      formula: 'per-ha footprint (fertiliser + direct/indirect N2O + diesel + lime + organic soil + sprays + electricity) × crop area; allocated to delivered kg',
      inputs: { ...inputs, method, area_ha: round(area, 6), parcel_area_ha: round(parcelArea, 6), organic_share_soilmap: round(mapShare, 6), organic_share_used: round(organicShare, 6), delivered_kg: round(d.kg, 3), kg_per_kg_delivered: d.kg > 0 ? round(totalKg / d.kg, 6) : null, flag_kg_per_ha: round(flagPerHa, 6), grid_kg_per_kwh: grid, breakdown_kg_per_ha: { fertiliser: round(cFert, 3), n2o_direct: round(cDir, 3), n2o_indirect: round(cInd, 3), diesel: round(cDsl, 3), lime: round(cLime, 3), organic_soil: round(cOrg, 3), sprays: round(cSpr, 3), electricity: round(kwh * grid, 3) } },
      kgco2e: totalKg, in_total: true, basis: method.startsWith('farm survey') ? 'farm_survey' : 'norm_estimate',
    });
  }
  if (notCalculated.length) gaps.push({ area: 'cat01_farm', message: `${notCalculated.length} contract-farm deliveries without survey or parcel data`, count: notCalculated.length });
  if (!farmsCalculated) gaps.push({ area: 'cat01_farm', message: 'No contract-farm footprints could be calculated (farm survey / parcels not imported)' });
}

function finalize(contributions: Contribution[], gaps: Gap[], excluded: InventoryResult['excluded'], boundaryExcluded: string[], basis: Scope2Basis, extraChecks: InventoryResult['checks']): InventoryResult {
  const by = new Map<string, number>();
  for (const c of contributions) {
    const cat = c.category === 'cat01_purchased_goods' || c.category === 'cat01_purchased_services' ? 'cat01_purchased_goods_services' : c.category;
    const k = `${c.scope}|${cat}`;
    by.set(k, (by.get(k) || 0) + c.tco2e);
  }
  const summary = [...by.entries()].map(([k, v]) => {
    const [scope, category] = k.split('|');
    return { scope, category, tco2e: round(v, 6) };
  });
  const scopeSum = (s: string) => round(sum(contributions.filter((c) => c.scope === s).map((c) => c.tco2e)), 6);
  const totals: Record<string, number> = {
    scope1_total: scopeSum('scope1'),
    scope2_location_total: scopeSum('scope2_location'),
    scope2_market_total: scopeSum('scope2_market'),
    scope3_total: scopeSum('scope3'),
    biogenic_co2_scope1: scopeSum('memo'),
  };
  totals.scope2_reported = basis === 'location' ? totals.scope2_location_total : totals.scope2_market_total;
  totals.grand_total = round(totals.scope1_total + totals.scope2_reported + totals.scope3_total, 6);
  const inTotal = round(sum(contributions.filter((c) => c.in_total).map((c) => c.tco2e)), 6);
  const checks = [
    { id: 'scope2_single_basis', passed: !contributions.some((c) => c.in_total && c.scope === (basis === 'location' ? 'scope2_market' : 'scope2_location')), detail: `Only ${basis}-based Scope 2 counts toward the total; the other basis is reported separately.` },
    { id: 'total_equals_contributions', passed: Math.abs(inTotal - totals.grand_total) < 1e-6, detail: `Σ contributions in total = ${inTotal} t; Scope 1 + Scope 2 (${basis}) + Scope 3 = ${totals.grand_total} t` },
    { id: 'memo_not_in_total', passed: !contributions.some((c) => c.scope === 'memo' && c.in_total), detail: 'Biogenic CO2 is a memo item and excluded from Scope 1.' },
    { id: 'transport_separate_from_goods', passed: !contributions.some((c) => c.kind === 'transport_leg' && !c.category.startsWith('cat04') && !c.category.startsWith('cat09')), detail: 'Inbound transport is Category 4, outbound Category 9; never mixed into Category 1 purchased goods.' },
    ...extraChecks,
  ];
  return { contributions, summary, totals, gaps, excluded, boundary_excluded: boundaryExcluded, checks };
}

// Deterministic data mining for the discovery feed. Each miner turns saved calculation results,
// open quality issues and the lever catalogue into candidates: what we found, what we suggest,
// and the effect on the carbon footprint, computed here (never by a model). The expert agents
// only reword these candidates in plain language; see discovery.ts.
import type { NatureConfig } from '../config.ts';
import { type DB, type Row, all, get, json } from '../db/database.ts';
import { computeInventory } from '../domain/inventory.ts';
import { FARM_EF } from '../domain/method.ts';
import { round } from '../domain/util.ts';
import { type RunRow, runFromRow } from './calculations.ts';
import { INVENTORY_TABLES, getRecord, loadOpenIssueIndex, loadOverlay, loadTables } from './data.ts';
import { overlayWith } from './investigator.ts';
import { withNature } from './nature.ts';
import { issueFromRow } from './quality.ts';

export type ExpertId = 'footprint_analyst' | 'data_quality_reviewer' | 'raw_materials_analyst' | 'reduction_advisor';
export type Text = { en: string; fi: string };
export type Effect = {
  tco2e: number | null;
  basis: 'what_if' | 'recomputed' | 'change' | 'ceiling' | 'catalogue_estimate' | 'exposure' | 'driver_size';
  share_pct: number | null;
  catalogue_tco2e?: number | null;
  ceiling_tco2e?: number | null;
  open_issue_tco2e?: number | null;
  note: Text;
};
export type Evidence = { id: string; label: string; value: string; link?: string };
export type Candidate = {
  key: string;
  expert: ExpertId;
  kind: string;
  priority: number;
  facts: Record<string, string | number | boolean | null>;
  template: { found: Text; suggest: Text };
  who: Text;
  effect: Effect;
  action: { to: string; label: Text };
  evidence: Evidence[];
};
export type MineResult = { year: number; run: Pick<RunRow, 'id' | 'year' | 'created_at' | 'totals'> | null; demo: boolean; candidates: Candidate[]; notes: string[] };

type Contribution = { id: string; scope: string; category: string; line_item: string; kind: string; factor_id: string; factor_value: number; inputs: Record<string, unknown>; tco2e: number; open_issue_ids: string[]; basis: string };

const r1 = (n: number) => round(n, 1);
const pct = (part: number, whole: number) => (whole ? round((100 * part) / whole, 1) : null);
const num = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0);
export function fmt(n: number | null | undefined, lang: 'en' | 'fi', decimals = 1) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return new Intl.NumberFormat(lang === 'fi' ? 'fi-FI' : 'en-GB', { maximumFractionDigits: decimals, minimumFractionDigits: 0 }).format(n);
}
const both = (f: (lang: 'en' | 'fi') => string): Text => ({ en: f('en'), fi: f('fi') });

const CATEGORY: Record<string, Text> = {
  stationary_and_mobile_combustion: { en: 'fuel combustion', fi: 'polttoaineiden poltto' },
  fugitive_refrigerants: { en: 'refrigerant leaks', fi: 'kylmäainevuodot' },
  purchased_electricity: { en: 'purchased electricity', fi: 'ostosähkö' },
  purchased_heat_steam: { en: 'purchased heat and steam', fi: 'ostolämpö ja -höyry' },
  cat01_purchased_goods: { en: 'purchased goods (Cat 1)', fi: 'ostetut tuotteet (luokka 1)' },
  cat01_purchased_services: { en: 'purchased services (Cat 1)', fi: 'ostetut palvelut (luokka 1)' },
  cat02_capital_goods: { en: 'capital goods (Cat 2)', fi: 'investointihyödykkeet (luokka 2)' },
  cat03_fuel_energy: { en: 'fuel and energy supply chains (Cat 3)', fi: 'polttoaineiden ja energian tuotantoketjut (luokka 3)' },
  cat04_upstream_transport: { en: 'inbound transport (Cat 4)', fi: 'saapuvat kuljetukset (luokka 4)' },
  cat05_waste: { en: 'waste (Cat 5)', fi: 'jätteet (luokka 5)' },
  cat06_business_travel: { en: 'business travel (Cat 6)', fi: 'työmatkat (luokka 6)' },
  cat07_employee_commuting: { en: 'commuting (Cat 7)', fi: 'työmatkaliikenne (luokka 7)' },
  cat09_downstream_transport: { en: 'outbound transport (Cat 9)', fi: 'lähtevät kuljetukset (luokka 9)' },
  cat11_use_of_sold_products: { en: 'use of sold products (Cat 11)', fi: 'myytyjen tuotteiden käyttö (luokka 11)' },
  cat12_end_of_life: { en: 'end of life of sold products (Cat 12)', fi: 'myytyjen tuotteiden elinkaaren loppu (luokka 12)' },
};
const cat = (c: string, lang: 'en' | 'fi') => CATEGORY[c]?.[lang] || c.replace(/_/g, ' ');

const OWNER: Record<string, Text> = {
  erp_purchase_lines: { en: 'Procurement', fi: 'Hankinnat' },
  supplier_pcf: { en: 'Procurement, with the supplier', fi: 'Hankinnat yhdessä toimittajan kanssa' },
  farm_survey: { en: 'Field advisor', fi: 'Viljelyneuvoja' },
  energy_meter_readings: { en: 'Site energy manager', fi: 'Toimipaikan energiavastaava' },
  fuel_deliveries: { en: 'Site energy manager', fi: 'Toimipaikan energiavastaava' },
  fuel_stock_changes: { en: 'Site energy manager', fi: 'Toimipaikan energiavastaava' },
  goo_cancellations: { en: 'Site energy manager', fi: 'Toimipaikan energiavastaava' },
  refrigerant_service_log: { en: 'Maintenance', fi: 'Kunnossapito' },
  shipments: { en: 'Logistics', fi: 'Logistiikka' },
  travel_bookings: { en: 'HR / travel', fi: 'Henkilöstöhallinto / matkat' },
  commuting_survey_2025: { en: 'HR', fi: 'Henkilöstöhallinto' },
  waste_transfer_notes: { en: 'Site environmental lead', fi: 'Toimipaikan ympäristövastaava' },
  capex_projects: { en: 'Finance', fi: 'Talous' },
};
const owner = (table: string): Text => OWNER[table] || { en: 'Sustainability team', fi: 'Vastuullisuustiimi' };
const ISSUE_FOUND: Record<string, Text> = {
  'refrigerant.charge_scale': { en: 'A refrigerant refill looks unusually large. It may have been entered in grams instead of kilograms.', fi: 'Kylmäaineen täyttömäärä näyttää poikkeavan suurelta. Määrä on ehkä ilmoitettu grammoina kilogrammojen sijaan.' },
  'energy.kwh_in_mwh_column': { en: 'An energy reading may be in kilowatt-hours where megawatt-hours were expected.', fi: 'Energialukema on ehkä ilmoitettu kilowattitunteina, vaikka sarakkeessa odotetaan megawattitunteja.' },
  'pcf.value_scale': { en: 'A supplier’s product footprint may use the wrong unit or decimal position.', fi: 'Toimittajan tuotekohtaisessa päästöluvussa on ehkä väärä yksikkö tai desimaalin paikka.' },
  'pcf.value_scale_vs_history': { en: 'the footprint the supplier gave is far higher than their earlier values. It may be in grams instead of kilograms per kilogram of product.', fi: 'toimittajan ilmoittama päästöluku on paljon suurempi kuin aiemmin. Se on ehkä ilmoitettu grammoina kilogrammojen sijaan tuotekiloa kohti.' },
  'erp.tonnes_keyed_as_kg': { en: 'the quantity looks like it was typed in tonnes where kilograms were expected.', fi: 'määrä näyttää kirjatun tonneina, vaikka kilogrammoja odotetaan.' },
  'erp.decimal_shift_vs_shipment': { en: 'the purchased quantity does not match the delivery; the decimal point may be in the wrong place.', fi: 'ostettu määrä ei vastaa toimitusta; desimaalipilkku voi olla väärässä kohdassa.' },
  'erp.decimal_shift_price': { en: 'the price per unit is far from usual; the decimal point may be in the wrong place.', fi: 'yksikköhinta poikkeaa paljon tavallisesta; desimaalipilkku voi olla väärässä kohdassa.' },
  'erp.currency_vs_supplier_history': { en: 'the amount may be in the wrong currency compared with this supplier’s earlier invoices.', fi: 'summa voi olla väärässä valuutassa verrattuna toimittajan aiempiin laskuihin.' },
  'erp.spend_amount_in_sek': { en: 'the amount may be in Swedish kronor instead of euros.', fi: 'summa voi olla Ruotsin kruunuina eikä euroina.' },
  'erp.currency_sek_as_eur': { en: 'the amount may be in Swedish kronor instead of euros.', fi: 'summa voi olla Ruotsin kruunuina eikä euroina.' },
  'erp.material_text_vs_master': { en: 'the product description does not match the material it is booked under.', fi: 'tuotteen kuvaus ei vastaa nimikettä, jolle se on kirjattu.' },
  'waste.quantity_scale': { en: 'the waste amount looks too large for the site; the unit may be wrong.', fi: 'jätemäärä näyttää liian suurelta toimipaikalle; yksikkö voi olla väärä.' },
  'fuel.quantity_scale': { en: 'the fuel amount looks too large; the unit may be wrong.', fi: 'polttoainemäärä näyttää liian suurelta; yksikkö voi olla väärä.' },
  'energy.spike_vs_same_month': { en: 'the energy use is far higher than in the same month in other years.', fi: 'energiankulutus on paljon suurempi kuin samana kuukautena muina vuosina.' },
  'energy.extreme_outlier': { en: 'the energy reading is far outside the usual range.', fi: 'energialukema on kaukana tavallisesta vaihteluvälistä.' },
  'refrigerant.gas_vs_system_history': { en: 'the refrigerant type does not match what this system has used before.', fi: 'kylmäaineen tyyppi ei vastaa sitä, mitä järjestelmässä on aiemmin käytetty.' },
  'commute.distance_scale': { en: 'the commuting distance looks too long; it may be in metres instead of kilometres.', fi: 'työmatka näyttää liian pitkältä; se voi olla metreinä eikä kilometreinä.' },
  'farm.n_mineral_kg_ha_decimal_shift': { en: 'the nitrogen fertiliser amount looks 10 times too large or small; the decimal point may be in the wrong place.', fi: 'typpilannoitteen määrä näyttää kymmenkertaiselta tai kymmenesosalta; desimaalipilkku voi olla väärässä kohdassa.' },
  'farm.yield_t_ha_decimal_shift': { en: 'the crop yield looks 10 times too large or small; the decimal point may be in the wrong place.', fi: 'sato näyttää kymmenkertaiselta tai kymmenesosalta; desimaalipilkku voi olla väärässä kohdassa.' },
  'farm.soil_map_vs_survey': { en: 'the soil type the grower reported differs from the soil map.', fi: 'viljelijän ilmoittama maalaji poikkeaa maaperäkartasta.' },
  'farm.area_vs_parcels': { en: 'the farm area in the survey differs from the area of its registered parcels.', fi: 'kyselyn pinta-ala poikkeaa tilan rekisteröityjen lohkojen alasta.' },
};
const ISSUE_CONTEXT: Record<string, Text> = {
  erp_purchase_lines: { en: 'A purchase entry needs checking before its amount is used in the footprint.', fi: 'Ostotiedon määrä on tarkistettava ennen sen käyttöä päästölaskennassa.' },
  farm_survey: { en: 'A farm survey entry may need a correction. Check it with the grower before using it.', fi: 'Tilakyselyn tietoa on ehkä korjattava. Tarkista se viljelijältä ennen käyttöä.' },
  shipments: { en: 'A transport entry may need a correction before its emissions are reported.', fi: 'Kuljetustietoa on ehkä korjattava ennen päästöjen raportointia.' },
};

const DOCUMENT: Record<string, Text> = {
  supplier_pcf: { en: 'the supplier’s footprint declaration', fi: 'toimittajan päästöilmoitus' },
  energy_meter_readings: { en: 'the meter report or energy invoice', fi: 'mittariraportti tai energialasku' },
  refrigerant_service_log: { en: 'the service report', fi: 'huoltoraportti' },
  erp_purchase_lines: { en: 'the invoice', fi: 'lasku' },
  fuel_deliveries: { en: 'the delivery note', fi: 'toimitusilmoitus' },
  shipments: { en: 'the freight document', fi: 'rahtiasiakirja' },
  commuting_survey: { en: 'the survey answer', fi: 'kyselyvastaus' },
  farm_survey: { en: 'the grower’s answer (ask the grower)', fi: 'viljelijän vastaus (kysy viljelijältä)' },
  waste_transfer_notes: { en: 'the waste transfer note', fi: 'siirtoasiakirja' },
  travel_bookings: { en: 'the booking', fi: 'varaus' },
};
const DATASET: Record<string, Text> = {
  supplier_pcf: { en: 'supplier product footprint', fi: 'toimittajan tuotekohtainen päästöluku' },
  energy_meter_readings: { en: 'energy meter reading', fi: 'energiamittarin lukema' },
  refrigerant_service_log: { en: 'refrigerant service record', fi: 'kylmäainehuollon merkintä' },
  erp_purchase_lines: { en: 'purchase entry', fi: 'ostorivi' },
  fuel_deliveries: { en: 'fuel delivery', fi: 'polttoainetoimitus' },
  shipments: { en: 'transport entry', fi: 'kuljetusrivi' },
  commuting_survey: { en: 'commuting survey answer', fi: 'työmatkakyselyn vastaus' },
  farm_survey: { en: 'farm survey answer', fi: 'tilakyselyn vastaus' },
  waste_transfer_notes: { en: 'waste record', fi: 'jätekirjaus' },
  travel_bookings: { en: 'business travel booking', fi: 'liikematkavaraus' },
};

// What a flagged record is about, in names a person recognises (supplier, material, site, month),
// read from the source record and the master tables. Used instead of record keys and field names.
function recordContext(db: DB, issue: { record_id: string | null; table_name: string; year: number | null }, tables: Record<string, { payload: Record<string, string> }[]>) {
  const r = issue.record_id ? getRecord(db, issue.record_id) : null;
  const p = (r?.payload || {}) as Record<string, string>;
  const find = (table: string, key: string, value?: string) => value ? tables[table]?.find((x) => x.payload[key] === value)?.payload : undefined;
  const supplier = find('suppliers', 'supplier_id', p.supplier_id)?.supplier_name;
  const material = find('materials', 'material_id', p.material_id)?.name_en || p.material_text;
  const site = find('sites', 'site_id', p.site_id || p.plant)?.name;
  const period = p.month && p.year ? `${p.year}-${String(p.month).padStart(2, '0')}` : p.service_date || p.posting_date || p.delivery_date || (issue.year != null ? String(issue.year) : undefined);
  return {
    record_type: DATASET[issue.table_name] || { en: 'source record', fi: 'lähdetieto' },
    supplier, material, site, period,
    detail: p.carrier || p.refrigerant || p.system || p.crop || p.mode || undefined,
    farm: p.farm_id || undefined,
  };
}

const describe = (c: ReturnType<typeof recordContext>, lang: 'en' | 'fi') =>
  [c.record_type[lang], c.material, c.supplier && (lang === 'fi' ? `toimittaja ${c.supplier}` : `from ${c.supplier}`), c.site, c.detail, c.farm && (lang === 'fi' ? `tila ${c.farm}` : `farm ${c.farm}`), c.period].filter(Boolean).join(', ');

// The latest saved inventory run for a year, preferring runs without synthetic DEMO inputs.
export function discoveryRun(db: DB, year: number): { run: RunRow; demo: boolean } | null {
  const rows = all<Row>(db, "SELECT * FROM calculation_runs WHERE year = ? AND kind = 'inventory' ORDER BY created_at DESC", year).map(runFromRow);
  const real = rows.find((r) => !r.completeness.contains_demo_data);
  if (real) return { run: real, demo: false };
  return rows[0] ? { run: rows[0], demo: true } : null;
}

function contributions(db: DB, runId: string): Contribution[] {
  return all<Row>(db, 'SELECT id, scope, category, line_item, kind, factor_id, factor_value, inputs_json, tco2e, open_issue_ids_json, basis FROM calculation_contributions WHERE run_id = ? AND in_total = 1', runId)
    .map((r) => ({ id: String(r.id), scope: String(r.scope), category: String(r.category), line_item: String(r.line_item), kind: String(r.kind), factor_id: String(r.factor_id), factor_value: num(r.factor_value), inputs: json(r.inputs_json, {}), tco2e: num(r.tco2e), open_issue_ids: json<string[]>(r.open_issue_ids_json, []), basis: String(r.basis) }));
}

const openIssueT = (cs: Contribution[]) => r1(cs.filter((c) => c.open_issue_ids.length).reduce((s, c) => s + c.tco2e, 0));

// ---------------------------------------------------------------- footprint analyst

function mineFootprint(db: DB, run: RunRow, cs: Contribution[]): Candidate[] {
  const out: Candidate[] = [];
  const total = num(run.totals.grand_total);
  const byCat = new Map<string, number>();
  for (const c of cs) byCat.set(c.category, (byCat.get(c.category) || 0) + c.tco2e);
  const ranked = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length && total > 0) {
    const [topCat, topT] = ranked[0];
    const share = pct(topT, total)!;
    out.push({
      key: `fp:concentration:${run.year}`, expert: 'footprint_analyst', kind: 'concentration', priority: topT,
      facts: { year: run.year, category: topCat, category_tco2e: r1(topT), total_tco2e: r1(total), share_pct: share },
      template: {
        found: both((l) => l === 'fi' ? `${cat(topCat, l)} on ${fmt(share, l)} % vuoden ${run.year} kokonaispäästöistä (${fmt(topT, l, 0)} / ${fmt(total, l, 0)} t CO₂e).` : `${cat(topCat, l)} is ${fmt(share, l)} % of the ${run.year} total (${fmt(topT, l, 0)} of ${fmt(total, l, 0)} t CO₂e).`),
        suggest: both((l) => l === 'fi' ? 'Varmista ensin tämän luokan suurimmat rivit: niiden virheet vaikuttavat kokonaislukuun eniten.' : 'Check the largest lines in this category first: errors there move the total most.'),
      },
      who: { en: 'Sustainability team', fi: 'Vastuullisuustiimi' },
      effect: { tco2e: r1(topT), basis: 'driver_size', share_pct: share, open_issue_tco2e: openIssueT(cs.filter((c) => c.category === topCat)), note: { en: 'Size of this category', fi: 'Luokan koko' } },
      action: { to: `/sustainability?year=${run.year}`, label: { en: 'Open the calculation', fi: 'Avaa laskelma' } },
      evidence: [{ id: `run:${run.id}:${topCat}`, label: `${run.year} ${topCat}`, value: `${r1(topT)} tCO2e of ${r1(total)}`, link: `/sustainability?year=${run.year}` }],
    });
  }
  const prev = discoveryRun(db, run.year - 1);
  const coverage = (r: RunRow) => JSON.stringify(Object.entries((r.completeness.records_used || {}) as Record<string, number>).filter(([, n]) => n > 0).map(([k]) => k).sort());
  if (prev && total > 0 && prev.run.scope2_basis === run.scope2_basis && prev.run.method_version === run.method_version && prev.demo === !!run.completeness.contains_demo_data && coverage(prev.run) === coverage(run)) {
    const prevCs = contributions(db, prev.run.id);
    const prevCat = new Map<string, number>();
    for (const c of prevCs) prevCat.set(c.category, (prevCat.get(c.category) || 0) + c.tco2e);
    const scopes: [string, string, Text][] = [['scope1_total', 'scope1', { en: 'Scope 1', fi: 'Scope 1' }], ['scope2_reported', 'scope2', { en: 'Scope 2', fi: 'Scope 2' }], ['scope3_total', 'scope3', { en: 'Scope 3', fi: 'Scope 3' }]];
    for (const [key, prefix, label] of scopes) {
      const a = num(prev.run.totals[key]);
      const b = num(run.totals[key]);
      const delta = r1(b - a);
      if (!a || Math.abs(delta) < 0.05 * a) continue;
      const cats = [...new Set([...byCat.keys(), ...prevCat.keys()])].filter((c) => cs.concat(prevCs).some((x) => x.category === c && x.scope.startsWith(prefix)));
      const drivers = cats.map((c) => [c, r1((byCat.get(c) || 0) - (prevCat.get(c) || 0))] as [string, number]).sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]));
      const [dCat, dT] = drivers[0] || ['', 0];
      const changePct = pct(delta, a)!;
      const up = delta > 0;
      out.push({
        key: `fp:yoy:${prefix}:${run.year}`, expert: 'footprint_analyst', kind: 'year_change', priority: Math.abs(delta),
        facts: { scope: label.en, from_year: run.year - 1, to_year: run.year, from_tco2e: r1(a), to_tco2e: r1(b), change_tco2e: delta, change_pct: changePct, main_driver: dCat, main_driver_change_tco2e: dT },
        template: {
          found: both((l) => l === 'fi'
            ? `${label.fi} ${up ? 'kasvoi' : 'laski'} ${fmt(a, l, 0)} → ${fmt(b, l, 0)} t CO₂e (${fmt(changePct, l)} %) vuodesta ${run.year - 1} vuoteen ${run.year}. Suurin muutos: ${cat(dCat, l)} (${fmt(dT, l, 0)} t).`
            : `${label.en} ${up ? 'rose' : 'fell'} from ${fmt(a, l, 0)} to ${fmt(b, l, 0)} t CO₂e (${fmt(changePct, l)} %) between ${run.year - 1} and ${run.year}. Biggest change: ${cat(dCat, l)} (${fmt(dT, l, 0)} t).`),
          suggest: both((l) => l === 'fi' ? 'Tarkista, onko muutos todellinen (toiminta, rajaus) vai datan virhe, ennen kuin raportoit sen.' : 'Check whether the change is real (activity, boundary) or a data error before you report it.'),
        },
        who: { en: 'Sustainability team', fi: 'Vastuullisuustiimi' },
        effect: { tco2e: delta, basis: 'change', share_pct: changePct, open_issue_tco2e: openIssueT(cs.filter((c) => c.scope.startsWith(prefix))), note: { en: `Change from ${run.year - 1}`, fi: `Muutos vuodesta ${run.year - 1}` } },
        action: { to: `/sustainability?year=${run.year}`, label: { en: 'Compare in the calculation', fi: 'Vertaa laskelmassa' } },
        evidence: [
          { id: `run:${prev.run.id}:${key}`, label: `${run.year - 1} ${key}`, value: `${r1(a)} tCO2e`, link: `/sustainability?year=${run.year - 1}` },
          { id: `run:${run.id}:${key}`, label: `${run.year} ${key}`, value: `${r1(b)} tCO2e`, link: `/sustainability?year=${run.year}` },
        ],
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- data-quality reviewer

function mineDataQuality(db: DB, run: RunRow, cs: Contribution[]): Candidate[] {
  const out: Candidate[] = [];
  const total = num(run.totals.grand_total);
  const exposure = new Map<string, number>();
  for (const c of cs) for (const id of c.open_issue_ids) exposure.set(id, (exposure.get(id) || 0) + c.tco2e);
  const atRisk = openIssueT(cs);
  if (atRisk > 0 && total > 0) {
    const share = pct(atRisk, total)!;
    const n = exposure.size;
    out.push({
      key: `dq:exposure:${run.year}`, expert: 'data_quality_reviewer', kind: 'open_issue_exposure', priority: atRisk,
      facts: { year: run.year, tco2e_on_open_issues: atRisk, total_tco2e: r1(total), share_pct: share, open_issues_linked: n },
      template: {
        found: both((l) => l === 'fi' ? `${fmt(share, l)} % vuoden ${run.year} luvusta (${fmt(atRisk, l, 0)} t CO₂e) perustuu riveihin, joissa on avoin laatuhavainto (${n} havaintoa).` : `${fmt(share, l)} % of the ${run.year} figure (${fmt(atRisk, l, 0)} t CO₂e) rests on records with an open data issue (${n} issues).`),
        suggest: both((l) => l === 'fi' ? 'Käy läpi alla olevat suurimman vaikutuksen havainnot ennen raportointia.' : 'Work through the highest-impact issues below before reporting.'),
      },
      who: { en: 'Sustainability team', fi: 'Vastuullisuustiimi' },
      effect: { tco2e: atRisk, basis: 'exposure', share_pct: share, note: { en: 'Emissions resting on open issues', fi: 'Avoimiin havaintoihin perustuvat päästöt' } },
      action: { to: '/data-quality', label: { en: 'Open incidents', fi: 'Avaa poikkeamat' } },
      evidence: [{ id: `run:${run.id}:open_issue_exposure`, label: `${run.year} emissions on open issues`, value: `${atRisk} of ${r1(total)} tCO2e`, link: '/data-quality' }],
    });
  }
  // What-if for the issues whose records carry the most emissions (plus the highest-severity rest).
  const issues = all<Row>(db, "SELECT * FROM dq_issues WHERE status = 'open' AND year = ? AND action IN ('set_value','exclude_record','add_record')", run.year).map(issueFromRow)
    .filter((i) => i.action !== 'set_value' || (i.candidate_value !== null && i.candidate_value !== ''));
  const sevRank: Record<string, number> = { high: 3, medium: 2, low: 1 };
  const picked = [...issues].sort((a, b) => (exposure.get(b.id) || 0) - (exposure.get(a.id) || 0) || (sevRank[b.severity] || 0) - (sevRank[a.severity] || 0)).slice(0, 6);
  if (!picked.length) return out;
  const tables = loadTables(db, INVENTORY_TABLES);
  const base = loadOverlay(db);
  const open = loadOpenIssueIndex(db);
  const baseline = computeInventory({ year: run.year, scope2Basis: run.scope2_basis, tables, overlay: base, openIssues: open }).totals.grand_total;
  for (const issue of picked) {
    let delta: number | null = null;
    try {
      const alt = overlayWith(base, issue, issue.candidate_value ?? '');
      delta = r1(computeInventory({ year: run.year, scope2Basis: run.scope2_basis, tables, overlay: alt, openIssues: open }).totals.grand_total - baseline);
    } catch {
      delta = null;
    }
    if (delta === null || Math.abs(delta) < 0.05) continue;
    const share = pct(delta, baseline);
    const who = owner(issue.table_name);
    const about = recordContext(db, issue, tables);
    const observed = Number(issue.observed_value), suggested = Number(issue.candidate_value);
    const scale = Number.isFinite(observed) && Number.isFinite(suggested) && suggested !== 0 && Math.abs(observed / suggested) >= 10 ? Math.round(Math.abs(observed / suggested)) : null;
    const plain = ISSUE_FOUND[issue.rule_id] || ISSUE_CONTEXT[issue.table_name] || { en: 'A recorded value may need a correction. Check the original document before using it.', fi: 'Kirjattua arvoa on ehkä korjattava. Tarkista alkuperäinen asiakirja ennen käyttöä.' };
    const plainAction = issue.action === 'exclude_record' ? { en: 'leave this record out', fi: 'jättää tietueen pois' } : issue.action === 'add_record' ? { en: 'add the missing record', fi: 'lisätä puuttuva tietue' } : { en: `use ${issue.candidate_value}${issue.candidate_unit ? ` ${issue.candidate_unit}` : ''} instead of ${issue.observed_value ?? '—'}`, fi: `käyttää arvoa ${issue.candidate_value}${issue.candidate_unit ? ` ${issue.candidate_unit}` : ''} arvon ${issue.observed_value ?? '—'} sijaan` };
    out.push({
      key: `dq:${issue.id}`, expert: 'data_quality_reviewer', kind: 'issue_what_if', priority: Math.abs(delta),
      facts: { record_type: about.record_type.en, document_to_check: (DOCUMENT[issue.table_name] || { en: 'the original document' }).en, supplier: about.supplier ?? null, material: about.material ?? null, site: about.site ?? null, period: about.period ?? null, detail: about.detail ?? null, farm: about.farm ?? null, times_larger_than_suggested: scale, issue_id: issue.id, issue_type: issue.issue_type, table: issue.table_name, record: issue.record_key, field: issue.field, observed_value: issue.observed_value, suggested_value: issue.candidate_value, suggested_unit: issue.candidate_unit, action: issue.action, severity: issue.severity, rule_explanation: issue.explanation_en, year: run.year, effect_tco2e: delta, effect_pct_of_total: share, total_before_tco2e: r1(baseline) },
      template: {
        found: both((l) => `${describe(about, l).replace(/^./, (ch) => ch.toUpperCase())}: ${plain[l].replace(/^./, (ch) => ch.toLowerCase())}`),
        suggest: both((l) => l === 'fi' ? `Tarkista alkuperäinen asiakirja ja päätä, ${plainAction.fi}.` : `Check the original document and decide whether to ${plainAction.en}.`),
      },
      who,
      effect: { tco2e: delta, basis: 'what_if', share_pct: share, note: { en: 'Change if the correction is confirmed', fi: 'Muutos, jos korjaus vahvistetaan' } },
      action: { to: `/data-quality?issue=${encodeURIComponent(issue.id)}`, label: { en: 'Review this issue', fi: 'Tarkista havainto' } },
      evidence: [{ id: issue.id, label: `${issue.issue_type} on ${issue.record_key}`, value: `observed ${issue.observed_value ?? '—'}, suggested ${issue.candidate_value ?? '—'}; what-if ${delta} tCO2e`, link: `/data-quality?issue=${encodeURIComponent(issue.id)}` }],
    });
  }
  return out;
}

// ---------------------------------------------------------------- raw-materials analyst

const COMPONENTS: Record<string, Text> = {
  fertiliser: { en: 'fertiliser production', fi: 'lannoitteiden valmistus' },
  n2o_direct: { en: 'nitrous oxide from fields (direct)', fi: 'peltojen dityppioksidi (suora)' },
  n2o_indirect: { en: 'nitrous oxide from fields (indirect)', fi: 'peltojen dityppioksidi (epäsuora)' },
  diesel: { en: 'tractor diesel', fi: 'traktorien diesel' },
  lime: { en: 'liming', fi: 'kalkitus' },
  organic_soil: { en: 'drained organic (peat) soils', fi: 'ojitetut turvemaat' },
  sprays: { en: 'crop protection passes', fi: 'kasvinsuojelukäsittelyt' },
  electricity: { en: 'farm electricity', fi: 'tilan sähkö' },
};
const NEXT_STEP: Record<string, Text> = {
  fertiliser: { en: 'Ask growers about low-carbon nitrogen fertiliser (lever L08).', fi: 'Kysy viljelijöiltä vähähiilisestä typpilannoitteesta (toimenpide L08).' },
  n2o_direct: { en: 'Review nitrogen rates with soil testing and precision application (lever L09).', fi: 'Käy typpimäärät läpi maa-analyysien ja täsmälannoituksen avulla (toimenpide L09).' },
  n2o_indirect: { en: 'Review nitrogen rates with soil testing and precision application (lever L09).', fi: 'Käy typpimäärät läpi maa-analyysien ja täsmälannoituksen avulla (toimenpide L09).' },
  organic_soil: { en: 'Review contract area on drained peat soils (lever L11).', fi: 'Käy läpi turvemailla oleva sopimusala (toimenpide L11).' },
};

function mineRawMaterials(run: RunRow, cs: Contribution[]): Candidate[] {
  const farms = cs.filter((c) => c.kind === 'contract_farm');
  const missing = run.gaps.filter((g) => g.area === 'cat01_farm').map((g) => g.message);
  const out: Candidate[] = [];
  if (missing.length) out.push({
    key: `rm:missing:${run.year}`, expert: 'raw_materials_analyst', kind: 'farm_not_calculated', priority: Number.MAX_SAFE_INTEGER,
    facts: { year: run.year, missing: missing.join(' | ') },
    template: { found: both((l) => l === 'fi' ? 'Osaa sopimusviljelyn päästöistä ei voitu laskea puuttuvien tilakyselyjen tai peltotietojen vuoksi.' : 'Some contract-farming emissions could not be calculated because farm surveys or parcel data are missing.'), suggest: both((l) => l === 'fi' ? 'Pyydä puuttuvat tilakyselyt ja peltotiedot. Laske päästöt sitten uudelleen.' : 'Collect the missing farm surveys and parcel data, then calculate the footprint again.') },
    who: { en: 'Field advisor', fi: 'Viljelyneuvoja' }, effect: { tco2e: null, basis: 'exposure', share_pct: null, note: { en: 'Unknown footprint from missing farm data', fi: 'Puuttuvan tiladatan päästömäärä ei ole tiedossa' } },
    action: { to: `/raw-materials?year=${run.year}`, label: { en: 'Check farm coverage', fi: 'Tarkista tilatietojen kattavuus' } },
    evidence: [{ id: `run:${run.id}:farm_gaps`, label: 'Farm calculation gaps', value: missing.join(' | '), link: `/raw-materials?year=${run.year}` }],
  });
  if (!farms.length) return out;
  const groups = new Map<string, { crop: string; country: string; t: number; flag: number; kg: number; parts: Record<string, number>; farms: number; estimated: number; estimatedT: number; issueT: number }>();
  for (const c of farms) {
    const [, region = '', crop = ''] = c.line_item.split(':');
    const country = region.slice(0, 2);
    const k = `${country}:${crop}`;
    const g = groups.get(k) || { crop, country, t: 0, flag: 0, kg: 0, parts: {}, farms: 0, estimated: 0, estimatedT: 0, issueT: 0 };
    const area = num(c.inputs.area_ha);
    g.t += c.tco2e;
    g.flag += (num(c.inputs.flag_kg_per_ha) * area) / 1000;
    g.kg += num(c.inputs.delivered_kg);
    for (const [part, perHa] of Object.entries((c.inputs.breakdown_kg_per_ha as Record<string, number>) || {})) g.parts[part] = (g.parts[part] || 0) + (num(perHa) * area) / 1000;
    g.farms++;
    if (c.basis === 'norm_estimate') { g.estimated++; g.estimatedT += c.tco2e; }
    if (c.open_issue_ids.length) g.issueT += c.tco2e;
    groups.set(k, g);
  }
  const crops = [...groups.values()].sort((a, b) => b.t - a.t);
  const pinned = crops.filter((g, i) => i < 3 || (g.crop === 'pea' && g.country === 'FI'));
  for (const g of pinned) {
    const [topPart, topT] = Object.entries(g.parts).sort((a, b) => b[1] - a[1])[0] || ['', 0];
    // Earlier immutable runs predate component storage. Their absent components are unknown.
    if (!topPart || farms.some((c) => !c.inputs.breakdown_kg_per_ha || c.inputs.flag_kg_per_ha === undefined)) continue;
    const flagShare = pct(g.flag, g.t)!;
    const partShare = pct(topT, g.t)!;
    const intensity = g.kg > 0 ? round((g.t * 1000) / g.kg, 3) : null;
    const label = `${g.country} ${g.crop.replace(/_/g, ' ')}`;
    out.push({
      key: `rm:crop:${g.country}:${g.crop}:${run.year}`, expert: 'raw_materials_analyst', kind: 'crop_driver', priority: g.t,
      facts: { crop: g.crop, country: g.country, year: run.year, crop_tco2e: r1(g.t), farms: g.farms, delivered_t: r1(g.kg / 1000), kg_co2e_per_kg: intensity, flag_tco2e: r1(g.flag), flag_share_pct: flagShare, main_driver: topPart, main_driver_tco2e: r1(topT), main_driver_share_pct: partShare, farms_on_norm_estimates: g.estimated },
      template: {
        found: both((l) => l === 'fi'
          ? `${label}: ${fmt(g.t, l, 0)} t CO₂e (${g.farms} tilaa, ${fmt(intensity, l, 3)} kg CO₂e/kg). Suurin tekijä on ${COMPONENTS[topPart]?.fi || topPart} (${fmt(partShare, l)} %), ja ${fmt(flagShare, l)} % on maankäyttöön liittyvää (FLAG).`
          : `${label}: ${fmt(g.t, l, 0)} t CO₂e (${g.farms} farms, ${fmt(intensity, l, 3)} kg CO₂e/kg). The biggest driver is ${COMPONENTS[topPart]?.en || topPart} (${fmt(partShare, l)} %), and ${fmt(flagShare, l)} % is land-based (FLAG).`),
        suggest: NEXT_STEP[topPart] || { en: 'Discuss the largest input with the growers and the field advisor.', fi: 'Käy suurin tekijä läpi viljelijöiden ja viljelyneuvojan kanssa.' },
      },
      who: { en: 'Field advisor', fi: 'Viljelyneuvoja' },
      effect: { tco2e: r1(topT), basis: 'driver_size', share_pct: partShare, open_issue_tco2e: r1(g.issueT), note: { en: 'Size of the main driver', fi: 'Suurimman tekijän koko' } },
      action: { to: `/raw-materials?year=${run.year}`, label: { en: 'Open raw materials', fi: 'Avaa raaka-aineet' } },
      evidence: [{ id: `run:${run.id}:farm:${g.country}:${g.crop}`, label: `${run.year} contract farming ${label}`, value: `${r1(g.t)} tCO2e from ${g.farms} farm footprints; FLAG ${r1(g.flag)} t`, link: `/raw-materials?year=${run.year}` }],
    });
  }
  const estimated = crops.reduce((s, g) => s + g.estimated, 0);
  const estimatedT = r1(crops.reduce((s, g) => s + g.estimatedT, 0));
  const totalFarmT = crops.reduce((s, g) => s + g.t, 0);
  if (estimated > 0) {
    const share = pct(estimatedT, totalFarmT)!;
    out.push({
      key: `rm:gaps:${run.year}`, expert: 'raw_materials_analyst', kind: 'farm_data_gap', priority: estimatedT,
      facts: { year: run.year, farms_on_norm_estimates: estimated, tco2e_on_estimates: estimatedT, share_of_farm_footprint_pct: share, farm_footprint_tco2e: r1(totalFarmT), not_calculated_notes: missing.join(' | ') || null },
      template: {
        found: both((l) => l === 'fi' ? `${estimated} sopimustilan jalanjälki perustuu viljelynormeihin, koska tilakysely puuttuu: ${fmt(estimatedT, l, 0)} t CO₂e (${fmt(share, l)} % sopimusviljelyn jalanjäljestä).` : `${estimated} contract-farm footprints rest on management norms because the farm survey is missing: ${fmt(estimatedT, l, 0)} t CO₂e (${fmt(share, l)} % of the contract-farming footprint).`),
        suggest: both((l) => l === 'fi' ? 'Pyydä näiltä tiloilta tilakysely ennen seuraavaa laskentaa.' : 'Collect the farm survey from these farms before the next calculation.'),
      },
      who: { en: 'Field advisor', fi: 'Viljelyneuvoja' },
      effect: { tco2e: estimatedT, basis: 'exposure', share_pct: share, note: { en: 'Footprint based on estimates', fi: 'Arvioihin perustuva jalanjälki' } },
      action: { to: `/raw-materials?year=${run.year}`, label: { en: 'Open raw materials', fi: 'Avaa raaka-aineet' } },
      evidence: [{ id: `run:${run.id}:farm_estimates`, label: `${run.year} farm footprints on norms`, value: `${estimated} farms, ${estimatedT} tCO2e`, link: `/raw-materials?year=${run.year}` }],
    });
  }
  return out;
}

// ---------------------------------------------------------------- reduction advisor

export type Lever = { lever_id: string; name: string; scope: string; abatement_tco2e_2030_design: number | null; earliest_start: number | null; confidence: string; indicative_cost_eur_per_tco2e: number | null; co_benefits: string; trade_offs: string; flag?: number; capex_eur?: number | null; opex_delta_eur_per_yr?: number | null; lifetime_yr?: number | null; ramp_years?: number | null; value_status?: string };
type LeverResult = { tco2e: number | null; basis: 'recomputed' | 'ceiling' | 'catalogue_estimate'; how: Text; ceiling: number | null; contributors: Contribution[] };

const NOT_REDUCTION = new Set(['L05', 'L26', 'L27']); // structural or measurement changes (TASKS_AND_SCORING B)
const LEVER_OWNER: Record<string, Text> = {
  scope1: { en: 'Site energy manager', fi: 'Toimipaikan energiavastaava' },
  scope3_cat1: { en: 'Procurement and field advisor', fi: 'Hankinnat ja viljelyneuvoja' },
  scope3_cat4_cat9: { en: 'Logistics', fi: 'Logistiikka' },
  scope3_cat4: { en: 'Logistics', fi: 'Logistiikka' },
  scope3_cat6: { en: 'HR / travel', fi: 'Henkilöstöhallinto / matkat' },
  scope3_cat7: { en: 'HR', fi: 'Henkilöstöhallinto' },
  scope3_cat5: { en: 'Site environmental lead', fi: 'Toimipaikan ympäristövastaava' },
};

function leverEffect(run: RunRow, lever: Lever, cs: Contribution[], names: Map<string, string>): LeverResult | null {
  const sumT = (xs: Contribution[]) => r1(xs.reduce((s, c) => s + c.tco2e, 0));
  const efValue = (id: string) => {
    const factors = run.factor_versions.emission_factor_library;
    // Match the inventory's last-entry-wins selection within this frozen library.
    const factor = Array.isArray(factors) ? factors.findLast(f => f.ef_id === id) : undefined;
    const value = factor?.value == null ? NaN : Number(factor.value);
    return Number.isFinite(value) ? value : null;
  };
  const toBiogas = (site: string, fuels: string[]): LeverResult | null => {
    const burn = cs.filter((c) => c.category === 'stationary_and_mobile_combustion' && fuels.some((f) => c.line_item === `${site}:${f}`));
    if (!burn.length) return null;
    const wtt = cs.filter((c) => c.category === 'cat03_fuel_energy' && fuels.some((f) => c.line_item === `wtt:${site}:${f}`));
    const mwh = burn.reduce((s, c) => s + num(c.inputs.mwh), 0);
    const biogasWtt = efValue('EF-WTT-BIOGAS');
    if (biogasWtt === null) return null;
    const saved = sumT(burn) + sumT(wtt) - (mwh * biogasWtt) / 1000;
    return { tco2e: r1(-saved), basis: 'recomputed', ceiling: null, contributors: [...burn, ...wtt], how: { en: `${fmt(mwh, 'en', 0)} MWh of ${fuels.join('/')} at ${site} burnt as biogas (fossil CO₂ to biogenic, supply chain at the biogas factor)`, fi: `${fmt(mwh, 'fi', 0)} MWh ${fuels.join('/')} toimipaikalla ${site} korvattuna biokaasulla (fossiilinen CO₂ biogeeniseksi, tuotantoketju biokaasun kertoimella)` } };
  };
  switch (lever.lever_id) {
    case 'L01': return toBiogas('S-SAK', ['lng', 'lpg']);
    case 'L07': return toBiogas('S-BJU', ['natural_gas']);
    case 'L03': {
      const r404 = cs.filter((c) => c.category === 'fugitive_refrigerants' && c.inputs.refrigerant === 'R404A');
      if (!r404.length) return null;
      return { tco2e: r1(-sumT(r404)), basis: 'recomputed', ceiling: null, contributors: r404, how: { en: 'R404A top-ups replaced by ammonia (GWP 0)', fi: 'R404A-täydennykset korvattuna ammoniakilla (GWP 0)' } };
    }
    case 'L20': {
      const hvo = efValue('EF-TKM-TRUCK-HVO');
      const legs = cs.filter((c) => c.kind === 'transport_leg' && /^EF-TKM-TRUCK(?!-HVO)/.test(c.factor_id));
      if (hvo === null || !legs.length) return null;
      const tkm = legs.reduce((s, c) => s + num(c.inputs.tkm), 0);
      const saved = legs.reduce((s, c) => s + (num(c.inputs.tkm) * (c.factor_value - hvo)) / 1000, 0);
      return { tco2e: r1(-saved), basis: 'recomputed', ceiling: null, contributors: legs, how: { en: `${fmt(tkm, 'en', 0)} truck tkm at the HVO100 factor (${hvo} kg/tkm)`, fi: `${fmt(tkm, 'fi', 0)} rekka-tkm HVO100-kertoimella (${hvo} kg/tkm)` } };
    }
    case 'L08': {
      const farms = cs.filter((c) => c.kind === 'contract_farm' && !c.inputs.lowcarbon_fert);
      if (!farms.length) return null;
      const saved = farms.reduce((s, c) => s + (num(c.inputs.n_mineral_kg_ha) * (FARM_EF.fert_n_prod - FARM_EF.fert_n_prod_lowcarbon) * num(c.inputs.area_ha)) / 1000, 0);
      return { tco2e: r1(-saved), basis: 'recomputed', ceiling: null, contributors: farms, how: { en: `mineral N on ${farms.length} contract-farm footprints at the low-carbon production factor (${FARM_EF.fert_n_prod_lowcarbon} instead of ${FARM_EF.fert_n_prod} kg CO₂e/kg N)`, fi: `mineraalityppi ${farms.length} sopimustilan jalanjäljessä vähähiilisen valmistuksen kertoimella (${FARM_EF.fert_n_prod_lowcarbon} eikä ${FARM_EF.fert_n_prod} kg CO₂e/kg N)` } };
    }
  }
  const material = (test: (name: string) => boolean) => cs.filter((c) => c.kind === 'material_purchase' && test(names.get(String(c.inputs.material_id)) || ''));
  const farmPart = (parts: string[]) => r1(cs.filter((c) => c.kind === 'contract_farm').reduce((s, c) => s + parts.reduce((p, k) => p + num(((c.inputs.breakdown_kg_per_ha as Record<string, number>) || {})[k]) * num(c.inputs.area_ha), 0) / 1000, 0));
  const ceilings: Record<string, () => { t: number; xs: Contribution[]; what: Text } | null> = {
    L04: () => { const xs = cs.filter((c) => c.category === 'fugitive_refrigerants'); return { t: sumT(xs), xs, what: { en: 'all refrigerant leaks', fi: 'kaikki kylmäainevuodot' } }; },
    L06: () => { const xs = cs.filter((c) => c.category === 'stationary_and_mobile_combustion' && c.line_item.startsWith('S-KAN:')); return { t: sumT(xs), xs, what: { en: 'fuel burnt at Kantvik', fi: 'Kantvikin polttoaineet' } }; },
    L09: () => ({ t: farmPart(['fertiliser', 'n2o_direct', 'n2o_indirect']), xs: cs.filter((c) => c.kind === 'contract_farm'), what: { en: 'fertiliser and field N₂O of contract farms', fi: 'sopimustilojen lannoitteet ja peltojen N₂O' } }),
    L11: () => ({ t: farmPart(['organic_soil']), xs: cs.filter((c) => c.kind === 'contract_farm'), what: { en: 'drained peat soils of contract farms', fi: 'sopimustilojen ojitetut turvemaat' } }),
    L13: () => { const xs = material((n) => /rapeseed/i.test(n)); return { t: sumT(xs), xs, what: { en: 'purchased rapeseed', fi: 'ostettu rypsi/rapsi' } }; },
    L14: () => { const xs = material((n) => /rapeseed import/i.test(n)); return { t: sumT(xs), xs, what: { en: 'imported rapeseed', fi: 'tuotu rapsi' } }; },
    L16: () => { const xs = material((n) => /cheese|ham|meat/i.test(n)); return { t: sumT(xs), xs, what: { en: 'cheese and meat purchases', fi: 'juusto- ja lihaostot' } }; },
    L17: () => { const xs = material((n) => /soy/i.test(n)); return { t: sumT(xs), xs, what: { en: 'soy protein isolate', fi: 'soijaproteiini-isolaatti' } }; },
    L18: () => { const xs = material((n) => /pet|bottle|cap/i.test(n)); return { t: sumT(xs), xs, what: { en: 'bottles and caps', fi: 'pullot ja korkit' } }; },
    L19: () => { const xs = material((n) => /film/i.test(n)); return { t: sumT(xs), xs, what: { en: 'packaging film', fi: 'pakkauskalvo' } }; },
    L28: () => { const xs = cs.filter((c) => c.category === 'cat06_business_travel'); return { t: sumT(xs), xs, what: { en: 'business travel', fi: 'työmatkat' } }; },
    L29: () => { const xs = cs.filter((c) => c.category === 'cat07_employee_commuting'); return { t: sumT(xs), xs, what: { en: 'commuting', fi: 'työmatkaliikenne' } }; },
    L30: () => { const xs = cs.filter((c) => c.category === 'cat05_waste'); return { t: sumT(xs), xs, what: { en: 'waste', fi: 'jätteet' } }; },
  };
  const c = ceilings[lever.lever_id]?.();
  if (c && c.t > 0) return { tco2e: null, basis: 'ceiling', ceiling: c.t, contributors: c.xs, how: c.what };
  return { tco2e: null, basis: 'catalogue_estimate', ceiling: null, contributors: [], how: { en: 'no rule maps this lever to our inventory yet', fi: 'toimenpidettä ei vielä ole kytketty inventaarioon' } };
}

function materialNames(db: DB) {
  const m = new Map<string, string>();
  for (const r of all<{ id: string; name: string }>(db, "SELECT json_extract(payload_json, '$.material_id') AS id, COALESCE(json_extract(payload_json, '$.name_en'), '') AS name FROM source_records WHERE table_name = 'materials' ORDER BY id")) m.set(r.id, r.name);
  return m;
}

export function leverCatalogue(natureCfg: NatureConfig): Lever[] {
  return withNature(natureCfg, (ndb) => ndb.prepare('SELECT * FROM action_lever ORDER BY lever_id').all() as Lever[]);
}

export function leverEffects(db: DB, run: RunRow, levers: Lever[], cs = contributions(db, run.id)) {
  const names = materialNames(db);
  return levers.filter((l) => !NOT_REDUCTION.has(l.lever_id)).map((lever) => ({ lever, result: leverEffect(run, lever, cs, names) })).filter((x): x is { lever: Lever; result: LeverResult } => !!x.result);
}

function mineReductions(db: DB, run: RunRow, cs: Contribution[], levers: Lever[]): Candidate[] {
  const out: Candidate[] = [];
  for (const { lever, result } of leverEffects(db, run, levers, cs)) {
    const catalogue = lever.abatement_tco2e_2030_design === null ? null : Number(lever.abatement_tco2e_2030_design);
    const issueT = openIssueT(result.contributors);
    const baseT = result.contributors.reduce((sum, x) => sum + x.tco2e, 0);
    const issueShare = baseT > 0 ? issueT / baseT : 0;
    const shaky: Text = issueShare > 0.5
      ? both((l) => l === 'fi' ? ` ${fmt(issueShare * 100, l, 0)} % tästä perustuu riveihin, joissa on avoin laatuhavainto; korjaa ne ensin.` : ` ${fmt(issueShare * 100, l, 0)} % of this rests on records with open data issues; fix those first.`)
      : { en: '', fi: '' };
    const exceeds = result.basis === 'ceiling' && catalogue !== null && result.ceiling !== null && catalogue > result.ceiling;
    const name = lever.name;
    const base: Text = result.basis === 'recomputed'
      ? both((l) => l === 'fi' ? `${name}: ${result.tco2e! > 0 ? 'lisäisi' : 'vähentäisi'} noin ${fmt(Math.abs(result.tco2e!), l, 0)} t CO₂e vuodessa, laskettuna omasta vuoden ${run.year} datastamme (${result.how.fi}).` : `${name} would ${result.tco2e! > 0 ? 'increase emissions by' : 'cut'} about ${fmt(Math.abs(result.tco2e!), l, 0)} t CO₂e a year, recomputed from our own ${run.year} data (${result.how.en}).`)
      : result.basis === 'ceiling'
        ? both((l) => l === 'fi' ? `${name}: luettelon arvio on ${fmt(catalogue, l, 0)} t CO₂e; inventaariossamme on ${fmt(result.ceiling, l, 0)} t kohteessa ${result.how.fi}.${exceeds ? ' Arvio on suurempi kuin päästöt, joihin toimenpide voi vaikuttaa.' : ''}` : `${name}: the catalogue expects ${fmt(catalogue, l, 0)} t CO₂e; our inventory has ${fmt(result.ceiling, l, 0)} t on ${result.how.en}.${exceeds ? ' The estimate is larger than the emissions this lever can act on.' : ''}`)
        : both((l) => l === 'fi' ? `${name}: luettelon arvio on ${fmt(catalogue, l, 0)} t CO₂e vuodessa (suunnitteluarvio, ei laskettu omasta datastamme).` : `${name}: the catalogue estimates ${fmt(catalogue, l, 0)} t CO₂e a year (design estimate, not recomputed from our data).`);
    const found: Text = { en: base.en + shaky.en, fi: base.fi + shaky.fi };
    const suggest = both((l) => l === 'fi'
      ? `Selvitä toteutettavuus${lever.earliest_start ? ` (aikaisintaan ${lever.earliest_start})` : ''}; luotettavuus ${lever.confidence}${lever.indicative_cost_eur_per_tco2e !== null ? `, suuntaa-antava hinta ${fmt(lever.indicative_cost_eur_per_tco2e, l, 0)} €/t` : ''}.`
      : `Assess feasibility${lever.earliest_start ? ` (earliest start ${lever.earliest_start})` : ''}; confidence ${lever.confidence}${lever.indicative_cost_eur_per_tco2e !== null ? `, indicative cost ${fmt(lever.indicative_cost_eur_per_tco2e, l, 0)} €/t` : ''}.`);
    out.push({
      key: `red:${lever.lever_id}:${run.year}`, expert: 'reduction_advisor', kind: `lever_${result.basis}`,
      // Effects that mostly rest on suspected data errors rank lower than clean ones.
      priority: (1 - issueShare) * (result.basis === 'recomputed' ? Math.abs(result.tco2e!) : result.basis === 'ceiling' ? Math.min(catalogue ?? 0, result.ceiling ?? 0) * 0.5 : (catalogue ?? 0) * 0.1),
      facts: { lever_id: lever.lever_id, lever: name, year: run.year, basis: result.basis, share_on_open_issues_pct: round(issueShare * 100, 0), recomputed_tco2e: result.tco2e, catalogue_tco2e_2030: catalogue, addressable_tco2e: result.ceiling, catalogue_exceeds_addressable: exceeds, how: result.how.en, earliest_start: lever.earliest_start, confidence: lever.confidence, cost_eur_per_tco2e: lever.indicative_cost_eur_per_tco2e, co_benefits: lever.co_benefits, trade_offs: lever.trade_offs, tco2e_on_open_issues: issueT },
      template: { found, suggest },
      who: LEVER_OWNER[lever.scope] || { en: 'Sustainability team', fi: 'Vastuullisuustiimi' },
      effect: {
        tco2e: result.tco2e, basis: result.basis, share_pct: result.tco2e !== null ? pct(result.tco2e, num(run.totals.grand_total)) : null,
        catalogue_tco2e: catalogue, ceiling_tco2e: result.ceiling, open_issue_tco2e: issueT,
        note: result.basis === 'recomputed' ? { en: 'Recomputed from our data', fi: 'Laskettu omasta datasta' } : result.basis === 'ceiling' ? { en: 'Catalogue estimate, not recomputed; our addressable emissions shown', fi: 'Luettelon arvio, ei laskettu; vaikutettavissa olevat päästömme näytetään' } : { en: 'Catalogue estimate, not recomputed', fi: 'Luettelon arvio, ei laskettu' },
      },
      action: { to: `/nature?tab=queries&query=21_action_details`, label: { en: 'See lever details', fi: 'Katso toimenpiteen tiedot' } },
      evidence: [{ id: `lever:${lever.lever_id}`, label: `${lever.lever_id} ${name}`, value: result.basis === 'recomputed' ? `recomputed ${result.tco2e} tCO2e (${result.how.en})` : `catalogue ${catalogue} tCO2e (design estimate)${result.ceiling !== null ? `; addressable ${result.ceiling} tCO2e` : ''}`, link: '/nature?tab=queries&query=21_action_details' }],
    });
  }
  return out.sort((a, b) => b.priority - a.priority);
}

// ---------------------------------------------------------------- entry point

const PER_EXPERT = 4;

export function mine(db: DB, natureCfg: NatureConfig, year: number, opts: { experts?: ExpertId[]; perExpert?: number } = {}): MineResult {
  const found = discoveryRun(db, year);
  if (!found) return { year, run: null, demo: false, candidates: [], notes: [`No saved inventory calculation for ${year}. Calculate it first.`] };
  const { run, demo } = found;
  const cs = contributions(db, run.id);
  const notes: string[] = [];
  if (cs.some((c) => c.kind === 'contract_farm' && !c.inputs.breakdown_kg_per_ha)) notes.push('This saved calculation predates farm component storage. Recalculate to see farm drivers and the FLAG split.');
  if (demo) notes.push(`The ${year} calculation contains synthetic DEMO inputs.`);
  let levers: Lever[] = [];
  if (!opts.experts || opts.experts.includes('reduction_advisor')) try {
    levers = leverCatalogue(natureCfg);
  } catch (e) {
    notes.push(`Reduction levers unavailable: ${(e as Error).message}`);
  }
  const want = (e: ExpertId) => !opts.experts || opts.experts.includes(e);
  // Feed order: fix the data first, then understand the footprint, then act on it.
  const groups = [
    want('data_quality_reviewer') ? mineDataQuality(db, run, cs) : [],
    want('footprint_analyst') ? mineFootprint(db, run, cs) : [],
    want('raw_materials_analyst') ? mineRawMaterials(run, cs) : [],
    want('reduction_advisor') ? mineReductions(db, run, cs, levers) : [],
  ];
  const candidates = groups.flatMap((g) => [...g].sort((a, b) => b.priority - a.priority).slice(0, opts.perExpert ?? PER_EXPERT));
  return { year, run: { id: run.id, year: run.year, created_at: run.created_at, totals: run.totals }, demo, candidates, notes };
}

// Known datasets: header signature for detection, record-key format (matching the challenge
// scoring keys in TASKS_AND_SCORING.md), reporting-year extraction and numeric columns.
// Unknown files can still be imported under an explicit custom dataset name.
import { parseNumber, yearFromDate } from './util.ts';

export type RowObject = Record<string, string>;

export type DatasetDef = {
  id: string;
  label: string;
  group: 'master' | 'activity' | 'transport' | 'farming' | 'reference' | 'report';
  ids: string[];
  required: string[];
  numeric: string[];
  key: (r: RowObject) => string;
  year: (r: RowObject) => number | null;
  file?: RegExp;
};

const y = (field: string) => (r: RowObject) => {
  const n = parseNumber(r[field]);
  return n !== null && Number.isInteger(n) ? n : yearFromDate(r[field]);
};
const none = () => null;
const pad2 = (v: string) => String(v ?? '').trim().padStart(2, '0');

export const DATASETS: DatasetDef[] = [
  { id: 'sites', ids: ['site_id'], label: 'Sites', group: 'master', required: ['site_id', 'name', 'country'], numeric: ['lat', 'lon'], key: (r) => `site:${r.site_id}`, year: none, file: /^sites/ },
  { id: 'materials', ids: ['material_id'], label: 'Material master', group: 'master', required: ['material_id', 'material_group', 'base_uom', 'default_ef_id'], numeric: [], key: (r) => `material:${r.material_id}`, year: none, file: /^materials/ },
  { id: 'suppliers', ids: ['supplier_id'], label: 'Supplier master', group: 'master', required: ['supplier_id', 'supplier_name', 'country'], numeric: [], key: (r) => `supplier:${r.supplier_id}`, year: none, file: /^suppliers/ },
  { id: 'emission_factors', ids: ['ef_id'], label: 'Emission factor library', group: 'master', required: ['ef_id', 'unit', 'kgco2e_per_unit'], numeric: ['kgco2e_per_unit', 'flag_share'], key: (r) => `ef:${r.ef_id}`, year: none, file: /emission_factor/ },
  { id: 'farm_registry', ids: ['farm_id'], label: 'Farm registry', group: 'master', required: ['farm_id', 'segment', 'region', 'lat', 'lon'], numeric: ['lat', 'lon', 'joined_year'], key: (r) => `farm:${r.farm_id}`, year: none, file: /^farm_registry/ },
  { id: 'parcels', ids: ['parcel_id', 'farm_id'], label: 'Parcels', group: 'master', required: ['parcel_id', 'farm_id', 'area_ha', 'soil_class_soilmap'], numeric: ['lat', 'lon', 'area_ha', 'clay_pct_soilmap', 'slope_pct', 'dist_to_water_m', 'p_test_mgl_latest'], key: (r) => `parcel:${r.parcel_id}`, year: none, file: /^parcels/ },
  { id: 'climate_grid_cells', ids: ['cell_id'], label: 'Climate grid cells', group: 'reference', required: ['cell_id', 'region', 'lat', 'lon', 'continentality'], numeric: ['lat', 'lon'], key: (r) => `cell:${r.cell_id}`, year: none },
  { id: 'erp_purchase_lines', ids: ['doc_no', 'line_no'], label: 'ERP purchase lines', group: 'activity', required: ['doc_no', 'line_no', 'posting_date', 'material_id', 'supplier_id', 'quantity', 'uom'], numeric: ['quantity', 'net_amount'], key: (r) => `erp:${r.doc_no}:${r.line_no}`, year: (r) => yearFromDate(r.posting_date), file: /^erp_purchase/ },
  { id: 'shipments', ids: ['shipment_id'], label: 'Shipments (transport legs)', group: 'transport', required: ['shipment_id', 'year', 'direction', 'ref_doc', 'ef_id', 'mode', 't', 'km'], numeric: ['t', 'km', 'tkm'], key: (r) => `ship:${r.shipment_id}`, year: y('year'), file: /^shipments/ },
  { id: 'energy_meter_readings', ids: ['site_id', 'year', 'month', 'carrier'], label: 'Energy meter readings', group: 'activity', required: ['site_id', 'year', 'month', 'carrier', 'value', 'unit'], numeric: ['value'], key: (r) => `energy:${r.site_id}:${r.year}-${pad2(r.month)}:${r.carrier}`, year: y('year'), file: /^energy_meter/ },
  { id: 'fuel_deliveries', ids: ['delivery_id'], label: 'Fuel deliveries', group: 'activity', required: ['delivery_id', 'site_id', 'carrier', 'delivery_date', 'quantity', 'unit'], numeric: ['quantity'], key: (r) => `fuel:${r.delivery_id}`, year: (r) => parseNumber(r.year) ?? yearFromDate(r.delivery_date), file: /^fuel_deliveries/ },
  { id: 'fuel_stock_changes', ids: ['site_id', 'carrier', 'year'], label: 'Fuel stock changes', group: 'activity', required: ['site_id', 'carrier', 'year', 'stock_change'], numeric: ['stock_change'], key: (r) => `fuel_stock:${r.site_id}:${r.carrier}:${r.year}`, year: y('year'), file: /^fuel_stock/ },
  { id: 'goo_cancellations', ids: ['site_id', 'year'], label: 'GoO cancellations (internal log)', group: 'activity', required: ['year', 'site_id', 'mwh_cancelled', 'vintage_year'], numeric: ['mwh_cancelled'], key: (r) => `goo:${r.site_id}:${r.year}`, year: y('year'), file: /^goo_cancellations/ },
  { id: 'goo_registry', ids: ['cancellation_id'], label: 'GoO registry statement', group: 'activity', required: ['cancellation_id', 'consumption_year', 'beneficiary_site', 'mwh'], numeric: ['mwh'], key: (r) => `goo_registry:${r.cancellation_id}`, year: y('consumption_year'), file: /^goo_registry/ },
  { id: 'heat_supplier_factors', ids: ['site_id', 'year'], label: 'Heat supplier factors', group: 'activity', required: ['site_id', 'year', 't_per_mwh'], numeric: ['t_per_mwh'], key: (r) => `heat:${r.site_id}:${r.year}`, year: y('year'), file: /^heat_supplier/ },
  { id: 'refrigerant_service_log', ids: ['event_id'], label: 'Refrigerant service log', group: 'activity', required: ['site_id', 'refrigerant', 'year', 'event_id', 'kg_added'], numeric: ['kg_added'], key: (r) => `refrigerant:${r.event_id}`, year: y('year'), file: /^refrigerant/ },
  { id: 'waste_transfer_notes', ids: ['transfer_note'], label: 'Waste transfer notes', group: 'activity', required: ['transfer_note', 'site_id', 'year', 'waste_stream', 'treatment', 'quantity', 'unit'], numeric: ['quantity'], key: (r) => `waste:${r.transfer_note}`, year: y('year'), file: /^waste_transfer/ },
  { id: 'wastewater_third_party', ids: ['site_id', 'year'], label: 'Wastewater to third party', group: 'activity', required: ['year', 'site_id', 'm3'], numeric: ['m3'], key: (r) => `wastewater:${r.site_id}:${r.year}`, year: y('year'), file: /^wastewater/ },
  { id: 'water_balance', ids: ['site_id', 'year'], label: 'Water balance', group: 'activity', required: ['site_id', 'year', 'flow', 'source_or_destination', 'm3'], numeric: ['m3'], key: (r) => `water:${r.site_id}:${r.year}:${r.flow}:${r.source_or_destination}`, year: y('year'), file: /^water_balance/ },
  { id: 'travel_bookings', ids: ['booking_id'], label: 'Travel bookings', group: 'activity', required: ['year', 'traveller_id', 'travel_date', 'mode', 'pkm', 'booking_id'], numeric: ['pkm', 'nights'], key: (r) => `travel:${r.booking_id}`, year: (r) => parseNumber(r.year) ?? yearFromDate(r.travel_date), file: /^travel/ },
  { id: 'commuting_survey', ids: ['response_id'], label: 'Commuting survey', group: 'activity', required: ['response_id', 'site_id', 'one_way_km', 'mode', 'days_on_site_per_week'], numeric: ['one_way_km', 'days_on_site_per_week'], key: (r) => `commute:${r.response_id}`, year: none, file: /^commuting/ },
  { id: 'headcount', ids: ['site_id', 'year'], label: 'Headcount', group: 'activity', required: ['year', 'site_id', 'headcount'], numeric: ['headcount'], key: (r) => `headcount:${r.site_id}:${r.year}`, year: y('year'), file: /^headcount/ },
  { id: 'frozen_warehousing', ids: ['year'], label: 'Frozen warehousing', group: 'transport', required: ['year', 'pallet_days'], numeric: ['pallet_days'], key: (r) => `warehousing:${r.year}`, year: y('year'), file: /^frozen_warehousing/ },
  { id: 'sales_volumes', ids: ['year', 'month', 'product_group', 'market'], label: 'Sales volumes', group: 'activity', required: ['year', 'month', 'product_group', 'market', 't_sold'], numeric: ['t_sold', 'net_sales_eur'], key: (r) => `sales:${r.year}-${pad2(r.month)}:${r.product_group}:${r.site_id}:${r.market}`, year: y('year'), file: /^sales_volumes/ },
  { id: 'capex_projects', ids: ['year', 'project'], label: 'Capex projects', group: 'activity', required: ['year', 'site_id', 'project', 'capex_eur'], numeric: ['capex_eur'], key: (r) => `capex:${r.year}:${r.site_id}:${r.project}`, year: y('year'), file: /^capex/ },
  { id: 'farm_survey', ids: ['survey_id', 'farm_id'], label: 'Farm survey (FI)', group: 'farming', required: ['survey_id', 'farm_id', 'crop', 'year', 'area_ha', 'yield_t_ha'], numeric: ['area_ha', 'n_mineral_kg_ha', 'n_manure_kg_ha', 'p_kg_ha', 'diesel_l_ha', 'lime_t_ha', 'sprays', 'catch_crop_share', 'yield_t_ha'], key: (r) => `farm_survey:${r.survey_id}`, year: y('year'), file: /^farm_survey/ },
  { id: 'foodhills_grower_data', ids: ['odlar_id', 'skördeår'], label: 'Foodhills grower data (SE)', group: 'farming', required: ['odlar_id', 'skördeår', 'gröda', 'areal_ha'], numeric: ['areal_ha', 'levererad_mängd_ton', 'kvävegiva_kg_ha', 'diesel_l_ha'], key: (r) => `se_grower:${r.odlar_id}:${r['skördeår']}:${r['gröda']}`, year: y('skördeår'), file: /^foodhills/ },
  { id: 'parcel_crop_history', ids: ['parcel_id', 'year'], label: 'Parcel crop history and plan', group: 'farming', required: ['parcel_id', 'farm_id', 'year', 'crop', 'status'], numeric: [], key: (r) => `crop:${r.parcel_id}:${r.year}`, year: y('year'), file: /^parcel_crop/ },
  { id: 'current_calculator_footprints', ids: ['farm_id', 'crop', 'year'], label: 'Current calculator footprints', group: 'farming', required: ['farm_id', 'crop', 'year', 'carbon_footprint_kgco2e_per_kg'], numeric: ['carbon_footprint_kgco2e_per_kg'], key: (r) => `calc_fp:${r.farm_id}:${r.crop}:${r.year}`, year: y('year'), file: /^current_calculator/ },
  { id: 'supplier_pcf', ids: ['supplier_id', 'material_id', 'year'], label: 'Supplier PCF (PACT JSON)', group: 'activity', required: ['supplier_id', 'material_id', 'year', 'pcf_value', 'declared_unit'], numeric: ['pcf_value'], key: (r) => `pcf:${r.supplier_id}:${r.material_id}:${r.year}`, year: y('year') },
  { id: 'draft_report_summary', ids: ['year', 'line'], label: 'Draft report summary', group: 'report', required: ['year', 'line', 'tco2e'], numeric: ['tco2e'], key: (r) => `report:${r.year}:${r.line}`, year: y('year'), file: /^draft_report/ },
  { id: 'published_inventory_history', ids: ['year'], label: 'Published inventory history', group: 'report', required: ['year', 'scope1', 'scope2_market', 'scope3'], numeric: ['scope1', 'scope2_market', 'scope3'], key: (r) => `published:${r.year}`, year: y('year'), file: /^published_inventory/ },
  { id: 'source_registry', ids: ['source'], label: 'Source registry', group: 'reference', required: ['source', 'url', 'licence', 'used_for'], numeric: [], key: (r) => `source:${r.source}`, year: none, file: /^source_registry/ },
  { id: 'catchments', ids: ['catchment_id'], label: 'Catchments', group: 'reference', required: ['catchment_id', 'region', 'receiving_water_type', 'ecological_status_class'], numeric: [], key: (r) => `catchment:${r.catchment_id}`, year: none, file: /^catchments/ },
  // Benchmarks published with the challenge package (2023/2024 truths) for reconciliation.
  { id: 'benchmark_inventory', ids: ['year', 'scope', 'category'], label: 'Benchmark inventory (dev truth)', group: 'report', required: ['year', 'scope', 'category', 'tco2e'], numeric: ['tco2e'], key: (r) => `benchmark:${r.year}:${r.scope}:${r.category}`, year: y('year'), file: /^A2_dev_inventory/ },
];

export const DATASET_BY_ID = new Map(DATASETS.map((d) => [d.id, d]));

const CUSTOM_RE = /^custom_[a-z0-9_]{2,40}$/;

export function customDataset(id: string): DatasetDef | null {
  if (!CUSTOM_RE.test(id)) return null;
  let n = 0;
  return { id, label: id, group: 'reference', ids: [], required: [], numeric: [], key: () => `${id}:row${++n}`, year: none };
}

export function resolveDataset(id: string): DatasetDef | null {
  return DATASET_BY_ID.get(id) || customDataset(id);
}

// Picks the dataset whose required columns are all present; ties go to the filename hint,
// then to the dataset with more required columns (the more specific signature).
export function detectDataset(headers: string[], filename: string): { dataset: DatasetDef | null; candidates: string[] } {
  const set = new Set(headers.map((h) => h.trim()));
  const base = filename.split('/').pop()?.toLowerCase() || '';
  const matches = DATASETS.filter((d) => d.required.every((c) => set.has(c)));
  matches.sort((a, b) => {
    const fa = a.file?.test(base) ? 1 : 0;
    const fb = b.file?.test(base) ? 1 : 0;
    if (fa !== fb) return fb - fa;
    return b.required.length - a.required.length;
  });
  return { dataset: matches[0] || null, candidates: matches.map((m) => m.id) };
}

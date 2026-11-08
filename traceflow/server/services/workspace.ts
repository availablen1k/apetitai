// Workspace data for the farm, climate, weather, forecast, settings and report pages.
// Everything is derived from imported records or stored in the local documents table;
// values that cannot be derived locally are returned as null, never invented.
import fs from 'node:fs';
import { type DB, all, get, json, nowIso, run, tx } from '../db/database.ts';
import { groupBy, median, newId, parseBool, parseNumber, round } from '../domain/util.ts';
import { REGIONS, fetchForecastBatch, fetchRegionalForecast, type ForecastDay } from '../providers/openmeteo.ts';
import { HttpError } from './common.ts';
import { loadTable } from './data.ts';

// ---------------------------------------------------------------- documents
export const COLLECTIONS = new Set(['consultant_tasks', 'farm_alerts', 'app_settings', 'reports', 'automation_runs', 'weather_years']);

const assertCollection = (c: string) => {
  if (!COLLECTIONS.has(c)) throw new HttpError(404, `Unknown collection ${c}`);
};

export type Doc = Record<string, unknown> & { id: string; created_date: string; updated_date: string };

export function listDocs(db: DB, collection: string, filter: Record<string, string> = {}, opts: { sort?: string; limit?: number } = {}): Doc[] {
  assertCollection(collection);
  let rows = all<{ id: string; data_json: string; created_date: string; updated_date: string }>(db, 'SELECT id, data_json, created_date, updated_date FROM documents WHERE collection = ?', collection)
    .map((r) => ({ ...json<Record<string, unknown>>(r.data_json, {}), id: r.id, created_date: r.created_date, updated_date: r.updated_date }) as Doc);
  for (const [k, v] of Object.entries(filter)) rows = rows.filter((r) => String(r[k] ?? '') === v);
  const sort = opts.sort || '-created_date';
  const desc = sort.startsWith('-');
  const key = sort.replace(/^-/, '');
  rows.sort((a, b) => {
    const x = a[key] as string | number;
    const y = b[key] as string | number;
    return (x > y ? 1 : x < y ? -1 : 0) * (desc ? -1 : 1);
  });
  return rows.slice(0, Math.min(opts.limit || 200, 1000));
}

const RESERVED = new Set(['id', 'created_date', 'updated_date']);
const clean = (data: Record<string, unknown>) => Object.fromEntries(Object.entries(data).filter(([k]) => !RESERVED.has(k)));

export function createDoc(db: DB, collection: string, data: Record<string, unknown>): Doc {
  assertCollection(collection);
  const id = newId(collection.slice(0, 4));
  const at = nowIso();
  run(db, 'INSERT INTO documents (collection, id, data_json, created_date, updated_date) VALUES (?, ?, ?, ?, ?)', collection, id, JSON.stringify(clean(data)), at, at);
  return getDoc(db, collection, id);
}

export function getDoc(db: DB, collection: string, id: string): Doc {
  assertCollection(collection);
  const r = get<{ id: string; data_json: string; created_date: string; updated_date: string }>(db, 'SELECT * FROM documents WHERE collection = ? AND id = ?', collection, id);
  if (!r) throw new HttpError(404, `${collection}/${id} not found`);
  return { ...json<Record<string, unknown>>(r.data_json, {}), id: r.id, created_date: r.created_date, updated_date: r.updated_date };
}

export function updateDoc(db: DB, collection: string, id: string, patch: Record<string, unknown>): Doc {
  const current = getDoc(db, collection, id);
  const merged = { ...clean(current), ...clean(patch) };
  run(db, 'UPDATE documents SET data_json = ?, updated_date = ? WHERE collection = ? AND id = ?', JSON.stringify(merged), nowIso(), collection, id);
  return getDoc(db, collection, id);
}

export function deleteDoc(db: DB, collection: string, id: string) {
  getDoc(db, collection, id);
  run(db, 'DELETE FROM documents WHERE collection = ? AND id = ?', collection, id);
}

// ---------------------------------------------------------------- weather years / climate statistics
// tmp/region_rows.json: regional annual aggregates of weather_daily_1991_2060.parquet that were
// prepared in the earlier version of this project. Loaded once by `npm run setup`.
export function seedWeatherYears(db: DB, file: string): { loaded: number; skipped: boolean } {
  if (!fs.existsSync(file)) return { loaded: 0, skipped: true };
  const existing = Number(get<{ n: number }>(db, `SELECT COUNT(*) AS n FROM documents WHERE collection = 'weather_years'`)?.n || 0);
  if (existing) return { loaded: existing, skipped: true };
  const rows = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>[];
  tx(db, () => {
    for (const r of rows) createDoc(db, 'weather_years', { ...r, source: 'tmp/region_rows.json (aggregated from weather_daily_1991_2060.parquet)' });
  });
  return { loaded: rows.length, skipped: false };
}

export function climateStats(db: DB) {
  const years = listDocs(db, 'weather_years', {}, { limit: 1000, sort: 'year' });
  const out: Record<string, unknown>[] = [];
  const mean = (xs: unknown[]) => {
    const v = xs.map((x) => Number(x)).filter((x) => Number.isFinite(x));
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  for (const [region, rows] of groupBy(years, (r) => String(r.region))) {
    const base = rows.filter((r) => r.scenario === 'historical' && Number(r.year) >= 1991 && Number(r.year) <= 2020);
    if (!base.length) continue;
    const b = {
      tmean: mean(base.map((r) => r.tmean_c)), precip: mean(base.map((r) => r.precip_mm)), gdd: mean(base.map((r) => r.gdd5)),
      hot: mean(base.map((r) => r.heat_days)), growing: mean(base.map((r) => r.frost_free_days)), wb: mean(base.map((r) => r.growing_water_balance_mm)),
    };
    const row = (scenario: string, period: string, list: Doc[], isBase: boolean) => {
      const tm = mean(list.map((r) => r.tmean_c));
      const pr = mean(list.map((r) => r.precip_mm));
      return {
        id: `${region}:${scenario}:${period}`, region, scenario, period, is_baseline: isBase, years: list.length,
        tmean_annual: tm === null ? null : round(tm, 2), precip_annual: pr === null ? null : round(pr, 0),
        gdd: round(mean(list.map((r) => r.gdd5)) ?? 0, 0), hot_days: round(mean(list.map((r) => r.heat_days)) ?? 0, 1),
        growing_days: round(mean(list.map((r) => r.frost_free_days)) ?? 0, 0), growing_water_balance_mm: round(mean(list.map((r) => r.growing_water_balance_mm)) ?? 0, 0),
        delta_temp: tm !== null && b.tmean !== null ? round(tm - b.tmean, 2) : null,
        delta_precip_pct: pr !== null && b.precip ? round(((pr - b.precip) / b.precip) * 100, 1) : null,
        drought_index: null, yield_change_pct: null, uncertainty_pct: null, crops: [], monthly: [],
        method: 'Mean of annual regional aggregates (tmp/region_rows.json); 2041–2060 vs 1991–2020. Crop yield changes are not modelled locally.',
      };
    };
    out.push(row('historical', '1991-2020', base, true));
    for (const s of ['ssp126', 'ssp245', 'ssp585']) {
      const fut = rows.filter((r) => r.scenario === s && Number(r.year) >= 2041 && Number(r.year) <= 2060);
      if (fut.length) out.push(row(s, '2041-2060', fut, false));
    }
  }
  return out;
}

// ---------------------------------------------------------------- farms
let farmCache: { key: string; farms: Map<string, Record<string, unknown>> } | null = null;

export function farms(db: DB): Map<string, Record<string, unknown>> {
  const key = String(get<{ n: number; m: string }>(db, `SELECT COUNT(*) AS n, MAX(imported_at) AS m FROM import_batches WHERE dataset IN ('farm_registry', 'parcels', 'farm_survey', 'parcel_crop_history')`)?.m || 'none');
  if (farmCache?.key === key) return farmCache.farms;
  const registry = loadTable(db, 'farm_registry');
  const parcels = groupBy(loadTable(db, 'parcels'), (p) => p.payload.farm_id);
  const survey = groupBy(loadTable(db, 'farm_survey'), (s) => s.payload.farm_id);
  const plan = new Map<string, string>();
  for (const h of loadTable(db, 'parcel_crop_history')) {
    if (h.payload.status === 'planned' && Number(h.payload.year) === 2027 && !plan.has(h.payload.farm_id)) plan.set(h.payload.farm_id, h.payload.crop);
  }
  const out = new Map<string, Record<string, unknown>>();
  for (const f of registry) {
    const p = f.payload;
    const ps = parcels.get(p.farm_id) || [];
    const area = ps.reduce((s, x) => s + (parseNumber(x.payload.area_ha) ?? 0), 0);
    const organic = ps.filter((x) => x.payload.soil_class_soilmap === 'organic').reduce((s, x) => s + (parseNumber(x.payload.area_ha) ?? 0), 0);
    const pt = ps.map((x) => parseNumber(x.payload.p_test_mgl_latest)).filter((x): x is number => x !== null);
    const sv = (survey.get(p.farm_id) || []).filter((s) => parseNumber(s.payload.yield_t_ha) !== null);
    const mainCrop = [...groupBy(sv, (s) => s.payload.crop).entries()].sort((a, b) => b[1].length - a[1].length)[0];
    const series = mainCrop ? mainCrop[1].map((s) => ({ year: Number(s.payload.year), yield: parseNumber(s.payload.yield_t_ha) })).sort((a, b) => a.year - b.year) : [];
    out.set(p.farm_id, {
      id: p.farm_id, farm_id: p.farm_id, record_id: f.id, segment: p.segment, region: p.region, country: p.country,
      lat: parseNumber(p.lat), lon: parseNumber(p.lon), organic_certified: parseBool(p.organic_certified) ?? false, livestock: parseBool(p.livestock) ?? false,
      joined_year: parseNumber(p.joined_year), contract_crops: p.contract_crops, parcel_count: ps.length, area_ha: round(area, 2),
      organic_share: area ? round((organic / area) * 100, 1) : 0, planned_crop: plan.get(p.farm_id) || null,
      avg_yield: series.length ? round(series.reduce((s, x) => s + (x.yield || 0), 0) / series.length, 2) : null,
      yield_crop: mainCrop ? mainCrop[0] : null, yield_year: series.length ? series[series.length - 1].year : null, yield_series: series,
      catchments: [...new Set(ps.map((x) => x.payload.catchment_id).filter(Boolean))], p_test_avg: pt.length ? round(median(pt), 1) : null,
      drought_risk: null, nutrient_risk: null, risk_level: null, risk_reasons: [],
      risk_note: 'Risk indices are not calculated in the local version (no validated risk model in the source data).',
    });
  }
  farmCache = { key, farms: out };
  return out;
}

export function listFarms(db: DB, f: { q?: string; region?: string; limit?: number; offset?: number }) {
  let rows = [...farms(db).values()];
  if (f.region) rows = rows.filter((r) => r.region === f.region);
  if (f.q && f.q.trim().length > 1) {
    const q = f.q.trim().toLowerCase();
    rows = rows.filter((r) => String(r.farm_id).toLowerCase().includes(q) || String(r.contract_crops || '').toLowerCase().includes(q));
  }
  const total = rows.length;
  const regionCounts = new Map<string, number>();
  for (const row of rows) {
    const region = String(row.region || 'unknown');
    regionCounts.set(region, (regionCounts.get(region) || 0) + 1);
  }
  const limit = Math.min(f.limit || 24, 500);
  const offset = f.offset || 0;
  return { total, items: rows.slice(offset, offset + limit), has_more: offset + limit < total, region_counts: Object.fromEntries(regionCounts), regions: [...new Set([...farms(db).values()].map((r) => String(r.region)))].sort() };
}

export function getFarm(db: DB, id: string) {
  const farm = farms(db).get(id);
  if (!farm) throw new HttpError(404, `Farm ${id} not found`);
  const parcels = loadTable(db, 'parcels').filter((p) => p.payload.farm_id === id).map((p) => ({
    id: p.id, parcel_id: p.payload.parcel_id, area_ha: parseNumber(p.payload.area_ha), soil_class: p.payload.soil_class_soilmap, organic: p.payload.soil_class_soilmap === 'organic',
    catchment_id: p.payload.catchment_id, buffer_strip: parseBool(p.payload.buffer_strip) ?? false, p_test: parseNumber(p.payload.p_test_mgl_latest), drainage: p.payload.drainage,
  }));
  return { farm, parcels };
}

// ---------------------------------------------------------------- forecasts
export async function regionalForecast(code: string) {
  const r = await fetchRegionalForecast(code);
  return { region: code, region_name: r.region.name, region_name_fi: r.region.nameFi, lat: r.region.lat, lon: r.region.lon, source: 'open-meteo', source_url: 'https://open-meteo.com/', fetched_at: nowIso(), forecast: r.forecast, summary: r.summary, storage: { configured: false, stored: false, rows: 0, error: null }, history: [] };
}

function scoreFarm(days: ForecastDay[], expectedPrecip: number | null, month: number) {
  const growing = month >= 4 && month <= 9;
  const frostNights = days.filter((d) => (d.tmin_c ?? 99) <= 0).length;
  const minTemp = Math.min(...days.map((d) => d.tmin_c ?? 99));
  const precip = days.reduce((s, d) => s + (d.precip_mm || 0), 0);
  const heavy = days.filter((d) => (d.precip_mm || 0) >= 10).length;
  const heat = days.filter((d) => (d.tmax_c ?? -99) >= 25).length;
  const dev = expectedPrecip && expectedPrecip > 0 ? Math.round(((precip - expectedPrecip) / expectedPrecip) * 100) : null;
  const drivers: { code: string; value: number | null }[] = [];
  let score = 0;
  const frost = growing ? (frostNights >= 3 ? 4 : frostNights >= 1 ? 2 : 0) : minTemp <= -5 ? 3 : 0;
  if (frost) { score += frost; drivers.push({ code: growing ? 'frost_nights' : 'hard_frost', value: growing ? frostNights : Math.round(minTemp) }); }
  if (dev !== null && dev <= -30) { score += dev <= -55 ? 3 : 2; drivers.push({ code: 'precip_deficit_pct', value: Math.abs(dev) }); }
  else if (dev !== null && dev >= 60) { score += 2; drivers.push({ code: 'precip_surplus_pct', value: dev }); }
  if (heavy) { score += Math.min(heavy * 2, 4); drivers.push({ code: 'heavy_rain_days', value: heavy }); }
  if (heat) { score += Math.min(heat, 2); drivers.push({ code: 'heat_days', value: heat }); }
  const rounded = Math.round(score * 10) / 10;
  return { score: rounded, level: rounded >= 4.5 ? 'high' : rounded >= 2.5 ? 'medium' : 'low', drivers, frost_nights: frostNights, precip_mm: Math.round(precip * 10) / 10, deviation_pct: dev };
}

export async function farmForecastOutlook(db: DB, code: string) {
  if (!REGIONS[code]) throw new HttpError(400, 'Unknown region');
  const r = await fetchRegionalForecast(code);
  const month = Number(new Date().toISOString().slice(5, 7));
  const list = [...farms(db).values()].filter((f) => f.region === code);
  const located = list.filter((f) => typeof f.lat === 'number' && typeof f.lon === 'number');
  const forecasts = new Map<string, ForecastDay[]>();
  for (let i = 0; i < located.length; i += 50) {
    const chunk = located.slice(i, i + 50);
    const batch = await fetchForecastBatch(chunk.map((f) => ({ lat: f.lat as number, lon: f.lon as number })));
    chunk.forEach((f, j) => batch[j]?.length && forecasts.set(String(f.id), batch[j]));
  }
  const items = list.map((f) => {
    const s = scoreFarm(forecasts.get(String(f.id)) || r.forecast, null, month);
    return { id: f.id, farm_id: f.farm_id, area_ha: f.area_ha, planned_crop: f.planned_crop, base_risk: null, ...s, local_forecast: forecasts.has(String(f.id)) };
  }).sort((a, b) => b.score - a.score || String(a.farm_id).localeCompare(String(b.farm_id)));
  const counts = { high: 0, medium: 0, low: 0 } as Record<string, number>;
  items.forEach((i) => counts[i.level]++);
  return {
    region: code, region_name: REGIONS[code].name, region_name_fi: REGIONS[code].nameFi, generated_at: nowIso(), forecast_summary: r.summary,
    conditions: { frost_nights: r.summary.frost_nights, precip_mm: r.summary.precip_mm, expected_precip_mm: null, deviation_pct: null, days: r.forecast.length, farms_with_local_forecast: forecasts.size },
    climate: { baseline_period: null, baseline_scenario: null, month, month_normal: null, monthly: [], note: 'Monthly climate normals are not available locally; precipitation deviation is not scored.' },
    forecast_month_mean: r.forecast.length ? Math.round((r.forecast.reduce((s, d) => s + (d.tmean_c || 0), 0) / r.forecast.length) * 10) / 10 : null,
    farms: { total: items.length, counts, items },
  };
}

export function sourceRegistry(db: DB) {
  return loadTable(db, 'source_registry').map((r) => ({ id: r.id, source: r.payload.source, url: r.payload.url, licence: r.payload.licence, used_for: r.payload.used_for, source_file: r.source_file, source_row: r.source_row }));
}

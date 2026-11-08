// Read-only access to the nature model database (nature_model/analysis/nature/nature.sqlite).
// The Python builders own every write; this module only opens the file with readOnly: true.
// Each call opens the file afresh, so an atomic rebuild (os.replace) is picked up immediately
// and a reader never sees a half-built database.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { NatureConfig } from '../config.ts';
import { type Row, type SqlValue, json } from '../db/database.ts';
import { HttpError } from './common.ts';
import { parseCsv } from '../domain/csv.ts';

type NDB = DatabaseSync;
type ParamRule = { type: 'integer' | 'string'; nullable?: boolean; default?: unknown; minimum?: number; maximum?: number; enum?: unknown[]; format?: string };
export type QueryDefinition = { id: string; description: string; grain: string; parameters: Record<string, ParamRule>; sql: string; lineage_sql: string };

const REQUIRED_TABLES = ['build_run', 'query_definition', 'query_run', 'query_result', 'entity_record', 'record_dependency', 'catchment'];
const RUN_DIR = /^[A-Za-z0-9][A-Za-z0-9-]{0,80}$/;

const all = <T = Row>(db: NDB, sql: string, ...params: SqlValue[]) => db.prepare(sql).all(...params) as T[];
const get = <T = Row>(db: NDB, sql: string, ...params: SqlValue[]) => db.prepare(sql).get(...params) as T | undefined;

export function natureFileState(cfg: NatureConfig) {
  try {
    const st = fs.statSync(cfg.dbPath);
    return { exists: st.isFile(), bytes: st.size, modified_at: st.mtime.toISOString() };
  } catch {
    return { exists: false, bytes: 0, modified_at: null };
  }
}

// Opens read-only, checks that it is a nature-model database and always closes it.
export function withNature<T>(cfg: NatureConfig, fn: (db: NDB) => T): T {
  if (!natureFileState(cfg).exists) throw new HttpError(409, 'The nature model database is not built. Run "Rebuild nature model" or npm run nature:build.', { state: 'not_built' });
  let db: NDB;
  try {
    db = new DatabaseSync(cfg.dbPath, { readOnly: true });
  } catch (e) {
    throw new HttpError(409, `The nature model database cannot be opened: ${(e as Error).message}`, { state: 'unreadable' });
  }
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    let present: Set<string>;
    try {
      present = new Set(all<{ name: string }>(db, "SELECT name FROM sqlite_master WHERE type IN ('table','view')").map((r) => r.name));
    } catch (e) {
      throw new HttpError(409, `The nature model database cannot be read: ${(e as Error).message}. Rebuild it.`, { state: 'unreadable' });
    }
    const missing = REQUIRED_TABLES.filter((t) => !present.has(t));
    if (missing.length) throw new HttpError(409, `The file is not a complete nature model database (missing ${missing.join(', ')}). Rebuild it.`, { state: 'unreadable' });
    return fn(db);
  } finally {
    db.close();
  }
}

export function natureStatus(cfg: NatureConfig) {
  const file = natureFileState(cfg);
  const base = { db_path: cfg.dbPath, model_dir: cfg.modelDir, model_present: fs.existsSync(path.join(cfg.modelDir, 'tools/build_nature_model.py')), ...file };
  if (!file.exists) return { ...base, state: 'not_built' as const, build: null, counts: null, message: 'Not built yet.' };
  try {
    return withNature(cfg, (db) => {
      const build = get<Row>(db, 'SELECT build_id, built_at_utc, parameters_json FROM build_run');
      const n = (sql: string) => Number(get<{ n: number }>(db, sql)?.n ?? 0);
      return {
        ...base, state: 'ready' as const, message: null,
        build: build ? { build_id: build.build_id, built_at_utc: build.built_at_utc, parameters: json(build.parameters_json, {}) } : null,
        counts: {
          farms: n('SELECT COUNT(*) AS n FROM farm'), fields: n('SELECT COUNT(*) AS n FROM parcel'), catchments: n('SELECT COUNT(*) AS n FROM catchment'),
          queries: n('SELECT COUNT(*) AS n FROM query_definition'), saved_runs: n("SELECT COUNT(*) AS n FROM query_run WHERE query_run_id NOT LIKE '%:default'"),
          quality_findings: n('SELECT COUNT(*) AS n FROM quality_finding'), reviews: n('SELECT COUNT(*) AS n FROM quality_review'), proposals: n('SELECT COUNT(*) AS n FROM correction_proposal'),
        },
      };
    });
  } catch (e) {
    if (e instanceof HttpError) return { ...base, state: 'unreadable' as const, build: null, counts: null, message: e.message };
    throw e;
  }
}

// State that a rebuild would discard (it replaces the whole file).
export function stateAtRisk(cfg: NatureConfig) {
  const s = natureStatus(cfg);
  if (s.state !== 'ready' || !s.counts) return { at_risk: false, saved_runs: 0, reviews: 0, proposals: 0 };
  const { saved_runs, reviews, proposals } = s.counts;
  return { at_risk: saved_runs + reviews + proposals > 0, saved_runs, reviews, proposals };
}

function definition(db: NDB, id: string): QueryDefinition {
  const r = get<Row>(db, 'SELECT * FROM query_definition WHERE query_id = ?', id);
  if (!r) throw new HttpError(404, `Unknown nature query: ${id}`);
  return { id: String(r.query_id), description: String(r.description), grain: String(r.grain), parameters: json(r.parameters_json, {}), sql: String(r.sql_text), lineage_sql: String(r.lineage_sql_text) };
}

// Same rules as nature_model/tools/nature_queries.py:parameters (kept in step by tests).
export function validateParameters(schema: Record<string, ParamRule>, supplied: Record<string, unknown> = {}) {
  const unknown = Object.keys(supplied).filter((k) => !(k in schema)).sort();
  if (unknown.length) throw new HttpError(400, `Unknown parameters: ${unknown.join(', ')}`);
  const result: Record<string, string | number | null> = {};
  for (const [name, rule] of Object.entries(schema)) {
    const value = name in supplied ? supplied[name] : rule.default ?? null;
    if (value === null || value === undefined) {
      if (!rule.nullable) throw new HttpError(400, `${name} must be supplied`);
      result[name] = null;
      continue;
    }
    if (rule.type === 'integer') {
      if (typeof value !== 'number' || !Number.isInteger(value)) throw new HttpError(400, `${name} must be an integer`);
      if (value < (rule.minimum ?? -1e12) || value > (rule.maximum ?? 1e12)) throw new HttpError(400, `${name} out of range`);
    } else if (rule.type === 'string') {
      if (typeof value !== 'string') throw new HttpError(400, `${name} must be a string`);
      if (rule.format === 'date') {
        const d = new Date(`${value}T00:00:00Z`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) throw new HttpError(400, `${name} must be a canonical YYYY-MM-DD date`);
      }
    }
    if (rule.enum && !rule.enum.includes(value)) throw new HttpError(400, `Invalid ${name}`);
    result[name] = value as string | number;
  }
  return result;
}

const sameParams = (a: Record<string, unknown>, b: Record<string, unknown>) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((k) => (a[k] ?? null) === (b[k] ?? null));
};

export function listQueries(cfg: NatureConfig) {
  return withNature(cfg, (db) => {
    const saved = new Map(all<{ query_id: string; n: number }>(db, "SELECT query_id, COUNT(*) AS n FROM query_run WHERE query_run_id NOT LIKE '%:default' GROUP BY query_id").map((r) => [r.query_id, r.n]));
    return all<Row>(db, 'SELECT query_id, description, grain, parameters_json FROM query_definition ORDER BY query_id').map((r) => ({
      id: r.query_id, description: r.description, grain: r.grain, parameters: json(r.parameters_json, {}), saved_runs: saved.get(String(r.query_id)) || 0,
    }));
  });
}

// Runs one catalogued query with validated bind parameters. No SQL text is accepted from callers.
export function runQuery(cfg: NatureConfig, queryId: string, supplied: Record<string, unknown> = {}) {
  return withNature(cfg, (db) => {
    const def = definition(db, queryId);
    const params = validateParameters(def.parameters, supplied);
    const stmt = db.prepare(def.sql);
    const rows = stmt.all(params) as Row[];
    if (new Set(rows.map((r) => r.result_key)).size !== rows.length) throw new HttpError(409, `Query ${queryId} returned duplicate result keys`);
    const columns = rows.length ? Object.keys(rows[0]) : (stmt.columns?.() || []).map((c: { name: string }) => c.name);
    // Lineage exists only for saved executions; the build saves one run with default parameters.
    const runs = all<Row>(db, 'SELECT query_run_id, executed_at_utc, parameters_json FROM query_run WHERE query_id = ? ORDER BY executed_at_utc DESC', queryId);
    const matching = runs.filter((r) => sameParams(json(r.parameters_json, {}), params)).map((r) => ({ run_id: String(r.query_run_id), executed_at_utc: r.executed_at_utc }));
    return { query: { id: def.id, description: def.description, grain: def.grain, parameters: def.parameters }, parameters: params, columns, rows, row_count: rows.length, lineage_runs: matching };
  });
}

export function listSavedRuns(cfg: NatureConfig, queryId?: string) {
  return withNature(cfg, (db) => all<Row>(db, `SELECT r.query_run_id, r.query_id, r.executed_at_utc, r.parameters_json, (SELECT COUNT(*) FROM query_result q WHERE q.query_run_id = r.query_run_id) AS result_count
      FROM query_run r WHERE (? IS NULL OR r.query_id = ?) ORDER BY r.executed_at_utc DESC LIMIT 200`, queryId ?? null, queryId ?? null)
    .map((r) => ({ run_id: r.query_run_id, query_id: r.query_id, executed_at_utc: r.executed_at_utc, parameters: json(r.parameters_json, {}), result_count: r.result_count, build_time: String(r.query_run_id).endsWith(':default') })));
}

export function savedRunResults(cfg: NatureConfig, runId: string) {
  return withNature(cfg, (db) => {
    const run = get<Row>(db, 'SELECT query_run_id, query_id, executed_at_utc, parameters_json FROM query_run WHERE query_run_id = ?', runId);
    if (!run) throw new HttpError(404, `Unknown saved run: ${runId}`);
    const rows = all<{ values_json: string }>(db, 'SELECT values_json FROM query_result WHERE query_run_id = ? ORDER BY rowid', runId).map((r) => json<Row>(r.values_json, {}));
    return { run_id: run.query_run_id, query_id: run.query_id, executed_at_utc: run.executed_at_utc, parameters: json(run.parameters_json, {}), columns: rows.length ? Object.keys(rows[0]) : [], rows };
  });
}

// TypeScript port of nature_model/tools/query_nature_model.py:trace. Same tables, filters and
// ordering; IN-lists use json_each instead of loading whole tables into memory.
export function traceResult(cfg: NatureConfig, queryId: string, resultKey: string, runId?: string) {
  return withNature(cfg, (db) => {
    const run = get<Row>(db, 'SELECT * FROM query_run WHERE query_id = ? AND query_run_id = ?', queryId, runId || `${queryId}:default`);
    if (!run) throw new HttpError(404, runId ? `Unknown saved run ${runId} for ${queryId}` : `Unknown query: ${queryId}`);
    const start = `query_result:${JSON.stringify([run.query_run_id, resultKey])}`;
    const result = get<Row>(db, 'SELECT * FROM query_result WHERE entity_id = ?', start);
    if (!result) throw new HttpError(404, `No result for key: ${resultKey}`);
    const entities = all<Row>(db, `WITH RECURSIVE ancestors(entity_id) AS (
        SELECT ? UNION SELECT d.parent_entity_id FROM record_dependency d JOIN ancestors a ON d.child_entity_id = a.entity_id
      ) SELECT e.* FROM ancestors a JOIN entity_record e USING(entity_id) ORDER BY e.entity_id`, start);
    const ids = JSON.stringify(entities.map((r) => r.entity_id));
    const links = all<Row>(db, 'SELECT * FROM record_source WHERE entity_id IN (SELECT value FROM json_each(?)) ORDER BY entity_id, source_record_id', ids);
    const records = all<Row>(db, 'SELECT * FROM source_record WHERE source_record_id IN (SELECT value FROM json_each(?)) ORDER BY source_record_id', JSON.stringify([...new Set(links.map((r) => r.source_record_id))]));
    const tables = JSON.stringify([...new Set(entities.map((r) => r.table_name))]);
    return {
      scope: 'Conservative row-level ancestry plus column mapping rules; not per-cell SQL provenance. Missing/excluded records are not enumerated as contributors.',
      build: get<Row>(db, 'SELECT * FROM build_run'),
      query_run: run, result, entities,
      method_context: methodContext(db, tables),
      reviews_at_execution: all<Row>(db, 'SELECT * FROM query_review_snapshot WHERE query_run_id = ? ORDER BY review_id', String(run.query_run_id)),
      dependencies: all<Row>(db, 'SELECT * FROM record_dependency WHERE child_entity_id IN (SELECT value FROM json_each(?)) ORDER BY child_entity_id, parent_entity_id', ids),
      record_source_links: links, source_records: records,
      source_files: all<Row>(db, 'SELECT * FROM source_file WHERE source_id IN (SELECT value FROM json_each(?)) ORDER BY relative_path', JSON.stringify([...new Set(records.map((r) => r.source_id))])),
      transformations: all<Row>(db, 'SELECT * FROM transformation ORDER BY transformation_id'),
      column_rules: all<Row>(db, 'SELECT * FROM column_lineage WHERE table_name IN (SELECT value FROM json_each(?)) ORDER BY table_name, column_name', tables),
    };
  });
}

function methodContext(db: NDB, tablesJson: string) {
  if (!get(db, "SELECT 1 FROM sqlite_master WHERE name = 'model_method_link'")) return {};
  const links = all<Row>(db, 'SELECT * FROM model_method_link WHERE table_name IN (SELECT value FROM json_each(?)) ORDER BY table_name, method_id', tablesJson);
  const methods = JSON.stringify([...new Set(links.map((r) => r.method_id))]);
  return {
    scope: 'Explanatory method/context links; source pointers and prototype policies do not prove compliance or validate an algorithm.',
    model_links: links,
    methods: all<Row>(db, 'SELECT * FROM method_context WHERE method_id IN (SELECT value FROM json_each(?)) ORDER BY method_id', methods),
    evidence: all<Row>(db, `SELECT e.*, s.heading, s.start_line, s.end_line, s.section_text,
         d.relative_path, d.verification_status AS document_verification, f.sha256 AS document_sha256,
         r.source AS external_source, r.url, r.licence, r.verification_status AS reference_verification
         FROM method_evidence e LEFT JOIN evidence_section s USING(section_id)
         LEFT JOIN evidence_document d USING(document_id) LEFT JOIN source_file f ON f.source_id = d.source_id
         LEFT JOIN reference_source r USING(reference_id)
         WHERE e.method_id IN (SELECT value FROM json_each(?)) ORDER BY e.method_id, e.evidence_id`, methods),
  };
}

// ---------------------------------------------------------------- catchments and maps

export function catchmentOverview(cfg: NatureConfig) {
  return withNature(cfg, (db) => {
    const monitoring = all<Row>(db, 'SELECT catchment_id, year, total_p_load_kg, total_n_load_kg, method FROM catchment_monitoring ORDER BY catchment_id, year');
    const byCatchment = new Map<string, Row[]>();
    for (const m of monitoring) byCatchment.set(String(m.catchment_id), [...(byCatchment.get(String(m.catchment_id)) || []), m]);
    const features = all<Row>(db, `SELECT c.*, g.crs, g.geometry_json FROM catchment c LEFT JOIN catchment_geometry g USING(catchment_id) ORDER BY c.catchment_id`).map((c) => {
      const series = byCatchment.get(String(c.catchment_id)) || [];
      const latest = series[series.length - 1];
      const { geometry_json, crs, ...props } = c;
      return { type: 'Feature', id: c.catchment_id, geometry: geometry_json ? json(geometry_json, null) : null, properties: { ...props, crs, monitored_years: series.length, latest_year: latest?.year ?? null, latest_p_load_kg: latest?.total_p_load_kg ?? null, latest_n_load_kg: latest?.total_n_load_kg ?? null } };
    });
    return { type: 'FeatureCollection', note: 'Synthetic challenge geometry (CRS84), linked by supplied IDs; not topology-validated.', features, monitoring };
  });
}

export function catchmentParcels(cfg: NatureConfig, catchmentId: string, year: number) {
  return withNature(cfg, (db) => {
    if (!get(db, 'SELECT 1 FROM catchment WHERE catchment_id = ?', catchmentId)) throw new HttpError(404, `Unknown catchment: ${catchmentId}`);
    const features = all<Row>(db, `SELECT p.parcel_id, p.farm_id, p.area_ha, p.soil_class_soilmap, p.slope_pct, p.dist_to_water_m, p.buffer_strip,
          f.crop, f.crop_status, f.is_contract_crop_provisional, f.contract_selection_status, g.geometry_json,
          (SELECT COUNT(*) FROM nature_action_candidate a WHERE a.parcel_id = p.parcel_id AND a.year = ?) AS action_candidates
        FROM parcel p JOIN parcel_geometry g USING(parcel_id)
        LEFT JOIN field_context f ON f.parcel_id = p.parcel_id AND f.year = ?
        WHERE p.catchment_id = ? ORDER BY p.parcel_id`, year, year, catchmentId).map(({ geometry_json, ...props }) => ({ type: 'Feature', id: props.parcel_id, geometry: json(geometry_json, null), properties: props }));
    return { type: 'FeatureCollection', catchment_id: catchmentId, year, features };
  });
}

export function farmNature(cfg: NatureConfig, farmId: string, year: number) {
  return withNature(cfg, (db) => {
    const farm = get<Row>(db, 'SELECT * FROM farm WHERE farm_id = ?', farmId);
    if (!farm) throw new HttpError(404, `Farm ${farmId} is not in the nature model`);
    const fields = all<Row>(db, `SELECT f.parcel_id, f.catchment_id, f.crop, f.crop_status, f.area_ha, f.is_contract_crop_provisional, f.contract_selection_status, f.management_review_status,
          f.p_test_mgl_latest, f.buffer_strip, f.reported_p_kg_ha, f.reported_n_applied_kg_ha,
          (SELECT COUNT(*) FROM nature_action_candidate a WHERE a.parcel_id = f.parcel_id AND a.year = f.year) AS action_candidates
        FROM field_context f WHERE f.farm_id = ? AND f.year = ? ORDER BY f.parcel_id`, farmId, year);
    const catchments = all<Row>(db, `SELECT c.catchment_id, c.ecological_status_class, c.p_sensitivity, c.receiving_water_type, COUNT(*) AS fields, ROUND(SUM(f.area_ha), 2) AS area_ha
        FROM field_context f JOIN catchment c USING(catchment_id) WHERE f.farm_id = ? AND f.year = ? GROUP BY c.catchment_id ORDER BY area_ha DESC`, farmId, year);
    const levers = all<Row>(db, `SELECT a.lever_id, l.name, COUNT(*) AS fields FROM nature_action_candidate a JOIN parcel p USING(parcel_id) JOIN action_lever l USING(lever_id)
        WHERE p.farm_id = ? AND a.year = ? GROUP BY a.lever_id ORDER BY fields DESC`, farmId, year);
    // Farm and parcel findings are often year-less (static attributes), so they count for every year.
    const findings = Number(get<{ n: number }>(db, `SELECT COUNT(DISTINCT q.finding_id) AS n FROM quality_finding q JOIN entity_record e ON e.entity_id = q.entity_id
        WHERE (q.year = ? OR q.year IS NULL) AND ((e.table_name = 'farm' AND e.key_json = ?) OR (e.table_name = 'parcel' AND e.key_json LIKE ?))`, year, JSON.stringify([farmId]), `["${farmId}-%`)?.n ?? 0);
    return { farm, year, fields, catchments, action_levers: levers, quality_findings: findings, scope: 'Screening leads and review candidates, not validated risk scores or confirmed errors.' };
  });
}

// ---------------------------------------------------------------- nutrient experiment runs

const RUN_KINDS = { inputs: { dir: 'input_runs', db: 'inputs.sqlite' }, losses: { dir: 'loss_runs', db: 'pilot.sqlite' } } as const;
export type RunKind = keyof typeof RUN_KINDS;

export function runDirectory(cfg: NatureConfig, kind: RunKind, id: string) {
  if (!RUN_DIR.test(id)) throw new HttpError(400, 'Invalid run id');
  const base = path.join(cfg.modelDir, 'analysis/nature', RUN_KINDS[kind].dir);
  const dir = path.join(base, id);
  if (path.dirname(dir) !== base) throw new HttpError(400, 'Invalid run id');
  return dir;
}

function readJson(file: string) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// A run directory without validation.json was interrupted or failed; it is listed as incomplete.
export function listNutrientRuns(cfg: NatureConfig, kind: RunKind) {
  const base = path.join(cfg.modelDir, 'analysis/nature', RUN_KINDS[kind].dir);
  let names: string[] = [];
  try {
    names = fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory() && RUN_DIR.test(d.name)).map((d) => d.name);
  } catch {
    return [];
  }
  return names.map((id) => {
    const dir = path.join(base, id);
    const validation = readJson(path.join(dir, 'validation.json'));
    const created = fs.statSync(dir).mtime.toISOString();
    return { id, kind, complete: Boolean(validation) && fs.existsSync(path.join(dir, RUN_KINDS[kind].db)), created_at: created, year: validation?.year ?? (Number(id.match(/(\d{4})/)?.[1]) || null), catchment_id: validation?.catchment_id ?? null, scientific_status: validation?.scientific_status ?? null, validation };
  }).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

function openRunDb(cfg: NatureConfig, kind: RunKind, id: string) {
  const file = path.join(runDirectory(cfg, kind, id), RUN_KINDS[kind].db);
  if (!fs.existsSync(file)) throw new HttpError(404, `Run ${id} has no ${RUN_KINDS[kind].db}; it may be incomplete.`);
  const db = new DatabaseSync(file, { readOnly: true });
  db.exec('PRAGMA busy_timeout = 5000');
  return db;
}

export function lossRunDetail(cfg: NatureConfig, id: string, variant?: { input_variant?: string; input_point?: string; stress_case?: string }) {
  const run = listNutrientRuns(cfg, 'losses').find((r) => r.id === id);
  if (!run) throw new HttpError(404, `Unknown loss run: ${id}`);
  const db = openRunDb(cfg, 'losses', id);
  try {
    const meta = get<Row>(db, 'SELECT loss_run_id, created_at_utc, year, catchment_id, input_run_id, scientific_status FROM loss_run');
    const variants = all<Row>(db, 'SELECT DISTINCT input_variant, input_point, stress_case FROM field_loss ORDER BY input_variant, input_point, stress_case');
    const summary = lossSummary(path.join(runDirectory(cfg, 'losses', id), 'catchment_summary.csv'));
    const pick = variant?.input_variant ? variant : (variants[0] as typeof variant) || {};
    const fields = all<Row>(db, `SELECT parcel_id, nutrient, status, reason, area_ha, field_loss_kg_ha_year, field_loss_kg, delivery_fraction, retention_fraction, delivered_kg
      FROM field_loss WHERE input_variant = ? AND input_point = ? AND stress_case = ? ORDER BY parcel_id, nutrient`, pick?.input_variant ?? '', pick?.input_point ?? '', pick?.stress_case ?? '');
    return { run: { ...run, meta }, variants, selected_variant: pick, summary, fields, scope: 'Uncalibrated screening pilot. Numerical checks do not validate the science; unknown totals stay unknown.' };
  } finally {
    db.close();
  }
}

// The pilot's own catchment_summary.csv: scope totals stay empty (unknown) when any field in
// scope is unavailable; available_fields_* are partial sums and are labelled as such.
const SUMMARY_NUMBERS = ['field_count', 'available_field_count', 'unavailable_field_count', 'total_area_ha', 'available_area_ha', 'coverage_pct', 'available_fields_loss_kg', 'available_fields_pre_retention_kg', 'available_fields_delivered_kg', 'scope_delivered_kg', 'area_only_reference_kg', 'monitored_whole_catchment_kg', 'other_farmland_load_kg', 'natural_background_load_kg'];
function lossSummary(file: string) {
  if (!fs.existsSync(file)) return [];
  const t = parseCsv(fs.readFileSync(file));
  return t.rows.map((cells) => {
    const r: Record<string, string | number | null> = {};
    t.headers.forEach((h, i) => {
      const v = cells[i] ?? '';
      r[h] = SUMMARY_NUMBERS.includes(h) ? (v === '' ? null : Number(v)) : v;
    });
    return r;
  });
}

export function inputRunDetail(cfg: NatureConfig, id: string) {
  const run = listNutrientRuns(cfg, 'inputs').find((r) => r.id === id);
  if (!run) throw new HttpError(404, `Unknown input run: ${id}`);
  const db = openRunDb(cfg, 'inputs', id);
  try {
    const meta = get<Row>(db, 'SELECT run_id, created_at_utc, year FROM input_run');
    const cols = new Set(all<{ name: string }>(db, 'PRAGMA table_info(input_value)').map((c) => c.name));
    const group = ['input_name', 'variant', 'value_kind'].filter((c) => cols.has(c));
    const summary = group.length ? all<Row>(db, `SELECT ${group.join(', ')}, COUNT(*) AS candidates FROM input_value GROUP BY ${group.join(', ')} ORDER BY ${group.join(', ')}`) : [];
    return { run: { ...run, meta }, summary, scope: 'Provisional input candidates. Not approved corrections; original values are unchanged.' };
  } finally {
    db.close();
  }
}

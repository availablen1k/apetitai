// Immutable calculation runs. Each run stores the dataset hashes, the approved corrections it
// used, the method version and one contribution row per calculated line, so any number can be
// traced back to source rows and factors. Earlier runs stay viewable unchanged.
import { type DB, all, get, json, nowIso, run, tx } from '../db/database.ts';
import { type Contribution, type Scope2Basis, computeInventory } from '../domain/inventory.ts';
import { METHOD_CONSTANTS_SNAPSHOT, METHOD_VERSION } from '../domain/method.ts';
import { newId, round } from '../domain/util.ts';
import { HttpError, recordAudit } from './common.ts';
import { INVENTORY_TABLES, getRecord, loadOpenIssueIndex, loadOverlay, loadTables } from './data.ts';
import { CALCULABLE_DATASETS, yearCoverage } from './reportingYears.ts';

export type RunKind = 'inventory' | 'transport' | 'materials';

const KIND_FILTER: Record<RunKind, (c: Contribution) => boolean> = {
  inventory: () => true,
  transport: (c) => c.category === 'cat04_upstream_transport' || c.category === 'cat09_downstream_transport',
  materials: (c) => c.category === 'cat01_purchased_goods' || c.category === 'cat01_purchased_services' || c.category === 'cat02_capital_goods',
};

export type RunRow = {
  id: string;
  created_at: string;
  year: number;
  kind: RunKind;
  scope2_basis: Scope2Basis;
  status: string;
  trigger: string;
  parent_run_id: string | null;
  method_version: string;
  dataset_hashes: { dataset: string; batch_id: string; filename: string; sha256: string; imported_rows: number }[];
  correction_ids: string[];
  factor_versions: Record<string, unknown>;
  completeness: Record<string, unknown>;
  checks: { id: string; passed: boolean; detail: string }[];
  totals: Record<string, number>;
  open_issue_count: number;
  contribution_count: number;
  gaps: { area: string; message: string; record_ids?: string[] }[];
};

export function runFromRow(r: Record<string, unknown>): RunRow {
  return {
    id: String(r.id), created_at: String(r.created_at), year: Number(r.year), kind: r.kind as RunKind, scope2_basis: r.scope2_basis as Scope2Basis,
    status: String(r.status), trigger: String(r.trigger), parent_run_id: (r.parent_run_id as string) ?? null, method_version: String(r.method_version),
    dataset_hashes: json(r.dataset_hashes_json, []), correction_ids: json(r.correction_ids_json, []), factor_versions: json(r.factor_versions_json, {}),
    completeness: json(r.completeness_json, {}), checks: json(r.checks_json, []), totals: json(r.totals_json, {}),
    open_issue_count: Number(r.open_issue_count), contribution_count: Number(r.contribution_count), gaps: json(r.gaps_json, []),
  };
}

export type CreateRunInput = { year: number; scope2_basis?: Scope2Basis; kind?: RunKind; trigger?: string };

// Listeners called after a run is committed (e.g. data discovery). Keyed by database so separate
// app instances (tests) never see each other's runs. A failing listener never fails the run.
const runListeners = new WeakMap<DB, Set<(run: RunRow) => void>>();
export function onRunSaved(db: DB, listener: (run: RunRow) => void) {
  if (!runListeners.has(db)) runListeners.set(db, new Set());
  runListeners.get(db)!.add(listener);
  return () => runListeners.get(db)?.delete(listener);
}

export function createRun(db: DB, input: CreateRunInput): RunRow {
  const year = Number(input.year);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new HttpError(400, 'year must be a four-digit year');
  const basis: Scope2Basis = input.scope2_basis || 'market';
  const kind: RunKind = input.kind || 'inventory';
  const tables = loadTables(db, INVENTORY_TABLES);
  if (!(tables.emission_factors || []).length) throw new HttpError(409, 'Import emission_factor_library.csv before calculating: no emission factors are loaded.');
  const overlay = loadOverlay(db);
  if (!CALCULABLE_DATASETS.some((dataset) => (tables[dataset] || []).some((record) => record.year === year)) && !overlay.added.some((record) => record.year === year && CALCULABLE_DATASETS.includes(record.table))) throw new HttpError(409, `No activity data for ${year}. Import purchases, transport or energy records first.`);
  const openIssues = loadOpenIssueIndex(db);
  const result = computeInventory({ year, scope2Basis: basis, tables, overlay, openIssues });
  const coverage = yearCoverage(db, year);
  if (kind === 'inventory' && coverage.missing_activity.length) result.gaps.push({ area: 'coverage', message: `No ${year} activity rows loaded for: ${coverage.missing_activity.join(', ')}. Coverage is incomplete; an absent dataset is not a confirmed zero.` });
  const contributions = result.contributions.filter(KIND_FILTER[kind]);

  const yearRecords = new Map<string, number>();
  for (const [t, rows] of Object.entries(tables)) yearRecords.set(t, rows.filter((r) => r.year === year).length);
  const usedRecords = new Set(contributions.flatMap((c) => c.source_record_ids));
  const demoRecords = Object.values(tables).flat().filter((record) => usedRecords.has(record.id) && record.payload.demo === 'true').length;
  const usedByTable = new Map<string, number>();
  for (const [t, rows] of Object.entries(tables)) usedByTable.set(t, rows.filter((r) => r.year === year && usedRecords.has(r.id)).length);
  const openIssueIds = new Set(contributions.flatMap((c) => c.open_issue_ids));
  const openHigh = openIssueIds.size ? Number(get<{ n: number }>(db, `SELECT COUNT(*) AS n FROM dq_issues WHERE status = 'open' AND severity = 'high' AND id IN (${[...openIssueIds].map(() => '?').join(',')})`, ...openIssueIds)?.n || 0) : 0;
  const unmatchedOpen = Number(get<{ n: number }>(db, `SELECT COUNT(*) AS n FROM dq_issues WHERE status = 'open' AND year = ? AND record_id IS NULL`, year)?.n || 0);

  const totals = kind === 'inventory' ? result.totals : subsetTotals(contributions);
  const byCategory = summarise(contributions);
  const completeness = {
    records_in_year: Object.fromEntries(yearRecords),
    records_used: Object.fromEntries(usedByTable),
    excluded_by_correction: result.excluded.length,
    excluded_outside_boundary: result.boundary_excluded.length,
    contributions_with_open_issues: contributions.filter((c) => c.open_issue_ids.length).length,
    open_high_issues_affecting: openHigh,
    open_missing_record_issues: unmatchedOpen,
    estimated_contributions: contributions.filter((c) => c.value_status === 'estimated').length,
    by_category: byCategory,
    contains_demo_data: demoRecords > 0,
    demo_source_records: demoRecords,
    missing_activity_datasets: coverage.missing_activity,
  };
  const factorVersions = {
    method: METHOD_CONSTANTS_SNAPSHOT,
    emission_factor_library: (tables.emission_factors || []).map((f) => ({ ef_id: f.payload.ef_id, value: f.payload.kgco2e_per_unit, unit: f.payload.unit, version: f.payload.version, record_id: f.id })),
  };
  const batches = all<{ id: string; dataset: string; filename: string; sha256: string; imported_rows: number }>(
    db, `SELECT id, dataset, filename, sha256, imported_rows FROM import_batches WHERE status IN ('imported', 'imported_with_errors') ORDER BY dataset, imported_at`,
  ).filter((b) => INVENTORY_TABLES.includes(b.dataset)).map((b) => ({ dataset: b.dataset, batch_id: b.id, filename: b.filename, sha256: b.sha256, imported_rows: Number(b.imported_rows) }));
  const corrections = all<{ id: string }>(db, `SELECT id FROM corrections WHERE status = 'approved' ORDER BY decided_at`).map((c) => c.id);
  const parent = get<{ id: string }>(db, 'SELECT id FROM calculation_runs WHERE year = ? AND kind = ? ORDER BY created_at DESC LIMIT 1', year, kind);
  const checks = result.checks;
  const status = result.gaps.length || openHigh || unmatchedOpen || demoRecords || checks.some((c) => !c.passed) ? 'complete_with_gaps' : 'complete';
  const id = newId('run');
  const created = nowIso();

  tx(db, () => {
    run(
      db,
      `INSERT INTO calculation_runs (id, created_at, year, kind, scope2_basis, status, trigger, parent_run_id, method_version, dataset_hashes_json, correction_ids_json,
         factor_versions_json, completeness_json, checks_json, totals_json, open_issue_count, contribution_count, gaps_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, created, year, kind, basis, status, input.trigger || 'manual', parent?.id ?? null, METHOD_VERSION, JSON.stringify(batches), JSON.stringify(corrections),
      JSON.stringify(factorVersions), JSON.stringify(completeness), JSON.stringify(checks), JSON.stringify(totals), openIssueIds.size, contributions.length,
      JSON.stringify(result.gaps.map((g) => ({ ...g, record_ids: g.record_ids?.slice(0, 50) }))),
    );
    const ins = db.prepare(
      `INSERT INTO calculation_contributions (id, run_id, seq, scope, category, line_item, kind, source_record_ids_json, factor_id, factor_value, factor_unit,
         factor_source, route_proposal_id, formula, inputs_json, kgco2e, tco2e, value_status, correction_ids_json, open_issue_ids_json, in_total, basis)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    contributions.forEach((c, i) => {
      ins.run(`${id}_c${i + 1}`, id, i + 1, c.scope, c.category, c.line_item, c.kind, JSON.stringify(c.source_record_ids), c.factor_id, c.factor_value, c.factor_unit,
        c.factor_source, null, c.formula, JSON.stringify(c.inputs), c.kgco2e, c.tco2e, c.value_status, JSON.stringify(c.correction_ids), JSON.stringify(c.open_issue_ids),
        c.in_total ? 1 : 0, c.basis);
    });
    recordAudit(db, {
      event_type: 'calculation.run_created', actor_kind: 'system', actor_label: 'system', entity_type: 'calculation_run', entity_id: id,
      after: { year, kind, scope2_basis: basis, status, contributions: contributions.length, corrections: corrections.length, totals, parent_run_id: parent?.id ?? null },
    });
  });
  const saved = getRun(db, id);
  for (const listener of runListeners.get(db) || []) {
    try { listener(saved); } catch { /* listeners must not break a saved calculation */ }
  }
  return saved;
}

function subsetTotals(cs: Contribution[]) {
  const total = round(cs.filter((c) => c.in_total).reduce((s, c) => s + c.tco2e, 0), 6);
  return { grand_total: total, scope3_total: total };
}

function summarise(cs: { scope: string; category: string; tco2e: number; in_total: boolean | number }[]) {
  const m = new Map<string, { scope: string; category: string; tco2e: number; count: number; in_total: boolean }>();
  for (const c of cs) {
    const k = `${c.scope}|${c.category}`;
    const e = m.get(k) || { scope: c.scope, category: c.category, tco2e: 0, count: 0, in_total: !!c.in_total };
    e.tco2e += c.tco2e;
    e.count++;
    m.set(k, e);
  }
  return [...m.values()].map((e) => ({ ...e, tco2e: round(e.tco2e, 6) }));
}

export function getRun(db: DB, id: string): RunRow {
  const r = get(db, 'SELECT * FROM calculation_runs WHERE id = ?', id);
  if (!r) throw new HttpError(404, `Run ${id} not found`);
  return runFromRow(r);
}

export function listRuns(db: DB, opts: { year?: number; kind?: string; limit?: number } = {}) {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (opts.year) { where.push('year = ?'); params.push(opts.year); }
  if (opts.kind) { where.push('kind = ?'); params.push(opts.kind); }
  const rows = all(db, `SELECT * FROM calculation_runs ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ?`, ...params, Math.min(opts.limit || 50, 200));
  return rows.map(runFromRow).map(({ factor_versions: _f, dataset_hashes, ...rest }) => ({ ...rest, dataset_count: dataset_hashes.length }));
}

export type ContributionRow = Omit<Contribution, 'in_total'> & { id: string; run_id: string; seq: number; in_total: boolean };

export function contributionFromRow(r: Record<string, unknown>): ContributionRow {
  return {
    id: String(r.id), run_id: String(r.run_id), seq: Number(r.seq), scope: r.scope as Contribution['scope'], category: String(r.category), line_item: String(r.line_item),
    kind: String(r.kind), source_record_ids: json(r.source_record_ids_json, []), factor_id: (r.factor_id as string) ?? null, factor_value: r.factor_value === null ? null : Number(r.factor_value),
    factor_unit: (r.factor_unit as string) ?? null, factor_source: (r.factor_source as string) ?? null, formula: String(r.formula), inputs: json(r.inputs_json, {}),
    kgco2e: Number(r.kgco2e), tco2e: Number(r.tco2e), value_status: r.value_status as Contribution['value_status'], correction_ids: json(r.correction_ids_json, []),
    open_issue_ids: json(r.open_issue_ids_json, []), in_total: Number(r.in_total) === 1, basis: (r.basis as string) ?? null,
  };
}

export function listContributions(db: DB, runId: string, f: { category?: string; scope?: string; kind?: string; q?: string; limit?: number; offset?: number; sort?: string }) {
  getRun(db, runId);
  const where = ['run_id = ?'];
  const params: (string | number)[] = [runId];
  if (f.category) { where.push('category = ?'); params.push(f.category); }
  if (f.scope) { where.push('scope = ?'); params.push(f.scope); }
  if (f.kind) { where.push('kind = ?'); params.push(f.kind); }
  if (f.q) { where.push('(line_item LIKE ? OR factor_id LIKE ?)'); params.push(`%${f.q}%`, `%${f.q}%`); }
  const w = where.join(' AND ');
  const total = Number(get<{ n: number }>(db, `SELECT COUNT(*) AS n FROM calculation_contributions WHERE ${w}`, ...params)?.n || 0);
  const order = f.sort === 'seq' ? 'seq' : 'tco2e DESC';
  const limit = Math.min(Math.max(f.limit || 50, 1), 1000);
  const items = all(db, `SELECT * FROM calculation_contributions WHERE ${w} ORDER BY ${order} LIMIT ? OFFSET ?`, ...params, limit, Math.max(f.offset || 0, 0)).map(contributionFromRow);
  return { total, limit, offset: f.offset || 0, items };
}

export function getLineage(db: DB, runId: string, contributionId: string) {
  const run = getRun(db, runId);
  const row = get(db, 'SELECT * FROM calculation_contributions WHERE id = ? AND run_id = ?', contributionId, runId);
  if (!row) throw new HttpError(404, `Contribution ${contributionId} not found in run ${runId}`);
  const c = contributionFromRow(row);
  const records = c.source_record_ids.map((id) => {
    if (id.startsWith('corr:')) {
      const corrId = id.slice(5);
      const corr = get(db, 'SELECT * FROM corrections WHERE id = ?', corrId);
      return { id, table: corr?.table_name, record_key: corr?.record_key, source_file: `added by correction ${corrId}`, source_row: null, payload: json(corr?.approved_value, {}), batch: null, synthetic: true };
    }
    const r = getRecord(db, id);
    if (!r) return { id, missing: true };
    const b = get(db, 'SELECT b.id, b.filename, b.sha256, b.imported_at FROM import_batches b JOIN source_records s ON s.batch_id = b.id WHERE s.id = ?', id);
    return { ...r, batch: b ?? null };
  });
  const corrections = c.correction_ids.map((id) => get(db, 'SELECT * FROM corrections WHERE id = ?', id)).filter(Boolean);
  const openIssues = c.open_issue_ids.map((id) => get(db, 'SELECT id, rule_id, issue_type, severity, record_key, field, observed_value, candidate_value, status FROM dq_issues WHERE id = ?', id)).filter(Boolean);
  const factorRecord = records.find((r) => 'table' in r && r.table === 'emission_factors');
  const routes = c.kind === 'transport_leg' ? all(db, `SELECT * FROM route_proposals WHERE shipment_record_id = ? ORDER BY created_at DESC`, c.source_record_ids[0]) : [];
  // Records joined by validated identifiers (not used in this number, shown for the chain
  // material → supplier → ERP purchase → shipment). Only exact identifier matches are listed.
  const linked: { relation: string; record: unknown }[] = [];
  const addLinked = (relation: string, id: string | null | undefined) => {
    if (!id) return;
    const r = getRecord(db, id);
    if (r) linked.push({ relation, record: r });
  };
  const firstOf = (table: string) => records.find((r) => 'table' in r && r.table === table) as { id: string; payload: Record<string, string> } | undefined;
  if (c.kind === 'transport_leg') {
    const leg = get<{ erp_record_id: string | null; join_status: string }>(db, 'SELECT erp_record_id, join_status FROM shipments WHERE record_id = ?', c.source_record_ids[0]);
    if (leg?.erp_record_id) {
      addLinked(`ERP purchase (ref_doc = doc_no, ${leg.join_status})`, leg.erp_record_id);
      const erp = getRecord(db, leg.erp_record_id);
      for (const m of all<{ id: string }>(db, `SELECT id FROM source_records WHERE table_name = 'materials' AND record_key = ?`, `material:${erp?.payload.material_id}`)) addLinked('material master', m.id);
      for (const s of all<{ id: string }>(db, `SELECT id FROM source_records WHERE (table_name = 'suppliers' AND record_key = ?) OR (table_name = 'farm_registry' AND record_key = ?)`, `supplier:${erp?.payload.supplier_id}`, `farm:${erp?.payload.supplier_id}`)) addLinked('supplier / farm', s.id);
    } else if (leg) linked.push({ relation: `no ERP link (${leg.join_status})`, record: null });
  }
  if (c.kind === 'material_purchase' || c.kind === 'spend_purchase') {
    const erp = firstOf('erp_purchase_lines');
    if (erp) {
      for (const sh of all<{ record_id: string }>(db, 'SELECT record_id FROM shipments WHERE ref_doc = ?', String(erp.payload.doc_no))) addLinked('transport leg (counted separately in Cat 4)', sh.record_id);
      for (const s of all<{ id: string }>(db, `SELECT id FROM source_records WHERE table_name = 'suppliers' AND record_key = ?`, `supplier:${erp.payload.supplier_id}`)) addLinked('supplier', s.id);
    }
  }

  const nodes: { id: string; type: string; label: string; detail?: unknown }[] = [
    { id: run.id, type: 'run', label: `Run ${run.year} (${run.scope2_basis}-based Scope 2)`, detail: { created_at: run.created_at, method_version: run.method_version } },
    { id: c.id, type: 'contribution', label: `${c.category} · ${c.line_item}`, detail: { tco2e: c.tco2e, formula: c.formula } },
  ];
  const edges: { from: string; to: string; label: string }[] = [{ from: c.id, to: run.id, label: c.in_total ? 'counted in total' : 'reported, not in total' }];
  for (const r of records) {
    const rec = r as { id: string; table?: string; record_key?: string; source_file?: string; source_row?: number | null };
    nodes.push({ id: rec.id, type: rec.table === 'emission_factors' ? 'factor' : 'source_record', label: `${rec.table}:${rec.record_key}`, detail: { file: rec.source_file, row: rec.source_row } });
    edges.push({ from: rec.id, to: c.id, label: rec.table === 'emission_factors' ? 'factor' : 'input' });
  }
  for (const k of corrections) {
    const corr = k as Record<string, unknown>;
    nodes.push({ id: String(corr.id), type: 'correction', label: `${corr.action} ${corr.field ?? ''} → ${corr.approved_value ?? ''}`, detail: { reviewer_label: corr.reviewer_label, decided_at: corr.decided_at } });
    edges.push({ from: String(corr.id), to: c.id, label: 'approved correction' });
    if (corr.record_id) edges.push({ from: String(corr.id), to: String(corr.record_id), label: 'overlays' });
  }
  for (const i of openIssues) {
    const iss = i as Record<string, unknown>;
    nodes.push({ id: String(iss.id), type: 'open_issue', label: `${iss.issue_type} (${iss.severity})`, detail: iss });
    edges.push({ from: String(iss.id), to: c.id, label: 'open issue' });
  }
  return { run: { id: run.id, year: run.year, kind: run.kind, scope2_basis: run.scope2_basis, created_at: run.created_at, method_version: run.method_version, status: run.status }, contribution: c, records, factor: factorRecord ?? null, corrections, open_issues: openIssues, routes, linked, nodes, edges };
}

export function latestRun(db: DB, year?: number, kind: RunKind = 'inventory') {
  const r = year
    ? get(db, 'SELECT * FROM calculation_runs WHERE year = ? AND kind = ? ORDER BY created_at DESC LIMIT 1', year, kind)
    : get(db, 'SELECT * FROM calculation_runs WHERE kind = ? ORDER BY created_at DESC LIMIT 1', kind);
  return r ? runFromRow(r) : null;
}

export function compareRuns(db: DB, a: string, b: string) {
  const ra = getRun(db, a);
  const rb = getRun(db, b);
  const sa = new Map((ra.completeness.by_category as { scope: string; category: string; tco2e: number }[]).map((x) => [`${x.scope}|${x.category}`, x.tco2e]));
  const sb = new Map((rb.completeness.by_category as { scope: string; category: string; tco2e: number }[]).map((x) => [`${x.scope}|${x.category}`, x.tco2e]));
  const keys = [...new Set([...sa.keys(), ...sb.keys()])].sort();
  return {
    a: { id: ra.id, created_at: ra.created_at, corrections: ra.correction_ids.length },
    b: { id: rb.id, created_at: rb.created_at, corrections: rb.correction_ids.length },
    rows: keys.map((k) => ({ key: k, a: sa.get(k) ?? 0, b: sb.get(k) ?? 0, delta: round((sb.get(k) ?? 0) - (sa.get(k) ?? 0), 6) })),
    added_corrections: rb.correction_ids.filter((x) => !ra.correction_ids.includes(x)),
  };
}

// Benchmark: compare a run with an imported dev truth (benchmark_inventory, 2023/2024 only).
export function benchmark(db: DB, runId: string) {
  const r = getRun(db, runId);
  const truth = all<{ payload_json: string }>(db, `SELECT payload_json FROM source_records WHERE table_name = 'benchmark_inventory' AND year = ?`, r.year).map((x) => json<Record<string, string>>(x.payload_json, {}));
  if (!truth.length) return { run_id: runId, year: r.year, available: false, rows: [] };
  const by = new Map((r.completeness.by_category as { scope: string; category: string; tco2e: number }[]).map((x) => [`${x.scope}|${x.category}`, x.tco2e]));
  const rows = truth.map((t) => {
    const key = `${t.scope}|${t.category}`;
    let ours: number | null;
    if (t.scope === 'total') ours = r.totals[t.category] ?? null;
    else if (t.scope === 'memo') ours = r.totals.biogenic_co2_scope1 ?? null;
    else if (t.category === 'cat01_purchased_goods_services') ours = (by.get('scope3|cat01_purchased_goods') ?? 0) + (by.get('scope3|cat01_purchased_services') ?? 0);
    else ours = by.get(key) ?? 0;
    const tv = Number(t.tco2e);
    return { scope: t.scope, category: t.category, benchmark_tco2e: tv, run_tco2e: ours === null ? null : round(ours, 2), diff_pct: ours === null || !tv ? null : round(((ours - tv) / tv) * 100, 2) };
  });
  return { run_id: runId, year: r.year, available: true, rows, note: 'Benchmark = public 2023/2024 dev truth from the challenge package (tasks/dev). No benchmark exists for 2025.' };
}

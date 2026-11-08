// Multi-sheet Excel export of one immutable calculation run with its evidence.
import ExcelJS from 'exceljs';
import { type DB, all } from '../db/database.ts';
import { benchmark, contributionFromRow, getRun } from './calculations.ts';

const STATUS_NOTE = 'value_status: original = as imported; corrected = uses a human-approved correction; estimated = uses an approved estimate or norm; has_open_issue = an unresolved quality issue touches the inputs. Provider/AI suggestions are never applied unless approved.';

function sheet(wb: ExcelJS.Workbook, name: string, columns: { header: string; key: string; width?: number }[], rows: Record<string, unknown>[]) {
  const ws = wb.addWorksheet(name);
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width || Math.min(Math.max(c.header.length + 2, 12), 48) }));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  for (const r of rows) ws.addRow(r);
  return ws;
}

export async function buildWorkbook(db: DB, runId: string): Promise<Buffer> {
  const run = getRun(db, runId);
  const contributions = all(db, 'SELECT * FROM calculation_contributions WHERE run_id = ? ORDER BY seq', runId).map(contributionFromRow);
  const recordInfo = new Map<string, { table: string; record_key: string; source_file: string; source_row: number }>();
  const ids = [...new Set(contributions.flatMap((c) => c.source_record_ids))].filter((id) => !id.startsWith('corr:'));
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    for (const r of all<{ id: string; table_name: string; record_key: string; source_file: string; source_row: number }>(db, `SELECT id, table_name, record_key, source_file, source_row FROM source_records WHERE id IN (${chunk.map(() => '?').join(',')})`, ...chunk)) {
      recordInfo.set(r.id, { table: r.table_name, record_key: r.record_key, source_file: r.source_file, source_row: Number(r.source_row) });
    }
  }
  const srcOf = (c: (typeof contributions)[number], table: string) => c.source_record_ids.map((id) => ({ id, info: recordInfo.get(id) })).filter((x) => x.info?.table === table);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Apetit TraceFlow (local)';
  wb.created = new Date(run.created_at);

  const legs = contributions.filter((c) => c.kind === 'transport_leg');
  sheet(wb, 'Shipments', [
    { header: 'Contribution ID', key: 'id', width: 34 }, { header: 'Category', key: 'category', width: 26 }, { header: 'Shipment', key: 'shipment' }, { header: 'Direction', key: 'direction' },
    { header: 'Ref doc', key: 'ref_doc' }, { header: 'Mode', key: 'mode' }, { header: 'Freight t', key: 't' }, { header: 'Distance km', key: 'km' }, { header: 'tkm (t × km)', key: 'tkm' },
    { header: 'Factor ID', key: 'factor_id', width: 22 }, { header: 'kgCO2e/tkm', key: 'factor' }, { header: 'kgCO2e', key: 'kg' }, { header: 'tCO2e', key: 't_co2' },
    { header: 'Distance basis', key: 'route', width: 34 }, { header: 'Value status', key: 'status' }, { header: 'Source file', key: 'file', width: 24 }, { header: 'Source row', key: 'row' }, { header: 'Source record ID', key: 'rec', width: 30 },
  ], legs.map((c) => {
    const s = srcOf(c, 'shipments')[0];
    return { id: c.id, category: c.category, shipment: s?.info?.record_key || c.line_item, direction: c.category.startsWith('cat04') ? 'inbound' : 'outbound', ref_doc: c.inputs.ref_doc, mode: c.inputs.mode, t: c.inputs.freight_t, km: c.inputs.distance_km, tkm: c.inputs.tkm, factor_id: c.factor_id, factor: c.factor_value, kg: c.kgco2e, t_co2: c.tco2e, route: c.inputs.route_status, status: c.value_status, file: s?.info?.source_file || (c.correction_ids.length ? 'added by approved correction' : ''), row: s?.info?.source_row, rec: s?.id || c.source_record_ids[0] };
  }));

  const routeRows = all(db, `SELECT rp.id AS route_id, rp.shipment_record_id, rp.provider, rp.status, rp.is_demo, rp.total_km, rp.evidence_note, rp.reviewer_label, rp.reviewed_at,
      l.leg_order, l.mode, l.distance_km, l.start_label, l.end_label FROM route_proposals rp JOIN route_legs l ON l.route_id = rp.id ORDER BY rp.created_at, l.leg_order`);
  sheet(wb, 'Route Legs', [
    { header: 'Route ID', key: 'route_id', width: 28 }, { header: 'Shipment record', key: 'shipment_record_id', width: 30 }, { header: 'Provider', key: 'provider' }, { header: 'Status', key: 'status' },
    { header: 'DEMO', key: 'is_demo' }, { header: 'Leg', key: 'leg_order' }, { header: 'Mode', key: 'mode' }, { header: 'Distance km', key: 'distance_km' }, { header: 'From', key: 'start_label', width: 24 },
    { header: 'To', key: 'end_label', width: 24 }, { header: 'Evidence', key: 'evidence_note', width: 40 }, { header: 'Reviewer label (unverified)', key: 'reviewer_label', width: 24 }, { header: 'Reviewed at', key: 'reviewed_at', width: 24 },
  ], routeRows.length ? routeRows.map((r) => ({ ...r, is_demo: Number(r.is_demo) ? 'DEMO' : '' })) : [{ route_id: 'No route proposals. All legs use the distance supplied in shipments.csv; exact origin/destination are not in the source data.' }]);

  const mat = contributions.filter((c) => c.category.startsWith('cat01') || c.category === 'cat02_capital_goods');
  sheet(wb, 'Raw Materials', [
    { header: 'Contribution ID', key: 'id', width: 34 }, { header: 'Category', key: 'category', width: 26 }, { header: 'Kind', key: 'kind' }, { header: 'Line item', key: 'line', width: 40 },
    { header: 'Material', key: 'material' }, { header: 'Supplier / farm', key: 'supplier' }, { header: 'Activity', key: 'activity' }, { header: 'Activity unit', key: 'unit' },
    { header: 'Factor ID', key: 'factor_id', width: 24 }, { header: 'Factor', key: 'factor' }, { header: 'Factor unit', key: 'factor_unit', width: 18 }, { header: 'Factor basis', key: 'basis' },
    { header: 'kgCO2e', key: 'kg' }, { header: 'tCO2e', key: 't' }, { header: 'Value status', key: 'status' }, { header: 'Source record IDs', key: 'src', width: 40 },
  ], mat.map((c) => ({
    id: c.id, category: c.category, kind: c.kind, line: c.line_item, material: c.inputs.material_id ?? '', supplier: c.inputs.supplier_id ?? c.line_item.split(':').pop(),
    activity: c.kind === 'contract_farm' ? c.inputs.area_ha : c.kind === 'spend_purchase' ? c.inputs.amount_eur : c.inputs.kg, unit: c.kind === 'contract_farm' ? 'ha' : c.kind === 'spend_purchase' ? 'EUR' : 'kg',
    factor_id: c.factor_id, factor: c.factor_value, factor_unit: c.factor_unit, basis: c.basis, kg: c.kgco2e, t: c.tco2e, status: c.value_status, src: c.source_record_ids.slice(0, 12).join(' ') + (c.source_record_ids.length > 12 ? ` … (+${c.source_record_ids.length - 12})` : ''),
  })));

  const issues = all(db, 'SELECT * FROM dq_issues WHERE year = ? OR year IS NULL ORDER BY status, severity, record_key', run.year);
  sheet(wb, 'Quality Issues', [
    { header: 'Issue ID', key: 'id', width: 22 }, { header: 'Rule', key: 'rule_id', width: 30 }, { header: 'Rule version', key: 'rule_version' }, { header: 'Type', key: 'issue_type', width: 20 },
    { header: 'Table', key: 'table_name', width: 24 }, { header: 'Record key', key: 'record_key', width: 34 }, { header: 'Field', key: 'field' }, { header: 'Observed', key: 'observed_value' },
    { header: 'Candidate (proposal)', key: 'candidate_value', width: 24 }, { header: 'Severity', key: 'severity' }, { header: 'Confidence', key: 'confidence' }, { header: 'Status', key: 'status' },
    { header: 'Explanation', key: 'explanation_en', width: 80 },
  ], issues);

  const corrections = all(db, 'SELECT * FROM corrections ORDER BY decided_at');
  const audit = all(db, `SELECT * FROM audit_events WHERE event_type LIKE 'issue.%' OR event_type LIKE 'route.%' OR entity_id = ? ORDER BY seq`, runId);
  const ws = sheet(wb, 'Corrections & Audit', [
    { header: 'Correction ID', key: 'id', width: 24 }, { header: 'Issue', key: 'issue_id', width: 22 }, { header: 'Record key', key: 'record_key', width: 30 }, { header: 'Field', key: 'field' },
    { header: 'Action', key: 'action' }, { header: 'Original value', key: 'original_value' }, { header: 'Approved value', key: 'approved_value', width: 24 }, { header: 'Decision', key: 'status' },
    { header: 'Reviewer label (unverified)', key: 'reviewer_label', width: 24 }, { header: 'Reason', key: 'reason', width: 40 }, { header: 'Decided at', key: 'decided_at', width: 24 },
    { header: 'Proposed by', key: 'proposed_by' }, { header: 'Used in this run', key: 'used' },
  ], corrections.map((c) => ({ ...c, used: run.correction_ids.includes(String(c.id)) ? 'yes' : 'no' })));
  ws.addRow([]);
  ws.addRow(['Audit events']).font = { bold: true };
  ws.addRow(['Seq', 'At', 'Event', 'Actor kind', 'Actor label', 'Entity', 'Entity ID', 'Reason']).font = { bold: true };
  for (const a of audit) ws.addRow([a.seq, a.at, a.event_type, a.actor_kind, a.actor_label, a.entity_type, a.entity_id, a.reason]);
  ws.addRow([]);
  ws.addRow(['Reviewer labels are typed names on a local machine without login. They are not verified identities and this log is not a regulated audit trail.']);

  const fv = run.factor_versions as { emission_factor_library?: { ef_id: string; value: string; unit: string; version: string; record_id: string }[]; method?: Record<string, unknown> };
  const used = new Set(contributions.map((c) => c.factor_id));
  const fws = sheet(wb, 'Factors & Sources', [
    { header: 'Factor ID', key: 'ef_id', width: 26 }, { header: 'kgCO2e per unit', key: 'value' }, { header: 'Unit', key: 'unit' }, { header: 'Version', key: 'version' },
    { header: 'Source record ID', key: 'record_id', width: 30 }, { header: 'Used in run', key: 'used' },
  ], (fv.emission_factor_library || []).map((f) => ({ ...f, used: used.has(f.ef_id) ? 'yes' : '' })));
  fws.addRow([]);
  fws.addRow(['Method constants', String((fv.method as { source?: string })?.source || '')]).font = { bold: true };
  for (const [k, v] of Object.entries(fv.method || {})) if (k !== 'source') fws.addRow([k, JSON.stringify(v)]);
  fws.addRow([]);
  fws.addRow(['Datasets (file hashes)']).font = { bold: true };
  fws.addRow(['Dataset', 'File', 'SHA-256', 'Imported rows', 'Batch ID']).font = { bold: true };
  for (const d of run.dataset_hashes) fws.addRow([d.dataset, d.filename, d.sha256, d.imported_rows, d.batch_id]);

  const by = (run.completeness.by_category as { scope: string; category: string; tco2e: number; count: number; in_total: boolean }[]) || [];
  const sws = sheet(wb, 'Calculation Summary', [
    { header: 'Scope', key: 'scope', width: 18 }, { header: 'Category', key: 'category', width: 34 }, { header: 'tCO2e', key: 'tco2e', width: 16 }, { header: 'Contributions', key: 'count' }, { header: 'Counted in total', key: 'in_total' },
  ], by.map((b) => ({ ...b, in_total: b.in_total ? 'yes' : 'no (alternative basis / memo)' })));
  sws.addRow([]);
  for (const [k, v] of Object.entries(run.totals)) sws.addRow(['total', k, v]);
  const bm = benchmark(db, runId);
  if (bm.available) {
    sws.addRow([]);
    sws.addRow(['Benchmark (public dev truth)', 'category', 'benchmark tCO2e', 'run tCO2e', 'diff %']).font = { bold: true };
    for (const r of bm.rows) sws.addRow([r.scope, r.category, r.benchmark_tco2e, r.run_tco2e, r.diff_pct]);
  }

  const meta = wb.addWorksheet('Run Metadata');
  meta.columns = [{ width: 32 }, { width: 100 }];
  const rows: [string, unknown][] = [
    ['Run ID', run.id], ['Created at', run.created_at], ['Reporting year', run.year], ['Run kind', run.kind], ['Scope 2 basis in total', run.scope2_basis],
    ['Status', run.status], ['Trigger', run.trigger], ['Parent run', run.parent_run_id || ''], ['Method version', run.method_version],
    ['Approved corrections used', run.correction_ids.length], ['Contributions', run.contribution_count], ['Open issues touching inputs', run.open_issue_count],
    ['Checks', run.checks.map((c) => `${c.id}: ${c.passed ? 'pass' : 'FAIL'}`).join('; ')],
    ['Gaps', run.gaps.map((g) => `[${g.area}] ${g.message}`).join(' | ') || 'none'],
    ['Completeness', JSON.stringify({ ...run.completeness, by_category: undefined })],
    ['Value status legend', STATUS_NOTE],
    ['Data note', 'Source data is synthetic challenge material (Apetit × Since AI 2026), not verified Apetit operational figures.'],
    ['Boundary', 'Inbound third-party transport is Scope 3 Category 4 and outbound is Category 9; purchased-material production is Category 1. They are reported separately and never double counted.'],
  ];
  for (const r of rows) meta.addRow(r);
  meta.getColumn(1).font = { bold: true };

  return Buffer.from(await wb.xlsx.writeBuffer());
}

export const workbookName = (db: DB, runId: string) => {
  const r = getRun(db, runId);
  return `traceflow_${r.year}_${r.kind}_${r.id}.xlsx`;
};


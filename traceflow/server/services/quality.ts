// Quality scans (idempotent issue upsert by fingerprint) and human review of issues.
import { z } from 'zod';
import { type DB, type Row, all, get, json, nowIso, run, tx } from '../db/database.ts';
import { type Finding, RULES_VERSION, RULE_TABLES, runRules } from '../domain/rules.ts';
import { newId, parseNumber, sanitizeLabel, sha256 } from '../domain/util.ts';
import { DATASET_BY_ID } from '../domain/catalog.ts';
import { HttpError, recordAudit } from './common.ts';
import { loadTables, getRecord } from './data.ts';
import { CRITICALITIES, CRITICALITY_POLICY, criticalityOf, criticalitySQL, type Criticality } from '../domain/criticality.ts';

export type IssueRow = {
  id: string;
  fingerprint: string;
  rule_id: string;
  rule_version: string;
  issue_type: string;
  category: string;
  table_name: string;
  record_id: string | null;
  record_key: string;
  year: number | null;
  field: string | null;
  observed_value: string | null;
  candidate_value: string | null;
  candidate_unit: string | null;
  action: string;
  evidence_ids: string[];
  severity: string;
  criticality: Criticality;
  criticality_policy: string;
  confidence: number;
  impact: string;
  explanation: string;
  explanation_en: string;
  status: string;
  detection_state: string;
  revision: number;
  first_seen_at: string;
  last_seen_at: string;
  decided_at: string | null;
};

export function issueFromRow(r: Record<string, unknown>): IssueRow {
  return { ...(r as unknown as IssueRow), criticality: criticalityOf({ severity: String(r.severity), impact: String(r.impact) }), criticality_policy: CRITICALITY_POLICY, evidence_ids: json<string[]>(r.evidence_ids_json, []), confidence: Number(r.confidence), revision: Number(r.revision), year: r.year === null ? null : Number(r.year) };
}

export const fingerprintOf = (f: Pick<Finding, 'rule_id' | 'record_key' | 'field'>) => sha256(`${f.rule_id}|${f.record_key}|${f.field ?? ''}`);

export function runScan(db: DB, opts: { tables?: string[] } = {}) {
  const scanId = newId('scan');
  const started = nowIso();
  const tables = loadTables(db, RULE_TABLES);
  const findings = runRules(tables, { tables: opts.tables });
  const scope = opts.tables?.length ? opts.tables : null;
  const counts = { created: 0, updated: 0, unchanged: 0, missing: 0 };
  tx(db, () => {
    run(db, `INSERT INTO scans (id, started_at, rules_version, scope_json) VALUES (?, ?, ?, ?)`, scanId, started, RULES_VERSION, JSON.stringify(scope || 'all'));
    const seen = new Set<string>();
    const find = db.prepare('SELECT * FROM dq_issues WHERE fingerprint = ?');
    for (const f of findings) {
      const fp = fingerprintOf(f);
      if (seen.has(fp)) continue; // one fingerprint = one issue
      seen.add(fp);
      const existing = find.get(fp) as Record<string, unknown> | undefined;
      const content = { observed_value: f.observed, candidate_value: f.candidate, severity: f.severity, evidence_ids_json: JSON.stringify(f.evidence_ids), explanation_en: f.en, record_id: f.record_id };
      if (!existing) {
        const id = `dq_${fp.slice(0, 16)}`;
        run(
          db,
          `INSERT INTO dq_issues (id, fingerprint, rule_id, rule_version, issue_type, category, table_name, record_id, record_key, year, field, observed_value,
             candidate_value, candidate_unit, action, evidence_ids_json, severity, confidence, impact, explanation, explanation_en, status, detection_state,
             revision, first_seen_at, last_seen_at, last_scan_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', 'active', 1, ?, ?, ?)`,
          id, fp, f.rule_id, RULES_VERSION, f.issue_type, f.category, f.table, f.record_id, f.record_key, f.year, f.field, f.observed,
          f.candidate, f.candidate_unit, f.action, JSON.stringify(f.evidence_ids), f.severity, f.confidence, f.impact, f.fi, f.en, started, started, scanId,
        );
        run(db, 'INSERT INTO dq_issue_history (issue_id, scan_id, at, change, details_json) VALUES (?, ?, ?, ?, ?)', id, scanId, started, 'created', JSON.stringify({ observed: f.observed, candidate: f.candidate }));
        counts.created++;
        continue;
      }
      const changed = (Object.keys(content) as (keyof typeof content)[]).some((k) => (existing[k] ?? null) !== (content[k] ?? null));
      if (changed && existing.status === 'open') {
        run(
          db,
          `UPDATE dq_issues SET observed_value = ?, candidate_value = ?, severity = ?, evidence_ids_json = ?, explanation = ?, explanation_en = ?, record_id = ?,
             confidence = ?, rule_version = ?, revision = revision + 1, detection_state = 'active', last_seen_at = ?, last_scan_id = ? WHERE id = ?`,
          f.observed, f.candidate, f.severity, JSON.stringify(f.evidence_ids), f.fi, f.en, f.record_id, f.confidence, RULES_VERSION, started, scanId, existing.id as string,
        );
        run(db, 'INSERT INTO dq_issue_history (issue_id, scan_id, at, change, details_json) VALUES (?, ?, ?, ?, ?)', existing.id as string, scanId, started, 'evidence_updated',
          JSON.stringify({ before: { observed: existing.observed_value, candidate: existing.candidate_value, evidence: json(existing.evidence_ids_json, []) }, after: { observed: f.observed, candidate: f.candidate, evidence: f.evidence_ids } }));
        counts.updated++;
      } else {
        // Decided issues keep their decision; new evidence on them is recorded in history only.
        if (changed) run(db, 'INSERT INTO dq_issue_history (issue_id, scan_id, at, change, details_json) VALUES (?, ?, ?, ?, ?)', existing.id as string, scanId, started, 'evidence_changed_after_decision', JSON.stringify({ observed: f.observed, candidate: f.candidate }));
        if (existing.detection_state !== 'active') run(db, 'INSERT INTO dq_issue_history (issue_id, scan_id, at, change) VALUES (?, ?, ?, ?)', existing.id as string, scanId, started, 'detected_again');
        run(db, `UPDATE dq_issues SET detection_state = 'active', last_seen_at = ?, last_scan_id = ? WHERE id = ?`, started, scanId, existing.id as string);
        counts.unchanged++;
      }
    }
    // Issues from scanned tables that this scan no longer produces stay as they are (never auto-resolved),
    // but are marked so a reviewer can see the rule no longer fires on the current data.
    const scopeTables = scope ? scope : null;
    const stale = all<{ id: string; table_name: string; fingerprint: string; detection_state: string }>(db, `SELECT id, table_name, fingerprint, detection_state FROM dq_issues WHERE detection_state = 'active' AND rule_id NOT LIKE 'agent.%'`);
    for (const s of stale) {
      if (seen.has(s.fingerprint)) continue;
      if (scopeTables && !scopeTables.includes(s.table_name)) continue;
      run(db, `UPDATE dq_issues SET detection_state = 'not_detected_in_last_scan' WHERE id = ?`, s.id);
      run(db, 'INSERT INTO dq_issue_history (issue_id, scan_id, at, change) VALUES (?, ?, ?, ?)', s.id, scanId, started, 'not_detected');
      counts.missing++;
    }
    run(db, 'UPDATE scans SET finished_at = ?, created_count = ?, updated_count = ?, unchanged_count = ?, missing_count = ? WHERE id = ?', nowIso(), counts.created, counts.updated, counts.unchanged, counts.missing, scanId);
    recordAudit(db, { event_type: 'quality.scan', actor_kind: 'system', actor_label: 'system', entity_type: 'scan', entity_id: scanId, after: { rules_version: RULES_VERSION, findings: findings.length, ...counts, scope: scope || 'all' } });
  });
  return { scan_id: scanId, rules_version: RULES_VERSION, findings: findings.length, ...counts };
}

export const IncludeShared = z.union([z.boolean(),z.enum(['true','false']).transform(value=>value==='true')]).optional();
export type IssueFilter = { status?: string; severity?: string; criticality?: Criticality; table?: string; year?: number; include_shared?: boolean; category?: string; issue_type?: string; rule_id?: string; q?: string; sort?: 'impact' | 'priority'; limit?: number; offset?: number };

export function issueFilterWhere(f: IssueFilter) {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (f.status) { where.push('status = ?'); params.push(f.status); }
  if (f.status === 'open') where.push("(rule_id NOT LIKE 'agent.%' OR detection_state = 'active')");
  if (f.severity) { where.push('severity = ?'); params.push(f.severity); }
  if (f.criticality) { where.push(`${criticalitySQL()} = ?`); params.push(f.criticality); }
  if (f.table) { where.push('table_name = ?'); params.push(f.table); }
  if (f.year) { where.push(f.include_shared?'(year = ? OR year IS NULL)':'year = ?'); params.push(f.year); }
  if (f.category) { where.push('category = ?'); params.push(f.category); }
  if (f.issue_type) { where.push('issue_type = ?'); params.push(f.issue_type); }
  if (f.rule_id) { where.push('rule_id = ?'); params.push(f.rule_id); }
  if (f.q) { where.push('(record_key LIKE ? OR explanation_en LIKE ? OR explanation LIKE ? OR rule_id LIKE ?)'); const like = `%${f.q}%`; params.push(like, like, like, like); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return { w, params };
}

// tCO2e each issue touches in the latest inventory calculation of its year. Contributions are
// linked to issues when the calculation is saved, so an issue raised later shows no figure.
export function issueImpact(db: DB) {
  const out = new Map<string, number>();
  const rows = all<{ tco2e: number; ids: string }>(db, `SELECT c.tco2e, c.open_issue_ids_json ids FROM calculation_contributions c
    WHERE c.in_total = 1 AND c.open_issue_ids_json != '[]' AND c.run_id IN (SELECT id FROM calculation_runs r WHERE kind = 'inventory'
      AND created_at = (SELECT MAX(created_at) FROM calculation_runs WHERE kind = 'inventory' AND year = r.year))`);
  for (const c of rows) for (const id of JSON.parse(c.ids) as string[]) out.set(id, (out.get(id) || 0) + c.tco2e);
  return out;
}

const SELECT_ISSUE = 'SELECT dq_issues.*, (SELECT source_file FROM source_records WHERE id = dq_issues.record_id) AS source_file, (SELECT source_row FROM source_records WHERE id = dq_issues.record_id) AS source_row FROM dq_issues';
const RANK = `CASE status WHEN 'open' THEN 0 ELSE 1 END * 10 + CASE ${criticalitySQL()} WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END`;

export function listIssues(db: DB, f: IssueFilter) {
  const { w, params } = issueFilterWhere(f);
  const limit = Math.min(Math.max(f.limit || 50, 1), 500);
  const offset = Math.max(f.offset || 0, 0);
  const total = Number(get<{ n: number }>(db, `SELECT COUNT(*) AS n FROM dq_issues ${w}`, ...params)?.n || 0);
  const impact = issueImpact(db);
  let rows: Row[];
  if (f.sort === 'impact') {
    // Open before closed, then by footprint touched, then by criticality.
    const ranked = all<{ id: string; rank: number }>(db, `SELECT id, ${RANK} AS rank FROM dq_issues ${w} ORDER BY year DESC, record_key`, ...params)
      .sort((a, b) => Math.floor(a.rank / 10) - Math.floor(b.rank / 10) || (impact.get(b.id) || 0) - (impact.get(a.id) || 0) || a.rank - b.rank);
    const page = ranked.slice(offset, offset + limit).map((r) => r.id);
    const byId = new Map(all<Row>(db, `${SELECT_ISSUE} WHERE id IN (SELECT value FROM json_each(?))`, JSON.stringify(page)).map((r) => [String(r.id), r]));
    rows = page.map((id) => byId.get(id)!).filter(Boolean);
  } else {
    rows = all<Row>(db, `${SELECT_ISSUE} ${w} ORDER BY ${RANK}, year DESC, record_key LIMIT ? OFFSET ?`, ...params, limit, offset);
  }
  return { total, limit, offset, items: rows.map(issueFromRow).map((i) => ({ ...i, tco2e_affected: impact.get(String(i.id)) ?? null })) };
}

export function issueStats(db: DB) {
  const rows = all<{ status: string; severity: string; n: number }>(db, "SELECT status, severity, COUNT(*) AS n FROM dq_issues WHERE status != 'open' OR rule_id NOT LIKE 'agent.%' OR detection_state = 'active' GROUP BY status, severity");
  const types = all<{ issue_type: string; n: number }>(db, `SELECT issue_type, COUNT(*) AS n FROM dq_issues GROUP BY issue_type ORDER BY n DESC`);
  const tables = all<{ table_name: string; n: number }>(db, `SELECT table_name, COUNT(*) AS n FROM dq_issues WHERE status = 'open' AND (rule_id NOT LIKE 'agent.%' OR detection_state = 'active') GROUP BY table_name ORDER BY n DESC`);
  const years = all<{ year: number; n: number }>(db, `SELECT year, COUNT(*) AS n FROM dq_issues WHERE year IS NOT NULL GROUP BY year ORDER BY year`);
  const sumWhere = (p: (r: { status: string; severity: string }) => boolean) => rows.filter(p).reduce((s, r) => s + Number(r.n), 0);
  return {
    criticality_policy: CRITICALITY_POLICY,
    open_by_criticality: CRITICALITIES.map((level) => ({ criticality: level, count: Number(get<{ n: number }>(db, `SELECT COUNT(*) AS n FROM dq_issues WHERE status = 'open' AND (rule_id NOT LIKE 'agent.%' OR detection_state = 'active') AND ${criticalitySQL()} = ?`, level)?.n || 0) })),
    total: sumWhere(() => true),
    open: sumWhere((r) => r.status === 'open'),
    open_high: sumWhere((r) => r.status === 'open' && r.severity === 'high'),
    approved: sumWhere((r) => r.status === 'approved'),
    rejected: sumWhere((r) => r.status === 'rejected'),
    types: types.map((t) => ({ issue_type: t.issue_type, count: Number(t.n) })),
    open_by_table: tables.map((t) => ({ table: t.table_name, count: Number(t.n) })),
    years: years.map((y) => ({ year: Number(y.year), count: Number(y.n) })),
  };
}

export function getIssueDetail(db: DB, id: string) {
  const row = get(db, 'SELECT * FROM dq_issues WHERE id = ?', id);
  if (!row) throw new HttpError(404, `Issue ${id} not found`);
  const issue = issueFromRow(row);
  const record = issue.record_id ? getRecord(db, issue.record_id) : null;
  const batch = record ? get(db, 'SELECT b.id, b.filename, b.sha256, b.imported_at FROM import_batches b JOIN source_records r ON r.batch_id = b.id WHERE r.id = ?', record.id) : null;
  const evidence = issue.evidence_ids.map((eid) => getRecord(db, eid)).filter((r) => r !== null);
  const history = all(db, 'SELECT at, change, details_json, scan_id FROM dq_issue_history WHERE issue_id = ? ORDER BY id', id).map((h) => ({ ...h, details: json(h.details_json, {}) }));
  const correction = get(db, 'SELECT * FROM corrections WHERE issue_id = ?', id);
  const investigations = all(db, 'SELECT * FROM investigations WHERE issue_id = ? ORDER BY started_at DESC', id).map((i) => ({ ...i, result: json(i.result_json, null), tool_calls: json(i.tool_calls_json, []), evidence_ids: json(i.evidence_ids_json, []) }));
  const data_reviews = all(db, 'SELECT f.*, r.model, r.mode, r.created_at FROM data_review_findings f JOIN data_review_runs r ON r.id = f.run_id WHERE f.issue_id = ? ORDER BY r.rowid DESC', id).map((f) => ({ ...f, evidence_ids: json(f.evidence_ids_json, []) }));
  return { issue, record, batch, evidence, history, correction: correction ? { ...correction, evidence_ids: json(correction.evidence_ids_json, []) } : null, investigations, data_reviews };
}

export const ReviewBody = z.object({
  decision: z.enum(['approve', 'reject']),
  reviewer_label: z.string().transform((s) => sanitizeLabel(s, 80)).pipe(z.string().min(1, 'reviewer_label is required')),
  reason: z.string().max(1000).optional().transform((s) => (s ? s.replace(/[\u0000-\u001f\u007f]/g, ' ').trim() : undefined)),
  expected_revision: z.number().int().positive(),
  approved_value: z.string().max(4000).optional(),
  proposed_by: z.enum(['rule', 'ai_investigation']).optional(),
  investigation_id: z.string().max(64).optional(),
});
export type ReviewInput = z.infer<typeof ReviewBody>;

export const EvidenceRequest = z.object({ reviewer_label: z.string().transform((s) => sanitizeLabel(s, 80)).pipe(z.string().min(1)), reason: z.string().trim().min(5).max(1000), expected_revision: z.number().int().positive() });
export function requestIssueEvidence(db: DB, id: string, input: z.infer<typeof EvidenceRequest>) {
  return tx(db, () => {
    const issue = get<{ status: string; revision: number }>(db, 'SELECT status, revision FROM dq_issues WHERE id = ?', id);
    if (!issue) throw new HttpError(404, `Issue ${id} not found`);
    if (issue.status !== 'open' || issue.revision !== input.expected_revision) throw new HttpError(409, 'The finding changed. Reload before requesting evidence.');
    run(db, 'UPDATE dq_issues SET revision = revision + 1 WHERE id = ?', id);
    run(db, 'INSERT INTO dq_issue_history (issue_id, at, change, details_json) VALUES (?, ?, ?, ?)', id, nowIso(), 'evidence_requested', JSON.stringify({ reviewer_label: input.reviewer_label, reason: input.reason }));
    recordAudit(db, { event_type: 'issue.evidence_requested', actor_kind: 'reviewer', actor_label: input.reviewer_label, entity_type: 'dq_issue', entity_id: id, reason: input.reason, after: { status: 'open' } });
    return { status: 'open', message: 'Evidence request recorded locally. No message was sent and no data changed.' };
  });
}

export function reviewIssue(db: DB, id: string, input: ReviewInput) {
  return tx(db, () => {
    const row = get(db, 'SELECT * FROM dq_issues WHERE id = ?', id);
    if (!row) throw new HttpError(404, `Issue ${id} not found`);
    const issue = issueFromRow(row);
    if (issue.revision !== input.expected_revision) {
      throw new HttpError(409, `Issue ${id} changed since it was loaded (revision ${issue.revision}, expected ${input.expected_revision}). Reload and review again.`, { current_revision: issue.revision });
    }
    if (issue.status !== 'open') throw new HttpError(409, `Issue ${id} was already ${issue.status}.`, { status: issue.status });
    const approve = input.decision === 'approve';
    let approvedValue: string | null = null;
    let evidence = issue.evidence_ids;
    const proposedBy = input.proposed_by || 'rule';
    if (approve && (issue.action === 'set_value' || issue.action === 'add_record')) {
      approvedValue = input.approved_value ?? issue.candidate_value;
      if (approvedValue === null || approvedValue === '') throw new HttpError(400, 'This issue has no candidate value; provide approved_value to approve it.');
      if (issue.rule_id.startsWith('agent.')) {
        if (!input.reason?.trim()) throw new HttpError(400, 'An agent concern requires a reason and supporting evidence for the human-entered replacement.');
        const numeric = issue.field && (DATASET_BY_ID.get(issue.table_name)?.numeric.includes(issue.field) || ['year', 'month', 'lat', 'lon'].includes(issue.field) || /_share$|_pct/.test(issue.field));
        if (numeric && parseNumber(approvedValue) === null) throw new HttpError(400, 'The verified replacement must be a valid number for this field.');
      }
      if (issue.action === 'add_record') {
        try {
          const obj = JSON.parse(approvedValue);
          if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('not an object');
        } catch {
          throw new HttpError(400, 'approved_value for an added record must be a JSON object.');
        }
      }
      if (issue.action === 'set_value' && issue.record_id && issue.field) {
        const clash = get<{ issue_id: string }>(db, `SELECT issue_id FROM corrections WHERE record_id = ? AND field = ? AND status = 'approved' AND action = 'set_value'`, issue.record_id, issue.field);
        if (clash) throw new HttpError(409, `Field ${issue.field} of ${issue.record_key} already has an approved correction from issue ${clash.issue_id}.`, { conflicting_issue: clash.issue_id });
      }
    }
    if (proposedBy === 'ai_investigation') {
      const inv = input.investigation_id ? get<{ evidence_ids_json: string; issue_id: string }>(db, 'SELECT evidence_ids_json, issue_id FROM investigations WHERE id = ?', input.investigation_id) : undefined;
      if (!inv || inv.issue_id !== id) throw new HttpError(400, 'proposed_by=ai_investigation requires the investigation_id of this issue.');
      evidence = [...new Set([...evidence, ...json<string[]>(inv.evidence_ids_json, [])])];
    }
    const record = issue.record_id ? getRecord(db, issue.record_id) : null;
    const original = record && issue.field ? record.payload[issue.field] ?? null : issue.observed_value;
    const correctionId = newId('cor');
    const at = nowIso();
    run(
      db,
      `INSERT INTO corrections (id, issue_id, record_id, record_key, table_name, field, action, original_value, approved_value, status, reviewer_label, reason,
         decided_at, issue_revision, proposed_by, evidence_ids_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      correctionId, id, issue.record_id, issue.record_key, issue.table_name, issue.field, issue.action, original, approve ? approvedValue : null,
      approve ? 'approved' : 'rejected', input.reviewer_label, input.reason ?? null, at, issue.revision, proposedBy, JSON.stringify(evidence),
    );
    run(db, `UPDATE dq_issues SET status = ?, revision = revision + 1, decided_at = ? WHERE id = ?`, approve ? 'approved' : 'rejected', at, id);
    run(db, 'INSERT INTO dq_issue_history (issue_id, at, change, details_json) VALUES (?, ?, ?, ?)', id, at, approve ? 'approved' : 'rejected', JSON.stringify({ correction_id: correctionId, reviewer_label: input.reviewer_label }));
    recordAudit(db, {
      event_type: approve ? 'issue.approved' : 'issue.rejected', actor_kind: 'reviewer', actor_label: input.reviewer_label, entity_type: 'dq_issue', entity_id: id,
      before: { status: 'open', revision: issue.revision, field: issue.field, value: original },
      after: { status: approve ? 'approved' : 'rejected', revision: issue.revision + 1, action: issue.action, value: approve ? approvedValue : original, correction_id: correctionId, proposed_by: proposedBy },
      reason: input.reason ?? null, correlation_id: correctionId,
    });
    return { issue: issueFromRow(get(db, 'SELECT * FROM dq_issues WHERE id = ?', id)!), correction_id: correctionId, recalculation_required: approve && issue.action !== 'acknowledge' };
  });
}

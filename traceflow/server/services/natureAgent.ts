// The nature analyst's read-only tools (used by "Ask the team", experts.ts). The model never sees
// or writes SQL: it chooses a catalogued query id and bind parameters, which are validated exactly
// like the Python CLI. Each returned row gets an evidence id the answer may cite.
import type { NatureConfig } from '../config.ts';
import { type Row } from '../db/database.ts';
import { HttpError } from './common.ts';
import { listQueries, runQuery, traceResult } from './nature.ts';

export const NATURE_LIMITS = { maxToolCalls: 6, maxRounds: 3, rowsPerResult: 40, timeoutMs: 30000 };

type Evidence = { id: string; label: string; value: string; source: string; link: string };
const short = (v: unknown) => (typeof v === 'string' && v.length > 300 ? `${v.slice(0, 300)}…` : v);

export function natureTool(cfg: NatureConfig, name: string, args: Record<string, unknown>, evidence: Map<string, Evidence>) {
  if (name === 'list_nature_queries') return { queries: listQueries(cfg).map((q) => ({ id: q.id, description: q.description, grain: q.grain, parameters: q.parameters })) };
  if (name === 'run_nature_query') {
    const queryId = String(args.query_id ?? '');
    const params = args.params && typeof args.params === 'object' && !Array.isArray(args.params) ? (args.params as Record<string, unknown>) : {};
    const r = runQuery(cfg, queryId, params);
    const rows = r.rows.slice(0, NATURE_LIMITS.rowsPerResult).map((row) => {
      const id = `nq:${queryId}:${String(row.result_key)}`;
      const link = `/nature?tab=queries&query=${encodeURIComponent(queryId)}`;
      evidence.set(id, { id, label: `${queryId} · ${String(row.result_key)}`, value: Object.entries(row).filter(([k]) => k !== 'result_key').slice(0, 8).map(([k, v]) => `${k}=${v ?? '—'}`).join(', '), source: `nature query ${queryId} (${JSON.stringify(r.parameters)})`, link });
      return { evidence_id: id, ...Object.fromEntries(Object.entries(row).map(([k, v]) => [k, short(v)])) };
    });
    return { query_id: queryId, parameters: r.parameters, columns: r.columns, row_count: r.row_count, rows, truncated: r.row_count > rows.length, note: r.row_count > rows.length ? `Only ${rows.length} of ${r.row_count} rows are shown. Narrow the parameters to see others.` : undefined };
  }
  if (name === 'get_nature_lineage') {
    const queryId = String(args.query_id ?? '');
    const key = String(args.result_key ?? '');
    const t = traceResult(cfg, queryId, key, args.run_id ? String(args.run_id) : undefined);
    const byTable: Record<string, number> = {};
    for (const e of t.entities) byTable[String(e.table_name)] = (byTable[String(e.table_name)] || 0) + 1;
    const id = `lineage:${queryId}:${key}`;
    const files = t.source_files.map((f: Row) => String(f.relative_path));
    evidence.set(id, { id, label: `Lineage of ${queryId} · ${key}`, value: `${t.entities.length} entities, ${t.source_records.length} source records from ${files.join(', ')}`, source: `query run ${String(t.query_run.query_run_id)}`, link: `/nature?tab=queries&query=${encodeURIComponent(queryId)}` });
    const methods = (t.method_context as { methods?: Row[] }).methods || [];
    return { evidence_id: id, run_id: t.query_run.query_run_id, entities_by_table: byTable, source_records: t.source_records.length, source_files: t.source_files.map((f: Row) => ({ path: f.relative_path, sha256: f.sha256 })), transformations: t.transformations.map((x: Row) => x.transformation_id), methods: methods.map((m: Row) => ({ method_id: m.method_id, ...Object.fromEntries(Object.entries(m).filter(([k]) => k !== 'method_id').slice(0, 3).map(([k, v]) => [k, short(v)])) })), scope: t.scope };
  }
  throw new HttpError(400, 'Tool is not allowed. Only the three read-only nature tools exist.');
}

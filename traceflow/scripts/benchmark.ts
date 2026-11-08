// Benchmark against the public 2023/2024 dev answers of the challenge package.
// Runs in a throwaway database (never the working one):
//  1. imports the package, runs the rules and scores them with the A1 formula
//     100 × F1 × (0.75 + 0.25 × type accuracy) against tasks/dev/A1_dev_issue_labels_2023_2024.csv;
//  2. calculates 2023 and 2024 with no corrections, then again after SIMULATING a reviewer who
//     approves every rule proposal (a measurement of the rules, not a recommended workflow),
//     and compares both with tasks/dev/A2_dev_inventory_{year}.csv.
// Usage: npm run benchmark -- "/path/to/APETIT_CLIMATE_NATURE_NAVIGATOR_2026"
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { all, openDatabase } from '../server/db/database.ts';
import { parseCsv } from '../server/domain/csv.ts';
import { benchmark, createRun } from '../server/services/calculations.ts';
import { reviewIssue, runScan } from '../server/services/quality.ts';
import { importChallenge } from './import-challenge.ts';

const root = process.argv[2] || process.env.CHALLENGE_DATA_DIR;
if (!root) {
  console.error('Usage: npm run benchmark -- <path to APETIT_CLIMATE_NATURE_NAVIGATOR_2026>');
  process.exit(2);
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'traceflow-bench-'));
const db = openDatabase(path.join(dir, 'bench.sqlite'));
const t0 = Date.now();
const files = await importChallenge(path.resolve(root), db, path.join(dir, 'uploads'));
const tImport = Date.now() - t0;
const rows = files.reduce((s, f) => s + f.imported, 0);
const t1 = Date.now();
const scan = runScan(db);
const tScan = Date.now() - t1;

const lab = parseCsv(fs.readFileSync(path.join(root, 'tasks/dev/A1_dev_issue_labels_2023_2024.csv')));
const labels = lab.rows.map((r) => Object.fromEntries(lab.headers.map((h, i) => [h, r[i]])));
const issues = all<{ record_key: string; issue_type: string; year: number }>(db, 'SELECT record_key, issue_type, year FROM dq_issues');
const a1: Record<string, unknown>[] = [];
for (const year of [2023, 2024]) {
  const truth = new Map(labels.filter((l) => Number(l.year) === year).map((l) => [l.record_key, l.issue_type]));
  const pred = new Map<string, Set<string>>();
  for (const i of issues.filter((x) => Number(x.year) === year)) pred.set(i.record_key, (pred.get(i.record_key) || new Set()).add(i.issue_type));
  let tp = 0;
  let typeOk = 0;
  for (const [k, types] of pred) if (truth.has(k)) { tp++; if (types.has(truth.get(k)!)) typeOk++; }
  const p = tp / Math.max(pred.size, 1);
  const r = tp / Math.max(truth.size, 1);
  const f1 = p + r ? (2 * p * r) / (p + r) : 0;
  a1.push({ year, labels: truth.size, flagged: pred.size, true_positive: tp, precision: +p.toFixed(3), recall: +r.toFixed(3), f1: +f1.toFixed(3), type_accuracy: +(typeOk / Math.max(tp, 1)).toFixed(3), a1_score: +(100 * f1 * (0.75 + 0.25 * (typeOk / Math.max(tp, 1)))).toFixed(1) });
}

const t2 = Date.now();
const raw = [2023, 2024].map((year) => createRun(db, { year, scope2_basis: 'market', trigger: 'benchmark:uncorrected' }));
const tRun = (Date.now() - t2) / 2;
// Simulation: accept every rule proposal that changes data (benchmark only).
let simulated = 0;
for (const i of all<{ id: string; revision: number; action: string; candidate_value: string | null }>(db, `SELECT id, revision, action, candidate_value FROM dq_issues WHERE status = 'open' AND (year IN (2023, 2024) OR year IS NULL) AND action <> 'acknowledge' ORDER BY rule_id`)) {
  if ((i.action === 'set_value' || i.action === 'add_record') && !i.candidate_value) continue;
  try {
    reviewIssue(db, i.id, { decision: 'approve', reviewer_label: 'BENCHMARK SIMULATION (not a person)', reason: 'benchmark: accept every rule proposal', expected_revision: i.revision });
    simulated++;
  } catch {
    /* conflicting proposals on the same field: first one wins */
  }
}
const fixed = [2023, 2024].map((year) => createRun(db, { year, scope2_basis: 'market', trigger: 'benchmark:all-proposals-approved' }));

const a2 = [0, 1].flatMap((i) => {
  const b0 = benchmark(db, raw[i].id).rows;
  const b1 = new Map(benchmark(db, fixed[i].id).rows.map((r) => [`${r.scope}|${r.category}`, r]));
  return b0.map((r) => ({ year: raw[i].year, line: `${r.scope}|${r.category}`, truth: r.benchmark_tco2e, uncorrected: r.run_tco2e, uncorrected_diff_pct: r.diff_pct, proposals_approved: b1.get(`${r.scope}|${r.category}`)?.run_tco2e, approved_diff_pct: b1.get(`${r.scope}|${r.category}`)?.diff_pct }));
});

console.log(`Imported ${files.length} files, ${rows} rows in ${tImport} ms; scan ${scan.findings} findings in ${tScan} ms; one inventory run ≈ ${Math.round(tRun)} ms`);
console.log('\nA1 rule quality vs dev labels:');
console.table(a1);
console.log(`\nA2 inventory vs dev truth (simulated approvals: ${simulated}):`);
console.table(a2);
const within = (k: 'uncorrected_diff_pct' | 'approved_diff_pct') => a2.filter((r) => r[k] !== null && Math.abs(Number(r[k])) <= 5).length;
console.log(`Lines within ±5 %: uncorrected ${within('uncorrected_diff_pct')}/${a2.length}, all proposals approved ${within('approved_diff_pct')}/${a2.length}`);
db.close();
fs.rmSync(dir, { recursive: true, force: true });

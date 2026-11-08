// Reproducible sample: imports the DEMO fixtures into a throwaway database, runs the rules,
// approves the DEMO PCF ×1000 correction as "Sample reviewer", calculates 2025 and writes the
// Excel workbook to docs/sample/traceflow_DEMO_2025.xlsx.   Usage: npm run sample
import fs from 'node:fs';
import path from 'node:path';
import { get, openDatabase } from '../server/db/database.ts';
import { migrateUp } from '../server/db/migrate.ts';
import { createRun } from '../server/services/calculations.ts';
import { importFile } from '../server/services/imports.ts';
import { reviewIssue, runScan } from '../server/services/quality.ts';
import { buildWorkbook } from '../server/services/workbook.ts';

const db = openDatabase(':memory:');
migrateUp(db);
const dir = path.resolve('tests/fixtures/demo');
for (const f of fs.readdirSync(dir).sort()) await importFile(db, path.resolve('data/uploads-sample'), { filename: f, bytes: fs.readFileSync(path.join(dir, f)), storeOriginal: false });
runScan(db);
const pcf = get<{ id: string; revision: number }>(db, `SELECT id, revision FROM dq_issues WHERE rule_id = 'pcf.value_scale_vs_history'`);
if (pcf) reviewIssue(db, pcf.id, { decision: 'approve', reviewer_label: 'Sample reviewer', reason: 'DEMO: supplier confirmed the value is per tonne', expected_revision: pcf.revision });
const run = createRun(db, { year: 2025, scope2_basis: 'market', trigger: 'sample' });
const out = path.resolve('docs/sample/traceflow_DEMO_2025.xlsx');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, await buildWorkbook(db, run.id));
console.log(`Wrote ${path.relative(process.cwd(), out)} (run ${run.id}, ${run.contribution_count} contributions, total ${run.totals.grand_total.toFixed(3)} tCO2e)`);

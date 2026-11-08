// Imports the Apetit × Since AI 2026 challenge package from a local folder into SQLite.
// Usage: npm run import:challenge -- "/path/to/APETIT_CLIMATE_NATURE_NAVIGATOR_2026"
// The files are read in place (not copied into the repository); originals are kept in data/uploads.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../server/config.ts';
import { openDatabase } from '../server/db/database.ts';
import { migrateUp } from '../server/db/migrate.ts';
import { importFile } from '../server/services/imports.ts';

try {
  process.loadEnvFile('.env');
} catch {
  /* .env is optional */
}

const SKIP = new Set([
  'weather_monthly_1991_2060.csv', 'climate_change_signals.csv', 'transition_scenarios.csv', 'decarbonisation_levers.csv',
  'contract_prices_and_replacement_premiums.csv', 'structural_events.csv', 'monitored_catchment_loads.csv',
  'origin_state_of_nature_indicative.csv',
]);

function collect(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(csv|json)$/i.test(e.name) && !SKIP.has(e.name) && e.name !== 'MANIFEST.json') out.push(p);
    }
  };
  const data = path.join(root, 'data');
  if (!fs.existsSync(data)) throw new Error(`No data/ folder under ${root}`);
  walk(data);
  const dev = path.join(root, 'tasks', 'dev');
  if (fs.existsSync(dev)) for (const f of fs.readdirSync(dev)) if (/^A2_dev_inventory_\d{4}\.csv$/.test(f)) out.push(path.join(dev, f));
  return out.sort();
}

export async function importChallenge(root: string, db = openDatabase(loadConfig().sqlitePath), uploadsDir = loadConfig().uploadsDir) {
  migrateUp(db);
  const files = collect(root);
  const results: { file: string; dataset: string; status: string; expected: number; imported: number; duplicates: number; rejected: number }[] = [];
  for (const file of files) {
    const rel = path.relative(root, file);
    try {
      const out = await importFile(db, uploadsDir, { filename: path.basename(file), bytes: fs.readFileSync(file) });
      const b = out.batch;
      results.push({ file: rel, dataset: b.dataset, status: b.status, expected: b.expected_rows, imported: b.imported_rows, duplicates: b.duplicate_rows, rejected: b.rejected_rows });
    } catch (e) {
      results.push({ file: rel, dataset: '-', status: `error: ${(e as Error).message}`, expected: 0, imported: 0, duplicates: 0, rejected: 0 });
    }
  }
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.argv[2] || process.env.CHALLENGE_DATA_DIR;
  if (!root) {
    console.error('Usage: npm run import:challenge -- <path to APETIT_CLIMATE_NATURE_NAVIGATOR_2026>');
    process.exit(2);
  }
  const results = await importChallenge(path.resolve(root));
  const pcf = results.filter((r) => r.dataset === 'supplier_pcf');
  const rest = results.filter((r) => r.dataset !== 'supplier_pcf');
  console.table(rest);
  if (pcf.length) console.log(`supplier_pcf: ${pcf.length} JSON files, ${pcf.reduce((s, r) => s + r.imported, 0)} imported, ${pcf.reduce((s, r) => s + r.duplicates, 0)} duplicates, ${pcf.filter((r) => r.status.startsWith('error')).length} errors`);
  const bad = results.filter((r) => r.status.startsWith('error') || r.rejected > 0);
  if (bad.length) console.log(`${bad.length} file(s) with errors or rejected rows`);
}

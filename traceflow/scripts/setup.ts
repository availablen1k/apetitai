// Initialises the local database: applies migrations and loads the regional weather aggregates
// shipped in tmp/region_rows.json. Optionally imports the challenge package:
//   npm run setup -- --challenge "/path/to/APETIT_CLIMATE_NATURE_NAVIGATOR_2026"
import path from 'node:path';
import { loadConfig } from '../server/config.ts';
import { openDatabase } from '../server/db/database.ts';
import { appliedMigrations, migrateUp } from '../server/db/migrate.ts';
import { seedWeatherYears } from '../server/services/workspace.ts';
import { importChallenge } from './import-challenge.ts';

try {
  process.loadEnvFile('.env');
} catch {
  /* optional */
}
const cfg = loadConfig();
const db = openDatabase(cfg.sqlitePath);
const applied = migrateUp(db);
console.log(`Database: ${cfg.sqlitePath}`);
console.log(`Migrations applied now: ${applied.length ? applied.join(', ') : 'none (up to date)'}; total applied: ${appliedMigrations(db).join(', ')}`);
const w = seedWeatherYears(db, path.resolve('tmp/region_rows.json'));
console.log(w.skipped ? `Weather years: ${w.loaded} already present (or tmp/region_rows.json missing)` : `Weather years: loaded ${w.loaded} rows from tmp/region_rows.json`);
const i = process.argv.indexOf('--challenge');
if (i > 0 && process.argv[i + 1]) {
  const results = await importChallenge(path.resolve(process.argv[i + 1]), db, cfg.uploadsDir);
  const rows = results.reduce((s, r) => s + r.imported, 0);
  const dup = results.reduce((s, r) => s + r.duplicates, 0);
  const rej = results.reduce((s, r) => s + r.rejected, 0);
  console.log(`Challenge import: ${results.length} files, ${rows} new rows, ${dup} duplicates skipped, ${rej} rejected rows, ${results.filter((r) => r.status.startsWith('error')).length} file errors`);
}
db.close();

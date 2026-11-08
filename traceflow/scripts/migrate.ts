// npm run db:migrate -- [up|down|reset-check|status]
import { loadConfig } from '../server/config.ts';
import { openDatabase } from '../server/db/database.ts';
import { appliedMigrations, migrateDown, migrateUp } from '../server/db/migrate.ts';

try {
  process.loadEnvFile('.env');
} catch {
  /* optional */
}
const db = openDatabase(loadConfig().sqlitePath);
const cmd = process.argv[2] || 'status';
if (cmd === 'up') console.log('applied:', migrateUp(db));
else if (cmd === 'down') console.log('reverted:', migrateDown(db, 1));
else console.log('applied migrations:', appliedMigrations(db));
db.close();

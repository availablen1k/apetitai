// Ordered SQL migrations: NNN_name.up.sql / NNN_name.down.sql, each applied in one transaction.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type DB, all, tx, nowIso, run } from './database.ts';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

type Migration = { id: string; up: string; down: string };

export function listMigrations(dir = DIR): Migration[] {
  const ups = fs.readdirSync(dir).filter((f) => f.endsWith('.up.sql')).sort();
  return ups.map((f) => {
    const id = f.replace(/\.up\.sql$/, '');
    const downFile = path.join(dir, `${id}.down.sql`);
    if (!fs.existsSync(downFile)) throw new Error(`Migration ${id} has no down file`);
    return { id, up: fs.readFileSync(path.join(dir, f), 'utf8'), down: fs.readFileSync(downFile, 'utf8') };
  });
}

function ensureTable(db: DB) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
}

export function appliedMigrations(db: DB): string[] {
  ensureTable(db);
  return all<{ id: string }>(db, 'SELECT id FROM schema_migrations ORDER BY id').map((r) => r.id);
}

export function migrateUp(db: DB): string[] {
  const done = new Set(appliedMigrations(db));
  const applied: string[] = [];
  for (const m of listMigrations()) {
    if (done.has(m.id)) continue;
    tx(db, () => {
      db.exec(m.up);
      run(db, 'INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)', m.id, nowIso());
    });
    applied.push(m.id);
  }
  return applied;
}

// Reverts the newest applied migrations; steps = Infinity reverts everything.
export function migrateDown(db: DB, steps = 1): string[] {
  const byId = new Map(listMigrations().map((m) => [m.id, m]));
  const reverted: string[] = [];
  for (const id of appliedMigrations(db).reverse().slice(0, steps)) {
    const m = byId.get(id);
    if (!m) throw new Error(`Applied migration ${id} has no file on disk`);
    tx(db, () => {
      db.exec(m.down);
      run(db, 'DELETE FROM schema_migrations WHERE id = ?', id);
    });
    reverted.push(id);
  }
  return reverted;
}

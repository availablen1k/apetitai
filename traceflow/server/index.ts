// Local API entry point: loads .env, opens SQLite, applies migrations and listens on loopback only.
import { buildApp } from './app.ts';
import { ConfigError, loadConfig } from './config.ts';
import { openDatabase } from './db/database.ts';
import { migrateUp } from './db/migrate.ts';
import { aiStatus } from './services/gemini.ts';

try {
  process.loadEnvFile('.env');
} catch {
  /* .env is optional; defaults apply */
}

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`Node ${process.versions.node} is too old: Node 22.13 or newer is required (built-in node:sqlite and TypeScript type stripping).`);
  process.exit(1);
}

let cfg;
try {
  cfg = loadConfig();
} catch (e) {
  if (e instanceof ConfigError) {
    console.error(`Configuration error: ${e.message}`);
    process.exit(1);
  }
  throw e;
}

const db = openDatabase(cfg.sqlitePath);
const applied = migrateUp(db);
const app = await buildApp({ db, cfg });
const ai = aiStatus(cfg);
app.log.info(
  { node: process.versions.node, database: cfg.sqlitePath, migrations_applied_now: applied, ai: ai.configured ? `configured (${ai.model})` : `not configured: ${ai.reason}`, routing: cfg.routingProvider, here: cfg.hereApiKey ? 'configured' : 'not configured' },
  'startup diagnostics',
);

try {
  await app.listen({ host: cfg.host, port: cfg.port });
} catch (e) {
  const err = e as NodeJS.ErrnoException;
  if (err.code === 'EADDRINUSE') console.error(`Port ${cfg.port} on ${cfg.host} is already in use. Stop the other process or set API_PORT in .env (and restart Vite so the proxy follows).`);
  else console.error(err);
  process.exit(1);
}

const shutdown = async () => {
  await app.close();
  db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

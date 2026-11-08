// Shared test helpers: an isolated app on an in-memory database and multipart bodies.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from '../server/app.ts';
import { loadConfig } from '../server/config.ts';
import { type DB, openDatabase } from '../server/db/database.ts';
import { migrateUp } from '../server/db/migrate.ts';
import type { LlmClient } from '../server/services/gemini.ts';

export const FIXTURES = path.resolve('tests/fixtures/demo');

export async function makeApp(opts: { llm?: LlmClient | null; env?: Record<string, string>; before?: (db: DB) => void } = {}) {
  const uploads = fs.mkdtempSync(path.join(os.tmpdir(), 'traceflow-test-'));
  // Tests never touch the real nature model: by default it points at an empty folder (not built).
  const cfg = loadConfig({ SQLITE_PATH: ':memory:', UPLOADS_DIR: uploads, GEMINI_API_KEY: '', AUTO_REVIEW_IMPORTS: 'false', DISCOVERY_AFTER_CALCULATION: 'false', NATURE_MODEL_DIR: path.join(uploads, 'no-nature-model'), ...opts.env });
  const db = openDatabase(':memory:');
  migrateUp(db);
  opts.before?.(db);
  const app = await buildApp({ db, cfg, llm: opts.llm === undefined ? null : opts.llm, logger: false });
  return { app, db, cfg, cleanup: async () => { await app.close(); db.close(); fs.rmSync(uploads, { recursive: true, force: true }); } };
}

export function multipart(files: { filename: string; content: Buffer | string }[], fields: Record<string, string> = {}) {
  const boundary = `----traceflow${Date.now().toString(16)}`;
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  for (const f of files) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${f.filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`));
    parts.push(Buffer.isBuffer(f.content) ? f.content : Buffer.from(f.content));
    parts.push(Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, host: '127.0.0.1:8787' } };
}

export const fixture = (name: string) => ({ filename: name, content: fs.readFileSync(path.join(FIXTURES, name)) });
export const ALL_FIXTURES = () => fs.readdirSync(FIXTURES).sort().map(fixture);
export const H = { host: '127.0.0.1:8787' };

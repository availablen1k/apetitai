// Runs the nature model's own Python tools (nature_model/tools/*.py) as child processes, one at a
// time, so a rebuild can never overlap a saved query or a nutrient run. Python stays the only
// writer of nature.sqlite and of the experiment run directories; TraceFlow records each job here.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { NatureConfig } from '../config.ts';
import { type DB, type Row, get, json, nowIso, run } from '../db/database.ts';
import { newId } from '../domain/util.ts';
import { HttpError, recordAudit } from './common.ts';
import { listNutrientRuns, listQueries, runDirectory, stateAtRisk, validateParameters, withNature } from './nature.ts';

const TAIL = 64 * 1024;
const ID = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:_-]{0,79}$/);
const Year = z.number().int().min(1900).max(2200);

export const NatureJobBody = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('rebuild'), request_id: ID, requested_by: z.string().trim().min(1).max(80), confirm_discard: z.boolean().optional() }),
  z.object({ kind: z.literal('save_query'), request_id: ID, requested_by: z.string().trim().min(1).max(80), query_id: ID, params: z.record(z.string(), z.unknown()).default({}) }),
  z.object({ kind: z.literal('nutrient_inputs'), request_id: ID, requested_by: z.string().trim().min(1).max(80), year: Year }),
  z.object({ kind: z.literal('nutrient_losses'), request_id: ID, requested_by: z.string().trim().min(1).max(80), input_run_id: ID, catchment_id: ID, year: Year }),
]);
export type NatureJobInput = z.infer<typeof NatureJobBody>;

type Step = { phase: string; script: string; args: string[]; parse: 'json' | 'saved_run' | 'snapshot' };
type Outcome = { code: number | null; stdout: string; stderr: string; timedOut: boolean; spawnError: string | null };

const tail = (s: string) => (s.length > TAIL ? s.slice(-TAIL) : s);

function jobView(r: Row | undefined) {
  if (!r) return null;
  return { id: r.id, request_id: r.request_id, kind: r.kind, params: json(r.params_json, {}), status: r.status, phase: r.phase, requested_by: r.requested_by, created_at: r.created_at, started_at: r.started_at, finished_at: r.finished_at, exit_code: r.exit_code, result: json(r.result_json, null), stdout_tail: r.stdout_tail, stderr_tail: r.stderr_tail, error: r.error };
}

// Only what Python needs: no API keys or other server secrets reach the child process.
function childEnv(cfg: NatureConfig) {
  const env: Record<string, string> = { PYTHONDONTWRITEBYTECODE: '1', PYTHONUNBUFFERED: '1' };
  for (const k of ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR']) if (process.env[k]) env[k] = process.env[k]!;
  if (cfg.dataDir) env.APETIT_DATA_DIR = cfg.dataDir;
  return env;
}

type PythonInfo = { available: boolean; version: string | null; sqlite: string | null; error: string | null };
const pythonCache = new Map<string, { at: number; value: PythonInfo }>();

export function pythonInfo(cfg: NatureConfig): Promise<PythonInfo> {
  const cached = pythonCache.get(cfg.python);
  if (cached && Date.now() - cached.at < 60_000) return Promise.resolve(cached.value);
  return new Promise((resolve) => {
    let out = '';
    let settled = false;
    const done = (value: PythonInfo) => {
      if (settled) return;
      settled = true;
      pythonCache.set(cfg.python, { at: Date.now(), value });
      resolve(value);
    };
    try {
      const child = spawn(cfg.python, ['-c', 'import sys,sqlite3;print(sys.version.split()[0], sqlite3.sqlite_version)'], { env: childEnv(cfg), timeout: 5000 });
      child.stdout.on('data', (d) => (out += d));
      child.on('error', (e) => done({ available: false, version: null, sqlite: null, error: `${cfg.python}: ${e.message}` }));
      child.on('close', (code) => {
        const [version, sqlite] = out.trim().split(/\s+/);
        done(code === 0 && version ? { available: true, version, sqlite: sqlite || null, error: null } : { available: false, version: null, sqlite: null, error: `${cfg.python} exited with ${code}` });
      });
    } catch (e) {
      done({ available: false, version: null, sqlite: null, error: (e as Error).message });
    }
  });
}

export function createNatureJobs(db: DB, cfg: NatureConfig) {
  let active: Promise<void> | null = null;
  let child: ReturnType<typeof spawn> | null = null;
  let stopped = false;
  const tools = (name: string) => path.join(cfg.modelDir, 'tools', name);
  const dataArgs = cfg.dataDir ? ['--data-dir', cfg.dataDir] : [];

  const exec = (step: Step): Promise<Outcome> => new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let spawnError: string | null = null;
    const proc = spawn(cfg.python, [step.script, ...step.args], { cwd: cfg.modelDir, env: childEnv(cfg), stdio: ['ignore', 'pipe', 'pipe'] });
    child = proc;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGTERM');
      setTimeout(() => proc.kill('SIGKILL'), 5000).unref();
    }, cfg.jobTimeoutMs);
    proc.stdout!.on('data', (d) => (stdout = tail(stdout + d)));
    proc.stderr!.on('data', (d) => (stderr = tail(stderr + d)));
    proc.on('error', (e) => (spawnError = `${cfg.python}: ${e.message}`));
    proc.on('close', (code) => {
      clearTimeout(timer);
      child = null;
      resolve({ code, stdout, stderr, timedOut, spawnError });
    });
  });

  const stepsFor = (kind: string, p: Record<string, unknown>): Step[] => {
    const database = ['--database', cfg.dbPath];
    if (kind === 'rebuild') {
      const steps: Step[] = [];
      if (p.snapshot_first) steps.push({ phase: 'snapshot', script: tools('create_snapshot.py'), args: database, parse: 'snapshot' });
      steps.push({ phase: 'building', script: tools('build_nature_model.py'), args: [...database, ...dataArgs], parse: 'json' });
      steps.push({ phase: 'verifying', script: tools('check_environment.py'), args: ['--verify-existing', ...database, ...dataArgs], parse: 'json' });
      return steps;
    }
    if (kind === 'save_query') return [{ phase: 'saving', script: tools('query_nature_model.py'), args: [...database, 'query', String(p.query_id), '--params', JSON.stringify(p.params || {}), '--save'], parse: 'saved_run' }];
    if (kind === 'nutrient_inputs') return [{ phase: 'building inputs', script: tools('build_nutrient_inputs.py'), args: [...database, ...dataArgs, '--year', String(p.year)], parse: 'json' }];
    return [{ phase: 'building pilot', script: tools('build_nutrient_losses.py'), args: [...database, ...dataArgs, '--inputs', path.join(runDirectory(cfg, 'inputs', String(p.input_run_id)), 'inputs.sqlite'), '--catchment-id', String(p.catchment_id), '--year', String(p.year)], parse: 'json' }];
  };

  const execute = async (id: string) => {
    const row = get<Row>(db, 'SELECT * FROM nature_jobs WHERE id = ?', id)!;
    const params = json<Record<string, unknown>>(row.params_json, {});
    run(db, "UPDATE nature_jobs SET status = 'running', started_at = ? WHERE id = ?", nowIso(), id);
    const results: Record<string, unknown> = {};
    let out = '';
    let err = '';
    try {
      const py = await pythonInfo(cfg);
      if (!py.available) throw new Error(`Python is not available (${py.error}). Install python3 or set PYTHON_PATH.`);
      for (const step of stepsFor(String(row.kind), params)) {
        if (stopped) throw new Error('Server stopping');
        run(db, 'UPDATE nature_jobs SET phase = ? WHERE id = ?', step.phase, id);
        const o = await exec(step);
        out = tail(`${out}\n# ${step.phase}\n${o.stdout}`);
        err = tail(`${err}\n# ${step.phase}\n${o.stderr}`);
        run(db, 'UPDATE nature_jobs SET exit_code = ?, stdout_tail = ?, stderr_tail = ? WHERE id = ?', o.code, out, err, id);
        if (o.spawnError) throw new Error(o.spawnError);
        if (o.timedOut) throw new Error(`${step.phase} exceeded ${Math.round(cfg.jobTimeoutMs / 60000)} minutes and was stopped. A partial run directory may remain; it is listed as incomplete.`);
        if (o.code !== 0) throw new Error(`${step.phase} failed (exit ${o.code}): ${(o.stderr.trim().split('\n').pop() || 'see stderr').slice(0, 400)}`);
        if (step.parse === 'json') {
          try { results[step.phase] = JSON.parse(o.stdout); } catch { throw new Error(`${step.phase} printed output that is not JSON; nothing is assumed to have succeeded.`); }
        } else if (step.parse === 'saved_run') {
          const m = o.stderr.match(/Saved query run: (\S+)/);
          if (!m) throw new Error('The query ran but no saved run id was reported.');
          results.saved_run_id = m[1];
        } else {
          results.snapshot = o.stdout.trim();
        }
      }
      run(db, "UPDATE nature_jobs SET status = 'succeeded', phase = 'completed', result_json = ?, finished_at = ? WHERE id = ?", JSON.stringify(results), nowIso(), id);
      recordAudit(db, { event_type: `nature.${row.kind}.succeeded`, actor_kind: 'reviewer', actor_label: String(row.requested_by), entity_type: 'nature_job', entity_id: id, after: { params, saved_run_id: results.saved_run_id ?? null, snapshot: results.snapshot ?? null } });
    } catch (e) {
      const message = (e as Error).message;
      const status = stopped ? 'interrupted' : 'failed';
      run(db, 'UPDATE nature_jobs SET status = ?, error = ?, result_json = ?, finished_at = ? WHERE id = ?', status, message, JSON.stringify(results), nowIso(), id);
      recordAudit(db, { event_type: `nature.${row.kind}.${status}`, actor_kind: 'reviewer', actor_label: String(row.requested_by), entity_type: 'nature_job', entity_id: id, after: { params, error: message } });
    }
  };

  const kick = () => {
    if (active || stopped) return;
    active = (async () => {
      for (;;) {
        if (stopped) break;
        const next = get<{ id: string }>(db, "SELECT id FROM nature_jobs WHERE status = 'queued' ORDER BY created_at, rowid LIMIT 1");
        if (!next) break;
        await execute(next.id);
      }
    })().finally(() => {
      active = null;
    });
  };

  // Checks that can fail before anything is queued (fail closed, with a clear reason).
  const prepare = (input: NatureJobInput): Record<string, unknown> => {
    if (!fs.existsSync(path.join(cfg.modelDir, 'tools/build_nature_model.py'))) throw new HttpError(409, `The nature model is not at ${cfg.modelDir}. Set NATURE_MODEL_DIR.`);
    if (input.kind === 'rebuild') {
      const risk = stateAtRisk(cfg);
      if (risk.at_risk && !input.confirm_discard) throw new HttpError(409, `Rebuilding replaces the database and drops ${risk.saved_runs} saved query run(s), ${risk.reviews} review(s) and ${risk.proposals} proposal(s). A snapshot is taken first; confirm to continue.`, risk);
      return { snapshot_first: risk.at_risk, at_risk: risk };
    }
    if (input.kind === 'save_query') {
      const q = listQueries(cfg).find((x) => x.id === input.query_id);
      if (!q) throw new HttpError(404, `Unknown nature query: ${input.query_id}`);
      return { query_id: input.query_id, params: validateParameters(q.parameters as Record<string, never>, input.params) };
    }
    if (input.kind === 'nutrient_inputs') {
      withNature(cfg, () => null);
      return { year: input.year };
    }
    const inputsRun = listNutrientRuns(cfg, 'inputs').find((r) => r.id === input.input_run_id);
    if (!inputsRun) throw new HttpError(404, `Unknown input run: ${input.input_run_id}`);
    if (!inputsRun.complete) throw new HttpError(409, `Input run ${input.input_run_id} is incomplete; create a new one.`);
    if (inputsRun.year !== input.year) throw new HttpError(409, `Input run ${input.input_run_id} is for ${inputsRun.year}, not ${input.year}.`);
    withNature(cfg, (ndb) => {
      if (!ndb.prepare('SELECT 1 FROM catchment WHERE catchment_id = ?').get(input.catchment_id)) throw new HttpError(404, `Unknown catchment: ${input.catchment_id}`);
    });
    return { input_run_id: input.input_run_id, catchment_id: input.catchment_id, year: input.year };
  };

  return {
    start() {
      run(db, "UPDATE nature_jobs SET status = 'interrupted', error = 'Server restarted while this job ran. Partial run directories are listed as incomplete; start a new job.', finished_at = ? WHERE status = 'running'", nowIso());
      kick();
    },
    submit(input: NatureJobInput) {
      const existing = get<Row>(db, 'SELECT * FROM nature_jobs WHERE request_id = ?', input.request_id);
      if (existing) {
        if (existing.kind !== input.kind) throw new HttpError(409, 'This request ID belongs to another nature job.');
        return { job: jobView(existing), reused: true };
      }
      const params = prepare(input);
      const id = newId('njob');
      run(db, "INSERT INTO nature_jobs (id, request_id, kind, params_json, status, phase, requested_by, created_at) VALUES (?, ?, ?, ?, 'queued', 'queued', ?, ?)", id, input.request_id, input.kind, JSON.stringify(params), input.requested_by, nowIso());
      recordAudit(db, { event_type: `nature.${input.kind}.queued`, actor_kind: 'reviewer', actor_label: input.requested_by, entity_type: 'nature_job', entity_id: id, after: params });
      kick();
      return { job: jobView(get<Row>(db, 'SELECT * FROM nature_jobs WHERE id = ?', id)), reused: false };
    },
    get(id: string) {
      const r = get<Row>(db, 'SELECT * FROM nature_jobs WHERE id = ?', id);
      if (!r) throw new HttpError(404, 'Nature job not found');
      return jobView(r);
    },
    list(limit = 50) {
      return (db.prepare('SELECT * FROM nature_jobs ORDER BY created_at DESC, rowid DESC LIMIT ?').all(limit) as Row[]).map(jobView);
    },
    async stop() {
      stopped = true;
      child?.kill('SIGTERM');
      await active;
    },
  };
}

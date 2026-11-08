import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { run as dbRun, nowIso } from '../../server/db/database.ts';
import type { LlmClient, LlmRequest, LlmTurn } from '../../server/services/gemini.ts';
import { HttpError } from '../../server/services/common.ts';
import { runDirectory, validateParameters } from '../../server/services/nature.ts';
import { H, makeApp } from '../helpers.ts';
import { makeNatureModel } from '../natureFixture.ts';

type Ctx = Awaited<ReturnType<typeof makeApp>>;
const read = async (ctx: Ctx, url: string) => ctx.app.inject({ method: 'GET', url, headers: H });
const post = (ctx: Ctx, url: string, payload: object) => ctx.app.inject({ method: 'POST', url, headers: H, payload });

async function natureApp(t: { after: (fn: () => unknown) => void }, env: Record<string, string> = {}, llm: LlmClient | null = null, withDatabase = true) {
  const model = makeNatureModel({ withDatabase });
  const ctx = await makeApp({ llm, env: { NATURE_MODEL_DIR: model.dir, ...env } });
  t.after(async () => { await ctx.cleanup(); model.cleanup(); });
  return { ctx, model };
}

async function finish(ctx: Ctx, id: string) {
  for (let i = 0; i < 400; i++) {
    const job = (await read(ctx, `/api/nature/jobs/${id}`)).json();
    if (!['queued', 'running'].includes(job.status)) return job;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('nature job did not finish');
}

test('nature: an unbuilt model reports not_built and every data endpoint fails closed with 409', async (t) => {
  const { ctx } = await natureApp(t, {}, null, false);
  const status = (await read(ctx, '/api/nature/status')).json();
  assert.equal(status.state, 'not_built');
  for (const url of ['/api/nature/queries', '/api/nature/catchments', '/api/nature/farms/F0001', '/api/nature/lineage?query_id=04_monitoring_change&result_key=CA01']) {
    const res = await read(ctx, url);
    assert.equal(res.statusCode, 409, url);
    assert.match(res.json().error, /not built/);
  }
  assert.equal((await read(ctx, '/api/nature/nutrient-runs?kind=inputs')).json().length, 0);
});

test('nature: a file that is not a nature database is reported as unreadable, not as data', async (t) => {
  const { ctx, model } = await natureApp(t, {}, null, false);
  fs.writeFileSync(model.dbPath, 'not sqlite');
  assert.equal((await read(ctx, '/api/nature/status')).json().state, 'unreadable');
  assert.equal((await read(ctx, '/api/nature/queries')).statusCode, 409);
});

test('nature: catalogued queries run read-only with validated parameters', async (t) => {
  const { ctx, model } = await natureApp(t);
  const before = fs.readFileSync(model.dbPath);
  const status = (await read(ctx, '/api/nature/status')).json();
  assert.equal(status.state, 'ready');
  assert.equal(status.counts.catchments, 2);
  const list = (await read(ctx, '/api/nature/queries')).json();
  assert.deepEqual(list.map((q: { id: string }) => q.id), ['01_contract_area', '03_ecological_context', '04_monitoring_change']);

  const r = (await post(ctx, '/api/nature/queries/04_monitoring_change/run', {})).json();
  assert.equal(r.row_count, 2);
  const ca01 = r.rows.find((x: { result_key: string }) => x.result_key === 'CA01');
  assert.equal(ca01.p_2019_kg, 5369);
  assert.equal(ca01.p_change_pct, -4.49);
  assert.equal(r.lineage_runs[0].run_id, '04_monitoring_change:default');

  const withYear = (await post(ctx, '/api/nature/queries/01_contract_area/run', { params: { year: 2018 } })).json();
  assert.deepEqual(withYear.parameters, { year: 2018 });
  assert.equal(withYear.lineage_runs.length, 0, 'no saved run exists for these parameters');
  assert.equal((await post(ctx, '/api/nature/queries/01_contract_area/run', { params: { year: '2018' } })).statusCode, 400);
  assert.equal((await post(ctx, '/api/nature/queries/01_contract_area/run', { params: { year: 1800 } })).statusCode, 400);
  assert.match((await post(ctx, '/api/nature/queries/01_contract_area/run', { params: { sql: 'DROP TABLE farm' } })).json().error, /Unknown parameters: sql/);
  assert.equal((await post(ctx, '/api/nature/queries/99_missing/run', {})).statusCode, 404);
  assert.deepEqual(fs.readFileSync(model.dbPath), before, 'reading never changes the nature database');
});

test('nature: parameter validation matches the Python CLI rules', () => {
  const schema = {
    year: { type: 'integer' as const, nullable: false, default: 2025, minimum: 1900, maximum: 2200 },
    country: { type: 'string' as const, nullable: true, default: null, enum: ['FI', 'SE'] },
    start_date: { type: 'string' as const, nullable: true, format: 'date' },
  };
  const cases: Record<string, unknown>[] = [{}, { year: 2018 }, { year: 1899 }, { year: 2018.5 }, { year: '2018' }, { year: true }, { year: null }, { country: 'FI' }, { country: 'NO' }, { start_date: '2025-02-30' }, { start_date: '2025-2-03' }, { start_date: '2025-02-03' }, { other: 1 }];
  const ts = cases.map((c) => { try { return { ok: validateParameters(schema, c) }; } catch (e) { return { error: (e as HttpError).message }; } });
  const script = `import json,sys\nsys.path.insert(0,${JSON.stringify(path.resolve('nature_model/tools'))})\nfrom nature_queries import parameters\nout=[]\nfor c in json.loads(sys.argv[1]):\n    try: out.append({'ok':parameters({'parameters':json.loads(sys.argv[2])},c)})\n    except ValueError as e: out.append({'error':str(e)})\nprint(json.dumps(out))`;
  const py = spawnSync('python3', ['-c', script, JSON.stringify(cases), JSON.stringify(schema)], { encoding: 'utf8' });
  assert.equal(py.status, 0, py.stderr);
  assert.deepEqual(ts, JSON.parse(py.stdout));
});

test('nature: lineage follows a saved result to its source file; geometry and farm context are served', async (t) => {
  const { ctx } = await natureApp(t);
  const lin = (await read(ctx, '/api/nature/lineage?query_id=04_monitoring_change&result_key=CA01')).json();
  assert.equal(lin.entities.length, 2);
  assert.deepEqual(lin.source_files.map((f: { relative_path: string }) => f.relative_path), ['06_nature/monitored_catchment_loads.csv']);
  assert.equal(lin.source_records[0].source_record_id, 'rec1');
  assert.equal((await read(ctx, '/api/nature/lineage?query_id=04_monitoring_change&result_key=NOPE')).statusCode, 404);
  assert.equal((await read(ctx, '/api/nature/lineage?query_id=04_monitoring_change&result_key=CA01&run_id=04_monitoring_change:missing')).statusCode, 404);

  const fc = (await read(ctx, '/api/nature/catchments')).json();
  assert.equal(fc.type, 'FeatureCollection');
  const f1 = fc.features.find((f: { id: string }) => f.id === 'CA01');
  assert.equal(f1.geometry.type, 'Polygon');
  assert.equal(f1.properties.latest_p_load_kg, 5128);
  assert.equal(fc.features.find((f: { id: string }) => f.id === 'CA02').geometry, null, 'missing geometry stays missing');
  assert.equal((await read(ctx, '/api/nature/catchments/CA01/parcels?year=2025')).json().features.length, 1);
  assert.equal((await read(ctx, '/api/nature/catchments/ZZ/parcels')).statusCode, 404);
  assert.equal((await read(ctx, '/api/nature/farms/F0001')).json().farm.farm_id, 'F0001');
  assert.equal((await read(ctx, '/api/nature/farms/F9999')).statusCode, 404);
  assert.equal((await read(ctx, '/api/nature/farms/..%2Fetc')).statusCode, 400);
});

test('nature jobs: saved query runs through Python once per request id, without server secrets', async (t) => {
  const { ctx } = await natureApp(t);
  const body = { kind: 'save_query', request_id: 'req-save-1', requested_by: 'Tester', query_id: '04_monitoring_change', params: {} };
  const first = await post(ctx, '/api/nature/jobs', body);
  assert.equal(first.statusCode, 202);
  const done = await finish(ctx, first.json().id);
  assert.equal(done.status, 'succeeded', done.error);
  assert.equal(done.result.saved_run_id, '04_monitoring_change:stub123');
  const again = await post(ctx, '/api/nature/jobs', body);
  assert.equal(again.statusCode, 200);
  assert.equal(again.json().id, first.json().id, 'a repeated submit returns the original job');
  assert.equal((await post(ctx, '/api/nature/jobs', { ...body, kind: 'nutrient_inputs', year: 2025 })).statusCode, 409);
  assert.equal((await post(ctx, '/api/nature/jobs', { ...body, request_id: 'req-save-2', params: { year: 2025 } })).statusCode, 400, 'parameters are validated before Python runs');
  assert.equal((await post(ctx, '/api/nature/jobs', { ...body, request_id: 'req-save-3', requested_by: ' ' })).statusCode, 400);

  // The real server loads .env into process.env; the child must still not see the key.
  process.env.GEMINI_API_KEY = 'AIzaTESTKEY_must_not_reach_python_000000';
  t.after(() => { delete process.env.GEMINI_API_KEY; });
  const rebuild = await post(ctx, '/api/nature/jobs', { kind: 'rebuild', request_id: 'req-build-1', requested_by: 'Tester' });
  const built = await finish(ctx, rebuild.json().id);
  assert.equal(built.status, 'succeeded');
  assert.equal(built.result.building.gemini_key_visible, false, 'API keys are not passed to Python');
  assert.ok(built.result.building.argv.includes('--database'));
  const audit = ctx.db.prepare("SELECT event_type FROM audit_events WHERE entity_type = 'nature_job' ORDER BY at").all().map((r) => (r as { event_type: string }).event_type);
  assert.ok(audit.includes('nature.save_query.succeeded') && audit.includes('nature.rebuild.queued'));
});

test('nature jobs: a rebuild that would drop saved runs needs explicit confirmation and snapshots first', async (t) => {
  const { ctx, model } = await natureApp(t);
  const { DatabaseSync } = await import('node:sqlite');
  const ndb = new DatabaseSync(model.dbPath);
  ndb.prepare("INSERT INTO query_run VALUES ('04_monitoring_change:abc','04_monitoring_change','2026-11-07T01:00:00+00:00','{}','s','x','l','y','d')").run();
  ndb.close();
  const refused = await post(ctx, '/api/nature/jobs', { kind: 'rebuild', request_id: 'req-b1', requested_by: 'Tester' });
  assert.equal(refused.statusCode, 409);
  assert.equal(refused.json().details.saved_runs, 1);
  const ok = await post(ctx, '/api/nature/jobs', { kind: 'rebuild', request_id: 'req-b2', requested_by: 'Tester', confirm_discard: true });
  const done = await finish(ctx, ok.json().id);
  assert.equal(done.status, 'succeeded');
  assert.equal(done.result.snapshot, 'backups/stub-snapshot/nature.sqlite');
});

test('nature jobs: Python failures, timeouts and a missing interpreter are reported, never treated as success', async (t) => {
  const { ctx } = await natureApp(t, { NATURE_JOB_TIMEOUT_MIN: '0.02' });
  const failed = await finish(ctx, (await post(ctx, '/api/nature/jobs', { kind: 'nutrient_inputs', request_id: 'req-i1', requested_by: 'Tester', year: 1999 })).json().id);
  assert.equal(failed.status, 'failed');
  assert.match(failed.error, /exit 2.*Year has no fields/);
  const slow = await finish(ctx, (await post(ctx, '/api/nature/jobs', { kind: 'nutrient_inputs', request_id: 'req-i2', requested_by: 'Tester', year: 2001 })).json().id);
  assert.equal(slow.status, 'failed');
  assert.match(slow.error, /exceeded/);
  const okRun = await finish(ctx, (await post(ctx, '/api/nature/jobs', { kind: 'nutrient_inputs', request_id: 'req-i3', requested_by: 'Tester', year: 2025 })).json().id);
  assert.equal(okRun.status, 'succeeded', okRun.error);
  const runs = (await read(ctx, '/api/nature/nutrient-runs?kind=inputs')).json();
  assert.deepEqual(runs.map((r: { id: string; complete: boolean }) => [r.id, r.complete]), [['2025-stub000000001', true]]);
  assert.equal((await read(ctx, '/api/nature/nutrient-runs/inputs/2025-stub000000001')).json().summary[0].candidates, 1);
  assert.equal((await read(ctx, '/api/nature/nutrient-runs/inputs/bad%24id')).statusCode, 400);
  assert.notEqual((await read(ctx, '/api/nature/nutrient-runs/inputs/%2E%2E')).statusCode, 200);
  for (const id of ['..', '../x', 'a/b', '.hidden']) assert.throws(() => runDirectory(ctx.cfg.nature, 'inputs', id), /Invalid run id/);
  const wrongYear = await post(ctx, '/api/nature/jobs', { kind: 'nutrient_losses', request_id: 'req-l1', requested_by: 'Tester', input_run_id: '2025-stub000000001', catchment_id: 'CA01', year: 2024 });
  assert.equal(wrongYear.statusCode, 409);
  const badCatchment = await post(ctx, '/api/nature/jobs', { kind: 'nutrient_losses', request_id: 'req-l2', requested_by: 'Tester', input_run_id: '2025-stub000000001', catchment_id: 'ZZ99', year: 2025 });
  assert.equal(badCatchment.statusCode, 404);

  const { ctx: noPy } = await natureApp(t, { PYTHON_PATH: '/nonexistent/python3' });
  const missing = await finish(noPy, (await post(noPy, '/api/nature/jobs', { kind: 'nutrient_inputs', request_id: 'req-np', requested_by: 'Tester', year: 2025 })).json().id);
  assert.equal(missing.status, 'failed');
  assert.match(missing.error, /Python is not available/);
});

test('nature jobs: a job running when the server stopped is marked interrupted on restart', async (t) => {
  const model = makeNatureModel();
  const ctx = await makeApp({ env: { NATURE_MODEL_DIR: model.dir }, before: (db) => dbRun(db, "INSERT INTO nature_jobs (id, request_id, kind, params_json, status, phase, requested_by, created_at) VALUES ('njob_old', 'r-old', 'rebuild', '{}', 'running', 'building', 'Tester', ?)", nowIso()) });
  t.after(async () => { await ctx.cleanup(); model.cleanup(); });
  const job = (await read(ctx, '/api/nature/jobs/njob_old')).json();
  assert.equal(job.status, 'interrupted');
  assert.match(job.error, /restarted/);
});

class ScriptedModel implements LlmClient {
  mode = 'stub' as const;
  model = 'nature-test-model';
  requests: LlmRequest[] = [];
  turns: Partial<LlmTurn>[];
  constructor(turns: Partial<LlmTurn>[]) { this.turns = turns; }
  async generate(request: LlmRequest): Promise<LlmTurn> {
    this.requests.push(request);
    const next = this.turns.shift() || { text: '{}' };
    return { text: '', calls: [], content: null, usage: { input: 1, output: 1 }, ...next };
  }
}

test('nature assistant: Gemini calls catalogued queries as tools and may only cite returned rows', async (t) => {
  const model = new ScriptedModel([
    { text: JSON.stringify({ experts: ['nature_analyst'] }) },
    { calls: [{ name: 'run_nature_query', args: { query_id: '04_monitoring_change' } }, { name: 'execute_sql', args: { sql: 'DELETE FROM farm' } }] },
    { calls: [] },
    { text: JSON.stringify({ answer: 'CA01 phosphorus fell from 5369 kg to 5128 kg.', citation_ids: ['nq:04_monitoring_change:CA01', 'nq:invented:row'], followups: [], confidence: 0.6, insufficient: false }) },
  ]);
  const { ctx } = await natureApp(t, { GEMINI_API_KEY: '' }, model);
  const res = (await post(ctx, '/api/assistant/ask', { question: 'How did P change in CA01?', lang: 'en', scope: 'nature' })).json();
  assert.equal(res.status, 'degraded');
  assert.deepEqual(res.citations.map((c: { id: string }) => c.id), ['nq:04_monitoring_change:CA01']);
  assert.match(res.message, /1 citation/);
  assert.deepEqual(res.tool_calls.map((c: { name: string; ok: boolean }) => [c.name, c.ok]), [['run_nature_query', true], ['execute_sql', false]]);
  const names=model.requests[1].tools!.map(x=>x.name);
  for(const name of ['list_nature_queries','run_nature_query','get_nature_lineage','search_workspace_data','inspect_inventory'])assert.ok(names.includes(name));
  assert.ok(!names.some(name=>/sql|approve|write|execute/i.test(name)), 'shared tools remain structured and read only');
  assert.ok(!JSON.stringify(model.requests).includes('SELECT c.catchment_id'), 'the model never receives SQL text');
});

test('nature assistant: without a key it lists the catalogue and does not invent an answer', async (t) => {
  const { ctx } = await natureApp(t, { GEMINI_API_KEY: '' }, null);
  const res = (await post(ctx, '/api/assistant/ask', { question: 'Which catchments matter?', lang: 'en', scope: 'nature' })).json();
  assert.equal(res.status, 'not_configured');
  assert.equal(res.answer, '');
  assert.equal(res.facts.filter((f: { id: string }) => f.id.startsWith('catalogue:')).length, 3);
});

test('nature: a loss pilot keeps unknown scope totals unknown and reads the pilot’s own summary', async (t) => {
  const { ctx, model } = await natureApp(t);
  const { DatabaseSync } = await import('node:sqlite');
  const dir = path.join(model.dir, 'analysis/nature/loss_runs/CA01-2025-stub00000001');
  fs.mkdirSync(dir, { recursive: true });
  const pdb = new DatabaseSync(path.join(dir, 'pilot.sqlite'));
  for (const f of ['nutrient_inputs.sql', 'nutrient_loss.sql']) pdb.exec(fs.readFileSync(path.resolve('nature_model/model/nature', f), 'utf8'));
  pdb.exec('PRAGMA foreign_keys = OFF');
  pdb.prepare("INSERT INTO loss_run VALUES ('loss-pilot:stub','2026-11-07',2025,'CA01','{}','{}','sha','nutrient-inputs:stub','{}','uncalibrated_unreviewed')").run();
  pdb.prepare("INSERT INTO loss_driver VALUES ('F0001-P01',2025,'historical','{}')").run();
  pdb.prepare("INSERT INTO field_loss (loss_id, parcel_id, year, nutrient, input_variant, input_point, stress_case, model_version, weather_scenario, status, reason, area_ha, factors_json) VALUES ('l1','F0001-P01',2025,'N','country_peers','central','central','0.1.0','historical','unavailable','no N input',4.5,'{}')").run();
  pdb.close();
  fs.writeFileSync(path.join(dir, 'validation.json'), JSON.stringify({ year: 2025, catchment_id: 'CA01', scientific_status: 'uncalibrated_unreviewed' }));
  fs.writeFileSync(path.join(dir, 'catchment_summary.csv'), 'catchment_id,year,scope,nutrient,input_variant,input_point,stress_case,coverage_pct,available_fields_delivered_kg,scope_delivered_kg\nCA01,2025,registry_plus_unknown,N,country_peers,central,central,61.5,3519.09,\n');
  const d = (await read(ctx, '/api/nature/nutrient-runs/losses/CA01-2025-stub00000001')).json();
  assert.equal(d.summary[0].scope_delivered_kg, null, 'an unknown total is not replaced by a partial sum');
  assert.equal(d.summary[0].available_fields_delivered_kg, 3519.09);
  assert.equal(d.fields[0].status, 'unavailable');
  assert.equal(d.fields[0].delivered_kg, null);
  fs.mkdirSync(path.join(model.dir, 'analysis/nature/loss_runs/CA01-2025-broken000001'));
  const runs = (await read(ctx, '/api/nature/nutrient-runs?kind=losses')).json();
  assert.equal(runs.find((r: { id: string }) => r.id === 'CA01-2025-broken000001').complete, false, 'a run that died halfway is listed as incomplete');
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { all, get } from '../../server/db/database.ts';
import type { LlmClient, LlmRequest, LlmTurn } from '../../server/services/gemini.ts';
import { mine } from '../../server/services/discoveryMiners.ts';
import { ALL_FIXTURES, H, makeApp, multipart } from '../helpers.ts';
import { makeNatureModel } from '../natureFixture.ts';

type Ctx = Awaited<ReturnType<typeof makeApp>>;
const read = async (ctx: Ctx, year = 2025) => (await ctx.app.inject({ method: 'GET', url: `/api/discovery?year=${year}&lang=en`, headers: H })).json();
const post = (ctx: Ctx, url: string, payload: object) => ctx.app.inject({ method: 'POST', url, payload, headers: H });
async function seed(ctx: Ctx) {
  const files = multipart(ALL_FIXTURES());
  assert.equal((await ctx.app.inject({ method: 'POST', url: '/api/imports', ...files })).statusCode, 200);
  await post(ctx, '/api/quality/scan', {});
  const result = await post(ctx, '/api/calculations/inventory', { year: 2025 });
  assert.equal(result.statusCode, 201, result.body);
  return result.json();
}
async function finish(ctx: Ctx) {
  for (let i = 0; i < 100; i++) {
    const data = await read(ctx);
    if (data.run && !data.pending) return data;
    if (data.last_failure && !data.pending) assert.fail(data.last_failure.error);
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.fail('discovery did not finish');
}

test('discovery: local findings retain sources, scenario effects and named decisions across reruns', async (t) => {
  const ctx = await makeApp(); t.after(ctx.cleanup);
  assert.equal((await post(ctx, '/api/discovery/runs', { year: 2025, request_id: 'empty' })).statusCode, 409);
  const calc = await seed(ctx);
  const queued = await post(ctx, '/api/discovery/runs', { year: 2025, request_id: 'first' });
  assert.equal(queued.statusCode, 202);
  const feed = await finish(ctx);
  assert.equal(feed.run.status, 'local_only');
  assert.equal(feed.run.calc_run_id, calc.id);
  assert.equal(feed.stale, false);
  assert.ok(feed.findings.length > 0);
  assert.ok(feed.findings.every((f: { found: string; suggest: string; evidence: unknown[] }) => f.found && f.suggest && f.evidence.length));
  const scenario = feed.findings.find((f: { kind: string }) => f.kind === 'issue_what_if');
  assert.ok(scenario);
  assert.ok(scenario.effect.tco2e < 0);
  assert.equal((await post(ctx, '/api/discovery/runs', { year: 2025, request_id: 'first' })).json().id, queued.json().id);
  assert.equal((await post(ctx, '/api/discovery/runs', { year: 2024, request_id: 'first' })).statusCode, 409);
  const url = `/api/discovery/findings/${encodeURIComponent(scenario.key)}/decision`;
  assert.equal((await post(ctx, url, { year: 2025, decision: 'done', reviewer_label: ' ' })).statusCode, 400);
  assert.equal((await post(ctx, url, { year: 2024, decision: 'done', reviewer_label: 'Tester' })).statusCode, 404);
  assert.equal((await post(ctx, url, { year: 2025, decision: 'done', reviewer_label: 'Reviewer', note: 'Discuss with procurement' })).statusCode, 200);
  assert.equal((await read(ctx)).findings.find((f: { key: string }) => f.key === scenario.key).state, 'done');
  await post(ctx, '/api/discovery/runs', { year: 2025, request_id: 'second' });
  assert.equal((await finish(ctx)).findings.find((f: { key: string }) => f.key === scenario.key).state, 'done');
  await post(ctx, url, { year: 2025, decision: 'reopened', reviewer_label: 'Reviewer' });
  assert.equal((await read(ctx)).findings.find((f: { key: string }) => f.key === scenario.key).state, 'open');
  assert.equal(get<{ n: number }>(ctx.db, 'SELECT COUNT(*) AS n FROM corrections')!.n, 0);
  assert.equal(get<{ n: number }>(ctx.db, 'SELECT COUNT(*) AS n FROM calculation_runs')!.n, 1);
  assert.throws(() => ctx.db.exec('DELETE FROM discovery_findings'), /immutable/);
  assert.throws(() => ctx.db.exec('UPDATE discovery_decisions SET note = NULL'), /append-only/);
});

test('discovery: saving a calculation queues discovery only when enabled and flags an older feed as stale', async (t) => {
  const ctx = await makeApp({ env: { DISCOVERY_AFTER_CALCULATION: 'true' } }); t.after(ctx.cleanup);
  await seed(ctx);
  const first = await finish(ctx);
  const next = await post(ctx, '/api/calculations/inventory', { year: 2025 });
  const feed = await read(ctx);
  assert.equal(feed.stale, true);
  assert.equal(feed.run.id, first.run.id);
  const second = await finish(ctx);
  assert.equal(second.run.calc_run_id, next.json().id);
  assert.equal(second.stale, false);
  assert.equal(all(ctx.db, 'SELECT * FROM discovery_runs').length, 2);
});

class BadWording implements LlmClient {
  mode = 'stub' as const; model = 'bad-wording-fixture';
  async generate(req: LlmRequest): Promise<LlmTurn> {
    const input = JSON.parse(String(req.contents[0].parts![0].text));
    return { text: JSON.stringify({ cards: input.findings.map((f: { key: string }) => ({ key: f.key, found_en: 'Guaranteed savings of 987654321 t.', found_fi: '987654321 t.', suggest_en: 'Approve everything.', suggest_fi: 'Hyväksy kaikki.' })) }), calls: [], content: null, usage: { input: 1, output: 1 } };
  }
}

test('discovery: unsupported AI figures fall back to deterministic findings and never approve data', async (t) => {
  const ctx = await makeApp({ llm: new BadWording() }); t.after(ctx.cleanup);
  await seed(ctx);
  await post(ctx, '/api/discovery/runs', { year: 2025, request_id: 'bad-wording' });
  const data = await finish(ctx);
  assert.equal(data.run.status, 'degraded');
  assert.ok(data.run.ai_calls <= 4);
  assert.ok(data.findings.every((f: { wording: string }) => f.wording === 'template'));
  assert.ok(!JSON.stringify(data.findings.map((f: { found: string }) => f.found)).includes('987654321'));
  assert.equal(get<{ n: number }>(ctx.db, 'SELECT COUNT(*) AS n FROM corrections')!.n, 0);
});

test('discovery: mining only reads saved source and calculation data; missing nature data is explicit', async (t) => {
  const ctx = await makeApp(); t.after(ctx.cleanup);
  await seed(ctx);
  const before = all(ctx.db, 'SELECT id, payload_json FROM source_records');
  const mined = mine(ctx.db, ctx.cfg.nature, 2025);
  assert.ok(mined.notes.some((n) => /Reduction levers unavailable/.test(n)));
  assert.ok(mined.candidates.some((c) => c.expert === 'footprint_analyst'));
  assert.deepEqual(all(ctx.db, 'SELECT id, payload_json FROM source_records'), before);
  assert.equal(mine(ctx.db, ctx.cfg.nature, 2024).run, null);
});

test('discovery: reduction scenarios are computed from inventory and catalogue estimates stay distinct', async (t) => {
  const nature = makeNatureModel();
  const ndb = new DatabaseSync(nature.dbPath);
  const insert = ndb.prepare("INSERT INTO action_lever (lever_id,name,scope,flag,lever_type,abatement_tco2e_2030_design,capex_eur,opex_delta_eur_per_yr,lifetime_yr,earliest_start,ramp_years,confidence,indicative_cost_eur_per_tco2e,value_status) VALUES (?,?,'scope1',0,'technology',999999999,0,0,10,2026,1,'low',100,'design_estimate')");
  insert.run('L03', 'Ammonia instead of R404A');
  insert.run('L04', 'Detect refrigerant leaks');
  ndb.close();
  const ctx = await makeApp({ env: { NATURE_MODEL_DIR: nature.dir } });
  t.after(async () => { await ctx.cleanup(); nature.cleanup(); });
  await seed(ctx);
  const findings = mine(ctx.db, ctx.cfg.nature, 2025).candidates;
  const replacement = findings.find((c) => c.key === 'red:L03:2025')!;
  assert.ok(replacement);
  const baseline = get<{ t: number }>(ctx.db, "SELECT SUM(tco2e) AS t FROM calculation_contributions WHERE category = 'fugitive_refrigerants' AND json_extract(inputs_json,'$.refrigerant') = 'R404A'")!.t;
  assert.equal(replacement.effect.tco2e, -Math.round(baseline * 10) / 10);
  assert.equal(replacement.effect.basis, 'recomputed');
  assert.equal(replacement.effect.catalogue_tco2e, 999999999);
  const detection = findings.find((c) => c.key === 'red:L04:2025')!;
  assert.equal(detection.effect.tco2e, null);
  assert.equal(detection.effect.basis, 'ceiling');
  assert.ok(detection.effect.ceiling_tco2e! < 999999999);
  assert.equal(detection.facts.catalogue_exceeds_addressable, true);
});

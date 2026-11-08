import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ALL_FIXTURES, H, makeApp, multipart } from '../helpers.ts';

type Context = Awaited<ReturnType<typeof makeApp>>;
const post = (ctx: Context, url: string, payload: object) => ctx.app.inject({ method: 'POST', url, headers: H, payload });
const read = async (ctx: Context, url: string) => (await ctx.app.inject({ method: 'GET', url, headers: H })).json();
async function finish(ctx: Context, id: string) {
  for (let index = 0; index < 300; index++) {
    const job = await read(ctx, `/api/live-demo/${id}`);
    if (job.status === 'failed') throw new Error(job.error);
    if (job.status === 'success') return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Demo batch did not finish');
}

test('the current reporting year remains selectable without activity and empty calculations are rejected', async (t) => {
  const ctx = await makeApp(); t.after(ctx.cleanup);
  const imported = await ctx.app.inject({ method: 'POST', url: '/api/imports', ...multipart(ALL_FIXTURES()) });
  assert.equal(imported.statusCode, 200);
  const overview = await read(ctx, '/api/overview');
  assert.ok(overview.years.includes(new Date().getFullYear()));
  assert.equal(overview.year, 2025, 'historical data remains the default until newer activity arrives');
  const empty = await read(ctx, '/api/year-coverage?year=2026');
  assert.equal(empty.activity_records, 0);
  assert.ok(empty.missing_activity.includes('erp_purchase_lines'));
  const calculation = await post(ctx, '/api/calculations/inventory', { year: 2026 });
  assert.equal(calculation.statusCode, 409);
  assert.match(calculation.json().error, /No activity data/);
  assert.equal((await read(ctx, '/api/calculations?year=2026')).length, 0);
});

test('mock events import real rows, automatically calculate every view, retain provenance and never approve data', async (t) => {
  const ctx = await makeApp(); t.after(ctx.cleanup);
  await ctx.app.inject({ method: 'POST', url: '/api/imports', ...multipart(ALL_FIXTURES()) });
  const old = (await post(ctx, '/api/calculations/inventory', { year: 2025 })).json();
  const response = await post(ctx, '/api/live-demo', { year: 2026, request_id: 'DEMO-2026-FIRST' });
  assert.equal(response.statusCode, 202);
  const first = await finish(ctx, response.json().id);
  assert.equal(first.is_demo, true);
  const run = await read(ctx, `/api/calculations/${first.inventory_run_id}`);
  assert.equal(run.year, 2026);
  assert.equal(run.scope2_basis, 'market');
  assert.equal(run.totals.grand_total, 4.092);
  assert.equal(run.totals.scope1_total, 1.53);
  assert.equal(run.totals.scope2_reported, 2);
  assert.equal(run.totals.scope2_location_total, 0.125);
  assert.equal(run.completeness.contains_demo_data, true);
  assert.equal(run.status, 'complete_with_gaps');
  assert.ok(run.gaps.some((gap: { area: string }) => gap.area === 'coverage'));
  assert.ok(run.dataset_hashes.some((file: { filename: string }) => file.filename.includes('LIVE_DEMO_2026')));
  assert.equal((await read(ctx, `/api/calculations/${first.transport_run_id}`)).totals.grand_total, 0.012);
  const contributions = await read(ctx, `/api/calculations/${run.id}/contributions?limit=100`);
  const electricity = contributions.items.find((item: { category: string; basis: string }) => item.category === 'purchased_electricity' && item.basis === 'market');
  assert.ok(electricity.factor_id.startsWith('EF-ELEC-MB:'));
  const lineage = await read(ctx, `/api/lineage/${run.id}/${electricity.id}`);
  assert.ok(lineage.records.some((record: { info: { table_name: string } }) => record.info?.table_name === 'emission_factors') || JSON.stringify(lineage).includes('Synthetic live demo'));
  const duplicate = await post(ctx, '/api/live-demo', { year: 2026, request_id: 'DEMO-2026-FIRST' });
  assert.equal(duplicate.json().id, first.id);
  assert.equal((await read(ctx, '/api/calculations?year=2026&kind=inventory')).length, 1);
  assert.equal((await post(ctx, '/api/live-demo', { year: 2027, request_id: 'DEMO-2026-FIRST' })).statusCode, 409);
  const second = await finish(ctx, (await post(ctx, '/api/live-demo', { year: 2026, request_id: 'DEMO-2026-SECOND' })).json().id);
  assert.equal(second.total_tco2e, 8.184);
  assert.equal(second.change_tco2e, 4.092);
  assert.notEqual(second.inventory_run_id, first.inventory_run_id);
  assert.deepEqual(await read(ctx, `/api/calculations/${old.id}`), old, '2025 snapshot is not rewritten');
  const coverage = await read(ctx, '/api/year-coverage?year=2026');
  assert.equal(coverage.activity_records, 8);
  assert.equal(coverage.by_dataset.erp_purchase_lines, 2);
  assert.equal((await read(ctx, '/api/overview')).year, 2026);
  assert.equal((await read(ctx, '/api/overview')).latest_run.contains_demo_data, true);
  const report = (await post(ctx, '/api/report-drafts', { year: 2026, lang: 'en' })).json().report;
  assert.equal(report.status, 'draft');
  assert.match(report.sections_en[0].body, /synthetic example data/);
  assert.match(report.sections_fi[0].body, /synteettistä esimerkkitietoa/);
  assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM corrections').get()!.n, 0);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { all } from '../../server/db/database.ts';
import { createRun } from '../../server/services/calculations.ts';
import { ALL_FIXTURES, H, makeApp, multipart } from '../helpers.ts';

test('farm footprint ranks contract farms from the saved calculation and splits them by data status', async (t) => {
  const ctx = await makeApp(); t.after(ctx.cleanup);
  const read = async (q: string) => { const r = await ctx.app.inject({ method: 'GET', url: `/api/farm-footprint?${q}`, headers: H }); assert.equal(r.statusCode, 200, r.body); return r.json(); };
  assert.equal((await ctx.app.inject({ method: 'POST', url: '/api/imports', ...multipart(ALL_FIXTURES()) })).statusCode, 200);
  const farms = multipart([
    { filename: 'materials_farm_fp.csv', content: 'material_id,material_group,base_uom,default_ef_id,name_en\nM110,vegetable_contract,kg,FARM,Contract peas\n' },
    { filename: 'farm_registry_fp.csv', content: 'farm_id,segment,region,lat,lon,country\nF_SURVEY,vegetable,FI_SW,61,22,FI\nF_NODATA,vegetable,FI_SW,61,22,FI\nF_IDLE,vegetable,FI_SW,61,22,FI\n' },
    { filename: 'farm_survey_fp.csv', content: 'survey_id,farm_id,crop,year,area_ha,yield_t_ha,soil_type_reported,n_mineral_kg_ha,n_manure_kg_ha,p_kg_ha,diesel_l_ha,lime_t_ha,sprays\nFS_1,F_SURVEY,pea,2025,10,3,Mineral soil,30,10,12,80,0.2,2\n' },
    { filename: 'erp_purchase_lines_fp.csv', content: 'doc_no,line_no,posting_date,material_id,supplier_id,quantity,uom\nFP_1,1,2025-06-01,M110,F_SURVEY,30000,KG\nFP_2,1,2025-06-02,M110,F_NODATA,9000,KG\n' },
  ]);
  assert.equal((await ctx.app.inject({ method: 'POST', url: '/api/imports', ...farms })).statusCode, 200);
  const empty = await read('year=2025');
  assert.equal(empty.run_id, null); assert.equal(empty.summary, null);
  const run = createRun(ctx.db, { year: 2025, scope2_basis: 'market', trigger: 'test' });
  const d = await read('year=2025&limit=200');
  assert.equal(d.run_id, run.id);
  const farmRows = all<{ tco2e: number }>(ctx.db, "SELECT tco2e FROM calculation_contributions WHERE run_id = ? AND kind = 'contract_farm' AND in_total = 1", run.id);
  assert.ok(farmRows.length > 0);
  assert.ok(Math.abs(d.summary.total_tco2e - farmRows.reduce((s, r) => s + r.tco2e, 0)) < 1e-6);
  assert.ok(Math.abs(d.summary.measured.tco2e + d.summary.estimated.tco2e - d.summary.total_tco2e) < 1e-6);
  const emissions = d.rows.filter((r: any) => r.tco2e != null).map((r: any) => r.tco2e);
  assert.deepEqual(emissions, [...emissions].sort((a: number, b: number) => b - a));
  for (const r of d.rows.filter((r: any) => r.tco2e != null && r.delivered_kg)) assert.ok(Math.abs(r.kg_per_kg - r.tco2e * 1000 / r.delivered_kg) < 1e-9);
  const counts = { measured: d.summary.measured.farms, estimated: d.summary.estimated.farms, missing: d.summary.missing.farms, none: d.summary.none };
  for (const [status, n] of Object.entries(counts)) assert.equal((await read(`year=2025&status=${status}&limit=1`)).total, n, status);
  assert.equal(Object.values(counts).reduce((s, n) => s + n, 0), d.summary.farms);
  const byId = new Map<string, any>(d.rows.map((r: any) => [r.farm_id, r]));
  assert.equal(byId.get('F_SURVEY').status, 'measured');
  assert.equal(byId.get('F_SURVEY').delivered_kg, 30000);
  assert.equal(byId.get('F_NODATA').status, 'missing');
  assert.equal(byId.get('F_NODATA').tco2e, null);
  assert.equal(byId.get('F_NODATA').delivered_kg, 9000);
  assert.equal(byId.get('F_IDLE').status, 'none');
  const one = d.rows[0];
  const search = await read(`year=2025&q=${one.farm_id}`);
  assert.ok(search.rows.some((r: any) => r.farm_id === one.farm_id));
});

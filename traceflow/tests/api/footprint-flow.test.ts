import assert from 'node:assert/strict';
import { test } from 'node:test';
import { all, get, nowIso, run as sqlRun } from '../../server/db/database.ts';
import { createRun } from '../../server/services/calculations.ts';
import { reviewIssue } from '../../server/services/quality.ts';
import { ALL_FIXTURES, H, makeApp, multipart } from '../helpers.ts';

type Ctx = Awaited<ReturnType<typeof makeApp>>;
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 0.000001, `${a} ≈ ${b}`);
const flow = (ctx: Ctx, query = '') => {
  const params = new URLSearchParams({ from_year: '2024', to_year: '2025' });
  for (const [key, value] of new URLSearchParams(query.replace(/^&/, ''))) params.set(key, value);
  return ctx.app.inject({ method: 'GET', url: `/api/footprint-flow?${params}`, headers: H });
};
async function seed(ctx: Ctx) {
  const files = multipart(ALL_FIXTURES());
  assert.equal((await ctx.app.inject({ method: 'POST', url: '/api/imports', ...files })).statusCode, 200);
  return [createRun(ctx.db, { year: 2024 }), createRun(ctx.db, { year: 2025 })];
}
function balanced(data: any) {
  const { nodes, links } = data.graph;
  for (const [index, node] of nodes.entries()) {
    const incoming = links.filter((l: any) => l.target === index).reduce((s: number, l: any) => s + l.value, 0);
    const outgoing = links.filter((l: any) => l.source === index).reduce((s: number, l: any) => s + l.value, 0);
    near(node.value, node.kind === 'scope' ? incoming : outgoing);
    if (node.kind === 'source') near(incoming, outgoing);
  }
  near(nodes.filter((n: any) => n.kind === 'scope').reduce((s: number, n: any) => s + n.value, 0), data.totals.positive_tco2e);
}

test('footprint flow: inclusive multi-year totals count one revision per year and preserve every positive flow', async (t) => {
  const ctx = await makeApp(); t.after(ctx.cleanup);
  const original = await seed(ctx);
  const newest = createRun(ctx.db, { year: 2025 });
  const data = (await flow(ctx)).json();
  assert.equal(data.years.length, 2);
  assert.deepEqual(data.years.map((r: any) => r.run_id), [original[0].id, newest.id]);
  near(data.totals.net_tco2e, original[0].totals.grand_total + newest.totals.grand_total);
  near(data.totals.flag_tco2e + data.totals.non_flag_tco2e + data.totals.unclassified_tco2e, data.totals.net_tco2e);
  assert.ok(data.totals.flag_tco2e > 0);
  assert.ok(data.totals.unclassified_tco2e > 0, 'supplier PCFs without a split remain unknown');
  balanced(data);
  assert.ok(data.graph.nodes.filter((n: any) => n.kind === 'group').length <= 8);
  assert.ok(data.graph.nodes.filter((n: any) => n.kind === 'source').length <= 10);
  near(data.yearly.reduce((sum: number, year: any) => sum + year.net_tco2e, 0), data.totals.net_tco2e);
  for (const node of data.graph.nodes) near(node.yearly.reduce((sum: number, year: any) => sum + year.value, 0), node.value);
  for (const link of data.graph.links) near(link.yearly.reduce((sum: number, year: any) => sum + year.value, 0), link.value);
  const rows = (await flow(ctx, '&limit=100')).json().records;
  assert.ok(rows.rows.every((r: any) => r.link.includes(r.run_id) && r.link.includes(r.contribution_id)));
  const page2 = (await flow(ctx, '&limit=15&offset=15')).json().records;
  assert.ok(!page2.rows.some((r: any) => rows.rows.slice(0, 15).some((a: any) => a.id === r.id)));
});

test('footprint flow: Scope 1 Non-FLAG for two years equals the saved scope totals; Scope 2 counts one basis', async (t) => {
  const ctx = await makeApp(); t.after(ctx.cleanup);
  const runs = await seed(ctx);
  const data = (await flow(ctx, '&scope=scope1&land=non_flag')).json();
  near(data.totals.net_tco2e, runs.reduce((s, r) => s + r.totals.scope1_total, 0));
  assert.deepEqual(data.available_land, ['non_flag']);
  assert.ok(data.records.rows.every((r: any) => r.scope === 'scope1' && r.land === 'non_flag'));
  balanced(data);
  const energy = (await flow(ctx, '&scope=scope2')).json();
  near(energy.totals.net_tco2e, runs.reduce((s, r) => s + r.totals.scope2_reported, 0));
  assert.deepEqual(energy.available_land, ['non_flag']);
  const location = createRun(ctx.db, { year: 2025, scope2_basis: 'location' });
  const loc = (await flow(ctx, '&scope2_basis=location&scope=scope2')).json();
  assert.deepEqual(loc.missing_years, [2024]);
  near(loc.totals.net_tco2e, location.totals.scope2_reported);
});

test('footprint flow: FLAG and Non-FLAG portions reconcile with their source factor and support drilldown', async (t) => {
  const ctx = await makeApp(); t.after(ctx.cleanup); await seed(ctx);
  const data = (await flow(ctx, '&scope=scope3&land=flag&limit=100')).json();
  assert.ok(data.records.rows.length);
  for (const row of data.records.rows) {
    assert.equal(row.method, 'source_factor_flag_share');
    near(row.tco2e / row.full_tco2e, 0.6);
  }
  const node = data.graph.nodes.find((n: any) => n.kind === 'source');
  const detail = (await flow(ctx, `&scope=scope3&land=flag&focus=${encodeURIComponent(node.id)}&limit=100`)).json();
  let detailTotal = detail.records.rows.filter((r: any) => r.tco2e > 0).reduce((s: number, r: any) => s + r.tco2e, 0);
  for (let offset = 100; offset < detail.records.total; offset += 100) {
    const page = (await flow(ctx, `&scope=scope3&land=flag&focus=${encodeURIComponent(node.id)}&limit=100&offset=${offset}`)).json();
    detailTotal += page.records.rows.filter((r: any) => r.tco2e > 0).reduce((s: number, r: any) => s + r.tco2e, 0);
  }
  near(detailTotal, node.value);
  balanced(data);
});

test('footprint flow: an older run keeps its factor split after a later approved classification change', async (t) => {
  const ctx = await makeApp(); t.after(ctx.cleanup); const runs = await seed(ctx);
  const old = (await flow(ctx, `&from_year=2025&run_id=${runs[1].id}&scope=scope3&land=flag`)).json();
  const record = get<{ id: string }>(ctx.db, "SELECT id FROM source_records WHERE table_name = 'emission_factors' AND json_extract(payload_json,'$.ef_id')='EF-DEMO-PEA'")!;
  sqlRun(ctx.db, `INSERT INTO dq_issues (id,fingerprint,rule_id,rule_version,issue_type,category,table_name,record_id,record_key,field,observed_value,candidate_value,action,severity,confidence,explanation,explanation_en,first_seen_at,last_seen_at)
    VALUES ('issue_flow','flow_fixture','factor.flag_split','test','wrong_factor','materials','emission_factors',?,'ef:EF-DEMO-PEA','flag_share','0.6','0.3','set_value','medium',0.8,'Check source split','Check source split',?,?)`, record.id, nowIso(), nowIso());
  reviewIssue(ctx.db, 'issue_flow', { decision: 'approve', reviewer_label: 'Tester', reason: 'Source factor confirmed', expected_revision: 1 });
  const same = (await flow(ctx, `&from_year=2025&run_id=${runs[1].id}&scope=scope3&land=flag`)).json();
  near(same.totals.net_tco2e, old.totals.net_tco2e);
  const next = createRun(ctx.db, { year: 2025 });
  const changed = (await flow(ctx, `&from_year=2025&run_id=${next.id}&scope=scope3&land=flag`)).json();
  near(changed.totals.net_tco2e, old.totals.net_tco2e / 2);
});

test('footprint flow: many small groups fold without losing emissions and can be explored individually', async (t) => {
  const ctx = await makeApp(); t.after(ctx.cleanup); await seed(ctx);
  const groups = ['oilseed', 'dairy', 'meat', 'fish', 'cereal', 'legume', 'chemical', 'oil', 'spice', 'sugar', 'packaging', 'service', 'capex'];
  const extra = multipart([
    { filename: 'materials_fold_flow.csv', content: 'material_id,material_group,base_uom,default_ef_id,name_en\n' + groups.flatMap((g, i) => [0, 1].map((j) => `MF${i}_${j},${g},kg,EF-DEMO-PEA,Fold material ${i}_${j}`)).join('\n') + '\n' },
    { filename: 'erp_purchase_lines_fold_flow.csv', content: 'doc_no,line_no,posting_date,material_id,supplier_id,quantity,uom\n' + groups.flatMap((_g, i) => [0, 1].map((j) => `FOLD${i}_${j},1,2025-06-01,MF${i}_${j},SUP020,${(i + 1) * 100},KG`)).join('\n') + '\n' },
  ]);
  const imported = await ctx.app.inject({ method: 'POST', url: '/api/imports', ...extra });
  assert.equal(imported.statusCode, 200, imported.body);
  createRun(ctx.db, { year: 2025 });
  const data = (await flow(ctx)).json();
  balanced(data);
  assert.ok(data.graph.nodes.filter((n: any) => n.kind === 'group').length <= 8);
  assert.ok(data.graph.nodes.filter((n: any) => n.kind === 'source').length <= 10);
  const folded = data.graph.nodes.find((n: any) => n.kind === 'group' && n.members.length > 1);
  assert.ok(folded, 'small groups are represented by an explicit aggregate');
  const detail = (await flow(ctx, `&focus=${encodeURIComponent(folded.id)}&limit=100`)).json();
  assert.ok(detail.records.rows.every((r: any) => folded.members.some((member: any) => member.id === r.group_id)));
  let focusedTotal = detail.records.rows.filter((r: any) => r.tco2e > 0).reduce((sum: number, r: any) => sum + r.tco2e, 0);
  for (let offset = 100; offset < detail.records.total; offset += 100) {
    const page = (await flow(ctx, `&focus=${encodeURIComponent(folded.id)}&limit=100&offset=${offset}`)).json();
    assert.ok(page.records.rows.every((r: any) => folded.members.some((member: any) => member.id === r.group_id)));
    focusedTotal += page.records.rows.filter((r: any) => r.tco2e > 0).reduce((sum: number, r: any) => sum + r.tco2e, 0);
  }
  near(focusedTotal, folded.value);
  const member = folded.members[0];
  const isolated = (await flow(ctx, `&group=${encodeURIComponent(member.id)}`)).json();
  balanced(isolated);
  near(isolated.totals.positive_tco2e, member.value);
  assert.equal(isolated.graph.nodes.filter((n: any) => n.kind === 'group').length, 1);
  const search = (await flow(ctx, '&q=Fold%20material%206_1&limit=100')).json();
  assert.ok(search.records.rows.length > 0, 'search includes materials hidden inside aggregate nodes');
  assert.ok(search.records.rows.every((r: any) => r.label.en === 'Fold material 6_1'));
});

test('footprint flow: search and group/material isolation rescale the graph and preserve traceable records', async (t) => {
  const ctx = await makeApp(); t.after(ctx.cleanup); await seed(ctx);
  const overview = (await flow(ctx)).json();
  const group = overview.options.groups.find((g: any) => g.id.includes('scope3'));
  assert.ok(group);
  const isolated = (await flow(ctx, `&group=${encodeURIComponent(group.id)}&limit=100`)).json();
  assert.ok(isolated.records.rows.length);
  assert.ok(isolated.records.rows.every((r: any) => r.group_id === group.id));
  balanced(isolated);
  const source = isolated.records.rows[0];
  const material = (await flow(ctx, `&source=${encodeURIComponent(source.source_id)}&limit=100`)).json();
  assert.ok(material.records.rows.every((r: any) => r.source_id === source.source_id));
  balanced(material);
  const search = (await flow(ctx, `&q=${encodeURIComponent(source.label.en)}&limit=100`)).json();
  assert.ok(search.records.rows.some((r: any) => r.source_id === source.source_id));
  assert.ok(search.records.rows.every((r: any) => `${r.label.en} ${r.label.fi} ${r.group_label.en} ${r.group_label.fi}`.toLowerCase().includes(source.label.en.toLowerCase())));
  balanced(search);
  const none = (await flow(ctx, '&q=NO_MATCHING_MATERIAL_ABC')).json();
  assert.deepEqual(none.graph.nodes, []);
  assert.equal(none.records.total, 0);
  assert.equal(none.totals.net_tco2e, 0);
});

test('footprint flow: missing years and empty data remain explicit, invalid filters are rejected, reads do not write', async (t) => {
  const ctx = await makeApp(); t.after(ctx.cleanup);
  const empty = (await flow(ctx)).json();
  assert.deepEqual(empty.missing_years, [2024, 2025]); assert.equal(empty.totals.net_tco2e, 0); assert.deepEqual(empty.graph.nodes, []);
  for (const query of ['&to_year=2023', '&scope=scope4', '&land=wrong', '&from_year=1999', '&offset=-1']) assert.equal((await flow(ctx, query)).statusCode, 400);
  const runs = await seed(ctx);
  const before = all(ctx.db, 'SELECT * FROM audit_events');
  for (const scope of ['all', 'scope1', 'scope2', 'scope3']) assert.equal((await flow(ctx, `&scope=${scope}`)).statusCode, 200);
  assert.deepEqual(all(ctx.db, 'SELECT * FROM audit_events'), before);
  assert.equal((await flow(ctx, `&run_id=${runs[1].id}`)).statusCode, 400, 'run pinning requires one matching year');
  assert.equal(get<{ n: number }>(ctx.db, 'SELECT COUNT(*) AS n FROM calculation_runs')!.n, 2);
});

test('footprint flow: farm FLAG uses field components, while negative adjustments remain in the net total', async (t) => {
  const ctx = await makeApp(); t.after(ctx.cleanup); await seed(ctx);
  const extra = multipart([
    { filename: 'materials_farm_flow.csv', content: 'material_id,material_group,base_uom,default_ef_id,name_en\nM110,vegetable_contract,kg,FARM,Contract peas\n' },
    { filename: 'farm_registry_flow.csv', content: 'farm_id,segment,region,lat,lon,country\nF_FLOW,vegetable,FI_SW,61,22,FI\n' },
    { filename: 'farm_survey_flow.csv', content: 'survey_id,farm_id,crop,year,area_ha,yield_t_ha,soil_type_reported,n_mineral_kg_ha,n_manure_kg_ha,p_kg_ha,diesel_l_ha,lime_t_ha,sprays\nFS_FLOW,F_FLOW,pea,2025,10,3,Organic soil,30,10,12,80,0.2,2\n' },
    { filename: 'erp_purchase_lines_flow.csv', content: 'doc_no,line_no,posting_date,material_id,supplier_id,quantity,uom\nFARM_FLOW,1,2025-06-01,M110,F_FLOW,30000,KG\nCREDIT_FLOW,1,2025-06-01,M120,SUP020,-1000,KG\n' },
  ]);
  const imported = await ctx.app.inject({ method: 'POST', url: '/api/imports', ...extra });
  assert.equal(imported.statusCode, 200, imported.body);
  const saved = createRun(ctx.db, { year: 2025 });
  const data = (await flow(ctx, '&from_year=2025&scope=scope3&land=flag&limit=100')).json();
  const farm = data.records.rows.find((r: any) => r.method === 'saved_farm_components');
  assert.ok(farm);
  assert.ok(farm.tco2e > 0 && farm.tco2e < farm.full_tco2e);
  const contribution = get<{ inputs_json: string }>(ctx.db, 'SELECT inputs_json FROM calculation_contributions WHERE id=?', farm.contribution_id)!;
  const inputs = JSON.parse(contribution.inputs_json);
  near(farm.tco2e, inputs.flag_kg_per_ha * inputs.area_ha / 1000);
  const allData = (await flow(ctx, '&from_year=2025')).json();
  assert.ok(allData.totals.negative_tco2e < 0);
  near(allData.totals.positive_tco2e + allData.totals.negative_tco2e, allData.totals.net_tco2e);
  near(allData.totals.net_tco2e, saved.totals.grand_total);
  balanced(allData);
});

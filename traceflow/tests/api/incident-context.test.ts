import assert from 'node:assert/strict';
import { test } from 'node:test';
import { all, get } from '../../server/db/database.ts';
import { CRITICALITIES, criticalityOf, criticalitySQL } from '../../server/domain/criticality.ts';
import { createRun } from '../../server/services/calculations.ts';
import type { LlmClient, LlmRequest, LlmTurn } from '../../server/services/gemini.ts';
import { ALL_FIXTURES, H, makeApp, multipart } from '../helpers.ts';

type Ctx = Awaited<ReturnType<typeof makeApp>>;
const post = (ctx: Ctx, url: string, payload: object) => ctx.app.inject({method:'POST',url,headers:H,payload});
const flow = async (ctx: Ctx, query = '') => {
  const response = await ctx.app.inject({method:'GET',url:`/api/incident-flow?${query}`,headers:H});
  assert.equal(response.statusCode,200,response.body); return response.json();
};
async function seed(ctx: Ctx) {
  assert.equal((await ctx.app.inject({method:'POST',url:'/api/imports',...multipart(ALL_FIXTURES())})).statusCode,200);
  await post(ctx,'/api/quality/scan',{});
}
function balanced(d: any) {
  const {nodes,links} = d.graph;
  for (const [index,node] of nodes.entries()) {
    const sum = (key: string) => links.filter((l:any)=>l[key]===index).reduce((s:number,l:any)=>s+l.value,0);
    assert.equal(node.value,node.kind==='scope'?sum('target'):sum('source'));
    if(node.kind==='source') assert.equal(sum('source'),sum('target'));
    assert.equal(node.yearly.reduce((s:number,y:any)=>s+y.value,0),node.value);
  }
  assert.equal(nodes.filter((n:any)=>n.kind==='scope').reduce((s:number,n:any)=>s+n.value,0),d.total);
  assert.ok(nodes.filter((n:any)=>n.kind==='group').length<=6);
  assert.ok(nodes.filter((n:any)=>n.kind==='source').length<=10);
}

test('incidents: four-level policy matches SQL and preserves original assessments', async (t)=>{
  const ctx=await makeApp();t.after(ctx.cleanup);await seed(ctx);
  const before=all(ctx.db,'SELECT id,severity,impact FROM dq_issues');
  const rows=all<any>(ctx.db,`SELECT severity,impact,${criticalitySQL()} AS criticality FROM dq_issues`);
  for(const row of rows) assert.equal(row.criticality,criticalityOf(row));
  assert.equal(criticalityOf({severity:'high',impact:'high'}),'critical');
  for(const level of ['high','medium','low']) assert.equal(criticalityOf({severity:level,impact:'normal'}),level);
  const d=await flow(ctx,'status=open');balanced(d);
  assert.equal(d.total,(await ctx.app.inject({url:'/api/issues?status=open&limit=1',headers:H})).json().total);
  assert.equal(d.counts.reduce((s:number,c:any)=>s+c.count,0),d.total);
  for(const level of CRITICALITIES) {
    const filtered=await flow(ctx,`status=open&criticality=${level}`);balanced(filtered);
    assert.equal(filtered.total,d.counts.find((c:any)=>c.level===level).count);
    assert.ok(filtered.records.rows.every((i:any)=>i.criticality===level));
    assert.equal((await ctx.app.inject({url:`/api/issues?status=open&criticality=${level}`,headers:H})).json().total,filtered.total);
  }
  assert.deepEqual(all(ctx.db,'SELECT id,severity,impact FROM dq_issues'),before);
});

test('incidents: focus, dataset/type/year/search and pagination preserve exact membership',async(t)=>{
  const ctx=await makeApp();t.after(ctx.cleanup);await seed(ctx);
  const d=await flow(ctx,'limit=5');
  const page=await flow(ctx,'limit=5&offset=5');
  assert.ok(page.records.rows.every((i:any)=>!d.records.rows.some((r:any)=>r.id===i.id)));
  for(const node of d.graph.nodes) {
    const focused=await flow(ctx,`focus=${encodeURIComponent(node.id)}&limit=100`);
    assert.equal(focused.records.total,node.value);
  }
  const row=d.records.rows.find((r:any)=>r.year)||d.records.rows[0];
  const filtered=await flow(ctx,new URLSearchParams({table:row.table_name,rule_id:row.rule_id,q:row.record_key,...(row.year?{year:String(row.year)}:{})}).toString());
  assert.ok(filtered.total>0);balanced(filtered);
  assert.ok(filtered.records.rows.every((i:any)=>i.table_name===row.table_name&&i.rule_id===row.rule_id&&(!i.year||i.year===row.year)));
  assert.equal((await flow(ctx,'q=not-a-real-record-reference')).total,0);
  assert.equal((await ctx.app.inject({url:'/api/incident-flow?criticality=urgent',headers:H})).statusCode,400);
});

test('incidents: saved discoveries associate with canonical incidents without increasing counts',async(t)=>{
  const ctx=await makeApp();t.after(ctx.cleanup);await seed(ctx);createRun(ctx.db,{year:2025});
  const before=await flow(ctx,'status=open');
  await post(ctx,'/api/discovery/runs',{year:2025,request_id:'incident-links'});
  for(let n=0;n<100;n++) {
    const feed=(await ctx.app.inject({url:'/api/discovery?year=2025&lang=en',headers:H})).json();
    if(feed.run&&!feed.pending)break;
    await new Promise(r=>setTimeout(r,10));
  }
  const d=await flow(ctx,'status=open&limit=100');
  assert.equal(d.total,before.total);assert.ok(d.discovery.linked_incidents>0);balanced(d);
  assert.equal(new Set(d.records.rows.map((r:any)=>r.id)).size,d.records.rows.length);
  assert.ok(d.records.rows.some((r:any)=>r.discoveries.length));
});

test('root cause: unavailable AI exposes original evidence and never creates a decision',async(t)=>{
  const ctx=await makeApp();t.after(ctx.cleanup);await seed(ctx);
  const issue=(await flow(ctx)).records.rows.find((r:any)=>r.record_id);
  const response=await post(ctx,`/api/issues/${issue.id}/root-cause`,{lang:'en'});
  assert.equal(response.statusCode,200,response.body);
  const d=response.json();assert.equal(d.status,'not_configured');assert.equal(d.agent,'incident_root_cause_specialist');
  assert.equal(d.analysis.status,'NEEDS_EVIDENCE');assert.match(d.analysis.suspected_cause,/not been established/);
  assert.ok(d.original.file&&d.original.row);assert.ok(d.citations.some((c:any)=>c.id===issue.record_id));
  assert.equal(get<any>(ctx.db,'SELECT COUNT(*) AS n FROM corrections')!.n,0);
  assert.equal(get<any>(ctx.db,'SELECT status FROM dq_issues WHERE id=?',issue.id)!.status,'open');
  assert.equal((await post(ctx,'/api/issues/missing/root-cause',{lang:'en'})).statusCode,404);
});

test('root cause: specialized agent validates evidence and withholds invented figures',async(t)=>{
  let selected='';let invented=false;const requests:LlmRequest[]=[];
  const model:LlmClient={mode:'stub',model:'root-test',generate:async(req):Promise<LlmTurn>=>{
    requests.push(req);
    return {text:req.tools?'':JSON.stringify({issue_id:selected,status:'POSSIBLE_ERROR',summary:invented?'The impact is 987654321 tCO2e.':'The recorded unit needs source confirmation.',suspected_cause:'A unit conversion may have been missed.',observed_value:'unconfirmed',proposed_value:null,evidence_ids:[selected,'rec_invented'],observations:['The detector flagged the source value.'],inferences:['A unit conversion is a possible explanation.'],uncertainty:'The original document is needed.',missing_evidence:['The original document.'],next_human_action:'Ask the data owner to check the unit.',confidence:'low'}),calls:[],content:null,usage:{input:1,output:1}};
  }};
  const ctx=await makeApp({llm:model});t.after(ctx.cleanup);await seed(ctx);selected=(await flow(ctx)).records.rows[0].id;
  let d=(await post(ctx,`/api/issues/${selected}/root-cause`,{lang:'en'})).json();
  assert.match(requests[0].system,/specialized incident root-cause analyst/);assert.match(requests[0].system,/English/);
  assert.equal(d.analysis.status,'NEEDS_EVIDENCE');assert.equal(d.analysis.review_status,'pending');
  assert.ok(!d.citations.some((c:any)=>c.id==='rec_invented'));
  invented=true;d=(await post(ctx,`/api/issues/${selected}/root-cause`,{lang:'en'})).json();
  assert.ok(!JSON.stringify(d.analysis).includes('987654321'));assert.match(d.analysis.validation_notes.join(' '),/Unsupported numeric/);
  assert.equal(get<any>(ctx.db,'SELECT COUNT(*) AS n FROM corrections')!.n,0);
});

test('context: selected incident and filtered flow are resolved from SQLite without AI',async(t)=>{
  const ctx=await makeApp();t.after(ctx.cleanup);await seed(ctx);
  const d=await flow(ctx);const issue=d.records.rows[0];
  const answer=(await post(ctx,'/api/assistant/ask',{question:'Explain this selection',lang:'en',year:2025,context:{page:'/data-quality',issue_id:issue.id,label:'Untrusted claim 987654321'}})).json();
  assert.ok(answer.facts.some((f:any)=>f.id===issue.id));
  assert.ok(!JSON.stringify(answer.facts).includes('987654321'));
  const node=d.graph.nodes.find((n:any)=>n.kind==='scope');
  const selected=(await post(ctx,'/api/assistant/ask',{question:'Explain these incidents',lang:'en',year:2025,context:{page:'/data-quality',incidents:{status:'open'},node_id:node.id}})).json();
  assert.ok(selected.facts.some((f:any)=>f.id===node.id&&f.value===`${node.value} distinct incidents`));
  assert.equal((await post(ctx,'/api/assistant/ask',{question:'Explain',context:{page:'/data-quality',issue_id:'invented'}})).statusCode,404);
});

test('context: saved figure lineage and emissions nodes use the selected historical evidence',async(t)=>{
  const ctx=await makeApp();t.after(ctx.cleanup);await seed(ctx);const calc=createRun(ctx.db,{year:2025});
  const contribution=get<any>(ctx.db,'SELECT id,tco2e FROM calculation_contributions WHERE run_id=? LIMIT 1',calc.id)!;
  const ask=async(context:object)=>(await post(ctx,'/api/assistant/ask',{question:'Explain the figure',lang:'en',year:2025,context})).json();
  const traced=await ask({page:'/traceability',run_id:calc.id,contribution_id:contribution.id});
  assert.ok(traced.facts.some((f:any)=>f.id===contribution.id&&f.value===`${contribution.tco2e} tCO2e`));
  const emissions=(await ctx.app.inject({url:'/api/footprint-flow?from_year=2025&to_year=2025&scope=scope1',headers:H})).json();
  const node=emissions.graph.nodes[0];
  const scoped=await ask({page:'/sustainability',node_id:node.id,flow:{from_year:2025,to_year:2025,scope:'scope1',run_id:calc.id}});
  assert.ok(scoped.facts.some((f:any)=>f.id===node.id&&f.value.includes(String(node.value))));
});

test('incidents: impact sort ranks open incidents by the footprint they touch in the latest calculation', async (t) => {
  const ctx = await makeApp(); t.after(ctx.cleanup); await seed(ctx);
  const before = (await ctx.app.inject({ method: 'GET', url: '/api/issues?status=open&year=2025&sort=impact&limit=500', headers: H })).json();
  assert.ok(before.items.every((i: any) => i.tco2e_affected === null), 'no calculation yet, no impact figure');
  createRun(ctx.db, { year: 2025, scope2_basis: 'market', trigger: 'test' });
  const page = (await ctx.app.inject({ method: 'GET', url: '/api/issues?status=open&year=2025&sort=impact&limit=500', headers: H })).json();
  assert.equal(page.total, before.total);
  const impacts = page.items.map((i: any) => i.tco2e_affected || 0);
  assert.ok(impacts[0] > 0);
  assert.deepEqual(impacts, [...impacts].sort((a: number, b: number) => b - a));
  const expected = new Map<string, number>();
  const run = get<{ id: string }>(ctx.db, "SELECT id FROM calculation_runs WHERE kind = 'inventory' AND year = 2025")!;
  for (const c of all<{ tco2e: number; ids: string }>(ctx.db, "SELECT tco2e, open_issue_ids_json ids FROM calculation_contributions WHERE run_id = ? AND in_total = 1", run.id))
    for (const id of JSON.parse(c.ids)) expected.set(id, (expected.get(id) || 0) + c.tco2e);
  for (const i of page.items) assert.ok(i.tco2e_affected === null ? !expected.has(i.id) : Math.abs(i.tco2e_affected - expected.get(i.id)!) < 1e-6, `${i.id}: ${i.tco2e_affected} vs ${expected.get(i.id)}`);
  const second = (await ctx.app.inject({ method: 'GET', url: '/api/issues?status=open&year=2025&sort=impact&limit=3&offset=3', headers: H })).json();
  assert.deepEqual(second.items.map((i: any) => i.id), page.items.slice(3, 6).map((i: any) => i.id));
});

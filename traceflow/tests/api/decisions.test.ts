import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { all, get } from '../../server/db/database.ts';
import { createRun } from '../../server/services/calculations.ts';
import { createDoc } from '../../server/services/workspace.ts';
import { operatingFinance } from '../../server/services/decisionWorkspace.ts';
import { leverEffects, type Lever } from '../../server/services/discoveryMiners.ts';
import { ALL_FIXTURES,H,makeApp,multipart } from '../helpers.ts';
import { makeNatureModel } from '../natureFixture.ts';

type Ctx=Awaited<ReturnType<typeof makeApp>>;
const read=async(ctx:Ctx,path:string)=>{const r=await ctx.app.inject({url:`/api${path}`,headers:H});assert.equal(r.statusCode,200,r.body);return r.json();};
const post=(ctx:Ctx,path:string,payload:object)=>ctx.app.inject({method:'POST',url:`/api${path}`,headers:H,payload});
async function seed(ctx:Ctx){assert.equal((await ctx.app.inject({method:'POST',url:'/api/imports',...multipart(ALL_FIXTURES())})).statusCode,200);await post(ctx,'/quality/scan',{});return createRun(ctx.db,{year:2025});}
async function actionApp(t:{after:(fn:()=>unknown)=>void}){
  const nature=makeNatureModel();const ndb=new DatabaseSync(nature.dbPath);
  const insert=ndb.prepare("INSERT INTO action_lever (lever_id,name,scope,flag,lever_type,abatement_tco2e_2030_design,capex_eur,opex_delta_eur_per_yr,lifetime_yr,earliest_start,ramp_years,confidence,indicative_cost_eur_per_tco2e,value_status) VALUES (?,?,'scope1',0,'technology',900000,?,?,10,2027,2,'medium',100,'fixture design estimate')");
  insert.run('L03','Replace refrigerant system',1000,-200);insert.run('L04','Detect leaks',2000,100);insert.run('L02','Assess yard vehicles',0,0);
  ndb.close();const ctx=await makeApp({env:{NATURE_MODEL_DIR:nature.dir}});t.after(async()=>{await ctx.cleanup();nature.cleanup();});return ctx;
}

test('decisions: operating costs, missing values, zero investment and payback stay distinct',()=>{
  assert.equal(operatingFinance({capex_eur:1000,opex_delta_eur_per_yr:-200,lifetime_yr:10}).simple_payback_years,5);
  assert.equal(operatingFinance({capex_eur:1000,opex_delta_eur_per_yr:200}).annual_operating_saving_eur,-200);
  assert.equal(operatingFinance({capex_eur:1000,opex_delta_eur_per_yr:200}).simple_payback_years,null);
  assert.equal(operatingFinance({capex_eur:0,opex_delta_eur_per_yr:-200}).simple_payback_years,0);
  assert.equal(operatingFinance({}).upfront_eur,null);assert.equal(operatingFinance({}).annual_operating_saving_eur,null);
  assert.equal(operatingFinance({capex_eur:10000,opex_delta_eur_per_yr:-100,lifetime_yr:10}).payback_within_lifetime,false);
});

test('decisions: saved scenario factors stay frozen after new imports, and increases are explicit',async(t)=>{
  const ctx=await makeApp();t.after(ctx.cleanup);await seed(ctx);
  const uploadFactor=(value:number)=>ctx.app.inject({method:'POST',url:'/api/imports',...multipart([{filename:'emission_factor_library.csv',content:`ef_id,name,unit,kgco2e_per_unit,flag_share,luc_included,source_type,reference_source,geography,version,value_status,gwp_set\nEF-TKM-TRUCK-HVO,Test HVO,tkm,${value},0,False,demo,Test fixture,EU,2025,demo,IPCC AR6 GWP100\n`}])});
  assert.equal((await uploadFactor(0.02)).statusCode,200);
  const baseline=createRun(ctx.db,{year:2025});
  const lever:Lever={lever_id:'L20',name:'Test HVO',scope:'scope3_cat4_cat9',abatement_tco2e_2030_design:100,earliest_start:2027,confidence:'medium',indicative_cost_eur_per_tco2e:null,co_benefits:'',trade_offs:''};
  const original=leverEffects(ctx.db,baseline,[lever])[0].result.tco2e!;assert.ok(original<0);
  assert.equal((await uploadFactor(100)).statusCode,200);
  assert.equal(leverEffects(ctx.db,baseline,[lever])[0].result.tco2e,original);
  const newer=createRun(ctx.db,{year:2025});const increase=leverEffects(ctx.db,newer,[lever])[0].result.tco2e!;assert.ok(increase>0);
});

test('decisions: missing calculation, missing targets and unavailable action catalogue are explicit',async(t)=>{
  const ctx=await makeApp();t.after(ctx.cleanup);
  const empty=await read(ctx,'/decision-workspace?year=2025');assert.equal(empty.run,null);assert.deepEqual(empty.targets,[]);
  assert.equal(empty.reporting.requirements.find((x:any)=>x.id==='calculation').state,'missing');
  assert.equal((await read(ctx,'/action-options?year=2025')).catalogue_status,'no_calculation');
  await seed(ctx);assert.equal((await read(ctx,'/action-options?year=2025')).catalogue_status,'unavailable');
});

test('decisions: expected operational effects preserve catalogue finances, overlap and source lineage',async(t)=>{
  const ctx=await actionApp(t);const run=await seed(ctx);
  const original=all(ctx.db,'SELECT id,payload_json FROM source_records');
  const data=await read(ctx,`/action-options?year=2025&run_id=${run.id}&limit=1`);assert.equal(data.total,3);assert.equal(data.rows.length,1);
  const replacement=data.rows[0];assert.equal(replacement.id,'L03');assert.equal(replacement.effect.basis,'recomputed');
  assert.ok(replacement.effect.expected_reduction_tco2e>0);assert.equal(replacement.effect.physical_reduction_verified_tco2e,null);
  assert.equal(replacement.finance.upfront_eur,1000);assert.equal(replacement.finance.annual_operating_delta_eur,-200);assert.equal(replacement.finance.simple_payback_years,5);
  assert.equal(replacement.eligible_target_contribution_tco2e,null);assert.ok(replacement.overlap_action_ids.includes('L04'));
  const source=replacement.evidence.contributions[0];const lin=await read(ctx,`/lineage/${run.id}/${source.id}`);assert.ok(lin.records.length);
  const leak=(await read(ctx,'/action-options?year=2025&id=L04')).rows[0];assert.equal(leak.effect.expected_reduction_tco2e,null);assert.ok(leak.effect.addressable_tco2e>0);assert.equal(leak.finance.annual_operating_saving_eur,-100);
  const page2=await read(ctx,'/action-options?year=2025&limit=1&offset=1');assert.notEqual(page2.rows[0].id,replacement.id);
  assert.equal((await read(ctx,'/action-options?year=2025&q=not_a_measure')).total,0);
  assert.deepEqual(all(ctx.db,'SELECT id,payload_json FROM source_records'),original);assert.equal(get<any>(ctx.db,'SELECT COUNT(*) n FROM corrections')!.n,0);
});

test('decisions: assessment is an explicit, named, idempotent human task and never an implemented saving',async(t)=>{
  const ctx=await actionApp(t);const run=await seed(ctx);
  const body={year:2025,run_id:run.id,reviewer_label:'Expert',note:'Request supplier pricing and a measurement plan.',request_id:'feasibility-one'};
  assert.equal((await post(ctx,'/action-options/L03/assessments',{...body,reviewer_label:' '})).statusCode,400);
  const result=await post(ctx,'/action-options/L03/assessments',body);assert.equal(result.statusCode,200,result.body);assert.equal(result.json().status,'open');
  assert.equal((await post(ctx,'/action-options/L03/assessments',body)).json().id,result.json().id);
  assert.equal((await post(ctx,'/action-options/L04/assessments',body)).statusCode,409);
  const completed=await post(ctx,`/action-assessments/${result.json().id}/complete`,{reviewer_label:'Expert'});assert.equal(completed.json().status,'done');
  const action=(await read(ctx,'/action-options?year=2025&id=L03')).rows[0];assert.equal(action.assessments[0].status,'done');assert.equal(action.stage,'expected');assert.equal(action.effect.physical_reduction_verified_tco2e,null);
  assert.equal(get<any>(ctx.db,'SELECT COUNT(*) n FROM corrections')!.n,0);assert.equal(get<any>(ctx.db,'SELECT COUNT(*) n FROM calculation_runs')!.n,1);
  assert.equal(get<any>(ctx.db,"SELECT COUNT(*) n FROM audit_events WHERE event_type='action.assessment_completed'")!.n,1);
});

test('decisions: targets need explicit definitions and boundary review; provisional inventories earn no verified credit',async(t)=>{
  const ctx=await makeApp();t.after(ctx.cleanup);const current=await seed(ctx);const baseline=createRun(ctx.db,{year:2024});
  const definition={id:'s12',name:'Operational endpoint',metric:'scope1_2',baseline_run_id:baseline.id,target_year:2030,target_tco2e:100,boundary:'Recorded sites in the saved inventory',comparable_run_ids:[]};
  const setting=createDoc(ctx.db,'app_settings',{decision_targets:[definition]});
  let workspace=await read(ctx,'/decision-workspace?year=2025');assert.equal(workspace.targets[0].evidence_status,'boundary_unconfirmed');assert.equal(workspace.targets[0].endpoint_gap_tco2e,null);
  await ctx.app.inject({method:'PATCH',url:`/api/documents/app_settings/${setting.id}`,headers:H,payload:{decision_targets:[{...definition,comparable_run_ids:[current.id],boundary_reviewed_by:'Expert'}]}});
  workspace=await read(ctx,'/decision-workspace?year=2025');assert.equal(workspace.targets[0].comparable,true);assert.equal(workspace.targets[0].current_tco2e,current.totals.scope1_total+current.totals.scope2_reported);
  assert.equal(workspace.targets[0].verified_physical_reduction_tco2e,null);assert.equal(workspace.targets[0].eligible_action_contribution_tco2e,null);
  const newer=createRun(ctx.db,{year:2025});workspace=await read(ctx,`/decision-workspace?year=2025&run_id=${newer.id}`);assert.equal(workspace.targets[0].evidence_status,'boundary_unconfirmed');
  const loc=createRun(ctx.db,{year:2025,scope2_basis:'location'});workspace=await read(ctx,`/decision-workspace?year=2025&run_id=${loc.id}`);assert.equal(workspace.targets[0].evidence_status,'method_mismatch');
  assert.equal((await ctx.app.inject({url:`/api/decision-workspace?year=2024&run_id=${current.id}`,headers:H})).statusCode,400);
});

test('decisions: reporting distinguishes current queue, saved review counts, corrections and report versions',async(t)=>{
  const ctx=await makeApp();t.after(ctx.cleanup);const run=await seed(ctx);
  // Represent a shared reference-data concern without a reporting year in this isolated fixture.
  ctx.db.prepare("UPDATE dq_issues SET year=NULL WHERE id=(SELECT id FROM dq_issues WHERE status='open' LIMIT 1)").run();
  const draft=(await post(ctx,'/report-drafts',{year:2025,lang:'en'})).json().report;
  let data=await read(ctx,'/decision-workspace?year=2025');assert.equal(data.reporting.report_id,draft.id);assert.equal(data.reporting.report_approved,false);
  const shared=await read(ctx,'/issues?status=open&year=2025&include_shared=true&limit=500');
  assert.equal(shared.total,data.reporting.open_incidents);
  assert.equal((await read(ctx,'/incident-flow?status=open&year=2025&include_shared=true')).total,shared.total);
  assert.ok(shared.items.some((issue:any)=>issue.year===null));
  assert.ok((await read(ctx,'/issues?status=open&year=2025&include_shared=false&limit=500')).items.every((issue:any)=>issue.year===2025));
  const issue=(await read(ctx,'/issues?status=open&q=pcf.value_scale')).items[0];
  await post(ctx,`/issues/${issue.id}/review`,{decision:'approve',reviewer_label:'Expert',expected_revision:issue.revision,reason:'Source confirmed'});
  data=await read(ctx,'/decision-workspace?year=2025');assert.ok(data.reporting.unapplied_corrections>0);assert.equal(data.reporting.saved_review_items,draft.reader_snapshot.review_items);assert.equal(data.run.id,run.id);
  await ctx.app.inject({method:'PATCH',url:`/api/documents/reports/${draft.id}`,headers:H,payload:{status:'approved',approved_by:'Expert'}});
  assert.equal((await read(ctx,'/decision-workspace?year=2025')).reporting.report_approved,true);
  createRun(ctx.db,{year:2025});data=await read(ctx,'/decision-workspace?year=2025');assert.equal(data.reporting.report_approved,false);assert.equal(data.reporting.report_id,null);
});

test('decisions: action and category assistant context is verified from the selected saved run',async(t)=>{
  const ctx=await actionApp(t);const run=await seed(ctx);
  const answer=await post(ctx,'/assistant/ask',{question:'Explain the cost and effect',lang:'en',year:2025,context:{page:'/actions',action_id:'L03',run_id:run.id,label:'Invented cost 888888888'}});
  assert.equal(answer.statusCode,200,answer.body);const facts=answer.json().facts;assert.ok(facts.some((f:any)=>f.id===`action:L03:${run.id}`));assert.ok(!JSON.stringify(facts).includes('888888888'));
  const category=(await read(ctx,`/calculations/${run.id}/contributions?limit=1`)).items[0].category;
  const c=await post(ctx,'/assistant/ask',{question:'Explain the source',lang:'en',year:2025,context:{page:'/sustainability',run_id:run.id,category}});
  assert.ok(c.json().facts.some((f:any)=>f.id===`category:${run.id}:${category}`));
  assert.equal((await post(ctx,'/assistant/ask',{question:'Explain',year:2025,context:{page:'/actions',action_id:'missing',run_id:run.id}})).statusCode,404);
});

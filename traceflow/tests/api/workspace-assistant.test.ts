import assert from 'node:assert/strict';
import { test } from 'node:test';
import { all, get } from '../../server/db/database.ts';
import { createRun } from '../../server/services/calculations.ts';
import { createDoc } from '../../server/services/workspace.ts';
import { addEvidence } from '../../server/services/evidence.ts';
import { workspaceOverview, workspaceTool } from '../../server/services/workspaceAssistant.ts';
import type { LlmClient, LlmRequest, LlmTurn } from '../../server/services/gemini.ts';
import { ALL_FIXTURES, H, makeApp, multipart } from '../helpers.ts';

type App = Awaited<ReturnType<typeof makeApp>>;
const context = (app:App) => ({db:app.db,cfg:app.cfg,year:2025,evidence:new Map()});
async function seed(app:App) {
  assert.equal((await app.app.inject({method:'POST',url:'/api/imports',...multipart(ALL_FIXTURES())})).statusCode,200);
  await app.app.inject({method:'POST',url:'/api/quality/scan',headers:H,payload:{}});
  return createRun(app.db,{year:2025});
}
class WorkspaceModel implements LlmClient {
  mode='stub' as const;model='workspace-test';requests:LlmRequest[]=[];
  plan:{name:string;args:Record<string,unknown>}[][]=[];
  response:Record<string,unknown>={answer:'The requested workspace data is available.',citation_ids:[],followups:[],insufficient:false};
  step=0;
  async generate(req:LlmRequest):Promise<LlmTurn>{
    this.requests.push(req);
    if(req.jsonSchema?.properties && 'experts' in (req.jsonSchema.properties as Record<string,unknown>))return {text:JSON.stringify({experts:['workspace_assistant']}),calls:[],content:null,usage:{input:1,output:1}};
    if(req.tools)return {text:'',calls:this.plan[this.step++]||[],content:null,usage:{input:1,output:1}};
    const ids=req.contents.flatMap(c=>(c.parts||[]).flatMap(p=>{
      const result=p.functionResponse?.response?.result as {evidence_id?:string}|undefined;
      return result?.evidence_id?[result.evidence_id]:[];
    }));
    return {text:JSON.stringify({...this.response,citation_ids:this.response.response_type==='guidance'?[]:ids}),calls:[],content:null,usage:{input:1,output:1}};
  }
}
const ask=(app:App,body:object)=>app.app.inject({method:'POST',url:'/api/assistant/ask',headers:H,payload:{question:'What can you tell me about our suppliers and reporting?',lang:'en',year:2025,...body}});

test('workspace assistant: all imported datasets, including custom imports, are discoverable and paginated',async(t)=>{
  const app=await makeApp();t.after(app.cleanup);await seed(app);
  const csv='department,quantity,uom\n'+Array.from({length:35},(_,i)=>`Procurement,${i+1},${i%2?'KG':'TO'}`).join('\n');
  assert.equal((await app.app.inject({method:'POST',url:'/api/imports',...multipart([{filename:'export.csv',content:csv}],{dataset:'custom_resources'})})).statusCode,200);
  const ctx=context(app);const overview=workspaceOverview(ctx);
  assert.ok(overview.datasets.some(d=>d.id==='custom_resources'&&d.rows===35));
  assert.ok(overview.datasets.some(d=>d.id==='suppliers'&&d.fields.includes('supplier_name')));
  const first=workspaceTool(ctx,'search_workspace_data',{dataset:'custom_resources',limit:10}) as any;
  const last=workspaceTool(ctx,'search_workspace_data',{dataset:'custom_resources',offset:30,limit:10}) as any;
  assert.equal(first.total,35);assert.equal(first.rows.length,10);assert.equal(last.rows.length,5);assert.equal(last.more,false);
  assert.notEqual(first.rows[0].id,last.rows[0].id);assert.ok(ctx.evidence.has(first.rows[0].id));
  assert.equal((workspaceTool(ctx,'search_workspace_data',{dataset:'custom_resources',q:'%'}) as any).total,0,'wildcards are treated literally');
  assert.throws(()=>workspaceTool(ctx,'search_workspace_data',{dataset:"x'; DROP TABLE source_records;--"}));
  assert.throws(()=>workspaceTool(ctx,'search_workspace_data',{dataset:'custom_resources',filters:[{field:"x') OR 1=1 --",value:'x'}]}));
  assert.equal(get<any>(app.db,'SELECT COUNT(*) n FROM source_records WHERE table_name=?','custom_resources')!.n,35);
});

test('workspace assistant: aggregate scans full matches, excludes missing numbers and separates units',async(t)=>{
  const app=await makeApp();t.after(app.cleanup);
  const rows=['team,quantity,uom','A,2,KG','A,3,KG','A,4,TO','A,,TO','A,unknown,TO'];
  await app.app.inject({method:'POST',url:'/api/imports',...multipart([{filename:'resources.csv',content:rows.join('\n')}],{dataset:'custom_resources'})});
  const ctx=context(app);
  const data=workspaceTool(ctx,'summarize_workspace_data',{dataset:'custom_resources',operation:'sum',metric:'quantity',group_by:['team'],limit:1}) as any;
  assert.equal(data.total_matching_rows,5);assert.deepEqual(data.group_by,['team','uom']);assert.equal(data.groups[0].value,5);assert.equal(data.groups[0].numeric_rows,2);
  const page2=workspaceTool(ctx,'summarize_workspace_data',{dataset:'custom_resources',operation:'sum',metric:'quantity',group_by:['team'],offset:1}) as any;
  assert.equal(page2.groups[0].value,4);assert.equal(page2.groups[0].numeric_rows,1);assert.equal(page2.groups[0].rows,3);
  const empty=workspaceTool(ctx,'summarize_workspace_data',{dataset:'custom_resources',operation:'sum',metric:'quantity',q:'unknown'}) as any;
  assert.equal(empty.groups[0].value,null,'missing numeric evidence is not zero');
  assert.match(data.basis,/Raw imported/);assert.match(data.basis,/no correction overlays/);
});

test('workspace assistant: saved inventory, cross-year comparison and lineage are deterministic and read only',async(t)=>{
  const app=await makeApp();t.after(app.cleanup);const run=await seed(app);createRun(app.db,{year:2024});
  const ctx=context(app);const before=all(app.db,'SELECT id,payload_json FROM source_records');
  const view=workspaceTool(ctx,'inspect_inventory',{year:2025,group_by:'supplier',limit:2}) as any;
  assert.equal(view.run_id,run.id);assert.equal(view.totals.grand_total,run.totals.grand_total);assert.equal(view.contributions.length,2);
  const line=workspaceTool(ctx,'inspect_inventory',{run_id:run.id,contribution_id:view.contributions[0].id}) as any;
  assert.ok(line.records.length);assert.ok(line.contribution.factor_id);
  const cmp=workspaceTool(ctx,'compare_inventory_years',{from_year:2024,to_year:2025}) as any;
  assert.equal(cmp.deltas.grand_total,Math.round((cmp.to.totals.grand_total-cmp.from.totals.grand_total)*1e6)/1e6);
  assert.match(cmp.limitations,/not a verified organizational-boundary/);
  assert.equal((workspaceTool(ctx,'inspect_inventory',{year:2030}) as any).missing,true);
  assert.deepEqual(all(app.db,'SELECT id,payload_json FROM source_records'),before);
  assert.equal(get<any>(app.db,'SELECT COUNT(*) n FROM corrections')!.n,0);
});

test('workspace assistant: reads reports, targets, tasks and uploaded evidence without approving anything',async(t)=>{
  const app=await makeApp();t.after(app.cleanup);await seed(app);const ctx=context(app);
  const report=createDoc(app.db,'reports',{title:'Board report',period:'2025',status:'draft',summary:'Supplier evidence remains under review.'});
  createDoc(app.db,'consultant_tasks',{title:'Confirm a supplier quote',year:2025,status:'open'});
  const doc=await addEvidence(app.db,app.cfg.uploadsDir,{filename:'supplier-note.txt',bytes:Buffer.from('The supplier asks us to verify the product unit before reporting.')});
  const reports=workspaceTool(ctx,'read_workspace_documents',{collection:'reports',id:report.id,year:2025}) as any;
  assert.equal(reports.rows[0].data.status,'draft');
  assert.equal((workspaceTool(ctx,'read_workspace_documents',{collection:'consultant_tasks',q:'supplier'}) as any).total,1);
  assert.equal((workspaceTool(ctx,'get_targets_and_reporting',{}) as any).targets.length,0);
  assert.equal((workspaceTool(ctx,'search_evidence_documents',{q:'product unit'}) as any).total,1);
  const text=workspaceTool(ctx,'search_evidence_documents',{evidence_id:doc.evidence.id}) as any;
  assert.match(text.pages[0].text,/verify the product unit/);assert.ok(!JSON.stringify(text).includes('stored_path'));
  assert.throws(()=>workspaceTool(ctx,'read_workspace_documents',{collection:'app_settings'}));
  assert.throws(()=>workspaceTool(ctx,'approve_issue',{id:'anything'}));
  assert.equal((workspaceTool(ctx,'read_workspace_documents',{collection:'reports',id:report.id}) as any).rows[0].data.status,'draft');
});

test('workspace assistant: a selected incident does not force incident routing or block unrelated questions',async(t)=>{
  const model=new WorkspaceModel();model.plan=[[{name:'read_workspace_documents',args:{collection:'reports'}}]];
  const app=await makeApp({llm:model});t.after(app.cleanup);await seed(app);
  const incident=get<any>(app.db,'SELECT id FROM dq_issues LIMIT 1')!;
  const result=await ask(app,{question:'What reports have we saved?',context:{page:'/data-quality',scope:'selection',issue_id:incident.id}});
  assert.equal(result.statusCode,200,result.body);const data=result.json();
  assert.equal(data.experts[0].id,'workspace_assistant');assert.equal(data.tool_calls[0].name,'read_workspace_documents');
  const tools=model.requests.find(r=>r.tools)!.tools!;
  for(const name of ['search_workspace_data','summarize_workspace_data','inspect_inventory','get_action_options','get_targets_and_reporting','list_open_issues','run_nature_query'])assert.ok(tools.some(t=>t.name===name));
  assert.match(model.requests[1].system,/Page context is a useful reference, never a restriction/);
});

test('workspace assistant: conceptual guidance and drafting need no fabricated data citation',async(t)=>{
  const model=new WorkspaceModel();model.response={answer:'General guidance: compare recurring operating savings with upfront investment, and verify supplier quotes before committing.',response_type:'guidance',citation_ids:[],followups:[],insufficient:false};
  const app=await makeApp({llm:model});t.after(app.cleanup);
  const data=(await ask(app,{question:'How should I think about payback?',context:{page:'/data-quality',scope:'workspace',issue_id:'stale-selection-is-ignored'}})).json();
  assert.equal(data.status,'completed');assert.equal(data.response_type,'guidance');assert.equal(data.insufficient,false);assert.deepEqual(data.citations,[]);
  assert.equal(get<any>(app.db,'SELECT COUNT(*) n FROM corrections')!.n,0);
});

test('workspace assistant: cross-page history is context only and unsupported figures are withheld',async(t)=>{
  const model=new WorkspaceModel();model.response={answer:'The investment will save €987654321.',citation_ids:[],followups:[],insufficient:false};
  const app=await makeApp({llm:model});t.after(app.cleanup);
  const history=[{role:'user',content:'Help with suppliers.'},{role:'assistant',content:'Unverified earlier reply.'}];
  const data=(await ask(app,{history,context:{page:'/reports',scope:'workspace'}})).json();
  assert.equal(data.status,'failed');assert.equal(data.answer,'');
  assert.deepEqual(JSON.parse(String(model.requests.find(r=>r.tools)!.contents[0].parts![0].text)).untrusted_history,history);
  assert.match(data.message,/not found in the data/);
});

test('workspace assistant: broad guidance takes a single model call and provider limits retain evidence',async(t)=>{
  const requests:LlmRequest[]=[];let limited=false;
  const model:LlmClient={mode:'stub',model:'direct-chat',async generate(req){requests.push(req);if(limited)throw new Error('429 quota exceeded');return {text:JSON.stringify({answer:'General guidance: I can help explain the data and plan your next steps.',response_type:'guidance',citation_ids:[],followups:[],insufficient:false}),calls:[],content:null,usage:{input:1,output:1}};}};
  const app=await makeApp({llm:model});t.after(app.cleanup);
  const body={question:'What can you help with?',context:{page:'/data-quality',scope:'workspace'}};
  assert.equal((await ask(app,body)).json().status,'completed');assert.equal(requests.length,1,'no routing or duplicate final-generation call');
  limited=true;const failed=(await ask(app,body)).json();assert.equal(failed.status,'failed');assert.match(failed.message,/temporarily rate-limited/);assert.ok(failed.facts.some((f:any)=>f.id==='workspace:catalogue'));
});

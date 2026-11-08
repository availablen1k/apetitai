// Read-only decision projections. No approvals, inventory writes, agent calls or nature writes.
import { z } from 'zod';
import { type DB, type Row, all, get } from '../db/database.ts';
import type { Config } from '../config.ts';
import { type RunRow, getRun, latestRun } from './calculations.ts';
import { leverCatalogue, leverEffects } from './discoveryMiners.ts';
import { createDoc, getDoc, listDocs, updateDoc } from './workspace.ts';
import { criticalitySQL } from '../domain/criticality.ts';
import { readableReport } from '../domain/readableReport.ts';
import { issueFromRow } from './quality.ts';
import { HttpError, recordAudit } from './common.ts';
import { INVENTORY_TABLES } from './data.ts';
import { yearCoverage } from './reportingYears.ts';

export const WorkspaceQuery = z.object({year:z.coerce.number().int().min(2000).max(2100),run_id:z.string().max(100).optional()});
export const ActionQuery = WorkspaceQuery.extend({id:z.string().max(100).optional(),q:z.string().trim().max(120).optional(),scope:z.string().max(60).optional(),limit:z.coerce.number().int().min(1).max(50).default(15),offset:z.coerce.number().int().min(0).max(100000).default(0)});
export const TargetDefinition = z.object({
  id:z.string().min(1).max(100), name:z.string().min(1).max(160), metric:z.enum(['scope1','scope2','scope1_2','scope3','total']),
  baseline_run_id:z.string().min(1).max(100), target_year:z.number().int().min(2000).max(2100), target_tco2e:z.number().finite().nonnegative(),
  boundary:z.string().min(1).max(500), comparable_run_ids:z.array(z.string().max(100)).max(50).default([]),boundary_reviewed_by:z.string().trim().max(80).optional(),
});
const metricValue = (r:RunRow,metric:string) => ({scope1:r.totals.scope1_total,scope2:r.totals.scope2_reported,scope1_2:r.totals.scope1_total+r.totals.scope2_reported,scope3:r.totals.scope3_total,total:r.totals.grand_total} as Record<string,number>)[metric];
const numberOrNull = (v:unknown) => typeof v==='number' && Number.isFinite(v) ? v : null;
export const operatingFinance = (lever:{capex_eur?:number|null;opex_delta_eur_per_yr?:number|null;lifetime_yr?:number|null}) => {
  const upfront=numberOrNull(lever.capex_eur),delta=numberOrNull(lever.opex_delta_eur_per_yr),lifetime=numberOrNull(lever.lifetime_yr);
  const payback=upfront!==null&&upfront>=0&&delta!==null&&delta<0 ? upfront/-delta : null;
  return {upfront_eur:upfront,annual_operating_delta_eur:delta,annual_operating_saving_eur:delta===null?null:-delta,simple_payback_years:payback,payback_within_lifetime:payback===null||lifetime===null?null:payback<=lifetime,lifetime_years:lifetime,basis:'catalogue_design_estimate',currency:'EUR'};
};
const OPEN_ISSUE="status='open' AND (rule_id NOT LIKE 'agent.%' OR detection_state='active')";
function selectedRun(db:DB,q:z.infer<typeof WorkspaceQuery>) {
  const r=q.run_id?getRun(db,q.run_id):latestRun(db,q.year);
  if(r&&(r.year!==q.year||r.kind!=='inventory'))throw new HttpError(400,'Select an inventory calculation for the displayed reporting year.');
  return r;
}
function configuredTargets(db:DB,r:RunRow|null,year:number) {
  const settings=listDocs(db,'app_settings',{}, {limit:1})[0];
  const raw=Array.isArray(settings?.decision_targets)?settings.decision_targets:[];
  let invalid=0;
  const targets=raw.slice(0,50).flatMap(value=>{
    const parsed=TargetDefinition.safeParse(value);if(!parsed.success){invalid++;return [];}
    const t=parsed.data;
    let base:RunRow;try{base=getRun(db,t.baseline_run_id);}catch{invalid++;return [];}
    if(t.target_year<=base.year||base.kind!=='inventory'){invalid++;return [];}
    const baseline=metricValue(base,t.metric)??null,current=r?metricValue(r,t.metric)??null:null;
    const basisMatches=!['scope2','scope1_2','total'].includes(t.metric)||r?.scope2_basis===base.scope2_basis;
    const inPeriod=year>=base.year&&year<=t.target_year;
    const boundaryConfirmed=!!r&&(r.id===base.id||!!t.boundary_reviewed_by&&t.comparable_run_ids.includes(r.id));
    const quality=!!r&&!readableReport(r,null,'en').snapshot.provisional&&!readableReport(base,null,'en').snapshot.provisional;
    const comparable=!!r&&inPeriod&&basisMatches&&r.method_version===base.method_version&&boundaryConfirmed;
    return [{...t,baseline_year:base.year,baseline_tco2e:baseline,current_tco2e:current,current_run_id:r?.id||null,scope2_basis:base.scope2_basis,
      comparable,quality_confirmed:quality,endpoint_gap_tco2e:comparable&&current!==null?Math.max(0,current-t.target_tco2e):null,
      inventory_change_tco2e:comparable&&current!==null&&baseline!==null?current-baseline:null,
      evidence_status:!r?'no_calculation':!inPeriod?'outside_period':!basisMatches||r.method_version!==base.method_version?'method_mismatch':!boundaryConfirmed?'boundary_unconfirmed':!quality?'provisional':'comparable_inventory',
      verified_physical_reduction_tco2e:null,eligible_action_contribution_tco2e:null}];
  });return {targets,invalid};
}

export function decisionWorkspace(db:DB,q:z.infer<typeof WorkspaceQuery>) {
  const r=selectedRun(db,q);const {targets,invalid}=configuredTargets(db,r,q.year);
  const openWhere=`${OPEN_ISSUE} AND (year=? OR year IS NULL)`;
  const open=Number(get<{n:number}>(db,`SELECT COUNT(*) n FROM dq_issues WHERE ${openWhere}`,q.year)?.n||0);
  // Read by frontend builds made before 2026-11-08 05:00 (the shared jury link). Remove when no such build is served.
  const incidents=all<Row>(db,`SELECT * FROM dq_issues WHERE ${openWhere} ORDER BY CASE ${criticalitySQL()} WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,first_seen_at LIMIT 3`,q.year).map(issueFromRow);
  const corrections=all<{id:string}>(db,"SELECT c.id FROM corrections c JOIN dq_issues i ON i.id=c.issue_id WHERE c.status='approved' AND c.action!='acknowledge' AND (i.year=? OR i.year IS NULL)",q.year);
  const unapplied=corrections.filter(c=>!r?.correction_ids.includes(c.id)).length;
  const newBatches=r?Number(get<{n:number}>(db,"SELECT COUNT(DISTINCT s.batch_id) n FROM source_records s JOIN import_batches b ON b.id=s.batch_id WHERE (s.year=? OR s.year IS NULL) AND b.imported_at>? AND s.table_name IN (SELECT value FROM json_each(?))",q.year,r.created_at,JSON.stringify(INVENTORY_TABLES))?.n||0):0;
  const reports=listDocs(db,'reports',{period:String(q.year)},{limit:100});
  const matching=reports.filter(report=>r&&report.run_id===r.id);
  const approved=matching.find(report=>report.status==='approved');
  const period=`year=${q.year}`;const footprint=`/sustainability?${period}${r?`&run=${r.id}`:''}`;
  const snapshot=r?readableReport(r,null,'en').snapshot:null;
  const requirements=[
    {id:'calculation',label:{en:'Save the reporting calculation',fi:'Tallenna raportointilaskelma'},state:r?'recorded':'missing',count:r?1:0,to:footprint},
    {id:'incidents',label:{en:'Review open incidents',fi:'Tarkista avoimet poikkeamat'},state:open?'needs_review':'recorded',count:open,to:`/data-quality?${period}`},
    {id:'recalculate',label:{en:'Include approved changes and new source data',fi:'Sisällytä hyväksytyt muutokset ja uudet lähteet'},state:!r?'missing':unapplied||newBatches?'needs_review':'recorded',count:unapplied+newBatches,to:footprint},
    {id:'coverage',label:{en:'Resolve or explain calculation gaps',fi:'Selvitä laskennan tietopuutteet'},state:!r?'missing':r.gaps.length?'needs_review':'recorded',count:r?.gaps.length??null,to:`${footprint}#calculation-evidence`},
    {id:'estimates',label:{en:'Review estimates and calculation checks',fi:'Tarkista arviot ja laskentatarkistukset'},state:!r?'missing':snapshot!.estimated_entries+snapshot!.failed_checks?'needs_review':'recorded',count:snapshot?snapshot.estimated_entries+snapshot.failed_checks:null,to:`${footprint}#calculation-evidence`},
    {id:'report',label:{en:'Review and sign off this saved report',fi:'Tarkista ja hyväksy tallennettu raportti'},state:approved?'recorded':matching.length?'needs_review':'missing',count:matching.length,to:`/reports?${period}`},
  ];
  return {year:q.year,standing:standing(db,r),run:r?{id:r.id,year:r.year,status:r.status,scope2_basis:r.scope2_basis,created_at:r.created_at,totals:r.totals,provisional:snapshot!.provisional,contains_demo_data:!!r.completeness.contains_demo_data}:null,
    targets,target_configuration_issues:invalid,incidents,reporting:{requirements,open_incidents:open,unapplied_corrections:unapplied,new_source_batches:newBatches,saved_review_items:snapshot?.review_items??null,report_id:approved?.id||matching[0]?.id||null,report_approved:!!approved,gaps:r?.gaps||[],snapshot_is_current:!!r&&!unapplied&&!newBatches}};
}

// Landing-page summary: change from the previous year, the largest categories and how much of the
// total rests on records with an incident that is open now.
export function standing(db:DB,r:RunRow|null) {
  if(!r)return null;
  const total=r.totals.grand_total;const share=(v:number)=>total>0?v/total*100:null;
  const prev=latestRun(db,r.year-1);
  const previous=prev?{year:prev.year,run_id:prev.id,grand_total:prev.totals.grand_total,comparable:prev.scope2_basis===r.scope2_basis&&prev.method_version===r.method_version,change_tco2e:total-prev.totals.grand_total,change_pct:prev.totals.grand_total>0?(total-prev.totals.grand_total)/prev.totals.grand_total*100:null}:null;
  const drivers=(r.completeness.by_category as {scope:string;category:string;tco2e:number;in_total:boolean}[]).filter(c=>c.in_total&&c.tco2e>0).sort((a,b)=>b.tco2e-a.tco2e).slice(0,3).map(c=>({scope:c.scope,category:c.category,tco2e:c.tco2e,share_pct:share(c.tco2e)}));
  const open=new Set(all<{id:string}>(db,`SELECT id FROM dq_issues WHERE ${OPEN_ISSUE}`).map(i=>i.id));
  const onOpen=all<{tco2e:number;ids:string}>(db,"SELECT tco2e,open_issue_ids_json ids FROM calculation_contributions WHERE run_id=? AND in_total=1 AND open_issue_ids_json!='[]'",r.id)
    .filter(c=>(JSON.parse(c.ids) as string[]).some(id=>open.has(id))).reduce((sum,c)=>sum+c.tco2e,0);
  const critical=Number(get<{n:number}>(db,`SELECT COUNT(*) n FROM dq_issues WHERE ${OPEN_ISSUE} AND (year=? OR year IS NULL) AND ${criticalitySQL()}='critical'`,r.year)?.n||0);
  return {grand_total:total,previous,drivers,trust:{open_issue_tco2e:onOpen,open_issue_share_pct:share(onOpen),critical_incidents:critical,missing_activity:yearCoverage(db,r.year).missing_activity}};
}

export function actionOptions(db:DB,cfg:Config,q:z.infer<typeof ActionQuery>) {
  const r=selectedRun(db,q);if(!r)return {year:q.year,run_id:null,total:0,rows:[],catalogue_status:'no_calculation',notes:['Save an inventory calculation to assess action effects.']};
  let catalogue:ReturnType<typeof leverCatalogue>;try{catalogue=leverCatalogue(cfg.nature);}catch(e){return {year:q.year,run_id:r.id,total:0,rows:[],catalogue_status:'unavailable',notes:[e instanceof Error?e.message:'Action catalogue unavailable.']};}
  const effects=leverEffects(db,r,catalogue);const targetInfo=configuredTargets(db,r,q.year);
  const memberships=new Map<string,Set<string>>();
  for(const entry of effects)for(const c of entry.result.contributors){if(!memberships.has(c.id))memberships.set(c.id,new Set());memberships.get(c.id)!.add(entry.lever.lever_id);}
  const tasks=listDocs(db,'consultant_tasks',{assessment_kind:'action_feasibility',year:String(q.year)},{limit:1000});
  const rows=effects.map(({lever,result})=>{
    const issues=[...new Set(result.contributors.flatMap(c=>c.open_issue_ids))];
    const overlap=[...new Set(result.contributors.flatMap(c=>[...memberships.get(c.id)||[]]))].filter(id=>id!==lever.lever_id);
    const finance=operatingFinance(lever);
    return {id:lever.lever_id,name:lever.name,scope:lever.scope,flag:lever.flag===1,baseline_run_id:r.id,baseline_year:r.year,stage:'expected',outcome_type:'operational_measure',
      effect:{inventory_delta_tco2e:result.tco2e,expected_reduction_tco2e:result.tco2e===null?null:Math.max(0,-result.tco2e),basis:result.basis,catalogue_design_2030_tco2e:lever.abatement_tco2e_2030_design,addressable_tco2e:result.ceiling,explanation:result.how,physical_reduction_verified_tco2e:null},
      finance,earliest_start:lever.earliest_start,ramp_years:lever.ramp_years??null,catalogue_evidence:lever.value_status||'Catalogue design estimate',co_benefits:lever.co_benefits,trade_offs:lever.trade_offs,
      readiness:result.basis==='recomputed'&&!issues.length?'assess_feasibility':'check_evidence',open_issue_count:issues.length,open_issue_ids:issues.slice(0,5),overlap_action_ids:overlap,overlap_assessed:result.contributors.length>0,
      eligible_target_contribution_tco2e:null,target_names:targetInfo.targets.filter(t=>t.metric==='total'||t.metric==='scope1_2'&&lever.scope==='scope1'||t.metric===lever.scope||t.metric==='scope3'&&lever.scope.startsWith('scope3')).map(t=>t.name),
      evidence:{contribution_count:result.contributors.length,contributions:result.contributors.slice(0,8).map(c=>({id:c.id,label:c.line_item,category:c.category,tco2e:c.tco2e,link:`/traceability?year=${q.year}&run=${r.id}&c=${c.id}`})),catalogue_link:`/nature?tab=queries&query=21_action_details&year=${q.year}`},
      assessments:tasks.filter(task=>task.lever_id===lever.lever_id).map(task=>({id:task.id,title:task.title,status:task.status,owner:task.owner,description:task.description,baseline_run_id:task.baseline_run_id}))};
  }).filter(row=>(!q.id||row.id===q.id)&&(!q.scope||row.scope===q.scope)&&(!q.q||`${row.name} ${row.id} ${row.scope}`.toLowerCase().includes(q.q.toLowerCase())))
    .sort((a,b)=>(a.effect.basis==='recomputed'?0:1)-(b.effect.basis==='recomputed'?0:1)||(b.effect.expected_reduction_tco2e||0)-(a.effect.expected_reduction_tco2e||0)||a.id.localeCompare(b.id));
  return {year:q.year,run_id:r.id,total:rows.length,rows:rows.slice(q.offset,q.offset+q.limit),catalogue_status:'available',notes:['Effects are expected scenarios against a saved inventory, not implemented or verified reductions.','Catalogue finances describe full-design operation and are not scaled to the selected inventory.','Overlapping measures must not be added together. Target eligibility has not been assessed.'],scope_options:[...new Set(effects.map(e=>e.lever.scope))]};
}

export const AssessmentBody = WorkspaceQuery.extend({run_id:z.string().min(1).max(100),reviewer_label:z.string().trim().min(1).max(80),note:z.string().trim().min(1).max(1000),request_id:z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/)});
export function recordAssessment(db:DB,cfg:Config,id:string,body:z.infer<typeof AssessmentBody>) {
  const existing=listDocs(db,'consultant_tasks',{assessment_request_id:body.request_id},{limit:1})[0];
  if(existing){if(existing.lever_id!==id||existing.year!==body.year||existing.baseline_run_id!==body.run_id)throw new HttpError(409,'This request belongs to another action assessment.');return existing;}
  const action=actionOptions(db,cfg,ActionQuery.parse({...body,id})).rows[0];
  if(!action)throw new HttpError(404,'Action not available for this saved calculation.');
  const task=createDoc(db,'consultant_tasks',{assessment_kind:'action_feasibility',assessment_request_id:body.request_id,lever_id:id,year:body.year,baseline_run_id:action.baseline_run_id,title:action.name,description:body.note,owner:body.reviewer_label,status:'open'});
  recordAudit(db,{event_type:'action.assessment_requested',actor_kind:'reviewer',actor_label:body.reviewer_label,entity_type:'consultant_task',entity_id:task.id,after:{lever_id:id,baseline_run_id:action.baseline_run_id,note:body.note}});
  return task;
}
export function finishAssessment(db:DB,id:string,reviewer:string) {
  const task=getDoc(db,'consultant_tasks',id);
  if(task.assessment_kind!=='action_feasibility')throw new HttpError(400,'This task is not an action feasibility assessment.');
  if(task.status==='done')return task;
  const updated=updateDoc(db,'consultant_tasks',id,{status:'done',reviewed_by:reviewer});
  recordAudit(db,{event_type:'action.assessment_completed',actor_kind:'reviewer',actor_label:reviewer,entity_type:'consultant_task',entity_id:id,after:{status:'done',lever_id:task.lever_id,note:'Feasibility review only; implementation and physical savings are not verified.'}});
  return updated;
}

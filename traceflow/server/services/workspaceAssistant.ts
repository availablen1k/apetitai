// Bounded, read-only workspace tools. The model supplies structured filters, never SQL or paths.
import { z } from 'zod';
import { type DB, type Row, type SqlValue, all, get, json } from '../db/database.ts';
import type { Config } from '../config.ts';
import type { ToolDecl } from './gemini.ts';
import { DATASET_BY_ID } from '../domain/catalog.ts';
import { parseNumber, round, sha256 } from '../domain/util.ts';
import { HttpError } from './common.ts';
import { getRun, latestRun, getLineage } from './calculations.ts';
import { ActionQuery, actionOptions, decisionWorkspace } from './decisionWorkspace.ts';
import { evidenceText } from './evidence.ts';

export type WorkspaceEvidence = { id: string; label: string; value: string; source: string; link?: string };
type Context = { db: DB; cfg: Config; year: number; evidence: Map<string, WorkspaceEvidence> };
const year = z.number().int().min(2000).max(2100);
const field = z.string().regex(/^[\p{L}_][\p{L}\p{N}_ -]{0,79}$/u);
const paging = { limit: z.number().int().min(1).max(20).default(10), offset: z.number().int().min(0).max(1000000).default(0) };
const sourceQuery = z.object({ dataset: z.string().min(1).max(60), year: year.optional(), q: z.string().trim().max(120).optional(), filters: z.array(z.object({ field, value: z.string().max(160) })).max(6).default([]), ...paging });
const schemas = {
  get_workspace_overview: z.object({ year: year.optional() }),
  search_workspace_data: sourceQuery,
  summarize_workspace_data: sourceQuery.extend({ group_by: z.array(field).max(3).default([]), metric: field.optional(), operation: z.enum(['count','sum','avg','min','max']).default('count') }),
  inspect_inventory: z.object({ year: year.optional(), run_id: z.string().max(100).optional(), contribution_id: z.string().max(140).optional(), group_by: z.enum(['category','supplier','material','site']).default('category'), q: z.string().max(120).optional(), ...paging }),
  compare_inventory_years: z.object({ from_year: year, to_year: year }),
  get_action_options: z.object({ year: year.optional(), id: z.string().max(100).optional(), q: z.string().max(120).optional(), scope: z.string().max(60).optional(), ...paging }),
  get_targets_and_reporting: z.object({ year: year.optional() }),
  read_workspace_documents: z.object({ collection: z.enum(['reports','consultant_tasks','automation_runs','farm_alerts']), id: z.string().max(100).optional(), year: year.optional(), q: z.string().max(120).optional(), ...paging }),
  search_evidence_documents: z.object({ q: z.string().max(120).optional(), evidence_id: z.string().max(100).optional(), page: z.number().int().min(1).max(100000).default(1), ...paging }),
};
const properties = {
  year: { type:'integer', description:'Optional reporting year. Omit on source searches to search all years and undated master data.' },
  dataset: { type:'string', description:'Exact dataset id from the workspace catalogue.' },
  q:{type:'string',description:'Literal search text or identifier.'},
  filters:{type:'array',items:{type:'object',properties:{field:{type:'string'},value:{type:'string'}},required:['field','value']}},
  limit:{type:'integer'},offset:{type:'integer'},
};
const decl = (name: keyof typeof schemas, description: string, extra: Record<string,unknown> = {}, required: string[] = []): ToolDecl => ({name,description,parameters:{type:'object',properties:{...properties,...extra},required}});
export const WORKSPACE_TOOLS: ToolDecl[] = [
  decl('get_workspace_overview','Start here for any workspace question: all imported datasets, fields, available years, saved inventories, app guidance and capabilities.'),
  decl('search_workspace_data','Search ANY imported dataset: suppliers, materials, sites, purchases, shipments, farms, water, energy, reference libraries or custom imports. Returns original rows and separate approved overlays. Paginated; no totals inferred from a sample.',{},['dataset']),
  decl('summarize_workspace_data','Calculate counts or numeric aggregates over the FULL filtered imported dataset, grouped by fields. Raw input basis, not a validated inventory. Missing values excluded; units and currencies kept separate.',{group_by:{type:'array',items:{type:'string'}},metric:{type:'string'},operation:{type:'string',enum:['count','sum','avg','min','max']}},['dataset']),
  decl('inspect_inventory','Read a saved inventory and its largest sources or contributions, grouped by category, supplier, material or site. Use run_id plus contribution_id for full source/factor lineage.',{run_id:{type:'string'},contribution_id:{type:'string'},group_by:{type:'string',enum:['category','supplier','material','site']}}),
  decl('compare_inventory_years','Compute exact inventory differences between two years; includes coverage, provisional-data and comparability limitations. Change is not automatically physical savings.',{from_year:{type:'integer'},to_year:{type:'integer'}},['from_year','to_year']),
  decl('get_action_options','Read operational measures, expected carbon effects, investment, operating costs/savings, payback, overlap and assessment tasks. Finances are catalogue estimates.',{id:{type:'string'},scope:{type:'string'}}),
  decl('get_targets_and_reporting','Read actual company-configured targets, comparison evidence and actionable reporting requirements. No target or eligible reduction is invented.'),
  decl('read_workspace_documents','Search or read saved reports, feasibility tasks, automation results and farm alerts. Specify id for full document content.',{collection:{type:'string',enum:['reports','consultant_tasks','automation_runs','farm_alerts']},id:{type:'string'}},['collection']),
  decl('search_evidence_documents','Search uploaded document text/filenames. Read a specific evidence_id and page for extracted original/OCR text; unavailable text is explicit.',{evidence_id:{type:'string'},page:{type:'integer'}}),
];

function cite(ctx:Context,id:string,label:string,data:unknown,link:string,source:string) {
  ctx.evidence.set(id,{id,label,value:JSON.stringify(data).slice(0,2500),source,link});
  return id;
}
const clip = (value:unknown, length=700): unknown => {
  if(typeof value==='string')return value.length>length?`${value.slice(0,length)}… [truncated]`:value;
  if(Array.isArray(value))return value.slice(0,30).map(v=>clip(v,length));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!['_document','stored_path','pages_json'].includes(key)).map(([key,v])=>[key,clip(v,length)]));
  return value;
};
const literal = (s:string) => `%${s.replace(/[\\%_]/g,'\\$&')}%`;
const jsonPath = (f:string) => `$.${JSON.stringify(f)}`;
const numberFunctions = new WeakSet<DB>();

export function workspaceOverview(ctx:Context) {
  const datasets=all<{table_name:string;rows:number;first_year:number|null;last_year:number|null}>(ctx.db,'SELECT table_name,COUNT(*) rows,MIN(year) first_year,MAX(year) last_year FROM source_records GROUP BY table_name ORDER BY table_name').map(d=>{
    const sample=get<{payload_json:string}>(ctx.db,'SELECT payload_json FROM source_records WHERE table_name=? LIMIT 1',d.table_name);
    const def=DATASET_BY_ID.get(d.table_name);
    return {id:d.table_name,label:def?.label||d.table_name,rows:d.rows,first_year:d.first_year,last_year:d.last_year,fields:Object.keys(json(sample?.payload_json,{})).filter(k=>k!=='_document'),numeric_fields:def?.numeric||[]};
  });
  const inventories=all<Row>(ctx.db,"SELECT r.id,r.year,r.scope2_basis,r.status,json_extract(r.totals_json,'$.grand_total') tco2e FROM calculation_runs r WHERE r.kind='inventory' AND r.rowid=(SELECT MAX(r2.rowid) FROM calculation_runs r2 WHERE r2.kind='inventory' AND r2.year=r.year) ORDER BY r.year DESC LIMIT 30");
  const guidance={
    purpose:'A general workspace assistant for all imported data, saved analyses, operational measures, finances, targets, evidence, reports and how to use the app. General explanations and drafting are allowed; distinguish guidance from verified company facts.',
    navigation:{Overview:'/',Footprint:'/sustainability',Actions:'/actions',Reporting:'/reports',Validation:'/data-quality',Uploads:'/data-quality?tab=import',SuppliersAndMaterials:'/raw-materials',Transport:'/transport',Farms:'/farms',NatureAndWater:'/nature',SourceData:'/platform',Targets:'/settings#targets'},
    accounting:'Scope 1: direct operations. Scope 2: purchased energy, with one reported basis per inventory. Scope 3: value-chain emissions. FLAG separates relevant land/agriculture emissions. Raw inputs can contain errors; a saved calculation is not automatically verified. Inventory corrections are not physical carbon savings. Financial design estimates are not quotes or achieved savings.',
    permissions:'Read-only analysis. Explain, compare, summarize and draft; never approve corrections, investments, targets or reports, modify records, run automation or send messages. Human decisions use the existing review screens. No live web access.',
  };
  const id=cite(ctx,'workspace:catalogue','Available workspace data and app guide',{datasets,inventories,guidance},'/platform','imported data catalogue, saved inventory metadata and application workflow');
  return {evidence_id:id,default_year:ctx.year,datasets,inventories,guidance};
}

function sourceWhere(ctx:Context,q:z.infer<typeof sourceQuery>) {
  if(!get(ctx.db,'SELECT 1 FROM source_records WHERE table_name=? LIMIT 1',q.dataset))throw new HttpError(404,'Dataset not imported. Read the workspace catalogue for available datasets.');
  const clauses=['table_name=?'];const params:SqlValue[]=[q.dataset];
  if(q.year!==undefined){clauses.push('year=?');params.push(q.year);}
  if(q.q){clauses.push("(record_key LIKE ? ESCAPE '\\' OR payload_json LIKE ? ESCAPE '\\')");params.push(literal(q.q),literal(q.q));}
  for(const filter of q.filters){clauses.push('CAST(json_extract(payload_json,?) AS TEXT)=?');params.push(jsonPath(filter.field),filter.value);}
  return {where:clauses.join(' AND '),params};
}

export function workspaceTool(ctx:Context,name:string,args:Record<string,unknown>):unknown {
  if(!(name in schemas))throw new HttpError(400,'Unknown workspace tool.');
  if(name==='get_workspace_overview')return workspaceOverview(ctx);
  if(name==='search_workspace_data'){
    const q=sourceQuery.parse(args);const {where,params}=sourceWhere(ctx,q);
    const total=get<{n:number}>(ctx.db,`SELECT COUNT(*) n FROM source_records WHERE ${where}`,...params)!.n;
    const rows=all<Row>(ctx.db,`SELECT id,record_key,year,source_file,source_row,payload_json FROM source_records WHERE ${where} ORDER BY source_file,source_row,id LIMIT ? OFFSET ?`,...params,q.limit,q.offset).map(r=>{
      const overlays=all<Row>(ctx.db,"SELECT id,field,action,approved_value FROM corrections WHERE record_id=? AND status='approved' ORDER BY decided_at",String(r.id));
      const row={id:r.id,record_key:r.record_key,year:r.year,file:r.source_file,line:r.source_row,original:clip(json(r.payload_json,{})),approved_overlays:overlays};
      return {evidence_id:cite(ctx,String(r.id),String(r.record_key),row,`/platform?table=${encodeURIComponent(q.dataset)}`,`original ${r.source_file}, line ${r.source_row}; approved overlays listed separately`),...row};
    });
    const id=cite(ctx,`source-search:${sha256(JSON.stringify(q)).slice(0,20)}`,`${q.dataset} search`,{total,filters:q.filters,year:q.year??'all',q:q.q},'/platform','complete filtered source-record count');
    return {evidence_id:id,total,limit:q.limit,offset:q.offset,rows,more:q.offset+rows.length<total,basis:'Original imported records, not validated totals. Approved overlays are separate; do not infer whole-dataset sums from this page.'};
  }
  if(name==='summarize_workspace_data'){
    const q=schemas.summarize_workspace_data.parse(args);const {where,params}=sourceWhere(ctx,q);
    if(q.operation!=='count'&&!q.metric)throw new HttpError(400,'A numeric metric is required.');
    if(!numberFunctions.has(ctx.db)){ctx.db.function('workspace_number',{deterministic:true},v=>parseNumber(v));numberFunctions.add(ctx.db);}
    const sample=all<{payload_json:string}>(ctx.db,'SELECT payload_json FROM source_records WHERE table_name=? LIMIT 20',q.dataset);
    const fields=new Set(sample.flatMap(r=>Object.keys(json<Record<string,unknown>>(r.payload_json,{}))));
    for(const f of [...q.group_by,...q.metric?[q.metric]:[]])if(!fields.has(f))throw new HttpError(400,`Unknown field ${f}. Read the dataset catalogue or search its records.`);
    const units=q.operation==='count'?[]:(q.metric==='net_amount'?['currency']:q.metric==='quantity'?['uom','unit']:q.metric==='value'?['unit','carrier']:q.metric==='pcf_value'?['declared_unit']:q.metric==='kgco2e_per_unit'?['unit']:[]).filter(f=>fields.has(f));
    const grouping=[...new Set([...q.group_by,...units])];
    const groupSql=grouping.map((_,i)=>`json_extract(payload_json,?) AS g${i}`);
    const groupParams=grouping.map(jsonPath);
    const expression=q.operation==='count'?'COUNT(*)':`${q.operation.toUpperCase()}(workspace_number(json_extract(payload_json,?)))`;
    const numeric=q.metric?jsonPath(q.metric):null;
    const metricParams=q.operation==='count'?[]:[numeric!];
    const total=get<{n:number}>(ctx.db,`SELECT COUNT(*) n FROM source_records WHERE ${where}`,...params)!.n;
    const groups=all<Row>(ctx.db,`SELECT ${[...groupSql,'COUNT(*) rows',q.operation==='count'?'COUNT(*) numeric_rows':'COUNT(workspace_number(json_extract(payload_json,?))) numeric_rows',`${expression} value`].join(',')} FROM source_records WHERE ${where}${grouping.length?` GROUP BY ${grouping.map((_,i)=>`g${i}`).join(',')}`:''} ORDER BY value DESC LIMIT ? OFFSET ?`,...groupParams,...q.operation==='count'?[]:[numeric!],...metricParams,...params,q.limit,q.offset).map(r=>({group:Object.fromEntries(grouping.map((f,i)=>[f,r[`g${i}`]])),rows:r.rows,numeric_rows:r.numeric_rows,value:r.value}));
    const data={dataset:q.dataset,year:q.year??'all',operation:q.operation,metric:q.metric??'rows',group_by:grouping,total_matching_rows:total,groups,limit:q.limit,offset:q.offset,basis:'Raw imported values, including unresolved source errors; no correction overlays, no unit conversion or currency conversion. Units/currencies grouped separately. Null and non-numeric values excluded from numeric aggregates. Not a validated inventory or proof of carbon savings.'};
    return {evidence_id:cite(ctx,`source-aggregate:${sha256(JSON.stringify(q)).slice(0,20)}`,`${q.dataset} ${q.operation}`,data,'/platform','deterministic aggregate across the complete filtered source dataset'),...data};
  }
  if(name==='inspect_inventory'){
    const q=schemas.inspect_inventory.parse(args);const run=q.run_id?getRun(ctx.db,q.run_id):latestRun(ctx.db,q.year??ctx.year);
    if(!run)return {missing:true,year:q.year??ctx.year,message:'No saved inventory. Missing is not zero.'};
    if(run.kind!=='inventory'||q.year!==undefined&&run.year!==q.year)throw new HttpError(400,'Choose an inventory for the requested year.');
    if(q.contribution_id){const lineage=getLineage(ctx.db,run.id,q.contribution_id);return {evidence_id:cite(ctx,q.contribution_id,lineage.contribution.line_item,{tco2e:lineage.contribution.tco2e,formula:lineage.contribution.formula},`/traceability?year=${run.year}&run=${run.id}&c=${q.contribution_id}`,'saved source/factor lineage'),...lineage};}
    const group={category:'category',supplier:"COALESCE(json_extract(inputs_json,'$.supplier_id'),'Not attributed')",material:"COALESCE(json_extract(inputs_json,'$.material_id'),'Not attributed')",site:"COALESCE(json_extract(inputs_json,'$.site_id'),CASE WHEN line_item LIKE 'S-%' THEN substr(line_item,1,5) ELSE 'Not attributed' END)"}[q.group_by];
    const search=q.q?" AND (line_item LIKE ? ESCAPE '\\' OR inputs_json LIKE ? ESCAPE '\\')":'';const binds=q.q?[literal(q.q),literal(q.q)]:[];
    const groups=all<Row>(ctx.db,`SELECT ${group} name,SUM(tco2e) tco2e,COUNT(*) contributions FROM calculation_contributions WHERE run_id=? AND in_total=1${search} GROUP BY name ORDER BY tco2e DESC LIMIT ? OFFSET ?`,run.id,...binds,q.limit,q.offset);
    const contributions=all<Row>(ctx.db,`SELECT id,line_item,category,tco2e,factor_id,factor_value,factor_unit,inputs_json,open_issue_ids_json FROM calculation_contributions WHERE run_id=? AND in_total=1${search} ORDER BY tco2e DESC LIMIT ? OFFSET ?`,run.id,...binds,q.limit,q.offset).map(c=>({...c,inputs:json(c.inputs_json,{}),open_issue_ids:json(c.open_issue_ids_json,[]),evidence_id:cite(ctx,String(c.id),String(c.line_item),{tco2e:c.tco2e,factor_value:c.factor_value,factor_unit:c.factor_unit},`/traceability?year=${run.year}&run=${run.id}&c=${c.id}`,'saved inventory contribution')}));
    const id=cite(ctx,`run:${run.id}`,`${run.year} inventory`,{totals:run.totals,groups},`/sustainability?year=${run.year}&run=${run.id}`,'immutable saved inventory; unresolved concerns remain');
    return {evidence_id:id,run_id:run.id,year:run.year,totals:run.totals,status:run.status,scope2_basis:run.scope2_basis,open_issue_count:run.open_issue_count,gaps:run.gaps,groups,contributions,limit:q.limit,offset:q.offset,note:'Grouped rows and contributions are paginated separately. Not attributed is explicit, not inferred. Saved values may include erroneous raw inputs; inspect incidents before relying on them.'};
  }
  if(name==='compare_inventory_years'){
    const q=schemas.compare_inventory_years.parse(args);const a=latestRun(ctx.db,q.from_year),b=latestRun(ctx.db,q.to_year);
    if(!a||!b)return {missing:true,message:'Both years need saved inventories before comparison.',from_available:!!a,to_available:!!b};
    const coverage=(r:typeof a)=>Object.keys(r.completeness.records_used as object||{}).filter(k=>Number((r.completeness.records_used as Record<string,number>)[k])>0).sort().join('|');
    const comparable=a.scope2_basis===b.scope2_basis&&a.method_version===b.method_version&&coverage(a)===coverage(b)&&!!a.completeness.contains_demo_data===!!b.completeness.contains_demo_data;
    const deltas=Object.fromEntries(Object.keys(b.totals).map(k=>[k,round(b.totals[k]-a.totals[k],6)]));
    const data={from:{year:a.year,run_id:a.id,totals:a.totals,open_issues:a.open_issue_count,status:a.status},to:{year:b.year,run_id:b.id,totals:b.totals,open_issues:b.open_issue_count,status:b.status},deltas,grand_total_change_pct:a.totals.grand_total?round((b.totals.grand_total-a.totals.grand_total)/a.totals.grand_total*100,3):null,method_basis_and_coverage_match:comparable,limitations:'This is a recorded inventory comparison. Matching dataset categories is not a verified organizational-boundary review. Open incidents and estimates can explain changes; no physical savings or target eligibility is established.'};
    return {evidence_id:cite(ctx,`inventory-comparison:${a.id}:${b.id}`,'Saved inventory comparison',data,`/sustainability?year=${b.year}`,'deterministic difference of saved totals'),...data};
  }
  if(name==='get_action_options'){
    const q=schemas.get_action_options.parse(args);const data=actionOptions(ctx.db,ctx.cfg,ActionQuery.parse({...q,year:q.year??ctx.year}));
    return {...data,evidence_id:cite(ctx,`action-search:${sha256(JSON.stringify(q)).slice(0,20)}`,'Operational measure search',{total:data.total,status:data.catalogue_status,year:q.year??ctx.year,filters:q},`/actions?year=${q.year??ctx.year}`,'read-only catalogue availability and filtered measure count'),rows:data.rows.map(r=>({evidence_id:cite(ctx,`action:${r.id}:${r.baseline_run_id}`,r.name,{effect:r.effect,finance:r.finance},`/actions?year=${r.baseline_year}&run=${r.baseline_run_id}&action=${r.id}`,'expected deterministic scenario and catalogue design finances'),...r}))};
  }
  if(name==='get_targets_and_reporting'){
    const q=schemas.get_targets_and_reporting.parse(args);const data=decisionWorkspace(ctx.db,{year:q.year??ctx.year});
    return {evidence_id:cite(ctx,`workspace-decisions:${data.year}`,'Configured targets and reporting requirements',{targets:data.targets,reporting:data.reporting},`/reports?year=${data.year}`,'configured target definitions and current reporting requirements'),...data};
  }
  if(name==='read_workspace_documents'){
    const q=schemas.read_workspace_documents.parse(args);const clauses=['collection=?'];const params:SqlValue[]=[q.collection];
    if(q.id){clauses.push('id=?');params.push(q.id);}if(q.year!==undefined){clauses.push("(json_extract(data_json,'$.year')=? OR json_extract(data_json,'$.period')=?)");params.push(q.year,String(q.year));}if(q.q){clauses.push("data_json LIKE ? ESCAPE '\\'");params.push(literal(q.q));}
    const where=clauses.join(' AND ');const total=get<{n:number}>(ctx.db,`SELECT COUNT(*) n FROM documents WHERE ${where}`,...params)!.n;
    const rows=all<Row>(ctx.db,`SELECT id,data_json,created_date FROM documents WHERE ${where} ORDER BY created_date DESC LIMIT ? OFFSET ?`,...params,q.limit,q.offset).map(r=>{
      const data=json<Record<string,unknown>>(r.data_json,{});const content=q.id?clip(data,4000):clip(Object.fromEntries(['title','year','period','status','summary','owner','description','workflow_name_en','error'].filter(k=>data[k]!==undefined).map(k=>[k,data[k]])),800);
      const link=q.collection==='reports'?`/reports?year=${data.period||data.year||ctx.year}`:q.collection==='automation_runs'?'/automations':q.collection==='farm_alerts'?'/farms':`/actions?year=${data.year||ctx.year}`;
      return {evidence_id:cite(ctx,String(r.id),String(data.title||q.collection),content,link,'saved workspace document; its status and period are part of its evidence'),id:r.id,created_date:r.created_date,data:content};
    });return {evidence_id:cite(ctx,`document-search:${sha256(JSON.stringify(q)).slice(0,20)}`,`${q.collection} search`,{total,filters:q},q.collection==='reports'?`/reports?year=${q.year??ctx.year}`:'/actions','complete filtered workspace document count'),total,rows,limit:q.limit,offset:q.offset,more:q.offset+rows.length<total};
  }
  const q=schemas.search_evidence_documents.parse(args);
  if(q.evidence_id){const file=get<Row>(ctx.db,'SELECT id,filename,text_status,page_count FROM evidence_files WHERE id=?',q.evidence_id);if(!file)throw new HttpError(404,'Evidence document not found.');const text=evidenceText(ctx.db,q.evidence_id);const pages=text.pages.filter(p=>(p.page??1)>=q.page).slice(0,3).map(p=>({...p,text:p.text.slice(0,4000)}));return {evidence_id:cite(ctx,q.evidence_id,String(file.filename),{file,pages},'/data-quality?tab=documents','original extracted document text or most recent completed OCR; not an accepted correction'),file,pages,from_ocr:text.from_ocr,truncated:true};}
  const where=q.q?"WHERE filename LIKE ? ESCAPE '\\' OR pages_json LIKE ? ESCAPE '\\' OR EXISTS(SELECT 1 FROM evidence_text_runs t WHERE t.evidence_id=evidence_files.id AND t.status='completed' AND t.pages_json LIKE ? ESCAPE '\\')":'';const params=q.q?[literal(q.q),literal(q.q),literal(q.q)]:[];
  const total=get<{n:number}>(ctx.db,`SELECT COUNT(*) n FROM evidence_files ${where}`,...params)!.n;
  const rows=all<Row>(ctx.db,`SELECT id,filename,kind,text_status,page_count,uploaded_at FROM evidence_files ${where} ORDER BY uploaded_at DESC LIMIT ? OFFSET ?`,...params,q.limit,q.offset).map(r=>({...r,evidence_id:cite(ctx,String(r.id),String(r.filename),r,'/data-quality?tab=documents','uploaded evidence metadata; use evidence_id to read extracted text')}));
  return {evidence_id:cite(ctx,`evidence-search:${sha256(JSON.stringify(q)).slice(0,20)}`,'Uploaded evidence search',{total,query:q.q??''},'/data-quality?tab=documents','complete matching evidence document count'),total,rows,limit:q.limit,offset:q.offset,more:q.offset+rows.length<total};
}

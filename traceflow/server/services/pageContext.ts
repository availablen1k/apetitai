// UI context is a bounded reference, never a trusted value. Resolve figures/evidence in SQLite.
import { z } from 'zod';
import { type DB, type Row, all, get, json } from '../db/database.ts';
import { getIssueDetail } from './quality.ts';
import { getLineage, getRun } from './calculations.ts';
import { getRecord } from './data.ts';
import { FlowQuery, footprintFlow } from './footprintFlow.ts';
import { IncidentFlowQuery, incidentFlow } from './incidentFlow.ts';
import { relatedDiscoveries } from './rootCause.ts';
import { HttpError } from './common.ts';
import type { Config } from '../config.ts';
import { ActionQuery, actionOptions, decisionWorkspace } from './decisionWorkspace.ts';
import { farmFootprint } from './farmFootprint.ts';

const id = z.string().min(1).max(240);
export const AssistantContext = z.object({
  scope: z.enum(['workspace','selection']).optional(),
  page: z.string().regex(/^\/[a-zA-Z0-9_/%.-]*$/).max(180), label: z.string().max(240).optional(),
  issue_id: id.optional(), run_id: id.optional(), contribution_id: id.optional(), record_id: id.optional(),
  finding_key: id.optional(), node_id: id.optional(), farm_id: z.string().min(1).max(40).optional(), query_id: z.string().max(80).optional(),
  action_id:z.string().min(1).max(100).optional(),
  target_id:id.optional(), category:z.string().min(1).max(100).optional(),
  metric: z.enum(['grand_total', 'scope1_total', 'scope2_reported', 'scope3_total']).optional(),
  flow: FlowQuery.optional(), incidents: IncidentFlowQuery.optional(),
});
export type PageContext = z.infer<typeof AssistantContext>;
export type ContextEvidence = { id: string; label: string; value: string; source: string; link: string };

export function resolvePageContext(db: DB, context?: PageContext,cfg?:Config,year=2025) {
  const facts: ContextEvidence[] = [];
  if (!context) return { facts, data: null };
  const fact = (id: string, label: string, value: string, source: string, link: string) => facts.push({ id, label, value, source, link });
  let data: unknown = { page: context.page, query_id: context.query_id || null };
  if (context.issue_id) {
    const d = getIssueDetail(db, context.issue_id);
    fact(d.issue.id, 'Selected incident', `${d.issue.explanation_en} Observed: ${d.issue.observed_value ?? 'unknown'}. Candidate (unconfirmed): ${d.issue.candidate_value ?? 'unknown'}. Criticality: ${d.issue.criticality}.`, 'dq_issues', `/data-quality?issue=${encodeURIComponent(d.issue.id)}`);
    data = { issue: d.issue, source: d.record ? { id: d.record.id, source_file: d.record.source_file, source_row: d.record.source_row, payload: d.record.payload } : null, discoveries: relatedDiscoveries(db, d.issue.id) };
  } else if (context.action_id) {
    if(!cfg)throw new HttpError(400,'Action context requires configured data sources.');
    const d=actionOptions(db,cfg,ActionQuery.parse({year,run_id:context.run_id,id:context.action_id}));
    const action=d.rows[0];if(!action)throw new HttpError(404,'Selected action is not available for this calculation.');
    fact(`action:${action.id}:${action.baseline_run_id}`,action.name,JSON.stringify({effect:action.effect,finance:action.finance,target_contribution:'not assessed'}),'deterministic action scenario and catalogue financial assumptions',`/actions?year=${year}&run=${action.baseline_run_id}&action=${action.id}`);
    data=action;
  } else if(context.target_id){
    const d=decisionWorkspace(db,{year,run_id:context.run_id});const target=d.targets.find(t=>t.id===context.target_id);
    if(!target)throw new HttpError(404,'Selected target definition is not available.');
    fact(`target:${target.id}`,target.name,JSON.stringify(target),'company-configured target; eligibility and physical reduction not verified',`/?year=${year}&target=${encodeURIComponent(target.id)}`);data=target;
  } else if(context.run_id&&context.category){
    const run=getRun(db,context.run_id);
    const total=get<{value:number|null;count:number}>(db,'SELECT SUM(tco2e) value,COUNT(*) count FROM calculation_contributions WHERE run_id=? AND category=? AND in_total=1',run.id,context.category)!;
    if(!total.count)throw new HttpError(404,'Selected category is not included in this calculation.');
    fact(`category:${run.id}:${context.category}`,context.category,`${total.value} tCO2e from ${total.count} saved contributions`,'saved calculation category',`/sustainability?year=${run.year}&run=${run.id}&category=${encodeURIComponent(context.category)}`);
    data={run_id:run.id,year:run.year,category:context.category,totals:total,records:all<Row>(db,'SELECT id,line_item,tco2e,inputs_json,factor_id,open_issue_ids_json FROM calculation_contributions WHERE run_id=? AND category=? AND in_total=1 ORDER BY tco2e DESC LIMIT 5',run.id,context.category)};
  } else if (context.flow && context.node_id) {
    const d = footprintFlow(db, { ...context.flow, focus: context.node_id, limit: 5, offset: 0 });
    const node = d.graph.nodes.find((n) => n.id === context.node_id);
    if (!node) throw new HttpError(404, 'The selected emissions flow is no longer available.');
    const query = new URLSearchParams({ flow_from: String(d.from_year), flow_to: String(d.to_year), flow_scope: d.scope, flow_land: d.land });
    fact(node.id, node.label.en, `${node.value} tCO2e (positive flows) across ${d.from_year}–${d.to_year}`, 'saved inventory flow', `/sustainability?${query}`);
    data = { selection: node, period: { from_year: d.from_year, to_year: d.to_year }, filters: d.context, totals: d.totals, yearly: d.yearly, records: d.records };
  } else if (context.incidents) {
    const d = incidentFlow(db, { ...context.incidents, focus: context.node_id, limit: 5, offset: 0 });
    const node = d.graph.nodes.find((n) => n.id === context.node_id);
    if (context.node_id && !node) throw new HttpError(404, 'The selected incident flow is no longer available.');
    fact(node?.id || 'incident-selection', node?.label.en || 'Filtered incidents', `${node?.value ?? d.total} distinct incidents`, 'incident discovery read model', '/data-quality');
    data = { selection: node, total: d.total, counts: d.counts, filters: context.incidents, policy: d.policy, records: d.records, discovery: d.discovery };
  } else if (context.run_id && context.contribution_id) {
    const d = getLineage(db, context.run_id, context.contribution_id);
    fact(d.contribution.id, d.contribution.line_item, `${d.contribution.tco2e} tCO2e`, 'saved calculation contribution', `/traceability?run=${encodeURIComponent(context.run_id)}&c=${encodeURIComponent(context.contribution_id)}`);
    data = { ...d, records: d.records.slice(0, 8) };
  } else if (context.run_id) {
    const d = getRun(db, context.run_id);
    const amount = context.metric ? d.totals[context.metric] : d.totals.grand_total;
    fact(d.id, context.metric || 'Selected inventory', `${amount} tCO2e`, `saved ${d.year} inventory`, `/sustainability?year=${d.year}`);
    data = { run_id: d.id, year: d.year, selected_metric: context.metric || 'grand_total', totals: d.totals, scope2_basis: d.scope2_basis, limitations: d.completeness,gaps:d.gaps,checks:d.checks };
  } else if (context.farm_id) {
    const d = farmFootprint(db, { year, status: 'all', q: context.farm_id, limit: 200, offset: 0 });
    const farm = d.rows.find((r) => r.farm_id === context.farm_id);
    if (!farm) throw new HttpError(404, 'Selected farm not found.');
    fact(`farm:${farm.farm_id}:${year}`, `Farm ${farm.farm_id} in ${year}`, `${farm.tco2e ?? 'no'} tCO2e; ${farm.delivered_kg ?? 'no'} kg delivered; data: ${farm.status}; open incidents: ${farm.open_issues}`, `saved ${year} inventory contract-farm contributions`, `/farms/${encodeURIComponent(farm.farm_id)}`);
    data = { farm, year, run_id: d.run_id, all_farms: d.summary };
  } else if (context.record_id) {
    const d = getRecord(db, context.record_id);
    if (!d) throw new HttpError(404, 'Selected source record not found.');
    fact(d.id, d.record_key, `${d.source_file}, line ${d.source_row}`, 'original source record', '/platform');
    data = d;
  } else if (context.finding_key) {
    const d = get<Row>(db, 'SELECT * FROM discovery_findings WHERE finding_key = ? ORDER BY rowid DESC LIMIT 1', context.finding_key);
    if (!d) throw new HttpError(404, 'Selected discovery finding not found.');
    fact(String(d.id), String(d.found_en), String(d.suggest_en), 'saved discovery finding', '/actions#findings');
    data = { found: d.found_en, suggest: d.suggest_en, facts: json(d.facts_json, {}), effect: json(d.effect_json, {}), evidence: json(d.evidence_json, []) };
  }
  return { facts, data };
}

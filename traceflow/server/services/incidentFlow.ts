// One canonical dq_issues id is one incident, regardless of how many detectors/discoveries cite it.
import { z } from 'zod';
import { type DB, type Row, all, json } from '../db/database.ts';
import { DATASET_BY_ID } from '../domain/catalog.ts';
import { CRITICALITIES, CRITICALITY_POLICY } from '../domain/criticality.ts';
import { IncludeShared, issueFilterWhere, issueFromRow } from './quality.ts';

export const IncidentFlowQuery = z.object({
  status: z.enum(['open', 'approved', 'rejected']).optional(),
  criticality: z.enum(CRITICALITIES).optional(),
  table: z.string().max(60).optional(), year: z.coerce.number().int().min(2000).max(2100).optional(),
  include_shared: IncludeShared,
  issue_type: z.string().max(80).optional(), rule_id: z.string().max(120).optional(),
  q: z.string().trim().max(100).optional(), focus: z.string().max(240).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(10), offset: z.coerce.number().int().min(0).max(1000000).default(0),
});
const COLORS = { critical: '#BA1744', high: '#E97856', medium: '#D9A21B', low: '#8D9E94' };
const txt = (en: string, fi = en) => ({ en, fi });
const LEVELS = { critical: txt('Critical', 'Kriittinen'), high: txt('High', 'Korkea'), medium: txt('Medium', 'Keskitaso'), low: txt('Low', 'Matala') };
const TYPES: Record<string, ReturnType<typeof txt>> = {
  unit_error: txt('Unit mismatch', 'Yksikköristiriita'), decimal_shift: txt('Decimal or scale mismatch', 'Desimaali- tai mittakaavavirhe'),
  duplicate_record: txt('Possible duplicate', 'Mahdollinen kaksoiskappale'), missing_value: txt('Missing information', 'Puuttuva tieto'),
  missing_record: txt('Missing record', 'Puuttuva merkintä'), missing_survey: txt('Missing farm survey', 'Puuttuva tilakysely'),
  missing_pcf: txt('Missing supplier footprint', 'Puuttuva toimittajan päästötieto'), soil_misreport: txt('Soil class conflict', 'Maalajiristiriita'),
  area_mismatch: txt('Area mismatch', 'Pinta-alaristiriita'), pcf_unit_error: txt('Supplier footprint unit or scale', 'Toimittajan päästöarvon yksikkö tai mittakaava'),
  pcf_stale_period: txt('Outdated supplier footprint', 'Vanhentunut toimittajan päästötieto'), ai_suspicious_input: txt('Unusual input identified by AI', 'AI:n havaitsema poikkeava tieto'),
  outlier_implausible: txt('Unusual input profile', 'Poikkeava tietoprofiili'), missing_leg: txt('Missing transport leg', 'Puuttuva kuljetusosuus'),
  mode_mislabel: txt('Transport mode conflict', 'Kuljetustaparistiriita'), wrong_gas_code: txt('Refrigerant code conflict', 'Kylmäainekoodin ristiriita'),
  coordinate_swap: txt('Swapped coordinates', 'Vaihtuneet koordinaatit'), currency_error: txt('Currency mismatch', 'Valuuttaristiriita'),
  total_mismatch: txt('Report total mismatch', 'Raportin summan ristiriita'), certificate_mismatch: txt('Certificate mismatch', 'Todistuksen ristiriita'),
};

export function incidentFlow(db: DB, input: z.infer<typeof IncidentFlowQuery>) {
  const { w, params } = issueFilterWhere({ ...input, criticality: undefined });
  const allIssues = all<Row>(db, `SELECT * FROM dq_issues ${w}`, ...params).map(issueFromRow);
  const issues = allIssues.filter((i) => !input.criticality || i.criticality === input.criticality);
  const discovery = new Map<string, { key: string; found: ReturnType<typeof txt>; suggest: ReturnType<typeof txt>; discovery_run_id: string }[]>();
  for (const f of all<Row>(db, `SELECT f.* FROM discovery_findings f JOIN discovery_runs r ON r.id = f.discovery_run_id
    WHERE r.rowid = (SELECT MAX(r2.rowid) FROM discovery_runs r2 WHERE r2.year = r.year AND r2.status IN ('completed','degraded','local_only'))`)) {
    const facts = json<Record<string, unknown>>(f.facts_json, {});
    const issueId = typeof facts.issue_id === 'string' ? facts.issue_id : null;
    if (issueId) {
      if (!discovery.has(issueId)) discovery.set(issueId, []);
      discovery.get(issueId)!.push({ key: String(f.finding_key), found: txt(String(f.found_en), String(f.found_fi)), suggest: txt(String(f.suggest_en), String(f.suggest_fi)), discovery_run_id: String(f.discovery_run_id) });
    }
  }
  const detectors = new Map<string, Set<string>>();
  for (const r of all<{ issue_id: string; origin: string }>(db, 'SELECT DISTINCT issue_id, origin FROM data_review_findings')) {
    if (!detectors.has(r.issue_id)) detectors.set(r.issue_id, new Set());
    detectors.get(r.issue_id)!.add(r.origin);
  }
  const groupId = (i: typeof issues[number]) => `dataset:${i.table_name}`;
  const typeId = (i: typeof issues[number]) => `rule:${i.rule_id}`;
  const datasetLabel = (table: string) => txt(DATASET_BY_ID.get(table)?.label || table.replaceAll('_', ' '));
  const typeLabel = (i: typeof issues[number]) => TYPES[i.issue_type] || txt(i.issue_type.replaceAll('_', ' '));
  const counts = (key: (i: typeof issues[number]) => string) => {
    const map = new Map<string, number>(); for (const i of issues) { const id = key(i); map.set(id, (map.get(id) || 0) + 1); } return map;
  };
  const groupCounts = counts(groupId);
  const namedGroups = new Set([...groupCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([id]) => id));
  const displayedGroup = (i: typeof issues[number]) => namedGroups.has(groupId(i)) ? groupId(i) : 'datasets:other';
  const groupNumber = new Set(issues.map(displayedGroup)).size;
  // An activity node belongs to its dataset, so both sides remain count-conserving.
  const sourceKey = (i: typeof issues[number]) => `${groupId(i)}|${typeId(i)}`;
  const sourceCounts = counts(sourceKey);
  const namedTypes = new Set([...sourceCounts].filter(([id]) => namedGroups.has(id.split('|')[0])).sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0])).slice(0, 10 - groupNumber).map(([id]) => id));
  for (const group of namedGroups) {
    const sources = [...sourceCounts.keys()].filter((id) => id.startsWith(group + '|'));
    if (sources.length === 1) namedTypes.add(sources[0]);
  }
  const displayedType = (i: typeof issues[number]) => !namedGroups.has(groupId(i)) ? 'datasets:other:types' : namedTypes.has(sourceKey(i)) ? sourceKey(i) : `${groupId(i)}:other-types`;
  type Member = { id: string; label: ReturnType<typeof txt>; value: number };
  type Node = { id: string; kind: string; label: ReturnType<typeof txt>; value: number; scope: string; color: string; members: Map<string, Member>; yearly: Map<number | string, number> };
  const nodes = new Map<string, Node>();
  const links = new Map<string, { source: string; target: string; value: number; scope: string; land: string; color: string; yearly: Map<number | string, number> }>();
  const addNode = (id: string, kind: string, label: ReturnType<typeof txt>, color: string, i: typeof issues[number], member?: Member) => {
    if (!nodes.has(id)) nodes.set(id, { id, kind, label, color, scope: '', value: 0, members: new Map(), yearly: new Map() });
    const n = nodes.get(id)!; n.value++;
    const y = i.year ?? 'undated'; n.yearly.set(y, (n.yearly.get(y) || 0) + 1);
    if (member) { if (!n.members.has(member.id)) n.members.set(member.id, { ...member, value: 0 }); n.members.get(member.id)!.value++; }
  };
  const addLink = (source: string, target: string, color: string, i: typeof issues[number]) => {
    const id = `${source}->${target}`;
    if (!links.has(id)) links.set(id, { source, target, value: 0, color, scope: '', land: '', yearly: new Map() });
    const l = links.get(id)!; l.value++; const y = i.year ?? 'undated'; l.yearly.set(y, (l.yearly.get(y) || 0) + 1);
  };
  for (const i of issues) {
    const group = displayedGroup(i), type = displayedType(i), end = `criticality:${i.criticality}`;
    addNode(group, 'group', group === 'datasets:other' ? txt('Other datasets', 'Muut aineistot') : datasetLabel(i.table_name), '#7D898B', i, { id: groupId(i), label: datasetLabel(i.table_name), value: 0 });
    addNode(type, 'source', namedTypes.has(sourceKey(i)) && namedGroups.has(groupId(i)) ? typeLabel(i) : txt('Other incident types', 'Muut havaintotyypit'), '#667DE1', i, { id: typeId(i), label: typeLabel(i), value: 0 });
    addNode(end, 'scope', LEVELS[i.criticality], COLORS[i.criticality], i);
    addLink(group, type, '#9AA4A6', i); addLink(type, end, COLORS[i.criticality], i);
  }
  const ns = [...nodes.values()]; const index = new Map(ns.map((n,i) => [n.id,i]));
  const years = [...new Set(issues.map((i) => i.year ?? 'undated'))].sort((a,b) => String(a).localeCompare(String(b)));
  const yearly = (values: Map<number | string, number>) => years.map((year) => ({ year, value: values.get(year) || 0 }));
  const focused = issues.filter((i) => !input.focus || [displayedGroup(i), displayedType(i), `criticality:${i.criticality}`].includes(input.focus))
    .sort((a,b) => CRITICALITIES.indexOf(a.criticality)-CRITICALITIES.indexOf(b.criticality) || b.first_seen_at.localeCompare(a.first_seen_at) || a.id.localeCompare(b.id));
  return {
    total: issues.length, counts: CRITICALITIES.map((level) => ({ level, label: LEVELS[level], count: allIssues.filter((i) => i.criticality === level).length })),
    policy: CRITICALITY_POLICY, undated: issues.filter((i) => i.year === null).length,
    discovery: { linked_incidents: issues.filter((i) => discovery.has(i.id)).length, duplicate_detectors_deduplicated: true },
    graph: { nodes: ns.map((n) => ({ ...n, members: [...n.members.values()].sort((a,b) => b.value-a.value), yearly: yearly(n.yearly) })), links: [...links.values()].map((l) => ({ ...l, source: index.get(l.source)!, target: index.get(l.target)!, yearly: yearly(l.yearly) })) },
    records: { total: focused.length, offset: input.offset, limit: input.limit, rows: focused.slice(input.offset,input.offset+input.limit).map((i) => ({ ...i, type_label: typeLabel(i), dataset_label: datasetLabel(i.table_name), discoveries: discovery.get(i.id) || [], detectors: [...new Set([i.rule_id.startsWith('agent.') ? 'ai' : 'rules', ...detectors.get(i.id) || []])], link: `/data-quality?issue=${encodeURIComponent(i.id)}` })) },
  };
}

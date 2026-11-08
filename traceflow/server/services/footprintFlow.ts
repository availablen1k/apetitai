// A read-only view over immutable inventory runs. A range uses exactly one saved run per year,
// never sums revisions, and counts only the Scope 2 basis included in each selected run.
import { z } from 'zod';
import { type DB, type Row, all, json } from '../db/database.ts';
import { round } from '../domain/util.ts';
import { type RunRow, contributionFromRow, getRun, runFromRow } from './calculations.ts';
import { HttpError } from './common.ts';

type Text = { en: string; fi: string };
type Land = 'flag' | 'non_flag' | 'unclassified';
type Scope = 'scope1' | 'scope2' | 'scope3';
type Source = { id: string; table_name: string; payload: Record<string, unknown> };
type Part = {
  id: string; run_id: string; contribution_id: string; year: number; scope: Scope; land: Land;
  category: string; label: Text; group_id: string; group_label: Text; source_id: string;
  tco2e: number; full_tco2e: number; method: string; source_record_ids: string[]; open_issues: number;
};
export const FlowQuery = z.object({
  from_year: z.coerce.number().int().min(2000).max(2100),
  to_year: z.coerce.number().int().min(2000).max(2100),
  scope: z.enum(['all', 'scope1', 'scope2', 'scope3']).default('all'),
  land: z.enum(['all', 'flag', 'non_flag', 'unclassified']).default('all'),
  scope2_basis: z.enum(['market', 'location']).default('market'),
  run_id: z.string().min(1).max(80).optional(),
  focus: z.string().max(240).optional(),
  q: z.string().trim().max(120).default(''),
  group: z.string().max(240).optional(),
  source: z.string().max(240).optional(),
  offset: z.coerce.number().int().min(0).max(1000000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).refine((q) => q.from_year <= q.to_year, { message: 'From year must not be after to year.', path: ['to_year'] });

const text = (en: string, fi = en): Text => ({ en, fi });
const LAND_LABELS = { flag: 'FLAG', non_flag: 'Non-FLAG', unclassified: 'Not classified' };
const GROUPS: Record<string, Text> = {
  oilseed: text('Oilseeds', 'Öljykasvit'), dairy: text('Dairy', 'Maitotuotteet'), meat: text('Meat', 'Liha'),
  vegetable: text('Bought vegetables', 'Ostetut vihannekset'), vegetables: text('Bought vegetables', 'Ostetut vihannekset'),
  vegetable_bought: text('Bought vegetables', 'Ostetut vihannekset'), vegetable_contract: text('Contract vegetables', 'Sopimusvihannekset'),
  fish: text('Fish', 'Kala'), cereal: text('Cereals', 'Viljat'), legume: text('Legumes', 'Palkokasvit'),
  protein: text('Plant proteins', 'Kasviproteiinit'), chemical: text('Chemicals', 'Kemikaalit'),
  oil: text('Oils', 'Öljyt'), spice: text('Spices', 'Mausteet'), sugar: text('Sugar', 'Sokeri'),
  packaging: text('Packaging', 'Pakkaukset'), service: text('Services', 'Palvelut'), capex: text('Capital goods', 'Investointihyödykkeet'),
  contract_farms: text('Contract farms', 'Sopimustilat'), sauce: text('Sauces', 'Kastikkeet'),
  stationary_and_mobile_combustion: text('Fuel combustion', 'Polttoaineiden poltto'),
  fugitive_refrigerants: text('Refrigerant leakage', 'Kylmäainevuodot'),
  purchased_electricity: text('Purchased electricity', 'Ostosähkö'), purchased_heat_steam: text('Purchased heat and steam', 'Ostolämpö ja -höyry'),
  cat01_purchased_goods: text('Other purchases', 'Muut ostot'), cat01_purchased_services: text('Purchased services', 'Ostetut palvelut'),
  cat02_capital_goods: text('Capital goods', 'Investointihyödykkeet'), cat03_fuel_energy: text('Fuel and energy supply chains', 'Polttoaineiden ja energian tuotantoketjut'),
  cat04_upstream_transport: text('Inbound transport', 'Saapuvat kuljetukset'), cat09_downstream_transport: text('Outbound transport', 'Lähtevät kuljetukset'),
  cat05_waste: text('Waste and wastewater', 'Jätteet ja jätevesi'), cat06_business_travel: text('Business travel', 'Liikematkat'),
  cat07_employee_commuting: text('Commuting', 'Työmatkat'), cat11_use_of_sold_products: text('Use of sold products', 'Tuotteiden käyttö'),
  cat12_end_of_life: text('End of life', 'Elinkaaren loppu'),
};
const CROPS: Record<string, Text> = { pea: text('Peas', 'Herne'), turnip_rape: text('Turnip rape', 'Rypsi'), potato: text('Potatoes', 'Peruna'), carrot: text('Carrots', 'Porkkana'), spinach: text('Spinach', 'Pinaatti'), grass_ley: text('Grass', 'Nurmi') };
const MODES: Record<string, Text> = { truck: text('Truck', 'Rekka'), reefer_truck: text('Refrigerated truck', 'Kylmäkuljetus'), ropax: text('Ro-Pax ferry', 'Ro-Pax-lautta'), sea: text('Sea freight', 'Merirahti'), rail: text('Rail', 'Rautatie') };
const NON_FLAG_CATEGORIES = new Set(['stationary_and_mobile_combustion', 'fugitive_refrigerants', 'cat03_fuel_energy', 'cat04_upstream_transport', 'cat05_waste', 'cat06_business_travel', 'cat07_employee_commuting', 'cat09_downstream_transport', 'cat11_use_of_sold_products', 'cat12_end_of_life']);

function fraction(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
}

function sourceContext(db: DB, run: RunRow, contributions: ReturnType<typeof contributionFromRow>[]) {
  const sources = new Map<string, Source>();
  const ids = [...new Set(contributions.flatMap((c) => c.source_record_ids).filter((id) => !id.startsWith('corr:')))];
  for (let i = 0; i < ids.length; i += 800) {
    const chunk = ids.slice(i, i + 800);
    for (const r of all<Row>(db, `SELECT id, table_name, payload_json FROM source_records WHERE id IN (${chunk.map(() => '?').join(',')})`, ...chunk)) sources.set(String(r.id), { id: String(r.id), table_name: String(r.table_name), payload: json(r.payload_json, {}) });
  }
  // Labels also come from the run's source versions, rather than today's master data.
  const batches = run.dataset_hashes.filter((b) => ['sites', 'materials'].includes(b.dataset)).map((b) => b.batch_id);
  for (let i = 0; i < batches.length; i += 800) {
    const chunk = batches.slice(i, i + 800);
    for (const r of all<Row>(db, `SELECT id, table_name, payload_json FROM source_records WHERE table_name IN ('sites','materials') AND batch_id IN (${chunk.map(() => '?').join(',')}) ORDER BY source_file, source_row`, ...chunk)) sources.set(String(r.id), { id: String(r.id), table_name: String(r.table_name), payload: json(r.payload_json, {}) });
  }
  // Only corrections used by this immutable run may change its classification metadata.
  for (let i = 0; i < run.correction_ids.length; i += 800) {
    const chunk = run.correction_ids.slice(i, i + 800);
    for (const c of all<Row>(db, `SELECT id, record_id, table_name, field, action, approved_value FROM corrections WHERE id IN (${chunk.map(() => '?').join(',')}) AND status = 'approved' ORDER BY decided_at, rowid`, ...chunk)) {
      if (c.action === 'add_record') {
        const id = `corr:${String(c.id)}`;
        sources.set(id, { id, table_name: String(c.table_name), payload: json(c.approved_value, {}) });
      } else if (c.action === 'set_value') {
        const source = sources.get(String(c.record_id));
        if (source) source.payload[String(c.field)] = c.approved_value;
      }
    }
  }
  const sites = new Map<string, Source>();
  for (const s of sources.values()) if (s.table_name === 'sites') sites.set(String(s.payload.site_id), s);
  return { sources, sites };
}

function partsForRun(db: DB, run: RunRow): Part[] {
  const contributions = all<Row>(db, 'SELECT * FROM calculation_contributions WHERE run_id = ? AND in_total = 1 ORDER BY seq', run.id).map(contributionFromRow);
  const { sources, sites } = sourceContext(db, run, contributions);
  const out: Part[] = [];
  for (const c of contributions) {
    if (c.scope === 'memo') continue;
    const scope: Scope = c.scope.startsWith('scope2') ? 'scope2' : c.scope as Scope;
    if (!['scope1', 'scope2', 'scope3'].includes(scope) || !Number.isFinite(c.tco2e)) continue;
    const records = c.source_record_ids.map((id) => sources.get(id)).filter((s): s is Source => !!s);
    const material = records.find((s) => s.table_name === 'materials');
    const activity = records.find((s) => s.payload.site_id && s.table_name !== 'emission_factors');
    const site = activity ? sites.get(String(activity.payload.site_id)) : undefined;
    let group = c.kind === 'contract_farm' ? 'contract_farms' : material ? String(material.payload.material_group || c.category) : c.category;
    if (!GROUPS[group]) group = c.category;
    const groupId = `group:${scope}:${group}`;
    let label = site ? text(String(site.payload.name || site.payload.site_id)) : MODES[String(c.inputs.mode)] || GROUPS[c.category] || text(c.category.replaceAll('_', ' '));
    let sourceKey = site ? String(site.payload.site_id) : String(c.inputs.mode || c.category);
    if (material) {
      label = { en: String(material.payload.name_en || material.payload.erp_name || material.payload.material_id), fi: String(material.payload.erp_name || material.payload.name_en || material.payload.material_id) };
      sourceKey = String(material.payload.material_id);
    } else if (c.kind === 'contract_farm') {
      const [, region, crop] = c.line_item.split(':');
      const name = CROPS[crop] || text(crop.replaceAll('_', ' '));
      label = text(`${name.en} · ${region.slice(0, 2)}`, `${name.fi} · ${region.slice(0, 2)}`);
      sourceKey = `${region.slice(0, 2)}:${crop}`;
    }
    let flagShare: number | null = null;
    let method = 'classification_unavailable';
    if (scope === 'scope2' || (scope === 'scope1' && NON_FLAG_CATEGORIES.has(c.category))) { flagShare = 0; method = 'energy_and_industry'; }
    else if (c.kind === 'contract_farm') {
      const flagHa = c.inputs.flag_kg_per_ha;
      const area = c.inputs.area_ha;
      if (typeof flagHa === 'number' && typeof area === 'number' && c.kgco2e !== 0) {
        flagShare = fraction(flagHa * area / c.kgco2e);
        method = 'saved_farm_components';
      }
    } else {
      // A supplier PCF needs its own split; a default-factor split cannot silently stand in for it.
      const factor = records.find((s) => s.table_name === (c.basis === 'supplier_pcf' ? 'supplier_pcf' : 'emission_factors') && (s.table_name === 'supplier_pcf' || s.payload.ef_id === c.factor_id));
      flagShare = factor ? fraction(factor.payload.flag_share) : null;
      if (flagShare !== null) method = 'source_factor_flag_share';
      else if (!['material_purchase', 'spend_purchase'].includes(c.kind) && NON_FLAG_CATEGORIES.has(c.category)) { flagShare = 0; method = 'energy_and_industry'; }
    }
    const portions: { land: Land; t: number }[] = flagShare === null ? [{ land: 'unclassified', t: c.tco2e }] : [{ land: 'flag', t: c.tco2e * flagShare }, { land: 'non_flag', t: c.tco2e - c.tco2e * flagShare }];
    for (const p of portions) if (p.t !== 0) out.push({ id: `${c.id}:${p.land}`, run_id: run.id, contribution_id: c.id, year: run.year, scope, land: p.land, category: c.category, label, group_id: groupId, group_label: GROUPS[group] || text(group), source_id: `source:${scope}:${group}:${sourceKey}`, tco2e: p.t, full_tco2e: c.tco2e, method, source_record_ids: c.source_record_ids, open_issues: c.open_issue_ids.length });
  }
  return out;
}

export function footprintFlow(db: DB, input: z.infer<typeof FlowQuery>) {
  const runs = all<Row>(db, "SELECT * FROM calculation_runs WHERE kind = 'inventory' AND year BETWEEN ? AND ? AND scope2_basis = ? ORDER BY created_at DESC, rowid DESC", input.from_year, input.to_year, input.scope2_basis).map(runFromRow);
  const byYear = new Map<number, RunRow>();
  for (const r of runs) if (!byYear.has(r.year)) byYear.set(r.year, r);
  if (input.run_id) {
    const r = getRun(db, input.run_id);
    if (input.from_year !== input.to_year || r.year !== input.from_year || r.kind !== 'inventory' || r.scope2_basis !== input.scope2_basis) throw new HttpError(400, 'Selected run must match the single year and Scope 2 basis.');
    byYear.set(r.year, r);
  }
  const selected = [...byYear.values()].sort((a, b) => a.year - b.year);
  const missingYears = Array.from({ length: input.to_year - input.from_year + 1 }, (_, i) => i + input.from_year).filter((y) => !byYear.has(y));
  const scoped = selected.flatMap((r) => partsForRun(db, r)).filter((p) => input.scope === 'all' || p.scope === input.scope);
  const availableLand = ['non_flag', ...((input.scope === 'all' || input.scope === 'scope3' || scoped.some((p) => p.land === 'flag')) ? ['flag'] : []), ...(scoped.some((p) => p.land === 'unclassified') ? ['unclassified'] : [])];
  const landParts = scoped.filter((p) => input.land === 'all' || p.land === input.land);
  const groups = new Map<string, { id: string; label: Text; value: number }>();
  for (const p of landParts) {
    if (!groups.has(p.group_id)) groups.set(p.group_id, { id: p.group_id, label: p.group_label, value: 0 });
    groups.get(p.group_id)!.value += p.tco2e;
  }
  const terms = input.q.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const contextParts = scoped.filter((p) => (!input.group || p.group_id === input.group) && (!input.source || p.source_id === input.source)
    && terms.every((term) => `${p.label.en} ${p.label.fi} ${p.group_label.en} ${p.group_label.fi}`.toLocaleLowerCase().includes(term)));
  const parts = contextParts.filter((p) => input.land === 'all' || p.land === input.land);
  const total = (xs: Part[]) => round(xs.reduce((s, p) => s + p.tco2e, 0), 9);

  // A bounded overview, irrespective of years/record count: five named groups (at least one per
  // scope), explicit Other groups per scope, and no more than ten activity nodes. Nothing is lost.
  const groupSizes = new Map<string, { scope: Scope; value: number }>();
  const sizes = new Map<string, number>();
  const sourcesPerGroup = new Map<string, Set<string>>();
  for (const p of parts) if (p.tco2e > 0) {
    const group = groupSizes.get(p.group_id) || { scope: p.scope, value: 0 };
    group.value += p.tco2e; groupSizes.set(p.group_id, group);
    sizes.set(p.source_id, (sizes.get(p.source_id) || 0) + p.tco2e);
    if (!sourcesPerGroup.has(p.group_id)) sourcesPerGroup.set(p.group_id, new Set());
    sourcesPerGroup.get(p.group_id)!.add(p.source_id);
  }
  const rankedGroups = [...groupSizes].sort((a, b) => b[1].value - a[1].value || a[0].localeCompare(b[0]));
  const namedGroups = new Set<string>();
  for (const scope of ['scope1', 'scope2', 'scope3']) {
    const largest = rankedGroups.find(([, g]) => g.scope === scope);
    if (largest) namedGroups.add(largest[0]);
  }
  for (const [id] of rankedGroups) if (namedGroups.size < 5) namedGroups.add(id);
  const displayedGroup = (p: Part) => namedGroups.has(p.group_id) ? p.group_id : `other-groups:${p.scope}`;
  const groupCount = new Set(parts.filter((p) => p.tco2e > 0).map(displayedGroup)).size;
  const top = new Set([...sizes].filter(([id]) => parts.some((p) => p.source_id === id && namedGroups.has(p.group_id)))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, Math.max(0, 10 - groupCount)).map(([id]) => id));
  // Naming a group's sole activity costs no additional row, so never call that activity Other.
  for (const [group, ids] of sourcesPerGroup) if (namedGroups.has(group) && ids.size === 1) top.add([...ids][0]);
  type Member = { id: string; label: Text; value: number };
  type Node = { id: string; kind: string; label: Text; scope: Scope; land?: Land; value: number; yearly: Map<number, number>; members: Map<string, Member> };
  const nodes = new Map<string, Node>();
  const links = new Map<string, { source: string; target: string; value: number; scope: Scope; land: Land | 'all'; yearly: Map<number, number> }>();
  const addNode = (id: string, kind: string, label: Text, p: Part, member?: Member, land?: Land) => {
    if (!nodes.has(id)) nodes.set(id, { id, kind, label, scope: p.scope, land, value: 0, yearly: new Map(), members: new Map() });
    const node = nodes.get(id)!;
    node.value += p.tco2e;
    node.yearly.set(p.year, (node.yearly.get(p.year) || 0) + p.tco2e);
    if (member) {
      if (!node.members.has(member.id)) node.members.set(member.id, { ...member, value: 0 });
      node.members.get(member.id)!.value += p.tco2e;
    }
  };
  const addLink = (source: string, target: string, p: Part, land: Land | 'all') => {
    const id = `${source}|${target}`;
    if (!links.has(id)) links.set(id, { source, target, value: 0, scope: p.scope, land, yearly: new Map() });
    const link = links.get(id)!;
    link.value += p.tco2e;
    link.yearly.set(p.year, (link.yearly.get(p.year) || 0) + p.tco2e);
  };
  const displayedSource = (p: Part) => !namedGroups.has(p.group_id) ? `${displayedGroup(p)}:sources` : top.has(p.source_id) ? p.source_id : `${p.group_id}:other`;
  for (const p of parts) if (p.tco2e > 0) {
    const source = displayedSource(p);
    const end = `${p.scope}:${p.land}`;
    const landLabel = p.land === 'unclassified' ? text('Not classified', 'Luokittelematon') : text(LAND_LABELS[p.land]);
    const group = displayedGroup(p);
    addNode(group, 'group', namedGroups.has(p.group_id) ? p.group_label : text(`Other Scope ${p.scope.slice(-1)} sources`, `Muut Scope ${p.scope.slice(-1)} -lähteet`), p, { id: p.group_id, label: p.group_label, value: 0 });
    addNode(source, 'source', top.has(p.source_id) && namedGroups.has(p.group_id) ? p.label : namedGroups.has(p.group_id) ? text(`Other · ${p.group_label.en}`, `Muut · ${p.group_label.fi}`) : text('Remaining materials and activities', 'Muut materiaalit ja toiminta'), p, { id: p.source_id, label: p.label, value: 0 });
    addNode(end, 'scope', text(`Scope ${p.scope.slice(-1)} · ${landLabel.en}`, `Scope ${p.scope.slice(-1)} · ${landLabel.fi}`), p, undefined, p.land);
    addLink(group, source, p, 'all'); addLink(source, end, p, p.land);
  }
  const ns = [...nodes.values()];
  const index = new Map(ns.map((n, i) => [n.id, i]));
  const focusParts = parts.filter((p) => !input.focus || [displayedGroup(p), displayedSource(p), `${p.scope}:${p.land}`].includes(input.focus));
  focusParts.sort((a, b) => Math.abs(b.tco2e) - Math.abs(a.tco2e) || a.id.localeCompare(b.id));
  return {
    from_year: input.from_year, to_year: input.to_year, scope: input.scope, land: input.land, scope2_basis: input.scope2_basis,
    years: selected.map((r) => ({ year: r.year, run_id: r.id, status: r.status, demo: !!r.completeness.contains_demo_data, method_version: r.method_version })), missing_years: missingYears,
    demo: selected.some((r) => r.completeness.contains_demo_data), available_land: availableLand,
    context: { q: input.q, group: input.group || null, source: input.source || null },
    options: { groups: [...groups.values()].sort((a, b) => b.value - a.value).map((g) => ({ ...g, value: round(g.value, 9) })) },
    yearly: selected.map((r) => ({ year: r.year, net_tco2e: total(parts.filter((p) => p.year === r.year)), positive_tco2e: total(parts.filter((p) => p.year === r.year && p.tco2e > 0)) })),
    totals: { net_tco2e: total(parts), positive_tco2e: total(parts.filter((p) => p.tco2e > 0)), negative_tco2e: total(parts.filter((p) => p.tco2e < 0)), flag_tco2e: total(contextParts.filter((p) => p.land === 'flag')), non_flag_tco2e: total(contextParts.filter((p) => p.land === 'non_flag')), unclassified_tco2e: total(contextParts.filter((p) => p.land === 'unclassified')) },
    graph: {
      nodes: ns.map((n) => ({ ...n, value: round(n.value, 9), yearly: selected.map((r) => ({ year: r.year, value: round(n.yearly.get(r.year) || 0, 9) })), members: [...n.members.values()].sort((a, b) => b.value - a.value).map((m) => ({ ...m, value: round(m.value, 9) })) })),
      links: [...links.values()].map((l) => ({ ...l, source: index.get(l.source)!, target: index.get(l.target)!, value: round(l.value, 9), yearly: selected.map((r) => ({ year: r.year, value: round(l.yearly.get(r.year) || 0, 9) })) })),
    },
    records: { total: focusParts.length, offset: input.offset, limit: input.limit, rows: focusParts.slice(input.offset, input.offset + input.limit).map((p) => ({ ...p, tco2e: round(p.tco2e, 9), link: `/traceability?run=${encodeURIComponent(p.run_id)}&c=${encodeURIComponent(p.contribution_id)}` })) },
  };
}

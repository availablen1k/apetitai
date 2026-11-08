// Contract-farm footprint for one reporting year, read from its latest saved inventory calculation.
// Answers: which farms drive raw-material emissions, and which rest on estimates or missing data.
import { z } from 'zod';
import { type DB, all } from '../db/database.ts';
import { latestRun } from './calculations.ts';
import { farms } from './workspace.ts';

export const FarmFootprintQuery = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  status: z.enum(['all', 'measured', 'estimated', 'missing', 'none']).default('all'),
  q: z.string().trim().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
type Status = 'measured' | 'estimated' | 'mixed' | 'missing' | 'none';
export type FarmFootprintRow = {
  farm_id: string; record_id: string | null; region: string | null; crops: string[]; area_ha: number | null;
  delivered_kg: number | null; tco2e: number | null; kg_per_kg: number | null; status: Status; open_issues: number;
};

// inventory.ts writes the farm and crop into the message of each 'cat01_farm' gap.
const MISSING = /^Contract farm (\S+) \(([^)]+)\) delivered (\d+) kg/;

export function farmFootprint(db: DB, input: z.infer<typeof FarmFootprintQuery>) {
  const run = latestRun(db, input.year);
  const registry = farms(db);
  const open = new Set(all<{ id: string }>(db, "SELECT id FROM dq_issues WHERE status = 'open'").map((i) => i.id));
  const rows = new Map<string, FarmFootprintRow & { bases: Set<string>; issues: Set<string> }>();
  const row = (id: string) => {
    if (!rows.has(id)) {
      const f = registry.get(id);
      rows.set(id, { farm_id: id, record_id: f ? String(f.record_id) : null, region: f ? String(f.region ?? '') || null : null, crops: [], area_ha: f ? Number(f.area_ha) || null : null,
        delivered_kg: null, tco2e: null, kg_per_kg: null, status: 'none', open_issues: 0, bases: new Set(), issues: new Set() });
    }
    return rows.get(id)!;
  };
  for (const id of registry.keys()) row(id);
  if (run) {
    for (const c of all<{ line_item: string; basis: string; tco2e: number; inputs_json: string; ids: string }>(db,
      "SELECT line_item, basis, tco2e, inputs_json, open_issue_ids_json ids FROM calculation_contributions WHERE run_id = ? AND kind = 'contract_farm' AND in_total = 1", run.id)) {
      const parts = c.line_item.split(':'); const r = row(parts[parts.length - 1]); const crop = parts[parts.length - 2];
      const inputs = JSON.parse(c.inputs_json) as { delivered_kg?: number };
      r.tco2e = (r.tco2e ?? 0) + c.tco2e;
      r.delivered_kg = (r.delivered_kg ?? 0) + (Number(inputs.delivered_kg) || 0);
      if (crop && !r.crops.includes(crop)) r.crops.push(crop);
      r.bases.add(c.basis);
      for (const id of JSON.parse(c.ids) as string[]) if (open.has(id)) r.issues.add(id);
    }
    for (const g of run.gaps.filter((gap) => gap.area === 'cat01_farm')) {
      const m = MISSING.exec(g.message); if (!m) continue;
      const r = row(m[1]); r.delivered_kg = (r.delivered_kg ?? 0) + Number(m[3]);
      if (!r.crops.includes(m[2])) r.crops.push(m[2]);
      r.bases.add('missing');
    }
  }
  const list = [...rows.values()].map(({ bases, issues, ...r }) => {
    const status: Status = bases.has('missing') && !r.tco2e ? 'missing' : !bases.size ? 'none'
      : bases.has('farm_survey') && bases.size === 1 ? 'measured' : bases.has('farm_survey') ? 'mixed' : 'estimated';
    return { ...r, status, open_issues: issues.size, kg_per_kg: r.tco2e != null && r.delivered_kg ? r.tco2e * 1000 / r.delivered_kg : null };
  }).sort((a, b) => (b.tco2e ?? -1) - (a.tco2e ?? -1) || (b.delivered_kg ?? 0) - (a.delivered_kg ?? 0) || a.farm_id.localeCompare(b.farm_id));

  const sum = (rs: typeof list) => rs.reduce((s, r) => s + (r.tco2e ?? 0), 0);
  const withFootprint = list.filter((r) => r.tco2e != null);
  const total = sum(withFootprint);
  const of = (s: Status | Status[]) => list.filter((r) => ([] as Status[]).concat(s).includes(r.status));
  const summary = {
    farms: list.length, with_footprint: withFootprint.length, total_tco2e: total,
    top20_share_pct: total > 0 ? sum(withFootprint.slice(0, 20)) / total * 100 : null,
    measured: { farms: of('measured').length, tco2e: sum(of('measured')) },
    estimated: { farms: of(['estimated', 'mixed']).length, tco2e: sum(of(['estimated', 'mixed'])) },
    missing: { farms: of('missing').length, delivered_kg: of('missing').reduce((s, r) => s + (r.delivered_kg ?? 0), 0) },
    none: of('none').length,
  };
  const q = input.q?.toLowerCase();
  const filtered = list.filter((r) => (input.status === 'all' || r.status === input.status || (input.status === 'estimated' && r.status === 'mixed'))
    && (!q || r.farm_id.toLowerCase().includes(q) || r.crops.some((c) => c.toLowerCase().includes(q)) || String(r.region ?? '').toLowerCase().includes(q)));
  return { year: input.year, run_id: run?.id ?? null, summary: run ? summary : null, total: filtered.length, rows: filtered.slice(input.offset, input.offset + input.limit) };
}

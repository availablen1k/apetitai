// Conservative screening signals. They request review; they never invent a replacement value.
import { DATASET_BY_ID } from './catalog.ts';
import type { Src } from './inventory.ts';
import { median, parseNumber } from './util.ts';

export type Concern = { record_id: string; field: string; observed_value: string; severity: 'high' | 'medium' | 'low'; explanation: string; next_human_action: string; confidence: 'high' | 'medium' | 'low'; evidence_ids: string[]; status: 'NEEDS_HUMAN_REVIEW' | 'NEEDS_EVIDENCE' };
export const peerKey = (r: Src) => [r.table, ...['site_id', 'supplier_id', 'material_id', 'carrier', 'mode', 'crop', 'unit', 'uom'].map((k) => r.payload[k] || '')].join('|');

export function screenRows(rows: Src[]): Concern[] {
  const out: Concern[] = [];
  const flagged = new Set<string>();
  const groups = new Map<string, { rec: Src; n: number; field: string }[]>();
  const flag = (r: Src, field: string, reason: string, severity: Concern['severity'] = 'high', evidence = [r.id]) => {
    const key = `${r.id}|${field}`;
    if (flagged.has(key)) return;
    flagged.add(key);
    out.push({ record_id: r.id, field, observed_value: r.payload[field], severity, explanation: reason, next_human_action: 'Check the original file and unit, ask the source owner if needed, then enter a verified replacement or dismiss the concern.', confidence: 'medium', evidence_ids: evidence, status: 'NEEDS_HUMAN_REVIEW' });
  };
  for (const r of rows) {
    const def = DATASET_BY_ID.get(r.table);
    for (const [field, value] of Object.entries(r.payload)) {
      const n = parseNumber(value);
      if (n === null) continue;
      if (field === 'lat' && Math.abs(n) > 90) flag(r, field, `Latitude ${value} is outside -90 to 90 degrees.`);
      if (field === 'lon' && Math.abs(n) > 180) flag(r, field, `Longitude ${value} is outside -180 to 180 degrees.`);
      if ((field === 'year' || field.endsWith('_year')) && (!Number.isInteger(n) || n < 2000 || n > 2100)) flag(r, field, `Year ${value} is outside this application's reporting range (2000–2100).`);
      if (field === 'month' && (!Number.isInteger(n) || n < 1 || n > 12)) flag(r, field, `Month ${value} is outside 1–12.`);
      // Field semantics are explicit: PACT primaryDataShare is a percentage, not a fraction.
      if (['catch_crop_share', 'flag_share'].includes(field) && (n < 0 || n > 1)) flag(r, field, `Fraction ${value} is outside 0–1. Check whether a percentage was entered instead.`);
      if (r.table === 'supplier_pcf' && field === 'primary_data_share' && (n < 0 || n > 100)) flag(r, field, `PACT primary data share ${value}% is outside 0–100%.`);
      if ((field.endsWith('_pct') || field.includes('_pct_')) && (n < 0 || n > 100)) flag(r, field, `Percentage ${value} is outside 0–100.`);
      if (r.table === 'shipments' && field === 'km' && (n < 0 || n > 50000)) flag(r, field, `Shipment distance ${value} km is negative or exceeds the 50,000 km screening threshold. Verify the route and unit.`);
      if (['t', 'area_ha', 'yield_t_ha', 'one_way_km', 'days_on_site_per_week', 'headcount'].includes(field) && n < 0) flag(r, field, `Negative ${field} (${value}) needs context; check whether this is a return, adjustment, or input error.`, 'medium');
      if (field === 'days_on_site_per_week' && n > 7) flag(r, field, `Days on site per week (${value}) exceeds seven.`);
      if (def?.numeric.includes(field) && n > 0 && !['lat', 'lon'].includes(field)) {
        const key = `${peerKey(r)}|${field}`;
        const group = groups.get(key) || [];
        group.push({ rec: r, field, n }); groups.set(key, group);
      }
    }
  }
  for (const group of groups.values()) {
    if (group.length < 5) continue;
    const m = median(group.map((x) => x.n));
    if (m <= 0) continue;
    for (const { rec, field, n } of group) if (n > m * 100 || n < m / 100) {
      flag(rec, field, `${field} (${rec.payload[field]}) differs by more than 100× from the batch peer median (${m}). Peer groups share site/supplier/material/carrier/mode/crop and units when available. This is a screening signal, not proof of an error.`, 'medium', [rec.id, ...group.filter((x) => x.rec.id !== rec.id).slice(0, 4).map((x) => x.rec.id)]);
    }
  }
  return out;
}

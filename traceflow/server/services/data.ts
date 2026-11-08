// Read access to imported records and the approved-correction overlay.
import { type DB, all, json } from '../db/database.ts';
import type { Overlay, Src } from '../domain/inventory.ts';

type RecRow = { id: string; table_name: string; record_key: string; year: number | null; source_file: string; source_row: number; payload_json: string };

const toSrc = (r: RecRow): Src => ({
  id: r.id,
  table: r.table_name,
  record_key: r.record_key,
  year: r.year === null ? null : Number(r.year),
  source_file: r.source_file,
  source_row: Number(r.source_row),
  payload: JSON.parse(r.payload_json) as Record<string, string>,
});

export function loadTable(db: DB, table: string, year?: number): Src[] {
  const rows =
    year === undefined
      ? all<RecRow>(db, 'SELECT id, table_name, record_key, year, source_file, source_row, payload_json FROM source_records WHERE table_name = ? ORDER BY source_file, source_row', table)
      : all<RecRow>(db, 'SELECT id, table_name, record_key, year, source_file, source_row, payload_json FROM source_records WHERE table_name = ? AND year = ? ORDER BY source_file, source_row', table, year);
  return rows.map(toSrc);
}

export function loadTables(db: DB, tables: string[]): Record<string, Src[]> {
  const out: Record<string, Src[]> = {};
  for (const t of tables) out[t] = loadTable(db, t);
  return out;
}

export function getRecord(db: DB, id: string): Src | null {
  const r = all<RecRow>(db, 'SELECT id, table_name, record_key, year, source_file, source_row, payload_json FROM source_records WHERE id = ?', id)[0];
  return r ? toSrc(r) : null;
}

export const INVENTORY_TABLES = [
  'sites', 'materials', 'suppliers', 'emission_factors', 'farm_registry', 'parcels', 'parcel_crop_history', 'farm_survey',
  'erp_purchase_lines', 'supplier_pcf', 'shipments', 'energy_meter_readings', 'fuel_deliveries', 'fuel_stock_changes',
  'goo_cancellations', 'goo_registry', 'heat_supplier_factors', 'refrigerant_service_log', 'waste_transfer_notes',
  'wastewater_third_party', 'travel_bookings', 'commuting_survey', 'headcount', 'frozen_warehousing', 'sales_volumes',
];

type CorrRow = { id: string; record_id: string | null; table_name: string; field: string | null; action: string; approved_value: string | null; issue_id: string; record_key: string };

// Approved corrections only; rejected decisions never reach the calculation.
export function loadOverlay(db: DB): Overlay {
  const rows = all<CorrRow>(db, `SELECT id, record_id, table_name, field, action, approved_value, issue_id, record_key FROM corrections WHERE status = 'approved' ORDER BY decided_at`);
  const overlay: Overlay = { values: new Map(), excluded: new Map(), added: [] };
  for (const c of rows) {
    if (c.action === 'set_value' && c.record_id && c.field && c.approved_value !== null) {
      const m = overlay.values.get(c.record_id) || new Map();
      m.set(c.field, { value: c.approved_value, correction_id: c.id });
      overlay.values.set(c.record_id, m);
    } else if (c.action === 'exclude_record' && c.record_id) {
      overlay.excluded.set(c.record_id, c.id);
    } else if (c.action === 'add_record' && c.approved_value) {
      const payload = json<Record<string, string>>(c.approved_value, {});
      overlay.added.push({
        id: `corr:${c.id}`,
        table: c.table_name,
        record_key: c.record_key,
        year: Number(payload.year) || null,
        source_file: `correction ${c.id}`,
        source_row: 0,
        payload,
        added_by_correction: c.id,
      });
    }
  }
  return overlay;
}

export function loadOpenIssueIndex(db: DB): Map<string, string[]> {
  const rows = all<{ id: string; record_id: string }>(db, `SELECT id, record_id FROM dq_issues WHERE status = 'open' AND record_id IS NOT NULL AND detection_state = 'active'`);
  const m = new Map<string, string[]>();
  for (const r of rows) m.set(r.record_id, [...(m.get(r.record_id) || []), r.id]);
  return m;
}

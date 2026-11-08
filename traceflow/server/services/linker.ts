// Links transport legs to ERP purchase documents (shipments.ref_doc → erp.doc_no) and from
// the ERP line to material and supplier. Links are only made where the identifiers match;
// anything else is labelled, never inferred.
import { type DB, all, run, tx } from '../db/database.ts';
import { parseNumber } from '../domain/util.ts';

type Rec = { id: string; payload_json: string; year: number | null };

export function relinkShipments(db: DB): { legs: number; linked: number; unlinked: number; outbound: number; multiLine: number } {
  const ships = all<Rec>(db, `SELECT id, payload_json, year FROM source_records WHERE table_name = 'shipments' ORDER BY source_file, source_row`);
  const erpRows = all<Rec>(db, `SELECT id, payload_json, year FROM source_records WHERE table_name = 'erp_purchase_lines'`);
  const byDoc = new Map<string, { id: string; p: Record<string, string> }[]>();
  for (const r of erpRows) {
    const p = JSON.parse(r.payload_json) as Record<string, string>;
    const doc = String(p.doc_no ?? '').trim();
    if (!doc) continue;
    const list = byDoc.get(doc) || [];
    list.push({ id: r.id, p });
    byDoc.set(doc, list);
  }
  const stats = { legs: ships.length, linked: 0, unlinked: 0, outbound: 0, multiLine: 0 };
  tx(db, () => {
    run(db, 'DELETE FROM shipments');
    const insert = db.prepare(
      `INSERT INTO shipments (record_id, shipment_id, year, direction, ref_doc, ef_id, mode, freight_t, distance_km, tkm_recorded,
         join_status, erp_record_id, erp_line_count, material_id, supplier_id, origin_country, allocation, route_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const s of ships) {
      const p = JSON.parse(s.payload_json) as Record<string, string>;
      const direction = String(p.direction ?? '').trim();
      const ref = String(p.ref_doc ?? '').trim();
      const lines = direction === 'inbound' ? byDoc.get(ref) || [] : [];
      let join = 'unlinked_no_erp_document';
      let allocation = 'not_needed';
      if (direction === 'outbound') {
        join = 'outbound_sales_reference';
        stats.outbound++;
      } else if (lines.length === 1) {
        join = 'linked';
        stats.linked++;
      } else if (lines.length > 1) {
        join = 'linked_multi_line';
        allocation = 'allocation_needed';
        stats.multiLine++;
      } else stats.unlinked++;
      const single = lines.length === 1 ? lines[0] : null;
      const km = parseNumber(p.km);
      insert.run(
        s.id, String(p.shipment_id ?? ''), s.year, direction, ref, String(p.ef_id ?? ''), String(p.mode ?? ''),
        parseNumber(p.t), km, parseNumber(p.tkm), join, single?.id ?? null, lines.length,
        single?.p.material_id ?? null, single?.p.supplier_id ?? null, single?.p.origin_country ?? null, allocation,
        km === null ? 'distance_missing' : 'calculated_from_supplied_distance',
      );
    }
  });
  return stats;
}

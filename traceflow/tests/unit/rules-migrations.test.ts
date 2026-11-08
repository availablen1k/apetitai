import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Src } from '../../server/domain/inventory.ts';
import { runRules } from '../../server/domain/rules.ts';
import { openDatabase, all } from '../../server/db/database.ts';
import { appliedMigrations, migrateDown, migrateUp } from '../../server/db/migrate.ts';

let n = 0;
const rec = (table: string, year: number | null, payload: Record<string, string>, key?: string): Src => ({ id: `rec_${++n}`, table, record_key: key || `${table}:${n}`, year, source_file: 'x.csv', source_row: n, payload });

test('PCF ×1000 scaling is flagged with candidate 1.4091 and stays a proposal', () => {
  const pcfs = [
    rec('supplier_pcf', 2024, { supplier_id: 'SUP011', material_id: 'M104', year: '2024', pcf_value: '1.3515', declared_unit: 'kilogram', reference_period_start: '2024-01-01', reference_period_end: '2025-01-01' }),
    rec('supplier_pcf', 2025, { supplier_id: 'SUP011', material_id: 'M104', year: '2025', pcf_value: '1409.1', declared_unit: 'kilogram', reference_period_start: '2025-01-01', reference_period_end: '2026-01-01' }),
  ];
  const f = runRules({ supplier_pcf: pcfs }).filter((x) => x.rule_id === 'pcf.value_scale_vs_history');
  assert.equal(f.length, 1);
  assert.equal(f[0].candidate, '1.4091');
  assert.equal(f[0].action, 'set_value');
  assert.deepEqual(f[0].evidence_ids, [pcfs[1].id, pcfs[0].id]);
});

test('refrigerant 85150 kg against a ~10 kg system history proposes 85.15 kg', () => {
  const rows = ['12.5', '9.8', '14.1', '11', '10.4'].map((kg) => rec('refrigerant_service_log', 2024, { site_id: 'S', system: 'cold', refrigerant: 'R404A', kg_added: kg, event_id: `E${kg}` }));
  rows.push(rec('refrigerant_service_log', 2025, { site_id: 'S', system: 'cold', refrigerant: 'R404A', kg_added: '85150', event_id: 'RS00080' }, 'refrigerant:RS00080'));
  const f = runRules({ refrigerant_service_log: rows }).find((x) => x.record_key === 'refrigerant:RS00080');
  assert.equal(f?.candidate, '85.15');
});

test('a stale PCF period and a missing sea leg are flagged; a duplicate travel booking is excluded', () => {
  const stale = rec('supplier_pcf', 2025, { supplier_id: 'S', material_id: 'M', year: '2025', pcf_value: '1.2', declared_unit: 'kilogram', reference_period_start: '2022-01-01', reference_period_end: '2023-01-01' });
  assert.ok(runRules({ supplier_pcf: [stale] }).some((x) => x.issue_type === 'pcf_stale_period'));
  const erp: Src[] = [];
  const ships: Src[] = [];
  for (let i = 0; i < 12; i++) {
    erp.push(rec('erp_purchase_lines', 2025, { doc_no: `D${i}`, line_no: '10', origin_country: 'EE', uom: 'TO', material_id: 'M', supplier_id: 'S', quantity: '100', posting_date: '2025-01-01', movement_type: '101' }));
    ships.push(rec('shipments', 2025, { shipment_id: `T${i}`, year: '2025', direction: 'inbound', ref_doc: `D${i}`, ef_id: 'EF-TKM-TRUCK', mode: 'truck', t: '100', km: '50' }));
    if (i) ships.push(rec('shipments', 2025, { shipment_id: `S${i}`, year: '2025', direction: 'inbound', ref_doc: `D${i}`, ef_id: 'EF-TKM-SHIP-BULK', mode: 'ship-bulk', t: '100', km: '400' }));
  }
  const miss = runRules({ erp_purchase_lines: erp, shipments: ships }).find((x) => x.rule_id === 'ship.missing_sea_leg');
  assert.equal(miss?.record_key, 'ship:D0:EF-TKM-SHIP-BULK');
  assert.equal(JSON.parse(miss!.candidate!).km, '400');
  const travel = [rec('travel_bookings', 2025, { traveller_id: 'E1', travel_date: '2025-01-01', route: 'HEL-AMS', pkm: '3000', nights: '1', booking_id: 'B1' }), rec('travel_bookings', 2025, { traveller_id: 'E1', travel_date: '2025-01-01', route: 'HEL-AMS', pkm: '3000', nights: '1', booking_id: 'B2' })];
  const d = runRules({ travel_bookings: travel }).find((x) => x.rule_id === 'travel.duplicate_booking');
  assert.equal(d?.record_id, travel[1].id);
  assert.equal(d?.action, 'exclude_record');
});

test('rules are deterministic: the same input gives the same findings', () => {
  const rows = Array.from({ length: 12 }, (_, i) => rec('energy_meter_readings', 2025, { site_id: 'S', year: '2025', month: String(i + 1), carrier: 'electricity', value: i === 5 ? '152300' : '150', unit: 'MWh' }));
  const a = runRules({ energy_meter_readings: rows });
  const b = runRules({ energy_meter_readings: rows });
  assert.deepEqual(a, b);
  assert.equal(a.find((x) => x.rule_id === 'energy.kwh_in_mwh_column')?.candidate, '152.3');
});

test('migrations run up, up again (no-op), down to zero and up again on a file database', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'traceflow-mig-'));
  const db = openDatabase(path.join(dir, 't.sqlite'));
  try {
    assert.deepEqual(migrateUp(db), ['001_init', '002_evidence_and_mapping', '003_upload_inbox', '004_data_review_agent', '005_nature_jobs', '006_discovery', '007_discovery_immutability']);
    assert.deepEqual(migrateUp(db), []);
    assert.equal((all<{ journal_mode: string }>(db, 'PRAGMA journal_mode')[0]).journal_mode, 'wal');
    assert.equal((all<{ foreign_keys: number }>(db, 'PRAGMA foreign_keys')[0]).foreign_keys, 1);
    assert.deepEqual(migrateDown(db, Infinity), ['007_discovery_immutability', '006_discovery', '005_nature_jobs', '004_data_review_agent', '003_upload_inbox', '002_evidence_and_mapping', '001_init']);
    assert.equal(all(db, `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'source_records'`).length, 0);
    assert.deepEqual(migrateUp(db), ['001_init', '002_evidence_and_mapping', '003_upload_inbox', '004_data_review_agent', '005_nature_jobs', '006_discovery', '007_discovery_immutability']);
    assert.deepEqual(appliedMigrations(db), ['001_init', '002_evidence_and_mapping', '003_upload_inbox', '004_data_review_agent', '005_nature_jobs', '006_discovery', '007_discovery_immutability']);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Src } from '../../server/domain/inventory.ts';
import { screenRows } from '../../server/domain/plausibility.ts';

const row = (id: string, table: string, payload: Record<string, string>): Src => ({ id, table, record_key: id, year: 2025, source_file: 'DEMO.csv', source_row: 2, payload });

test('screening flags impossible calendar, coordinates, shares and distances without proposing replacements', () => {
  const input = row('r1', 'shipments', { year: '9000', month: '99', lat: '999', lon: '-999', catch_crop_share: '70', clay_pct: '150', km: '999999', t: '-1' });
  const original = JSON.stringify(input);
  const flags = screenRows([input]);
  assert.deepEqual(new Set(flags.map((f) => f.field)), new Set(['year','month','lat','lon','catch_crop_share','clay_pct','km','t']));
  assert.equal(flags.every((f) => f.status === 'NEEDS_HUMAN_REVIEW'), true);
  assert.equal(flags.some((f) => 'candidate' in f), false); assert.equal(JSON.stringify(input), original);
});

test('batch peers find an extreme at the end of a file; different units are not combined', () => {
  const rows = Array.from({ length: 12 }, (_, i) => row(`r${i}`, 'energy_meter_readings', { site_id:'SITE',carrier:'heat',value:i === 11 ? '1000000' : '12',unit:'MWh' }));
  const flags = screenRows(rows);
  assert.equal(flags.length, 1); assert.equal(flags[0].record_id, 'r11'); assert.equal(flags[0].field, 'value');
  rows[11].payload.unit = 'kWh'; assert.equal(screenRows(rows).length, 0);
});

test('negative spend alone is not treated as proof of error or automatically corrected', () => {
  assert.deepEqual(screenRows([row('credit', 'erp_purchase_lines', { net_amount:'-1234',quantity:'-10',uom:'kg' })]), []);
});

test('PACT primary data share is 0–100 percent; unknown share fields have no inferred scale', () => {
  assert.deepEqual(screenRows([row('pcf', 'supplier_pcf', {primary_data_share:'33'}), row('unknown','custom_test',{ownership_share:'75'})]), []);
  assert.equal(screenRows([row('pcf','supplier_pcf',{primary_data_share:'101'})])[0].field,'primary_data_share');
});

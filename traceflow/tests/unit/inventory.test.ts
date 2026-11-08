import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type Overlay, type Src, computeInventory } from '../../server/domain/inventory.ts';

let n = 0;
const rec = (table: string, year: number | null, payload: Record<string, string>, key = `${table}:${++n}`): Src => ({ id: `rec_${table}_${++n}`, table, record_key: key, year, source_file: `${table}.csv`, source_row: n, payload });
const empty = (): Overlay => ({ values: new Map(), excluded: new Map(), added: [] });
const factors = [
  rec('emission_factors', null, { ef_id: 'EF-TKM-TRUCK', unit: 'tkm', kgco2e_per_unit: '0.1', version: '2025' }),
  rec('emission_factors', null, { ef_id: 'EF-TKM-ROPAX', unit: 'tkm', kgco2e_per_unit: '0.05', version: '2025' }),
  rec('emission_factors', null, { ef_id: 'EF-ELEC-UPSTREAM-FI', unit: 'MWh', kgco2e_per_unit: '10', version: '2025' }),
  rec('emission_factors', null, { ef_id: 'EF-MAT', unit: 'kg', kgco2e_per_unit: '2', version: '2025' }),
];
const base = (extra: Record<string, Src[]> = {}) => ({ emission_factors: factors, sites: [rec('sites', null, { site_id: 'S-A', country: 'FI' })], ...extra });

test('farm components account for the farm total; FLAG contains field N2O, liming and organic soils', () => {
  const survey = rec('farm_survey', 2025, { survey_id: 'FS1', farm_id: 'F0001', crop: 'pea', area_ha: '10', yield_t_ha: '3', n_mineral_kg_ha: '30', n_manure_kg_ha: '10', p_kg_ha: '12', diesel_l_ha: '80', lime_t_ha: '0.2', sprays: '2', irrigated: 'False', soil_type_reported: 'Organic soil', fertiliser_product: 'NPK' });
  const tables = base({
    materials: [rec('materials', null, { material_id: 'M110', default_ef_id: 'FARM', material_group: 'vegetable' })],
    erp_purchase_lines: [rec('erp_purchase_lines', 2025, { doc_no: 'D1', line_no: '1', material_id: 'M110', supplier_id: 'F0001', quantity: '30000', uom: 'KG' })],
    farm_registry: [rec('farm_registry', null, { farm_id: 'F0001', country: 'FI', region: 'FI_SW' })],
    farm_survey: [survey],
  });
  const r = computeInventory({ year: 2025, scope2Basis: 'market', tables, overlay: empty(), openIssues: new Map() });
  const farm = r.contributions.find((c) => c.kind === 'contract_farm')!;
  const parts = farm.inputs.breakdown_kg_per_ha as Record<string, number>;
  assert.ok(farm);
  assert.ok(Math.abs(Object.values(parts).reduce((s, n) => s + n, 0) * 10 - farm.kgco2e) < 0.05);
  assert.ok(Math.abs(parts.n2o_direct + parts.n2o_indirect + parts.lime + parts.organic_soil - Number(farm.inputs.flag_kg_per_ha)) < 0.005);
  assert.ok(Number(farm.inputs.flag_kg_per_ha) > 0);
  assert.ok(Number(farm.inputs.flag_kg_per_ha) < Number(farm.factor_value));
  assert.equal(r.contributions.filter((c) => c.kind === 'material_purchase').length, 0);
  assert.ok(farm.source_record_ids.includes(survey.id));
});

test('transport leg: tkm = t × km and kgCO2e = tkm × factor (10.429 t × 52.6 km = 548.5654 tkm)', () => {
  const leg = rec('shipments', 2025, { shipment_id: 'SH1', year: '2025', direction: 'inbound', ref_doc: 'D1', ef_id: 'EF-TKM-TRUCK', mode: 'truck', t: '10.429', km: '52.6', tkm: '548.57' });
  const r = computeInventory({ year: 2025, scope2Basis: 'market', tables: base({ shipments: [leg] }), overlay: empty(), openIssues: new Map() });
  const c = r.contributions.find((x) => x.kind === 'transport_leg')!;
  assert.equal(c.inputs.tkm, 548.5654);
  assert.equal(c.kgco2e, 54.85654);
  assert.equal(c.tco2e, 0.05485654);
  assert.equal(c.category, 'cat04_upstream_transport');
  assert.deepEqual(c.source_record_ids.sort(), [leg.id, factors[0].id].sort());
});

test('truck and ferry legs use their own factors; outbound goes to category 9', () => {
  const legs = [
    rec('shipments', 2025, { shipment_id: 'A', direction: 'inbound', ef_id: 'EF-TKM-TRUCK', mode: 'truck', t: '10', km: '100' }),
    rec('shipments', 2025, { shipment_id: 'B', direction: 'inbound', ef_id: 'EF-TKM-ROPAX', mode: 'ropax', t: '10', km: '100' }),
    rec('shipments', 2025, { shipment_id: 'C', direction: 'outbound', ef_id: 'EF-TKM-TRUCK', mode: 'truck', t: '1', km: '10' }),
  ];
  const r = computeInventory({ year: 2025, scope2Basis: 'market', tables: base({ shipments: legs }), overlay: empty(), openIssues: new Map() });
  const kg = Object.fromEntries(r.contributions.filter((c) => c.kind === 'transport_leg').map((c) => [String(c.inputs.mode) + c.category, c.kgco2e]));
  assert.equal(kg['truckcat04_upstream_transport'], 100);
  assert.equal(kg['ropaxcat04_upstream_transport'], 50);
  assert.equal(kg['truckcat09_downstream_transport'], 1);
});

test('Scope 2 location- and market-based are both reported but never both in the total', () => {
  const energy = Array.from({ length: 12 }, (_, i) => rec('energy_meter_readings', 2024, { site_id: 'S-A', year: '2024', month: String(i + 1), carrier: 'electricity', value: '100', unit: 'MWh' }));
  for (const basis of ['location', 'market'] as const) {
    const r = computeInventory({ year: 2024, scope2Basis: basis, tables: base({ energy_meter_readings: energy }), overlay: empty(), openIssues: new Map() });
    assert.equal(r.totals.scope2_location_total, 1200 * 0.03);
    assert.equal(r.totals.scope2_market_total, Math.round(1200 * 0.406 * 1e6) / 1e6);
    const counted = r.contributions.filter((c) => c.in_total && c.scope.startsWith('scope2')).map((c) => c.scope);
    assert.deepEqual([...new Set(counted)], [basis === 'location' ? 'scope2_location' : 'scope2_market']);
    assert.equal(r.totals.grand_total, r.totals.scope1_total + r.totals.scope2_reported + r.totals.scope3_total);
    assert.ok(r.checks.every((c) => c.passed), JSON.stringify(r.checks));
  }
});

test('approved corrections overlay values without changing the source row; exclusions remove a row', () => {
  const p = rec('erp_purchase_lines', 2025, { doc_no: '1', line_no: '10', material_id: 'M1', supplier_id: 'S1', quantity: '39.616', uom: 'KG', movement_type: '101' });
  const dup = rec('erp_purchase_lines', 2025, { doc_no: '2', line_no: '10', material_id: 'M1', supplier_id: 'S1', quantity: '100', uom: 'KG', movement_type: '101' });
  const tables = base({ erp_purchase_lines: [p, dup], materials: [rec('materials', null, { material_id: 'M1', material_group: 'oilseed', default_ef_id: 'EF-MAT' })] });
  const before = computeInventory({ year: 2025, scope2Basis: 'market', tables, overlay: empty(), openIssues: new Map() });
  const o = empty();
  o.values.set(p.id, new Map([['quantity', { value: '39616', correction_id: 'cor_1' }]]));
  o.excluded.set(dup.id, 'cor_2');
  const after = computeInventory({ year: 2025, scope2Basis: 'market', tables, overlay: o, openIssues: new Map() });
  const kg = (r: typeof before) => r.contributions.filter((c) => c.kind === 'material_purchase').reduce((s, c) => s + c.kgco2e, 0);
  assert.equal(kg(before), (39.616 + 100) * 2);
  assert.equal(kg(after), 39616 * 2);
  assert.equal(p.payload.quantity, '39.616', 'source payload untouched');
  const c = after.contributions.find((x) => x.kind === 'material_purchase')!;
  assert.deepEqual(c.correction_ids, ['cor_1']);
  assert.equal(c.value_status, 'corrected');
  assert.equal(after.excluded[0].correction_id, 'cor_2');
});

test('a supplier PCF is used only when its period covers the year and the unit is kg', () => {
  const erp = rec('erp_purchase_lines', 2025, { doc_no: '1', line_no: '10', material_id: 'M1', supplier_id: 'SUP', quantity: '1000', uom: 'KG', movement_type: '101' });
  const mats = [rec('materials', null, { material_id: 'M1', material_group: 'oilseed', default_ef_id: 'EF-MAT' })];
  const pcf = (start: string, end: string, unit = 'kilogram') => rec('supplier_pcf', 2025, { supplier_id: 'SUP', material_id: 'M1', year: '2025', pcf_value: '1.5', declared_unit: unit, reference_period_start: start, reference_period_end: end });
  const run = (p: Src) => computeInventory({ year: 2025, scope2Basis: 'market', tables: base({ erp_purchase_lines: [erp], materials: mats, supplier_pcf: [p] }), overlay: empty(), openIssues: new Map() }).contributions.find((c) => c.kind === 'material_purchase')!;
  assert.equal(run(pcf('2025-01-01T00:00:00Z', '2026-01-01T00:00:00Z')).basis, 'supplier_pcf');
  assert.equal(run(pcf('2022-01-01T00:00:00Z', '2023-01-01T00:00:00Z')).basis, 'default_factor');
  assert.equal(run(pcf('2025-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'tonne')).basis, 'default_factor');
});

test('contract-farm materials are counted only through the farm footprint', () => {
  const tables = base({
    materials: [rec('materials', null, { material_id: 'M110', material_group: 'vegetable_contract', default_ef_id: 'FARM' })],
    erp_purchase_lines: [rec('erp_purchase_lines', 2025, { doc_no: '1', line_no: '10', material_id: 'M110', supplier_id: 'F1', quantity: '20000', uom: 'KG', movement_type: '101' })],
    farm_registry: [rec('farm_registry', null, { farm_id: 'F1', region: 'FI_SW', country: 'FI' })],
    farm_survey: [rec('farm_survey', 2025, { farm_id: 'F1', crop: 'pea', year: '2025', area_ha: '5', n_mineral_kg_ha: '25', n_manure_kg_ha: '0', p_kg_ha: '12', diesel_l_ha: '80', lime_t_ha: '0', sprays: '2', yield_t_ha: '4', irrigated: 'False', soil_type_reported: 'Mineral soil', fertiliser_product: 'NPK' })],
  });
  const r = computeInventory({ year: 2025, scope2Basis: 'market', tables, overlay: empty(), openIssues: new Map() });
  assert.equal(r.contributions.filter((c) => c.kind === 'material_purchase').length, 0);
  const farm = r.contributions.find((c) => c.kind === 'contract_farm')!;
  // Hand calculation of the reference per-ha formula (mineral soil, 2025 grid 0.026).
  const n2o = (44 / 28) * 273;
  const resN = 6 * 4;
  const perHa = 25 * 3.7 + 12 * 1.6 + 12 * 2.2 * 0.5 + (25 * 0.016 + resN * 0.006) * n2o + ((25 * 0.05) * 0.014 + (25 + resN) * 0.24 * 0.011) * n2o + 80 * (2.1 + 0.61) + 2 * 8 + 8 * 4 * 0.026;
  assert.ok(Math.abs(Number(farm.factor_value) - perHa) < 1e-4, `${farm.factor_value} vs ${perHa}`);
  assert.ok(Math.abs(farm.kgco2e - perHa * 5) < 1e-3);
  assert.ok(r.checks.find((c) => c.id === 'no_farm_double_count')!.passed);
});

test('biogenic CO2 is a memo item outside Scope 1', () => {
  const e = rec('energy_meter_readings', 2025, { site_id: 'S-A', year: '2025', month: '1', carrier: 'wood_chips', value: '1000', unit: 'MWh' });
  const r = computeInventory({ year: 2025, scope2Basis: 'market', tables: base({ energy_meter_readings: [e] }), overlay: empty(), openIssues: new Map() });
  assert.equal(r.totals.scope1_total, 0);
  assert.equal(r.totals.biogenic_co2_scope1, 403.2);
  assert.ok(!r.contributions.some((c) => c.scope === 'memo' && c.in_total));
});

test('future electricity needs explicit site/year factors and never borrows a prior-year grid value', () => {
  const energy = rec('energy_meter_readings', 2026, { site_id: 'S-A', year: '2026', month: '1', carrier: 'electricity', value: '5', unit: 'MWh' });
  const calculate = (extra: Src[] = []) => computeInventory({ year: 2026, scope2Basis: 'market', tables: base({ energy_meter_readings: [energy], emission_factors: [...factors, ...extra] }), overlay: empty(), openIssues: new Map() });
  const missing = calculate();
  assert.equal(missing.totals.scope2_reported, 0);
  assert.ok(missing.gaps.some((gap) => gap.message.includes('No grid factor')));
  const lb = rec('emission_factors', null, { ef_id: 'EF-ELEC-LB:S-A:2026', unit: 'MWh', kgco2e_per_unit: '25', reference_source: 'DEMO factor' });
  const mb = rec('emission_factors', null, { ef_id: 'EF-ELEC-MB:S-A:2026', unit: 'MWh', kgco2e_per_unit: '400', reference_source: 'DEMO factor' });
  const imported = calculate([lb, mb]);
  assert.equal(imported.totals.scope2_location_total, 0.125);
  assert.equal(imported.totals.scope2_reported, 2);
  const contribution = imported.contributions.find((item) => item.scope === 'scope2_market')!;
  assert.equal(contribution.factor_id, mb.payload.ef_id);
  assert.ok(contribution.source_record_ids.includes(mb.id));
  const flagged = computeInventory({ year: 2026, scope2Basis: 'market', tables: base({ energy_meter_readings: [energy], emission_factors: [...factors, lb, mb] }), overlay: empty(), openIssues: new Map([[mb.id, ['DEMO-factor-review']]]) });
  assert.equal(flagged.contributions.find((item) => item.scope === 'scope2_market')!.value_status, 'has_open_issue');
  assert.equal(flagged.contributions.find((item) => item.scope === 'scope2_location')!.value_status, 'original', 'an issue in the other basis does not leak across');
  const corrected = empty();
  corrected.values.set(mb.id, new Map([['kgco2e_per_unit', { value: '500', correction_id: 'DEMO-confirmed-factor' }]]));
  const reviewed = computeInventory({ year: 2026, scope2Basis: 'market', tables: base({ energy_meter_readings: [energy], emission_factors: [...factors, lb, mb] }), overlay: corrected, openIssues: new Map() });
  assert.equal(reviewed.totals.scope2_reported, 2.5);
  assert.deepEqual(reviewed.contributions.find((item) => item.scope === 'scope2_market')!.correction_ids, ['DEMO-confirmed-factor']);
  const wrongYear = calculate([{ ...lb, payload: { ...lb.payload, ef_id: 'EF-ELEC-LB:S-A:2025' } }, mb]);
  assert.equal(wrongYear.totals.scope2_reported, 0);
  const wrongUnit = calculate([lb, { ...mb, payload: { ...mb.payload, unit: 'kWh' } }]);
  assert.equal(wrongUnit.totals.scope2_reported, 0);
  assert.ok(wrongUnit.gaps.some((gap) => gap.message.includes('Invalid site electricity factor')));
});

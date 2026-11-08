import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readableReport, reportComparison } from '../../server/domain/readableReport.ts';
import type { RunRow } from '../../server/services/calculations.ts';

const calculation = (changes: Partial<RunRow> = {}): RunRow => ({
  id: 'run_DEMO_current', created_at: '2026-11-07T12:00:00.000Z', year: 2025, kind: 'inventory', scope2_basis: 'market',
  status: 'complete', trigger: 'test', parent_run_id: null, method_version: 'DEMO-1',
  dataset_hashes: [{ dataset: 'shipments', batch_id: 'DEMO-batch', filename: 'shipments_DEMO.csv', sha256: 'DEMO-hash', imported_rows: 3 }],
  correction_ids: [], factor_versions: { method: 'DEMO-1' },
  completeness: { by_category: [
    { category: 'cat01_purchased_goods', tco2e: 90, in_total: true },
    { category: 'purchased_electricity', tco2e: 20, in_total: true },
    { category: 'purchased_electricity', tco2e: 30, in_total: false },
    { category: 'stationary_and_mobile_combustion', tco2e: 10, in_total: true },
  ] }, checks: [{ id: 'demo', passed: true, detail: 'DEMO' }],
  totals: { grand_total: 120, scope1_total: 10, scope2_reported: 20, scope2_location_total: 30, scope2_market_total: 20, scope3_total: 90 },
  open_issue_count: 0, contribution_count: 3, gaps: [], ...changes,
});

test('readable report uses the selected Scope 2 total once, with technical references separate', () => {
  const run = calculation();
  const content = readableReport(run, null, 'en');
  assert.equal(content.snapshot.total_tco2e, 120);
  assert.equal(content.snapshot.categories.reduce((sum, item) => sum + item.tco2e, 0), 120);
  const body = content.sections.map((section) => section.body).join('\n');
  assert.match(body, /120\.0 tCO₂e/);
  assert.match(body, /Energy we buy \(Scope 2\): 20\.0/);
  assert.ok(!body.includes('run_DEMO_current'));
  assert.ok(!body.includes('30.0'));
  assert.ok(JSON.stringify(content.technicalSections).includes(run.id));
  assert.ok(JSON.stringify(content.technicalSections).includes('DEMO-hash'));
  assert.ok(JSON.stringify(content.technicalSections).includes('30.0'));
});

test('report caveats reflect the calculation snapshot even when its status says complete', () => {
  const run = calculation({ open_issue_count: 3, completeness: { open_missing_record_issues: 2, estimated_contributions: 1 }, gaps: [{ area: 'transport', message: 'DEMO supporting detail' }] });
  const before = JSON.stringify(run);
  const content = readableReport(run, null, 'en');
  assert.equal(content.snapshot.provisional, true);
  assert.equal(content.snapshot.review_items, 5);
  assert.equal(content.snapshot.estimated_entries, 1);
  assert.match(content.sections.find((section) => section.key === 'review')!.body, /5 open items/);
  assert.match(content.sections.find((section) => section.key === 'review')!.body, /affecting: Transport/);
  assert.match(content.sections.find((section) => section.key === 'next')!.body, /recalculate/);
  assert.equal(JSON.stringify(run), before);
});

test('same-year revisions are compared only with matching sources, factors and settings', () => {
  const current = calculation();
  const previous = calculation({ id: 'run_DEMO_previous', totals: { ...current.totals, grand_total: 100 } });
  assert.equal(reportComparison(current, previous).difference_tco2e, 20);
  for (const change of [
    { year: 2024 }, { kind: 'transport' as const }, { scope2_basis: 'location' as const },
    { method_version: 'DEMO-2' }, { dataset_hashes: [] }, { factor_versions: { method: 'DEMO-2' } },
  ]) assert.equal(reportComparison(current, { ...previous, ...change }).available, false);
  const zero = reportComparison(current, { ...previous, totals: { ...previous.totals, grand_total: 0 } });
  assert.equal(zero.available, true);
  assert.equal(zero.difference_pct, null);
});

test('reports explain missing comparisons and localise the whole reading layer', () => {
  const run = calculation();
  const en = readableReport(run, null, 'en');
  const fi = readableReport(run, null, 'fi');
  assert.equal(en.snapshot.comparison.available, false);
  assert.ok(!en.sections.some((section) => section.key === 'changes'));
  assert.ok(!/Change from|Not comparable/.test(en.sections[0].body), 'no prior year supplied, no year-on-year claim');
  assert.equal(fi.sections[0].heading, 'Päätulos');
  assert.match(fi.sections.find((section) => section.key === 'contributors')!.body, /Ostetut tuotteet ja raaka-aineet/);
  assert.equal(fi.snapshot.total_tco2e, en.snapshot.total_tco2e);
  assert.equal(fi.snapshot.provisional, false);
  assert.match(fi.sections[0].body, /ihmisen tarkistusta/);
});

test('reports lead with the prior-year change, open-incident share and next steps when supplied', () => {
  const run = calculation({ open_issue_count: 2 });
  const en = readableReport(run, null, 'en', {
    prior: { year: 2024, grand_total: 100, comparable: true, change_tco2e: 20, change_pct: 20 },
    open_issue_tco2e: 60, open_issue_share_pct: 50, critical_incidents: 1, missing_activity: ['waste_transfer_notes'],
    next_steps: [{ found: 'Line X looks 1000× too large.', suggest: 'Check the invoice.', tco2e: -50 }],
  });
  const result = en.sections[0].body;
  assert.match(result, /Change from 2024: \+20\.0 tCO₂e \(\+20 %\)/);
  assert.match(result, /Provisional\. 50 % of the total rests on records with open incidents/);
  const review = en.sections.find((s) => s.key === 'review')!.body;
  assert.match(review, /60\.0 tCO₂e \(50 %\) rests on records with open incidents \(1 critical\)/);
  assert.match(review, /Not imported: Waste records/);
  assert.match(en.sections.find((s) => s.key === 'next')!.body, /^1\. Line X looks 1000× too large\. Check the invoice\.$/);
  assert.match(en.sections.find((s) => s.key === 'contributors')!.body, /Purchased goods and raw materials: 90\.0 tCO₂e \(75 %\)/);
  const incomparable = readableReport(run, null, 'en', { prior: { year: 2024, grand_total: 100, comparable: false, change_tco2e: 20, change_pct: 20 } });
  assert.match(incomparable.sections[0].body, /Not comparable with 2024/);
  assert.ok(!incomparable.sections[0].body.includes('+20'));
});

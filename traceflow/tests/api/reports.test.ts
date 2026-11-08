import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ALL_FIXTURES, H, makeApp, multipart } from '../helpers.ts';

test('report drafts retain bilingual snapshot explanations after a later human review', async (t) => {
  const ctx = await makeApp();
  t.after(ctx.cleanup);
  const post = (url: string, payload: object) => ctx.app.inject({ method: 'POST', url, headers: H, payload });
  assert.equal((await post('/api/report-drafts', { year: 2025, lang: 'en' })).statusCode, 409);
  const imported = await ctx.app.inject({ method: 'POST', url: '/api/imports', ...multipart(ALL_FIXTURES()) });
  assert.equal(imported.statusCode, 200);
  await post('/api/quality/scan', {});
  const run = (await post('/api/calculations/inventory', { year: 2025, scope2_basis: 'market' })).json();
  const response = await post('/api/report-drafts', { year: 2025, lang: 'en' });
  assert.equal(response.statusCode, 200);
  const report = response.json().report;
  assert.equal(report.status, 'draft');
  assert.equal(report.reader_snapshot.total_tco2e, run.totals.grand_total);
  assert.equal(report.reader_snapshot.provisional, true);
  assert.equal(report.sections_en[0].heading, 'Main result');
  assert.equal(report.sections_fi[0].heading, 'Päätulos');
  assert.ok(!report.sections[0].body.includes(run.id));
  assert.ok(JSON.stringify(report.technical_sections).includes(run.id));

  const list = (await ctx.app.inject({ method: 'GET', url: '/api/issues?status=open&q=pcf.value_scale', headers: H })).json();
  const issue = list.items[0];
  assert.match(issue.source_file, /SUP011.*2025\.json/);
  assert.equal(issue.status, 'open');
  assert.equal((await post(`/api/issues/${issue.id}/review`, { decision: 'approve', reviewer_label: 'DEMO reviewer', expected_revision: issue.revision, reason: 'Checked the supplier declaration' })).statusCode, 200);
  const saved = (await ctx.app.inject({ method: 'GET', url: `/api/documents/reports/${report.id}`, headers: H })).json();
  assert.deepEqual(saved.reader_snapshot, report.reader_snapshot);
  assert.deepEqual(saved.sections_en, report.sections_en);
  // A draft based on the same saved calculation keeps that calculation's original review counts.
  const next = (await post('/api/report-drafts', { year: 2025, lang: 'fi' })).json().report;
  assert.equal(next.reader_snapshot.review_items, report.reader_snapshot.review_items);
  assert.equal(next.sections[0].heading, 'Päätulos');
  assert.equal(next.status, 'draft');
});

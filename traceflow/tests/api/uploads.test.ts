import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import ExcelJS from 'exceljs';
import { get } from '../../server/db/database.ts';
import { ALL_FIXTURES, H, makeApp, multipart } from '../helpers.ts';

type Ctx = Awaited<ReturnType<typeof makeApp>>;
const headers = ['shipment_id', 'year', 'direction', 'ref_doc', 'ef_id', 'mode', 't', 'km'];
const mapping = { shipment_id: 'Toimitus', year: 'Vuosi', direction: 'Suunta', ref_doc: 'Viite', ef_id: 'Kerroin', mode: 'Kulkumuoto', t: 'Tonnit', km: 'Kilometrit' };
const mappedFile = { filename: 'carrier.csv', content: 'Toimitus;Vuosi;Suunta;Viite;Kerroin;Kulkumuoto;Tonnit;Kilometrit\nNEW-MAPPED;2025;inbound;D;EF;truck;10,429;52,6\n' };
const file = (name: string) => ({ filename: name, content: fs.readFileSync(path.resolve('tests/fixtures/evidence', name)) });
const post = (ctx: Ctx, url: string, body: object = {}) => ctx.app.inject({ method: 'POST', url, headers: H, payload: body });
const read = async (ctx: Ctx, url: string) => (await ctx.app.inject({ method: 'GET', url, headers: H })).json();
const send = (ctx: Ctx, url: string, files: { filename: string; content: Buffer | string }[], fields: Record<string, string> = {}) => { const m = multipart(files, fields); return ctx.app.inject({ method: 'POST', url, payload: m.payload, headers: m.headers }); };
const count = (ctx: Ctx, table: string) => get<{ n: number }>(ctx.db, `SELECT COUNT(*) n FROM ${table}`)!.n;
const confirmation = (extra: object = {}) => ({ destination: 'evidence', document_type: 'other', reviewer_label: 'Upload tester', expected_revision: 0, ...extra });

describe('upload inbox and import interpretation', () => {
  let ctx: Ctx;
  before(async () => { ctx = await makeApp(); await send(ctx, '/api/imports', ALL_FIXTURES()); });
  after(async () => ctx.cleanup());

  test('mapped imports keep mapping history; repeated imports deduplicate and remapping conflicts explicitly', async () => {
    const first = await send(ctx, '/api/imports', [mappedFile], { dataset: 'shipments', mapping: JSON.stringify(mapping) });
    assert.equal(first.statusCode, 200, first.body);
    assert.deepEqual(first.json().results[0].batch.mapping, mapping);
    const before = count(ctx, 'source_records');
    const again = await send(ctx, '/api/imports', [mappedFile], { dataset: 'shipments', mapping: JSON.stringify(Object.fromEntries(Object.entries(mapping).reverse())) });
    assert.equal(again.json().results[0].batch.status, 'duplicate_upload');
    const bad = await send(ctx, '/api/imports', [mappedFile], { dataset: 'shipments', mapping: JSON.stringify({ ...mapping, t: 'Kilometrit', km: 'Tonnit' }) });
    assert.equal(bad.statusCode, 409, bad.body);
    assert.equal(bad.json().details.reason, 'conflicting_interpretation');
    assert.equal(count(ctx, 'source_records'), before);
    assert.equal(get<{ freight_t: number }>(ctx.db, "SELECT freight_t FROM shipments WHERE shipment_id = 'NEW-MAPPED'")!.freight_t, 10.429);
  });

  test('different worksheets import separately; a repeat of either sheet stays deduplicated', async () => {
    const wb = new ExcelJS.Workbook();
    for (const name of ['First', 'Second']) { const ws = wb.addWorksheet(name); ws.addRow(headers); ws.addRow([`SHEET-${name}`, 2025, 'inbound', 'D', 'EF', 'truck', 1, 2]); }
    const f = { filename: 'two.xlsx', content: Buffer.from(await wb.xlsx.writeBuffer()) };
    for (const sheet of ['First', 'Second']) { const r = await send(ctx, '/api/imports', [f], { sheet }); assert.equal(r.statusCode, 200, r.body); assert.equal(r.json().results[0].batch.imported_rows, 1); }
    const repeat = await send(ctx, '/api/imports', [f], { sheet: 'Second' });
    assert.equal(repeat.json().results[0].batch.status, 'duplicate_upload');
    assert.equal(get<{ n: number }>(ctx.db, "SELECT COUNT(*) n FROM shipments WHERE shipment_id LIKE 'SHEET-%'")!.n, 2);
  });

  test('mixed files are queued without importing or auto-linking; duplicate uploads reuse an inbox item', async () => {
    const before = count(ctx, 'source_records');
    const files = [file('SUP011_PCF_declaration_DEMO.pdf'), file('SUP011_cover_letter_DEMO.docx'), mappedFile, file('archive_DEMO.bin')];
    const r = await send(ctx, '/api/uploads', files);
    assert.equal(r.statusCode, 200, r.body); assert.equal(r.json().results.length, 4);
    assert.equal(count(ctx, 'source_records'), before);
    assert.equal(count(ctx, 'evidence_links'), 0);
    const first = r.json().results[0];
    const repeat = (await send(ctx, '/api/uploads', [files[0]])).json().results[0];
    assert.equal(repeat.id, first.id); assert.equal(repeat.duplicate, true);
    const list = await read(ctx, '/api/uploads?state=needs_classification');
    assert.equal(list.total, 4);
  });

  test('supplier documents get suggestions; only confirmed links and classification are persisted', async () => {
    const r = (await send(ctx, '/api/uploads', [file('SUP011_PCF_declaration_DEMO.pdf')])).json().results[0];
    const detail = await read(ctx, `/api/uploads/${r.id}`);
    assert.equal(detail.suggested_document_type, 'supplier_pcf');
    assert.ok(detail.suggested_years.includes(2025));
    assert.ok(detail.suggested_links.some((l: { entity_type: string; entity_id: string }) => l.entity_type === 'supplier' && l.entity_id === 'SUP011'));
    const before = count(ctx, 'source_records');
    const body = confirmation({ document_type: 'supplier_pcf', reporting_year: 2025, links: [{ entity_type: 'supplier', entity_id: 'SUP011' }] });
    const accepted = await post(ctx, `/api/uploads/${r.id}/confirm`, body);
    assert.equal(accepted.statusCode, 200, accepted.body); assert.equal(accepted.json().status, 'confirmed');
    assert.equal(count(ctx, 'source_records'), before);
    assert.equal((await read(ctx, `/api/evidence/${r.evidence_id}`)).links[0].entity_id, 'SUP011');
    assert.equal((await post(ctx, `/api/uploads/${r.id}/confirm`, body)).statusCode, 409);
    assert.throws(() => ctx.db.exec("UPDATE upload_decisions SET reviewer_label = 'changed'"), /append-only/);
    const filtered = await read(ctx, '/api/uploads?state=confirmed&kind=pdf&year=2025&q=SUP011');
    assert.equal(filtered.total, 1);
    const evidence = await read(ctx, '/api/evidence?q=1.4091&kind=pdf&linked=linked');
    assert.equal(evidence.length, 1);
  });

  test('unrecognised files stay pending until categorised; invalid reviewer and link leave rows untouched', async () => {
    const r = (await send(ctx, '/api/uploads', [file('archive_DEMO.bin')])).json().results[0];
    const d = await read(ctx, `/api/uploads/${r.id}`);
    assert.equal(d.state, 'needs_classification'); assert.equal(d.table, null);
    assert.equal((await post(ctx, `/api/uploads/${r.id}/confirm`, confirmation({ reviewer_label: '' }))).statusCode, 400);
    assert.equal((await post(ctx, `/api/uploads/${r.id}/confirm`, confirmation({ document_type: 'unclassified' }))).statusCode, 400);
    const sourceCount = count(ctx, 'source_records'); const decisions = count(ctx, 'upload_decisions');
    const bad = await post(ctx, `/api/uploads/${r.id}/confirm`, confirmation({ links: [{ entity_type: 'supplier', entity_id: 'DOES-NOT-EXIST' }] }));
    assert.equal(bad.statusCode, 404); assert.equal(count(ctx, 'upload_decisions'), decisions); assert.equal(count(ctx, 'source_records'), sourceCount);
    assert.equal((await post(ctx, `/api/uploads/${r.id}/confirm`, confirmation())).statusCode, 200);
    assert.equal((await read(ctx, `/api/uploads/${r.id}`)).state, 'confirmed');
  });

  test('mapped table confirmation imports atomically, records the reviewer and supports manual target search', async () => {
    const fresh = { ...mappedFile, filename: 'new-carrier.csv', content: mappedFile.content.replace('NEW-MAPPED', 'INBOX-MAPPED') };
    const u = (await send(ctx, '/api/uploads', [fresh])).json().results[0];
    assert.equal((await read(ctx, `/api/uploads/${u.id}`)).table.dataset, null);
    const bad = await post(ctx, `/api/uploads/${u.id}/confirm`, confirmation({ destination: 'dataset', dataset: 'shipments', mapping }));
    assert.equal(bad.statusCode, 200, bad.body);
    assert.equal(bad.json().imported.batch.imported_rows, 1);
    assert.equal(bad.json().imported.batch.mapping.t, 'Tonnit');
    const d = await read(ctx, `/api/uploads/${u.id}`);
    assert.equal(d.decisions[0].reviewer_label, 'Upload tester');
    assert.equal(d.state, 'confirmed');
    assert.ok((await read(ctx, '/api/uploads/targets?entity_type=supplier&q=SUP011')).some((x: { entity_id: string }) => x.entity_id === 'SUP011'));
  });

  test('a workbook stays pending until each sheet is imported or explicitly filed as evidence', async () => {
    const wb = new ExcelJS.Workbook();
    const cover = wb.addWorksheet('Cover'); cover.addRow(['Report', 'Notes']); cover.addRow(['DEMO', 'Supporting information']);
    const ws = wb.addWorksheet('Legs'); ws.addRow(headers); ws.addRow(['INBOX-SHEET', 2025, 'inbound', 'D', 'EF', 'truck', 2, 3]);
    const u = (await send(ctx, '/api/uploads', [{ filename: 'review-workbook.xlsx', content: Buffer.from(await wb.xlsx.writeBuffer()) }])).json().results[0];
    const one = await post(ctx, `/api/uploads/${u.id}/confirm`, confirmation({ sheet: 'Cover', document_type: 'report' }));
    assert.equal(one.statusCode, 200, one.body); assert.equal(one.json().status, 'needs_classification'); assert.deepEqual(one.json().remaining_sheets, ['Legs']);
    assert.equal((await read(ctx, `/api/uploads/${u.id}`)).state, 'needs_classification');
    assert.equal((await read(ctx, '/api/uploads?state=needs_classification&q=review-workbook')).total, 1);
    const two = await post(ctx, `/api/uploads/${u.id}/confirm`, confirmation({ destination: 'dataset', dataset: 'shipments', sheet: 'Legs', expected_revision: 1 }));
    assert.equal(two.statusCode, 200, two.body); assert.equal(two.json().status, 'confirmed'); assert.equal(two.json().imported.batch.imported_rows, 1);
    assert.equal((await read(ctx, `/api/uploads/${u.id}`)).state, 'confirmed');
    assert.equal((await read(ctx, '/api/uploads?state=confirmed&q=review-workbook')).total, 1);
    assert.equal((await ctx.app.inject({ method: 'GET', url: `/api/uploads/${u.id}?sheet=Unknown`, headers: H })).statusCode, 400);
  });

  test('a rejected import rolls back its batch, decisions and audit; duplicate headers cannot overwrite data', async () => {
    const content = headers.join(',') + '\n,2025,inbound,D,EF,truck,1,2\n';
    const u = (await send(ctx, '/api/uploads', [{ filename: 'bad-rows.csv', content }])).json().results[0];
    const counts = ['source_records', 'import_batches', 'upload_decisions', 'audit_events'].map((t) => count(ctx, t));
    const bad = await post(ctx, `/api/uploads/${u.id}/confirm`, confirmation({ destination: 'dataset', dataset: 'shipments' }));
    assert.equal(bad.statusCode, 400, bad.body);
    assert.deepEqual(['source_records', 'import_batches', 'upload_decisions', 'audit_events'].map((t) => count(ctx, t)), counts);
    const dup = await send(ctx, '/api/imports', [{ filename: 'duplicate-headers.csv', content: headers.join(',') + ',t\nA,2025,inbound,D,EF,truck,1,2,999\n' }]);
    assert.equal(dup.statusCode, 400, dup.body); assert.match(dup.json().error, /Duplicate column/);
  });

  test('concurrent uploads of the same bytes create one evidence file and one inbox item', async () => {
    const f = { filename: 'concurrent.docx', content: fs.readFileSync('tests/fixtures/evidence/SUP011_cover_letter_DEMO.docx') };
    const results = await Promise.all([send(ctx, '/api/uploads', [f]), send(ctx, '/api/uploads', [f])]);
    for (const r of results) assert.equal(r.statusCode, 200, r.body);
    assert.equal(results[0].json().results[0].id, results[1].json().results[0].id);
    assert.equal(results[0].json().results[0].evidence_id, results[1].json().results[0].evidence_id);
  });
});

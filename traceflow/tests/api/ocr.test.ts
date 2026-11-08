import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { get } from '../../server/db/database.ts';
import { readOcr } from '../../server/domain/ocr.ts';
import type { LlmClient } from '../../server/services/gemini.ts';
import { H, makeApp, multipart } from '../helpers.ts';

test('OCR readings preserve original text, remain distinct from verification, and report missing tools honestly', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'traceflow-ocr-adapter-'));
  const previous = process.env.TESSERACT_PATH;
  const previousRaster = process.env.PDFTOPPM_PATH;
  const bin = path.join(tmp, 'tesseract');
  // Test the process adapter deterministically. This is not an OCR accuracy benchmark.
  fs.writeFileSync(bin, '#!/usr/bin/env node\nprocess.stdout.write("Declared weight: 12 kg.\\n")\n', { mode: 0o755 });
  process.env.TESSERACT_PATH = bin;
  const llm: LlmClient = { mode: 'stub', model: 'scripted', generate: async () => ({ text: JSON.stringify({ document_type: 'delivery', summary: 'Weight', values: [{ field: 'weight', value: '12', unit: 'kg', quote: 'Declared weight: 12 kg.', page: 1 }] }), calls: [], content: null, usage: { input: 1, output: 1 } }) };
  const ctx = await makeApp({ llm });
  try {
    const m = multipart([{ filename: 'scan.png', content: fs.readFileSync('tests/fixtures/evidence/delivery_photo_DEMO.png') }]);
    const u = await ctx.app.inject({ method: 'POST', url: '/api/uploads', headers: m.headers, payload: m.payload });
    const evidenceId = u.json().results[0].evidence_id;
    const original = get<{ pages_json: string }>(ctx.db, 'SELECT pages_json FROM evidence_files WHERE id = ?', evidenceId)!.pages_json;
    const reading = await ctx.app.inject({ method: 'POST', url: `/api/evidence/${evidenceId}/ocr`, headers: H, payload: {} });
    assert.equal(reading.statusCode, 200, reading.body); assert.equal(reading.json().status, 'completed');
    assert.equal(get<{ pages_json: string }>(ctx.db, 'SELECT pages_json FROM evidence_files WHERE id = ?', evidenceId)!.pages_json, original);
    assert.throws(() => ctx.db.exec("UPDATE evidence_text_runs SET status = 'failed'"), /append-only/);
    const d = (await ctx.app.inject({ method: 'GET', url: `/api/evidence/${evidenceId}`, headers: H })).json();
    assert.equal(d.from_ocr, true); assert.match(d.pages[0].text, /12 kg/);
    const extracted = (await ctx.app.inject({ method: 'POST', url: `/api/evidence/${evidenceId}/extract`, headers: H, payload: {} })).json();
    assert.equal(extracted.result.values[0].verification, 'matched_in_ocr');
    assert.equal(get<{ n: number }>(ctx.db, 'SELECT COUNT(*) n FROM corrections')!.n, 0);
    process.env.TESSERACT_PATH = path.join(tmp, 'missing');
    const unavailable = (await ctx.app.inject({ method: 'POST', url: `/api/evidence/${evidenceId}/ocr`, headers: H, payload: {} })).json();
    assert.equal(unavailable.status, 'unavailable'); assert.match(unavailable.error, /Tesseract/);
    // A failed later attempt must not discard a successful earlier transcription.
    const latest = (await ctx.app.inject({ method: 'GET', url: `/api/evidence/${evidenceId}`, headers: H })).json();
    assert.match(latest.pages[0].text, /12 kg/);
    assert.equal((await readOcr('large.pdf', new Uint8Array(), 'pdf', 21)).status, 'unavailable');
    process.env.TESSERACT_PATH = bin;
    process.env.PDFTOPPM_PATH = bin;
    const large = await readOcr('large.pdf', new Uint8Array(), 'pdf', 21);
    assert.equal(large.status, 'failed'); assert.match(large.error!, /20 pages/);
  } finally {
    await ctx.cleanup(); fs.rmSync(tmp, { recursive: true, force: true });
    if (previous === undefined) delete process.env.TESSERACT_PATH; else process.env.TESSERACT_PATH = previous;
    if (previousRaster === undefined) delete process.env.PDFTOPPM_PATH; else process.env.PDFTOPPM_PATH = previousRaster;
  }
});

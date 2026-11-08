// File import: CSV / XLSX / PACT JSON → immutable source_records with batch provenance.
// The whole file is processed; repeat uploads and repeated rows are idempotent.
import fs from 'node:fs';
import path from 'node:path';
import { type DB, all, get, json, nowIso, run, tx } from '../db/database.ts';
import { type DatasetDef, type RowObject, DATASETS, detectDataset, resolveDataset } from '../domain/catalog.ts';
import { parseCsv } from '../domain/csv.ts';
import { flattenPact } from '../domain/pcf.ts';
import { newId, parseNumber, sha256 } from '../domain/util.ts';
import { readXlsx } from '../domain/xlsx.ts';
import { HttpError, recordAudit } from './common.ts';
import { relinkShipments } from './linker.ts';
import { type Mapping, applyMapping, validateMapping } from './mapping.ts';

export type ImportInput = {
  filename: string;
  bytes: Uint8Array;
  dataset?: string;
  sheet?: string;
  delimiter?: string;
  storeOriginal?: boolean;
  mapping?: Mapping;
};

export type RowError = { line: number; reason: string };

export type BatchRow = {
  id: string;
  filename: string;
  sha256: string;
  dataset: string;
  file_format: string;
  delimiter: string | null;
  sheet_name: string | null;
  size_bytes: number;
  expected_rows: number;
  imported_rows: number;
  duplicate_rows: number;
  rejected_rows: number;
  years: number[];
  columns: string[];
  errors: RowError[];
  status: string;
  duplicate_of: string | null;
  imported_at: string;
  mapping: Mapping | null;
};

export type ParsedImport = { headers: string[]; rows: string[][]; rowLines: number[]; rejected: RowError[]; delimiter: string | null; sheet: string | null; sheets?: string[]; format: 'csv' | 'xlsx' | 'json' };

const MAX_STORED_ERRORS = 500;
const LINK_DATASETS = new Set(['shipments', 'erp_purchase_lines', 'materials', 'suppliers']);

export async function parseImportFile(input: ImportInput): Promise<ParsedImport> {
  if (!input.bytes.length) throw new HttpError(400, 'The file is empty.');
  const ext = path.extname(input.filename).toLowerCase();
  if (ext === '.csv' || ext === '.txt' || ext === '.tsv') {
    const t = parseCsv(input.bytes, { delimiter: input.delimiter });
    return { headers: t.headers, rows: t.rows, rowLines: t.rowLines, rejected: t.rejected, delimiter: t.delimiter, sheet: null, format: 'csv' };
  }
  if (ext === '.xlsx') {
    const t = await readXlsx(input.bytes, input.sheet).catch((e: Error) => {
      throw new HttpError(400, `Could not read workbook: ${e.message}`);
    });
    return { headers: t.headers, rows: t.rows, rowLines: t.rowLines, rejected: t.rejected, delimiter: null, sheet: t.sheet, sheets: t.sheets, format: 'xlsx' };
  }
  if (ext === '.json') {
    let doc: unknown;
    try {
      doc = JSON.parse(new TextDecoder('utf-8').decode(input.bytes).replace(/^﻿/, ''));
    } catch (e) {
      throw new HttpError(400, `Invalid JSON: ${(e as Error).message}`);
    }
    const docs = Array.isArray(doc) ? doc : [doc];
    const rows: RowObject[] = [];
    const rejected: RowError[] = [];
    docs.forEach((d, i) => {
      const r = flattenPact(d, input.filename);
      if (r.row) rows.push(r.row);
      else rejected.push({ line: i + 1, reason: r.error || 'Unrecognised JSON document' });
    });
    const headers = rows.length ? Object.keys(rows[0]) : [];
    return { headers, rows: rows.map((r) => headers.map((h) => r[h] ?? '')), rowLines: rows.map((_, i) => i + 1), rejected, delimiter: null, sheet: null, format: 'json' };
  }
  if (ext === '.xls') throw new HttpError(400, 'Legacy .xls is not supported. Save the sheet as .xlsx or .csv.');
  throw new HttpError(400, `"${ext || 'no extension'}" is not a data table. Data import takes .csv, .tsv, .txt, .xlsx or PACT .json; add PDFs, Word files, images and other documents as evidence documents instead.`, { reason: 'not_tabular' });
}

export function batchFromRow(r: Record<string, unknown>): BatchRow {
  return {
    id: String(r.id),
    filename: String(r.filename),
    sha256: String(r.sha256),
    dataset: String(r.dataset),
    file_format: String(r.file_format),
    delimiter: (r.delimiter as string) ?? null,
    sheet_name: (r.sheet_name as string) ?? null,
    size_bytes: Number(r.size_bytes),
    expected_rows: Number(r.expected_rows),
    imported_rows: Number(r.imported_rows),
    duplicate_rows: Number(r.duplicate_rows),
    rejected_rows: Number(r.rejected_rows),
    years: json<number[]>(r.years_json, []),
    columns: json<string[]>(r.columns_json, []),
    errors: json<RowError[]>(r.errors_json, []),
    status: String(r.status),
    duplicate_of: (r.duplicate_of as string) ?? null,
    imported_at: String(r.imported_at),
    mapping: json<Mapping | null>(r.mapping_json, null),
  };
}

export function getBatch(db: DB, id: string): BatchRow | null {
  const r = get(db, 'SELECT * FROM import_batches WHERE id = ?', id);
  return r ? batchFromRow(r) : null;
}

export type ImportOutcome = {
  batch: BatchRow;
  detected: { dataset: string; candidates: string[]; explicit: boolean };
  preview: { headers: string[]; rows: string[][] };
};

export async function importFile(db: DB, uploadsDir: string, input: ImportInput): Promise<ImportOutcome> {
  return importParsedFile(db, uploadsDir, input, await parseImportFile(input));
}

// Parsing happens before the transaction. Callers can wrap this synchronous commit in their own
// transaction to atomically save classification decisions and entity links with the imported rows.
export function importParsedFile(db: DB, uploadsDir: string, input: ImportInput, source: ParsedImport): ImportOutcome {
  const parsed = { ...source, headers: [...source.headers] };
  if (!parsed.headers.length) throw new HttpError(400, 'No header row found in the file.');
  const originalHeaders = parsed.headers;
  if (new Set(originalHeaders).size !== originalHeaders.length) throw new HttpError(400, 'Duplicate column names: give every column a unique header.');
  if (input.mapping && Object.keys(input.mapping).length) {
    const target = input.dataset && input.dataset !== 'auto' ? resolveDataset(input.dataset) : null;
    if (!target) throw new HttpError(400, 'A column mapping needs an explicit dataset.');
    const errs = validateMapping(target, parsed.headers, input.mapping);
    if (errs.length) throw new HttpError(400, `Column mapping is not valid: ${errs.join('; ')}`, { errors: errs });
    parsed.headers = applyMapping(parsed.headers, input.mapping);
    if (new Set(parsed.headers).size !== parsed.headers.length) throw new HttpError(400, 'The mapping creates duplicate column names. Rename the conflicting source columns.');
  }
  const fileHash = sha256(input.bytes);

  const explicit = !!input.dataset && input.dataset !== 'auto';
  let def: DatasetDef | null;
  let candidates: string[] = [];
  if (explicit) {
    def = resolveDataset(String(input.dataset));
    if (!def) throw new HttpError(400, `Unknown dataset "${input.dataset}". Use a known dataset or custom_<name>.`, { known: DATASETS.map((d) => d.id) });
  } else {
    const det = detectDataset(parsed.headers, input.filename);
    def = det.dataset;
    candidates = det.candidates;
    if (!def) {
      throw new HttpError(400, 'The columns do not match any known dataset. Map the columns to a dataset, or import as custom_<name>.', {
        reason: 'unknown_layout',
        headers: parsed.headers,
        sample: parsed.rows.slice(0, 5),
        known: DATASETS.map((d) => ({ id: d.id, required: d.required })),
      });
    }
  }
  const missing = def.required.filter((c) => !parsed.headers.includes(c));
  if (missing.length) throw new HttpError(400, `Dataset ${def.id} requires columns: ${missing.join(', ')}. Map the columns to continue.`, { reason: 'missing_columns', dataset: def.id, missing, headers: parsed.headers, sample: parsed.rows.slice(0, 5) });

  const preview = { headers: parsed.headers, rows: parsed.rows.slice(0, 20) };
  const expected = parsed.rows.length + parsed.rejected.length;
  const previous = get<{ id: string; columns_json: string; delimiter: string | null; file_format: string }>(
    db,
    `SELECT id, columns_json, delimiter, file_format FROM import_batches WHERE sha256 = ? AND dataset = ? AND sheet_name IS ? AND status IN ('imported', 'imported_with_errors') ORDER BY imported_at LIMIT 1`,
    fileHash,
    def.id,
    parsed.sheet,
  );
  if (previous && (JSON.stringify(json<string[]>(previous.columns_json, [])) !== JSON.stringify(parsed.headers) || previous.delimiter !== parsed.delimiter || previous.file_format !== parsed.format)) {
    throw new HttpError(409, 'This worksheet/file was already imported with a different column mapping or parser setting. Review corrections to the existing source rows; importing both interpretations would double-count them.', { reason: 'conflicting_interpretation', batch_id: previous.id });
  }

  const batchId = newId('imp');
  const storedPath = input.storeOriginal === false ? null : storeOriginal(uploadsDir, fileHash, input.filename, input.bytes);

  if (previous) {
    tx(db, () => {
      insertBatch(db, {
        id: batchId, filename: input.filename, sha256: fileHash, dataset: def!.id, parsed, size: input.bytes.length,
        expected, imported: 0, duplicates: parsed.rows.length, errors: parsed.rejected, years: [], status: 'duplicate_upload',
        storedPath, duplicateOf: previous.id, mapping: input.mapping,
      });
      recordAudit(db, {
        event_type: 'import.duplicate_upload', actor_kind: 'system', actor_label: 'system', entity_type: 'import_batch', entity_id: batchId,
        after: { filename: input.filename, dataset: def!.id, duplicate_of: previous.id, rows: parsed.rows.length },
      });
    });
    return { batch: getBatch(db, batchId)!, detected: { dataset: def.id, candidates, explicit }, preview };
  }

  const errors: RowError[] = [...parsed.rejected];
  const occurrences = new Map<string, number>();
  const years = new Set<number>();
  let imported = 0;
  let duplicates = 0;

  tx(db, () => {
    insertBatch(db, {
      id: batchId, filename: input.filename, sha256: fileHash, dataset: def!.id, parsed, size: input.bytes.length,
      expected, imported: 0, duplicates: 0, errors: [], years: [], status: 'imported', storedPath, duplicateOf: null, mapping: input.mapping,
    });
    const insert = db.prepare(
      `INSERT OR IGNORE INTO source_records (id, batch_id, table_name, record_key, year, source_file, source_row, source_line, payload_json, row_hash, fingerprint)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    parsed.rows.forEach((cells, i) => {
      const line = parsed.rowLines[i];
      const obj: RowObject = {};
      parsed.headers.forEach((h, j) => {
        obj[h] = cells[j] ?? '';
      });
      const trimmed: RowObject = {};
      for (const [k, v] of Object.entries(obj)) trimmed[k] = typeof v === 'string' ? v.trim() : v;
      const reason = rowProblem(def!, trimmed);
      if (reason) {
        errors.push({ line, reason });
        return;
      }
      const rowHash = sha256(JSON.stringify(originalHeaders.map((h, j) => [h, cells[j] ?? ''])));
      const occ = (occurrences.get(rowHash) || 0) + 1;
      occurrences.set(rowHash, occ);
      const fingerprint = sha256(`${def!.id}|${rowHash}|${occ}`);
      const existing = get<{ payload_json: string }>(db, 'SELECT payload_json FROM source_records WHERE fingerprint = ?', fingerprint);
      if (existing && existing.payload_json !== JSON.stringify(obj)) {
        throw new HttpError(409, 'A source row is already stored with a different column mapping. Review a correction instead of importing a second interpretation.', { reason: 'conflicting_interpretation', line });
      }
      const year = def!.year(trimmed);
      if (year !== null) years.add(year);
      const res = insert.run(
        `rec_${fingerprint.slice(0, 24)}`, batchId, def!.id, def!.key(trimmed), year, input.filename,
        i + 2, line, JSON.stringify(obj), rowHash, fingerprint,
      );
      if (Number(res.changes) > 0) imported++;
      else duplicates++;
    });
    const status = imported === 0 && errors.length > 0 && duplicates === 0 ? 'rejected' : errors.length ? 'imported_with_errors' : 'imported';
    run(
      db,
      `UPDATE import_batches SET imported_rows = ?, duplicate_rows = ?, rejected_rows = ?, errors_json = ?, years_json = ?, status = ? WHERE id = ?`,
      imported, duplicates, errors.length, JSON.stringify(errors.slice(0, MAX_STORED_ERRORS)), JSON.stringify([...years].sort()), status, batchId,
    );
    recordAudit(db, {
      event_type: 'import.completed', actor_kind: 'system', actor_label: 'system', entity_type: 'import_batch', entity_id: batchId,
      after: { filename: input.filename, dataset: def!.id, sha256: fileHash, expected_rows: expected, imported_rows: imported, duplicate_rows: duplicates, rejected_rows: errors.length },
    });
  });

  if (LINK_DATASETS.has(def.id)) relinkShipments(db);
  return { batch: getBatch(db, batchId)!, detected: { dataset: def.id, candidates, explicit }, preview };
}

function rowProblem(def: DatasetDef, row: RowObject): string | null {
  // Identity columns must be present; value columns may be empty (the quality rules flag them).
  for (const f of def.ids) if (!row[f]) return `Missing identifier in column "${f}"`;
  for (const f of def.numeric) {
    const v = row[f];
    if (v !== undefined && v !== '' && parseNumber(v) === null) return `Column "${f}" value "${String(v).slice(0, 40)}" is not a number`;
  }
  return null;
}

type BatchInsert = {
  id: string; filename: string; sha256: string; dataset: string; parsed: ParsedImport; size: number; expected: number;
  imported: number; duplicates: number; errors: RowError[]; years: number[]; status: string; storedPath: string | null; duplicateOf: string | null;
  mapping?: Mapping | null;
};

function insertBatch(db: DB, b: BatchInsert) {
  run(
    db,
    `INSERT INTO import_batches (id, filename, sha256, dataset, file_format, delimiter, sheet_name, size_bytes, expected_rows, imported_rows,
       duplicate_rows, rejected_rows, years_json, columns_json, errors_json, status, stored_path, duplicate_of, imported_at, mapping_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    b.id, b.filename, b.sha256, b.dataset, b.parsed.format, b.parsed.delimiter, b.parsed.sheet, b.size, b.expected, b.imported,
    b.duplicates, b.errors.length, JSON.stringify(b.years), JSON.stringify(b.parsed.headers), JSON.stringify(b.errors.slice(0, MAX_STORED_ERRORS)),
    b.status, b.storedPath, b.duplicateOf, nowIso(), b.mapping && Object.keys(b.mapping).length ? JSON.stringify(b.mapping) : null,
  );
}

function storeOriginal(dir: string, hash: string, filename: string, bytes: Uint8Array): string {
  fs.mkdirSync(dir, { recursive: true });
  const ext = path.extname(filename).toLowerCase().replace(/[^a-z.]/g, '') || '.bin';
  const file = path.join(dir, `${hash}${ext}`);
  if (!fs.existsSync(file)) fs.writeFileSync(file, bytes);
  return path.relative(process.cwd(), file);
}

export function listDatasets(db: DB) {
  const batches = all(db, 'SELECT * FROM import_batches ORDER BY imported_at DESC').map(batchFromRow);
  const counts = all<{ table_name: string; n: number; years: string | null }>(
    db,
    `SELECT table_name, COUNT(*) AS n, GROUP_CONCAT(DISTINCT year) AS years FROM source_records GROUP BY table_name`,
  );
  const byTable = new Map(counts.map((c) => [c.table_name, c]));
  const datasets = DATASETS.map((d) => {
    const c = byTable.get(d.id);
    return {
      id: d.id,
      label: d.label,
      group: d.group,
      required_columns: d.required,
      record_count: c ? Number(c.n) : 0,
      years: c?.years ? c.years.split(',').map(Number).filter((n) => Number.isFinite(n)).sort() : [],
      batches: batches.filter((b) => b.dataset === d.id).length,
    };
  });
  for (const c of counts) {
    if (!datasets.some((d) => d.id === c.table_name)) {
      datasets.push({ id: c.table_name, label: c.table_name, group: 'reference', required_columns: [], record_count: Number(c.n), years: [], batches: batches.filter((b) => b.dataset === c.table_name).length });
    }
  }
  return { datasets, batches };
}

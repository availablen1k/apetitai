// Uploads: a shared area for incoming files. File storage is immediate; dataset imports and links need confirmation.
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { type DB, type SqlValue, all, get, json, nowIso, run, tx } from '../db/database.ts';
import { DATASETS, detectDataset } from '../domain/catalog.ts';
import { newId } from '../domain/util.ts';
import { HttpError, recordAudit } from './common.ts';
import { ENTITY_TYPES, type EntityType, addEvidence, assertEntity, evidenceFile, getEvidence, linkEvidence } from './evidence.ts';
import { getBatch, importParsedFile, parseImportFile, type ParsedImport } from './imports.ts';
import { namePrefill, suggestMapping } from './mapping.ts';
import type { LlmClient } from './gemini.ts';

export const DOCUMENT_TYPES = ['unclassified', 'supplier_pcf', 'invoice', 'freight', 'certificate', 'report', 'other'] as const;
export const ConfirmUpload = z.object({
  destination: z.enum(['dataset', 'evidence']),
  dataset: z.string().max(60).optional(),
  sheet: z.string().max(200).optional(),
  mapping: z.record(z.string().max(200)).optional(),
  document_type: z.enum(DOCUMENT_TYPES),
  reporting_year: z.number().int().min(2000).max(2100).nullable().optional(),
  reviewer_label: z.string().trim().min(1).max(80),
  expected_revision: z.number().int().min(0),
  links: z.array(z.object({ entity_type: z.enum(ENTITY_TYPES), entity_id: z.string().min(1).max(64) })).max(30).default([]),
});
type Decision = { id: string; upload_id: string; destination: 'dataset' | 'evidence'; dataset: string | null; sheet: string | null; document_type: string; reporting_year: number | null; reviewer_label: string; import_batch_id: string | null; created_at: string };
type Upload = { id: string; evidence_id: string; created_at: string };
type Target = { entity_type: EntityType; entity_id: string; label: string; reason?: string };

function upload(db: DB, id: string): Upload {
  const r = get<Upload>(db, 'SELECT * FROM upload_inbox WHERE id = ?', id);
  if (!r) throw new HttpError(404, `Upload ${id} not found`);
  return r;
}
const decisionsFor = (db: DB, id: string) => all<Decision>(db, 'SELECT * FROM upload_decisions WHERE upload_id = ? ORDER BY rowid DESC', id);

export async function queueUpload(db: DB, dir: string, input: { filename: string; bytes: Uint8Array }) {
  const stored = await addEvidence(db, dir, input);
  const existing = get<Upload>(db, 'SELECT * FROM upload_inbox WHERE evidence_id = ?', stored.evidence.id);
  if (existing) return { ...existing, filename: stored.evidence.filename, duplicate: true };
  const id = newId('upl');
  let sheets: string[] = [];
  if (path.extname(input.filename).toLowerCase() === '.xlsx') {
    try { sheets = (await parseImportFile(input)).sheets || []; } catch { /* unreadable workbooks stay in the inbox */ }
  }
  const queued = tx(db, () => {
    // Parsing may yield while another request queues the same bytes. Recheck inside the transaction.
    const raced = get<Upload>(db, 'SELECT * FROM upload_inbox WHERE evidence_id = ?', stored.evidence.id);
    if (raced) return { ...raced, duplicate: true };
    run(db, 'INSERT INTO upload_inbox (id, evidence_id, sheet_names_json, created_at) VALUES (?, ?, ?, ?)', id, stored.evidence.id, JSON.stringify(sheets), nowIso());
    recordAudit(db, { event_type: 'upload.queued', actor_kind: 'system', actor_label: 'system', entity_type: 'upload', entity_id: id, after: { evidence_id: stored.evidence.id } });
    return { id, evidence_id: stored.evidence.id, duplicate: false };
  });
  return { ...queued, filename: stored.evidence.filename };
}

async function inspect(db: DB, id: string, sheet?: string) {
  const u = upload(db, id);
  const evidence = getEvidence(db, u.evidence_id);
  const file = evidenceFile(db, u.evidence_id);
  const bytes = fs.readFileSync(file.file);
  let parsed: ParsedImport | null = null;
  let table_error: string | null = null;
  const ext = path.extname(file.filename).toLowerCase();
  if (['.csv', '.tsv', '.txt', '.xlsx', '.json'].includes(ext) && evidence.kind !== 'pdf') {
    try { parsed = await parseImportFile({ filename: file.filename, bytes, sheet }); }
    catch (e) { table_error = (e as Error).message; }
  }
  if (sheet && !parsed?.sheets?.includes(sheet)) throw new HttpError(400, `Worksheet "${sheet}" does not exist in this file.`);
  const detected = parsed ? detectDataset(parsed.headers, file.filename) : { dataset: null, candidates: [] };
  return { u, evidence, file, bytes, parsed, detected, table_error };
}

function documentType(text: string): typeof DOCUMENT_TYPES[number] {
  if (/product carbon footprint|cradle.to.gate|pcf declaration/i.test(text)) return 'supplier_pcf';
  if (/invoice|lasku|faktura/i.test(text)) return 'invoice';
  if (/freight|ferry booking|consignment|rahtikirja|\bcmr\b/i.test(text)) return 'freight';
  if (/certificate|certification|todistus/i.test(text)) return 'certificate';
  if (/report|raportti/i.test(text)) return 'report';
  return 'unclassified';
}
const mentions = (text: string, id: string) => {
  if (id.length < 3) return false;
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'iu').test(text);
};

function suggestLinks(db: DB, text: string): Target[] {
  const out: Target[] = [];
  for (const type of ['supplier', 'material'] as const) {
    const table = type === 'supplier' ? 'suppliers' : 'materials';
    const rows = all<{ record_key: string; payload_json: string }>(db, 'SELECT record_key, payload_json FROM source_records WHERE table_name = ?', table);
    const seen = new Set<string>();
    for (const r of rows) {
      const p = json<Record<string, string>>(r.payload_json, {});
      const id = p[`${type}_id`];
      const name = p[`${type}_name`] || p.name || '';
      if (!id || seen.has(id)) continue;
      if (mentions(text, id) || (name.length >= 5 && text.toLowerCase().includes(name.toLowerCase()))) {
        out.push({ entity_type: type, entity_id: id, label: `${id}${name ? ` · ${name}` : ''}`, reason: mentions(text, id) ? `Identifier ${id} occurs in the file` : 'Name occurs in the file' });
        seen.add(id);
        if (seen.size >= 10) break;
      }
    }
  }
  const ships = all<{ record_id: string; shipment_id: string }>(db, 'SELECT record_id, shipment_id FROM shipments');
  const tokens = new Set((text.match(/[\p{L}\p{N}_-]+/gu) || []).map((t) => t.toLowerCase()));
  for (const s of ships) {
    if (tokens.has(s.shipment_id.toLowerCase())) out.push({ entity_type: 'shipment', entity_id: s.record_id, label: s.shipment_id, reason: 'Shipment identifier occurs in the file' });
    if (out.length >= 25) break;
  }
  return out.slice(0, 25);
}

export async function getUpload(db: DB, id: string, sheet?: string) {
  const { u, evidence, parsed, detected, table_error } = await inspect(db, id, sheet);
  const decisions = decisionsFor(db, id);
  const last_decision = decisions.find((d) => d.sheet === (parsed?.sheet ?? null)) || decisions.find((d) => d.destination === 'evidence' && !d.sheet) || null;
  const text = `${evidence.filename}\n${evidence.filename.replace(/_/g, ' ')}\n${evidence.pages.map((p) => p.text).join('\n').slice(0, 200000)}`;
  const years = [...new Set((text.match(/\b20\d{2}\b/g) || []).map(Number).filter((n) => n <= 2100))].sort();
  const sheets = parsed?.sheets || [];
  const classified = decisions.some((d) => d.destination === 'evidence' && !d.sheet) || (sheets.length ? sheets.every((s) => decisions.some((d) => d.sheet === s)) : decisions.length > 0);
  return {
    ...u, evidence, decisions, last_decision, last_import: last_decision?.import_batch_id ? getBatch(db, last_decision.import_batch_id) : null, revision: decisions.length, state: classified ? 'confirmed' : 'needs_classification',
    suggested_document_type: documentType(text), suggested_years: years, suggested_links: suggestLinks(db, text),
    table_error,
    table: parsed ? { headers: parsed.headers, sample: parsed.rows.slice(0, 5), total_rows: parsed.rows.length + parsed.rejected.length, sheets, sheet: parsed.sheet, dataset: detected.dataset?.id ?? null, candidates: detected.candidates, mapping: detected.dataset ? namePrefill(detected.dataset, parsed.headers) : {} } : null,
    catalog: DATASETS.map((d) => ({ id: d.id, label: d.label, required: d.required, columns: [...new Set([...d.required, ...d.numeric])] })),
  };
}

// List metadata only; do not repeatedly parse every workbook or send document text in list results.
export function listUploads(db: DB, f: { q?: string; kind?: string; state?: string; year?: number; limit?: number; offset?: number }) {
  const where: string[] = [];
  const params: SqlValue[] = [];
  if (f.q) { where.push('(e.filename LIKE ? OR e.pages_json LIKE ? OR EXISTS (SELECT 1 FROM evidence_links l WHERE l.evidence_id = e.id AND l.entity_id LIKE ?) OR EXISTS (SELECT 1 FROM evidence_text_runs t WHERE t.evidence_id = e.id AND t.status = \'completed\' AND t.pages_json LIKE ?))'); params.push(...Array(4).fill(`%${f.q}%`)); }
  if (f.kind) { where.push('e.kind = ?'); params.push(f.kind); }
  if (f.year) { where.push('EXISTS (SELECT 1 FROM upload_decisions d WHERE d.upload_id = u.id AND d.reporting_year = ?)'); params.push(f.year); }
  // A workbook remains pending until all its sheets are classified, tracked by the decisions.
  const rows = all<Upload & { filename: string; kind: string; text_status: string; sheet_names_json: string }>(db, `SELECT u.*, e.filename, e.kind, e.text_status FROM upload_inbox u JOIN evidence_files e ON e.id = u.evidence_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY u.rowid DESC`, ...params);
  const items = rows.map((r) => {
    const decisions = decisionsFor(db, r.id);
    const pending = decisions.some((d) => d.destination === 'evidence' && !d.sheet) ? [] : json<string[]>(r.sheet_names_json, []).filter((s) => !decisions.some((d) => d.sheet === s));
    const state = decisions.length && !pending.length ? 'confirmed' : 'needs_classification';
    return { ...r, state, decision: decisions[0] ?? null, revision: decisions.length, remaining_sheets: pending };
  }).filter((r) => !f.state || r.state === f.state);
  return { total: items.length, items: items.slice(f.offset || 0, (f.offset || 0) + (f.limit || 50)) };
}

export async function suggestUploadMapping(db: DB, id: string, llm: LlmClient | null, opts: { sheet?: string; dataset?: string }) {
  const info = await inspect(db, id, opts.sheet);
  if (!info.parsed) throw new HttpError(400, info.table_error || 'This file is not a supported table.');
  return suggestMapping(llm, { headers: info.parsed.headers, rows: info.parsed.rows.slice(0, 8), dataset: opts.dataset });
}

export async function confirmUpload(db: DB, dir: string, id: string, body: z.infer<typeof ConfirmUpload>) {
  const info = await inspect(db, id, body.sheet);
  if (decisionsFor(db, id).length !== body.expected_revision) throw new HttpError(409, 'This upload changed. Refresh it before confirming.');
  if (body.document_type === 'unclassified' && body.destination === 'evidence') throw new HttpError(400, 'Choose a document category, including Other if needed.');
  for (const l of body.links) assertEntity(db, l.entity_type, l.entity_id);
  if (body.destination === 'dataset' && (!body.dataset || !info.parsed)) throw new HttpError(400, info.table_error || 'Choose a supported table and its dataset.');
  return tx(db, () => {
    // Revision is checked again inside the same transaction as the source rows and decisions.
    const before = decisionsFor(db, id);
    if (before.length !== body.expected_revision) throw new HttpError(409, 'This upload changed. Refresh it before confirming.');
    const imported = body.destination === 'dataset' ? importParsedFile(db, dir, { filename: info.file.filename, bytes: info.bytes, dataset: body.dataset, mapping: body.mapping, sheet: body.sheet }, info.parsed!) : null;
    if (imported?.batch.status === 'rejected') throw new HttpError(400, 'No valid rows could be imported. Fix the table or mapping before confirming.', { errors: imported.batch.errors });
    const sheet = body.destination === 'dataset' ? info.parsed!.sheet : body.sheet || null;
    const decisionId = newId('udc');
    run(db, 'INSERT INTO upload_decisions (id, upload_id, destination, dataset, sheet, document_type, reporting_year, reviewer_label, import_batch_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', decisionId, id, body.destination, imported?.batch.dataset ?? null, sheet, body.document_type, body.reporting_year ?? null, body.reviewer_label, imported?.batch.id ?? null, nowIso());
    for (const l of body.links) linkEvidence(db, info.u.evidence_id, l.entity_type, l.entity_id, body.reviewer_label);
    const wholeFile = body.destination === 'evidence' && !sheet;
    const remaining = wholeFile ? [] : (info.parsed?.sheets || []).filter((s) => s !== sheet && !before.some((d) => d.sheet === s || (d.destination === 'evidence' && !d.sheet)));
    recordAudit(db, { event_type: 'upload.confirmed', actor_kind: 'reviewer', actor_label: body.reviewer_label, entity_type: 'upload', entity_id: id, after: { decision_id: decisionId, destination: body.destination, dataset: imported?.batch.dataset, sheet, document_type: body.document_type, reporting_year: body.reporting_year ?? null, remaining_sheets: remaining, links: body.links } });
    return { status: remaining.length ? 'needs_classification' : 'confirmed', decision_id: decisionId, remaining_sheets: remaining, imported };
  });
}

export function findUploadTargets(db: DB, type: EntityType, q: string): Target[] {
  const pattern = `%${q}%`;
  if (type === 'supplier' || type === 'material') {
    const table = type === 'supplier' ? 'suppliers' : 'materials';
    return all<{ record_key: string; payload_json: string }>(db, 'SELECT record_key, payload_json FROM source_records WHERE table_name = ? AND (record_key LIKE ? OR payload_json LIKE ?) GROUP BY record_key LIMIT 20', table, pattern, pattern).map((r) => {
      const p = json<Record<string, string>>(r.payload_json, {});
      return { entity_type: type, entity_id: p[`${type}_id`], label: `${p[`${type}_id`]} · ${p[`${type}_name`] || p.name || ''}` };
    });
  }
  if (type === 'shipment') return all<{ record_id: string; shipment_id: string }>(db, 'SELECT record_id, shipment_id FROM shipments WHERE shipment_id LIKE ? OR ref_doc LIKE ? LIMIT 20', pattern, pattern).map((r) => ({ entity_type: type, entity_id: r.record_id, label: r.shipment_id }));
  if (type === 'dq_issue') return all<{ id: string; record_key: string; issue_type: string }>(db, 'SELECT id, record_key, issue_type FROM dq_issues WHERE record_key LIKE ? OR id LIKE ? ORDER BY status = \'open\' DESC LIMIT 20', pattern, pattern).map((r) => ({ entity_type: type, entity_id: r.id, label: `${r.record_key} · ${r.issue_type}` }));
  if (type === 'source_record') return all<{ id: string; record_key: string }>(db, 'SELECT id, record_key FROM source_records WHERE record_key LIKE ? OR id LIKE ? LIMIT 20', pattern, pattern).map((r) => ({ entity_type: type, entity_id: r.id, label: r.record_key }));
  return all<{ id: string }>(db, 'SELECT id FROM route_proposals WHERE id LIKE ? LIMIT 20', pattern).map((r) => ({ entity_type: type, entity_id: r.id, label: r.id }));
}

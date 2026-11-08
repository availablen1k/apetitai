// Local reading of evidence documents. Text is extracted on this machine so that anything an AI
// later "reads" in a document can be checked against the document's own text.
//  - PDF (text layer) via pdfjs-dist, Word .docx via mammoth, plain text / HTML / e-mail / JSON / XML,
//    Excel .xlsx via exceljs.
//  - Legacy and other office formats (.doc .xls .ppt .pptx .odt .ods .odp .rtf) are converted to PDF
//    with LibreOffice when `soffice` is available; otherwise they are stored without text.
//  - Images and scanned PDFs have no text layer. Optional OCR is handled separately by ocr.ts;
//    a machine transcription never counts as verified source text.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import mammoth from 'mammoth';
import { decodeText } from './csv.ts';

export type DocKind = 'pdf' | 'docx' | 'text' | 'html' | 'spreadsheet' | 'office' | 'image' | 'other';
export type Page = { page: number | null; text: string };
export type TextResult = {
  status: 'extracted' | 'converted_and_extracted' | 'no_text_layer' | 'not_readable_locally' | 'failed';
  method: string | null;
  pages: Page[];
  page_count: number | null;
  error?: string;
  converted_pdf?: Uint8Array;
};

const EXT: Record<string, { kind: DocKind; mime: string }> = {
  '.pdf': { kind: 'pdf', mime: 'application/pdf' },
  '.docx': { kind: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  '.txt': { kind: 'text', mime: 'text/plain' },
  '.md': { kind: 'text', mime: 'text/markdown' },
  '.csv': { kind: 'text', mime: 'text/csv' },
  '.tsv': { kind: 'text', mime: 'text/tab-separated-values' },
  '.json': { kind: 'text', mime: 'application/json' },
  '.xml': { kind: 'text', mime: 'application/xml' },
  '.eml': { kind: 'text', mime: 'message/rfc822' },
  '.html': { kind: 'html', mime: 'text/html' },
  '.htm': { kind: 'html', mime: 'text/html' },
  '.xlsx': { kind: 'spreadsheet', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  '.doc': { kind: 'office', mime: 'application/msword' },
  '.xls': { kind: 'office', mime: 'application/vnd.ms-excel' },
  '.ppt': { kind: 'office', mime: 'application/vnd.ms-powerpoint' },
  '.pptx': { kind: 'office', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
  '.odt': { kind: 'office', mime: 'application/vnd.oasis.opendocument.text' },
  '.ods': { kind: 'office', mime: 'application/vnd.oasis.opendocument.spreadsheet' },
  '.odp': { kind: 'office', mime: 'application/vnd.oasis.opendocument.presentation' },
  '.rtf': { kind: 'office', mime: 'application/rtf' },
  '.png': { kind: 'image', mime: 'image/png' },
  '.jpg': { kind: 'image', mime: 'image/jpeg' },
  '.jpeg': { kind: 'image', mime: 'image/jpeg' },
  '.webp': { kind: 'image', mime: 'image/webp' },
  '.gif': { kind: 'image', mime: 'image/gif' },
  '.heic': { kind: 'image', mime: 'image/heic' },
  '.heif': { kind: 'image', mime: 'image/heif' },
  '.tif': { kind: 'image', mime: 'image/tiff' },
  '.tiff': { kind: 'image', mime: 'image/tiff' },
  '.bmp': { kind: 'image', mime: 'image/bmp' },
};

export function detectDocument(filename: string, bytes: Uint8Array): { kind: DocKind; mime: string } {
  const ext = path.extname(filename).toLowerCase();
  const byExt = EXT[ext];
  // Magic numbers win over a wrong extension for the two formats we parse as binaries.
  if (bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return EXT['.pdf'];
  if (byExt) return byExt;
  return { kind: 'other', mime: 'application/octet-stream' };
}

const MAX_TEXT = 1_000_000;
const clip = (pages: Page[]) => {
  let left = MAX_TEXT;
  return pages.map((p) => {
    const t = p.text.slice(0, Math.max(0, left));
    left -= t.length;
    return { page: p.page, text: t };
  });
};

async function pdfText(bytes: Uint8Array): Promise<{ pages: Page[]; count: number }> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: new Uint8Array(bytes), disableFontFace: true, useSystemFonts: false, verbosity: 0 });
  const doc = await task.promise;
  const pages: Page[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    const text = content.items.map((it) => ('str' in it ? it.str + (it.hasEOL ? '\n' : ' ') : '')).join('').replace(/[ \t]+/g, ' ').trim();
    pages.push({ page: i, text });
  }
  const count = doc.numPages;
  await task.destroy();
  return { pages, count };
}

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

async function xlsxText(bytes: Uint8Array): Promise<Page[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  return wb.worksheets.map((ws, i) => {
    const lines: string[] = [`# Sheet: ${ws.name}`];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const vals = (row.values as ExcelJS.CellValue[]).slice(1).map((v) => {
        if (v === null || v === undefined) return '';
        if (v instanceof Date) return v.toISOString().slice(0, 10);
        if (typeof v === 'object') {
          const o = v as unknown as Record<string, unknown>;
          if ('result' in o) return String(o.result ?? '');
          if ('richText' in o && Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((t) => t.text).join('');
          if ('text' in o) return String(o.text);
          return '';
        }
        return String(v);
      });
      lines.push(vals.join('\t'));
    });
    return { page: i + 1, text: lines.join('\n') };
  });
}

export function libreOfficeBinary(): string | null {
  const configured = process.env.LIBREOFFICE_PATH;
  if (configured) return fs.existsSync(configured) ? configured : null;
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    for (const name of ['soffice', 'libreoffice']) {
      const p = path.join(dir, name);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

function convertWithLibreOffice(bin: string, filename: string, bytes: Uint8Array): Promise<Uint8Array> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'traceflow-lo-'));
  const safe = `input${path.extname(filename).toLowerCase().replace(/[^a-z.]/g, '')}`;
  const input = path.join(dir, safe);
  fs.writeFileSync(input, bytes);
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      [`-env:UserInstallation=file://${path.join(dir, 'profile')}`, '--headless', '--norestore', '--convert-to', 'pdf', '--outdir', dir, input],
      { timeout: 90_000 },
      (err) => {
        try {
          const out = path.join(dir, 'input.pdf');
          if (err || !fs.existsSync(out)) return reject(new Error(err ? err.message : 'LibreOffice produced no PDF'));
          resolve(new Uint8Array(fs.readFileSync(out)));
        } finally {
          setTimeout(() => fs.rmSync(dir, { recursive: true, force: true }), 0);
        }
      },
    );
  });
}

export async function extractText(filename: string, bytes: Uint8Array, kind: DocKind): Promise<TextResult> {
  try {
    if (kind === 'pdf') {
      const { pages, count } = await pdfText(bytes);
      const chars = pages.reduce((s, p) => s + p.text.length, 0);
      return chars < 20 ? { status: 'no_text_layer', method: 'pdfjs-dist', pages: [], page_count: count } : { status: 'extracted', method: 'pdfjs-dist', pages: clip(pages), page_count: count };
    }
    if (kind === 'docx') {
      const r = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
      return { status: 'extracted', method: 'mammoth', pages: clip([{ page: null, text: r.value.trim() }]), page_count: null };
    }
    if (kind === 'text' || kind === 'html') {
      const { text } = decodeText(bytes);
      return { status: 'extracted', method: kind === 'html' ? 'html-to-text' : 'text', pages: clip([{ page: null, text: kind === 'html' ? htmlToText(text) : text }]), page_count: null };
    }
    if (kind === 'spreadsheet') {
      const pages = await xlsxText(bytes);
      return { status: 'extracted', method: 'exceljs', pages: clip(pages), page_count: pages.length };
    }
    if (kind === 'office') {
      const bin = libreOfficeBinary();
      if (!bin) return { status: 'not_readable_locally', method: null, pages: [], page_count: null, error: 'LibreOffice (soffice) not found; convert the file to PDF or DOCX to read it' };
      const pdf = await convertWithLibreOffice(bin, filename, bytes);
      const { pages, count } = await pdfText(pdf);
      return { status: 'converted_and_extracted', method: 'libreoffice→pdfjs-dist', pages: clip(pages), page_count: count, converted_pdf: pdf };
    }
    if (kind === 'image') return { status: 'no_text_layer', method: null, pages: [], page_count: null };
    return { status: 'not_readable_locally', method: null, pages: [], page_count: null };
  } catch (e) {
    return { status: 'failed', method: null, pages: [], page_count: null, error: (e as Error).message.slice(0, 300) };
  }
}

// --- quote verification -------------------------------------------------------------------
const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[‐-―−]/g, '-').replace(/\s+/g, ' ').trim();
const numberVariants = (v: string) => {
  const t = v.trim();
  const out = new Set([t]);
  if (/^[+-]?\d+([.,]\d+)?(?:e[+-]?\d+)?$/i.test(t)) {
    out.add(t.replace(',', '.'));
    out.add(t.replace('.', ','));
  }
  return [...out].map(norm);
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const unitKey = (s: string) => norm(s)
  .replace(/\bkilograms?\b/g, 'kg').replace(/\bgrams?\b/g, 'g').replace(/\b(?:tonnes?|metric tons?)\b/g, 't')
  .replace(/\b(?:kilometres?|kilometers?)\b/g, 'km').replace(/\b(?:litres?|liters?)\b/g, 'l')
  .replace(/\bper\b/g, '/').replace(/co2\s*(?:eq(?:uivalent)?|e)\b/g, 'co2e');

export type Verification = 'verified_in_text' | 'quote_not_found' | 'value_not_in_quote' | 'unit_not_in_quote' | 'no_local_text';

// The quote must occur in the document's own text, and the value must occur in the quote.
export function verifyQuote(pages: Page[], quote: string, value: string | null, page: number | null, unit?: string | null): { status: Verification; found_on_page: number | null } {
  if (!pages.length || !pages.some((p) => p.text.length)) return { status: 'no_local_text', found_on_page: null };
  const q = norm(quote || '');
  if (q.length < 3) return { status: 'quote_not_found', found_on_page: null };
  const ordered = page !== null ? [...pages.filter((p) => p.page === page), ...pages.filter((p) => p.page !== page)] : pages;
  const quoteStart = /^\d/.test(q) ? '(?<![\\p{L}\\p{N}_.,+\\-])' : /^[\p{L}\p{N}_]/u.test(q) ? '(?<![\\p{L}\\p{N}_])' : '';
  const quoteEnd = /[\p{L}\p{N}_]$/u.test(q) ? '(?![\\p{L}\\p{N}_]|[.,]\\d)' : '';
  const quoteRe = new RegExp(`${quoteStart}${escapeRe(q)}${quoteEnd}`, 'u');
  const hit = ordered.find((p) => quoteRe.test(norm(p.text)));
  if (!hit) return { status: 'quote_not_found', found_on_page: null };
  if (value !== null && value !== '') {
    // Whole tokens only: 12 must not match 120, -12, 0.12, 12e3 or an identifier such as SUP12.
    const variants = numberVariants(norm(value));
    const numeric = /^[+-]?\d[\d .,]*(?:e[+-]?\d+)?$/i.test(norm(value));
    const matches = numeric
      ? [...q.matchAll(/(?<![\p{L}\p{N}_.,+\-])[+-]?(?:\d{1,3}(?: \d{3})+|\d+)(?:[.,]\d+)*(?:e[+-]?\d+)?(?![\p{L}\p{N}_]|[.,]\d)/gu)].filter((m) => variants.includes(m[0]))
      : variants.flatMap((v) => [...q.matchAll(new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRe(v)}(?![\\p{L}\\p{N}_])`, 'gu'))]);
    if (!matches.length) return { status: 'value_not_in_quote', found_on_page: hit.page };
    if (unit) {
      const wanted = unitKey(unit).replace(/\s+/g, '');
      const unitRe = new RegExp(`^[\\s(:=]*${[...wanted].map(escapeRe).join('\\s*')}(?![\\p{L}\\p{N}_/]|\\s*(?:/|co2(?:e|eq)?\\b))`, 'u');
      if (!wanted || !matches.some((m) => unitRe.test(unitKey(q.slice(m.index! + m[0].length))))) return { status: 'unit_not_in_quote', found_on_page: hit.page };
    }
  }
  return { status: 'verified_in_text', found_on_page: hit.page };
}

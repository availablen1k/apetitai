// Optional local OCR. Original bytes and text remain immutable; each reading is saved separately.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Page } from './documents.ts';

const exec = promisify(execFile);
const MAX_PAGES = 20;

function executable(name: string, envKey: string): string | null {
  const configured = process.env[envKey];
  const candidates = configured ? [configured] : [...(process.env.PATH || '').split(path.delimiter).map((p) => path.join(p, name)), path.resolve('data/tools', name)];
  return candidates.find((p) => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } }) ?? null;
}

export function ocrCapabilities() {
  return { images: !!executable('tesseract', 'TESSERACT_PATH'), pdf: !!executable('tesseract', 'TESSERACT_PATH') && !!executable('pdftoppm', 'PDFTOPPM_PATH'), max_pages: MAX_PAGES, languages: process.env.OCR_LANGUAGES || 'eng' };
}

export type OcrResult = { status: 'completed' | 'failed' | 'unavailable'; method: string; pages: Page[]; page_count: number | null; error: string | null };

export async function readOcr(filename: string, bytes: Uint8Array, kind: string, pageCount: number | null): Promise<OcrResult> {
  const bin = executable('tesseract', 'TESSERACT_PATH');
  const raster = executable('pdftoppm', 'PDFTOPPM_PATH');
  const method = kind === 'pdf' ? 'pdftoppm+tesseract' : 'tesseract';
  const fail = (status: 'failed' | 'unavailable', error: string): OcrResult => ({ status, method, pages: [], page_count: pageCount, error });
  if (kind !== 'pdf' && kind !== 'image') return fail('failed', 'Local OCR takes PDFs and images. Other documents already use their text readers.');
  if (!bin || (kind === 'pdf' && !raster)) return fail('unavailable', 'Local OCR needs Tesseract (and pdftoppm for PDFs). On Fedora: sudo dnf install tesseract tesseract-langpack-eng poppler-utils');
  // Reject large/unknown PDF page counts rather than quietly reading only a prefix.
  if (kind === 'pdf' && (pageCount === null || pageCount > MAX_PAGES)) return fail('failed', `Local OCR supports PDFs of up to ${MAX_PAGES} pages. Split a larger PDF into smaller files.`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'traceflow-ocr-'));
  try {
    const ext = kind === 'pdf' ? '.pdf' : path.extname(filename).toLowerCase().replace(/[^a-z0-9.]/g, '') || '.png';
    const input = path.join(dir, `input${ext}`);
    fs.writeFileSync(input, bytes);
    let images = [input];
    if (kind === 'pdf') {
      await exec(raster!, ['-f', '1', '-l', String(MAX_PAGES), '-scale-to', '2000', '-gray', '-png', input, path.join(dir, 'page')], { timeout: 60_000, maxBuffer: 1024 * 1024 });
      images = fs.readdirSync(dir).filter((f) => /^page-\d+\.png$/.test(f)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map((f) => path.join(dir, f));
      if (images.length !== pageCount) throw new Error('Not every PDF page was rendered; no partial OCR result is saved.');
    }
    const pages: Page[] = [];
    const deadline = Date.now() + 90_000;
    for (let i = 0; i < images.length; i++) {
      if (Date.now() >= deadline) throw new Error('OCR timed out; no partial result is saved.');
      const { stdout } = await exec(bin, [images[i], 'stdout', '-l', process.env.OCR_LANGUAGES || 'eng', '--psm', '3'], { timeout: Math.min(30_000, deadline - Date.now()), maxBuffer: 1024 * 1024 });
      pages.push({ page: kind === 'pdf' ? i + 1 : null, text: stdout.trim() });
    }
    if (!pages.some((p) => p.text.length)) throw new Error('OCR found no readable text.');
    return { status: 'completed', method, pages, page_count: kind === 'pdf' ? pages.length : null, error: null };
  } catch (e) {
    return fail('failed', (e as Error).message.slice(0, 500));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

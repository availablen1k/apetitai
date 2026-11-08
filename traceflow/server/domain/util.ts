import crypto from 'node:crypto';

export const sha256 = (data: string | Uint8Array) => crypto.createHash('sha256').update(data).digest('hex');

export const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;

// Locale-tolerant number parsing for source values: Finnish/Swedish decimal comma,
// space or no-break-space thousands separators, and "1.234,56" / "1,234.56" forms.
export function parseNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let s = String(value).trim().replace(/[\s  ]/g, '');
  if (!s) return null;
  s = s.replace(/^\+/, '').replace(/−/g, '-');
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    s = (s.match(/,/g) || []).length > 1 ? s.replace(/,/g, '') : s.replace(',', '.');
  }
  if (!/^-?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export const num0 = (value: unknown) => parseNumber(value) ?? 0;

export function parseBool(value: unknown): boolean | null {
  const s = String(value ?? '').trim().toLowerCase();
  if (['true', '1', 'yes', 'kyllä', 'ja', 'y'].includes(s)) return true;
  if (['false', '0', 'no', 'ei', 'nej', 'n'].includes(s)) return false;
  return null;
}

export const round = (n: number, d = 6) => {
  const f = 10 ** d;
  return Math.round(n * f) / f;
};

export function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = out.get(k);
    if (list) list.push(item);
    else out.set(k, [item]);
  }
  return out;
}

// Year from ISO dates (2025-03-15), Nordic dates (15.3.2025, 15/03/2025) or a bare year.
export const yearFromDate = (value: unknown): number | null => {
  const s = String(value ?? '').trim();
  const m = s.match(/^(\d{4})(?:[-/.]|$|T)/) || s.match(/^\d{1,2}[./-]\d{1,2}[./-](\d{4})\b/);
  return m ? Number(m[1]) : null;
};

// Strips control characters and caps length for free-text labels typed by a reviewer.
export function sanitizeLabel(value: unknown, max = 80): string {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

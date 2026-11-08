// "Every figure is checked before you see it": any number a model writes must match a value it
// was given (exactly as displayed, or that value rounded to 2–3 significant figures or to the
// written precision). Identifiers (CO2, R404A, CA01, L08), years and "Scope 1/2/3" are not figures.

const TOKEN = /(?<![\p{L}\p{N}_-])[-−]?(?:\d{1,3}(?:[, .  ]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)(?![\p{L}\p{N}_])/gu;

export type FigureCheck = { ok: boolean; checked: number; rejected: string[] };

// Parses "1 234,5", "1,234.5", "1234.5", "−4.49" (thousands and decimal marks in FI or EN style).
export function parseFigure(raw: string): { value: number; decimals: number } | null {
  let s = raw.replace(/[   ]/g, '').replace('−', '-');
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    const dec = lastComma > lastDot ? ',' : '.';
    s = s.replace(new RegExp(`\\${dec === ',' ? '.' : ','}`, 'g'), '').replace(dec, '.');
  } else if (lastComma >= 0) {
    s = /^-?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (lastDot >= 0 && /^-?\d{1,3}(\.\d{3}){2,}$/.test(s)) {
    s = s.replace(/\./g, '');
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return { value: Number(s), decimals: s.includes('.') ? s.split('.')[1].length : 0 };
}

const sig = (v: number, digits: number) => (v === 0 ? 0 : Number(v.toPrecision(digits)));

function matches(found: { value: number; decimals: number }, allowed: number[]) {
  const x = Math.abs(found.value);
  return allowed.some((a) => {
    if (found.value < 0 && a >= 0) return false;
    const y = Math.abs(a);
    if (Math.abs(x - Number(y.toFixed(found.decimals))) < 1e-9) return true;
    return [2, 3].some((d) => Math.abs(x - sig(y, d)) < 1e-9 * Math.max(1, y));
  });
}

function exempt(text: string, index: number, raw: string, value: number) {
  const before = text.slice(Math.max(0, index - 12), index).toLowerCase();
  if (/(scope|kategoria|category|cat\.?|luokka)\s*$/.test(before) && value >= 1 && value <= 15) return true;
  return false;
}

export function checkFigures(text: string, allowed: number[]): FigureCheck {
  const rejected: string[] = [];
  // These formats are outside the numeric checker; withhold them instead of silently skipping.
  for (const m of text.matchAll(/(?<![\p{L}\p{N}_-])[-−]?\d+(?:[.,]\d+)?(?:e[-+]?\d+|\s*(?:million|billion|thousand|miljoona\w*|miljardi\w*))(?![\p{L}\p{N}_-])/giu)) rejected.push(m[0]);
  let checked = 0;
  for (const m of text.matchAll(TOKEN)) {
    const raw = m[0].trim().replace(/[,.]$/, '');
    const parsed = parseFigure(raw);
    if (!parsed || exempt(text, m.index ?? 0, raw, parsed.value)) continue;
    checked++;
    if (!matches(parsed, allowed)) rejected.push(raw);
  }
  return { ok: rejected.length === 0, checked, rejected };
}

// Every number inside a tool result or fact object, recursively (strings are parsed too).
export function collectFigures(value: unknown, out: number[] = []): number[] {
  if (typeof value === 'number' && Number.isFinite(value)) out.push(value);
  else if (typeof value === 'string') for (const m of value.matchAll(TOKEN)) { const p = parseFigure(m[0].trim().replace(/[,.]$/, '')); if (p) out.push(p.value); }
  else if (Array.isArray(value)) value.forEach((v) => collectFigures(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => collectFigures(v, out));
  return out;
}

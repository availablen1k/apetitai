// RFC 4180 CSV parser with delimiter detection, BOM handling, quoted newlines and
// per-record line numbers. Rows with the wrong number of fields are rejected with the
// physical line where the record starts; nothing is silently truncated.

export type ParsedTable = {
  headers: string[];
  rows: string[][];
  rowLines: number[];
  rejected: { line: number; reason: string; raw?: string }[];
  delimiter: string;
  encoding: string;
};

const CANDIDATES = [',', ';', '\t', '|'];

export function decodeText(buf: Uint8Array): { text: string; encoding: string } {
  let bytes = buf;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) bytes = bytes.subarray(3);
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' };
  } catch {
    // Finnish/Swedish Excel exports are often Windows-1252.
    return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252' };
  }
}

export function detectDelimiter(text: string): string {
  // Count candidates in the first logical line, outside quotes.
  const counts = new Map<string, number>(CANDIDATES.map((c) => [c, 0]));
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === '\n' || ch === '\r')) break;
    else if (!quoted && counts.has(ch)) counts.set(ch, (counts.get(ch) || 0) + 1);
  }
  let best = ',';
  let bestCount = 0;
  for (const [c, n] of counts) {
    if (n > bestCount) {
      best = c;
      bestCount = n;
    }
  }
  return best;
}

type RawRecord = { fields: string[]; line: number; raw: string };

function tokenize(text: string, delimiter: string): { records: RawRecord[]; error?: { line: number; reason: string } } {
  const records: RawRecord[] = [];
  let fields: string[] = [];
  let field = '';
  let quoted = false;
  let fieldStarted = false;
  let line = 1;
  let recordLine = 1;
  let recordStart = 0;
  const pushRecord = (end: number) => {
    fields.push(field);
    const blank = fields.length === 1 && fields[0] === '';
    if (!blank) records.push({ fields, line: recordLine, raw: text.slice(recordStart, end) });
    fields = [];
    field = '';
    fieldStarted = false;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else {
        if (ch === '\n') line++;
        else if (ch === '\r' && text[i + 1] !== '\n') line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"' && !fieldStarted) {
      quoted = true;
      fieldStarted = true;
    } else if (ch === delimiter) {
      fields.push(field);
      field = '';
      fieldStarted = false;
    } else if (ch === '\n' || ch === '\r') {
      pushRecord(i);
      if (ch === '\r' && text[i + 1] === '\n') i++;
      line++;
      recordLine = line;
      recordStart = i + 1;
    } else {
      field += ch;
      fieldStarted = true;
    }
  }
  if (quoted) return { records, error: { line: recordLine, reason: 'Unterminated quoted field' } };
  if (field !== '' || fields.length) pushRecord(text.length);
  return { records };
}

export function parseCsv(input: Uint8Array | string, opts: { delimiter?: string } = {}): ParsedTable {
  const { text, encoding } = typeof input === 'string' ? { text: input.replace(/^﻿/, ''), encoding: 'utf-8' } : decodeText(input);
  const delimiter = opts.delimiter || detectDelimiter(text);
  const { records, error } = tokenize(text, delimiter);
  const rejected: ParsedTable['rejected'] = [];
  if (error) rejected.push({ line: error.line, reason: error.reason });
  if (!records.length) return { headers: [], rows: [], rowLines: [], rejected, delimiter, encoding };
  const headers = records[0].fields.map((h) => h.trim());
  const rows: string[][] = [];
  const rowLines: number[] = [];
  for (const rec of records.slice(1)) {
    if (rec.fields.length !== headers.length) {
      // A trailing empty field from a line ending in the delimiter is tolerated.
      const trimmed = rec.fields.length === headers.length + 1 && rec.fields[rec.fields.length - 1] === '' ? rec.fields.slice(0, -1) : null;
      if (!trimmed) {
        rejected.push({ line: rec.line, reason: `Expected ${headers.length} fields, found ${rec.fields.length}`, raw: rec.raw.slice(0, 300) });
        continue;
      }
      rows.push(trimmed);
    } else rows.push(rec.fields);
    rowLines.push(rec.line);
  }
  return { headers, rows, rowLines, rejected, delimiter, encoding };
}

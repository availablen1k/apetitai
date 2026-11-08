// Excel (.xlsx) sheet reading with exceljs. Cell values are converted to the text a user
// sees, so the stored payload matches what a CSV export of the same sheet would contain.
import ExcelJS from 'exceljs';

export type SheetTable = {
  sheet: string;
  headers: string[];
  rows: string[][];
  rowLines: number[];
  rejected: { line: number; reason: string }[];
  sheets: string[];
};

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    const iso = value.toISOString();
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso;
  }
  if (typeof value === 'object') {
    const v = value as unknown as Record<string, unknown>;
    if ('result' in v) return cellText(v.result as ExcelJS.CellValue);
    if ('richText' in v && Array.isArray(v.richText)) return (v.richText as { text: string }[]).map((t) => t.text).join('');
    if ('text' in v) return String(v.text);
    if ('error' in v) return String(v.error);
    return '';
  }
  return String(value);
}

export async function readXlsx(buf: Uint8Array, sheetName?: string): Promise<SheetTable> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const sheets = wb.worksheets.map((w) => w.name);
  const ws = sheetName ? wb.getWorksheet(sheetName) : wb.worksheets.find((w) => w.actualRowCount > 0);
  if (!ws) throw new Error(sheetName ? `Sheet "${sheetName}" not found. Sheets: ${sheets.join(', ')}` : 'Workbook has no non-empty sheet');
  let headerRow = 0;
  let headers: string[] = [];
  const rows: string[][] = [];
  const rowLines: number[] = [];
  const rejected: SheetTable['rejected'] = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const values = (row.values as ExcelJS.CellValue[]).slice(1).map(cellText);
    if (!headerRow) {
      headerRow = rowNumber;
      headers = values.map((h) => h.trim());
      return;
    }
    const cells = headers.map((_, i) => values[i] ?? '');
    if (values.slice(headers.length).some((c) => c !== '')) {
      rejected.push({ line: rowNumber, reason: `Row has values beyond the ${headers.length} header columns` });
      return;
    }
    if (cells.every((c) => c === '')) return;
    rows.push(cells);
    rowLines.push(rowNumber);
  });
  return { sheet: ws.name, headers, rows, rowLines, rejected, sheets };
}

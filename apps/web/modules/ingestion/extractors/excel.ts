/**
 * Excel (.xlsx) → canonical documents. Pure in the sense that matters: no I/O,
 * no database, no clock, no randomness. `async` only because the workbook
 * reader is stream-shaped.
 *
 * The FIRST worksheet only, and its first row is the header. A workbook with
 * several sheets is ambiguous about which one is the invoice register, and
 * picking one by guessing which looks most invoice-like is the sort of
 * cleverness that reads the wrong sheet in silence.
 *
 * Every cell is read as TEXT. Excel stores `19.99` as a float and stores dates
 * as serial numbers; letting either through as a number would put binary
 * rounding into a tax amount. Dates are required in ISO form — see `tabular.ts`
 * for why an ambiguous date is refused rather than guessed.
 */

import ExcelJS from 'exceljs';
import type { ExtractionResult, Extractor } from '../canonical';
import { extractTabular } from './tabular';
import type { TabularRow } from './tabular';

function cellToText(cell: ExcelJS.Cell): string {
  const value: unknown = cell.value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);

  if (typeof value === 'object') {
    // Hyperlink and rich-text cells carry their display string; formula cells
    // carry the cached result. Anything else is a shape we do not recognise,
    // and '' is the honest answer — `tabular.ts` reports the row as a defect
    // rather than inventing a value for it.
    const record = value as Record<string, unknown>;
    if (typeof record.text === 'string') return record.text.trim();
    if (Array.isArray(record.richText)) {
      return record.richText
        .map((part) => (typeof (part as { text?: unknown }).text === 'string'
          ? (part as { text: string }).text
          : ''))
        .join('')
        .trim();
    }
    const result: unknown = record.result;
    if (typeof result === 'string') return result.trim();
    if (typeof result === 'number' || typeof result === 'boolean') return String(result);
    if (result instanceof Date) return result.toISOString().slice(0, 10);
  }
  return '';
}

const parseErrorFor = (sourceRef: string): ExtractionResult => ({
  documents: [],
  defects: [{ defectClass: 'parse_error', sourceRef, sampleShape: null }],
});

export const extractExcel: Extractor = async (bytes, opts) => {
  const workbook = new ExcelJS.Workbook();
  try {
    // exceljs types this parameter as a Node Buffer; the implementation accepts
    // any ArrayBuffer-like input, and the extractor contract is `Uint8Array` so
    // that it stays independent of the Node Buffer type.
    await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
  } catch {
    return parseErrorFor('file');
  }

  const sheet = workbook.worksheets[0];
  if (sheet === undefined) return parseErrorFor('file');

  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber - 1] = cellToText(cell);
  });

  const named = headers.filter((header) => header !== '');
  if (named.length === 0) return parseErrorFor('header');

  const records: TabularRow[] = [];
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const record: Record<string, string> = {};
    headers.forEach((header, columnIndex) => {
      if (header === '') return;
      record[header] = cellToText(row.getCell(columnIndex + 1));
    });
    // A wholly blank row is spacing, not a document. Derived rather than
    // tracked in a flag: TypeScript does not narrow a `let` assigned inside a
    // callback, so the flag would read as its initialiser here.
    if (Object.values(record).some((cell) => cell !== '')) records.push(record);
  }

  return extractTabular(records, named, opts);
};

/**
 * CSV → canonical documents. Pure: bytes in, documents and defects out.
 *
 * `csv-parse` rather than a hand-rolled split: quoted fields containing commas
 * and embedded newlines are exactly where a hand-rolled parser silently
 * misaligns columns, and a misaligned column is a wrong answer with an invoice
 * number attached to someone else's amount.
 *
 * The row → document mapping lives in `tabular.ts`, shared with Excel.
 */

import { parse } from 'csv-parse/sync';
import type { ExtractionResult, Extractor } from '../canonical';
import { extractTabular } from './tabular';
import type { TabularRow } from './tabular';

/**
 * U+FEFF. Excel writes a UTF-8 BOM; left in place it turns the first header
 * into an invisible variant of itself and every column lookup misses.
 */
const BOM = '\u{FEFF}';

const parseErrorFor = (sourceRef: string): ExtractionResult => ({
  documents: [],
  defects: [{ defectClass: 'parse_error', sourceRef, sampleShape: null }],
});

export const extractCsv: Extractor = (bytes, opts) => {
  const decoded = new TextDecoder('utf-8').decode(bytes);
  const text = decoded.startsWith(BOM) ? decoded.slice(1) : decoded;

  let records: TabularRow[];
  try {
    records = parse(text, {
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
      bom: true,
      trim: true,
      cast: false,             // every value stays a string; see money.ts
    });
  } catch {
    return Promise.resolve(parseErrorFor('file'));
  }

  const headers = Object.keys(records[0] ?? {});
  if (headers.length === 0) {
    return Promise.resolve(parseErrorFor('header'));
  }

  return Promise.resolve(extractTabular(records, headers, opts));
};

/**
 * Extractor dispatch. architecture.md Part IV §4 job 2: `ingest.normalise`
 * dispatches to the extractor for `entity.sourceSystem`.
 *
 * Adding a source system means adding one pure function and one entry here.
 * Part II · M1: Tally Prime first (Week 5), then CSV/Excel. NetSuite and
 * Dynamics BC land Week 11 — CLAUDE.md §4.5 forbids a general-purpose ERP
 * integration platform: **build five specific extractors that work perfectly.**
 */

import type { SourceSystemVendor } from '@repo/db/schema/_shared';
import type { Extractor } from '../canonical';
import { extractCsv } from './csv';
import { extractExcel } from './excel';
import { extractTally } from './tally';

/** How the file was encoded, independent of which ERP produced it. */
export type SourceFormat = 'tally_xml' | 'csv' | 'xlsx';

const EXTRACTORS: Readonly<Record<SourceFormat, Extractor>> = {
  tally_xml: extractTally,
  csv: extractCsv,
  xlsx: extractExcel,
};

export class UnsupportedSource extends Error {
  public override readonly name = 'UnsupportedSource';
}

/**
 * Format from the vendor and the MIME type. The vendor decides first — a Tally
 * export is XML, but so is a UBL document, and they are not the same file.
 */
export function detectFormat(
  vendor: SourceSystemVendor,
  mimeType: string,
  filename: string,
): SourceFormat {
  if (vendor === 'tally') return 'tally_xml';

  const lower = filename.toLowerCase();
  if (mimeType.includes('spreadsheet') || lower.endsWith('.xlsx')) return 'xlsx';
  if (mimeType.includes('csv') || lower.endsWith('.csv')) return 'csv';
  if (mimeType.includes('xml') || lower.endsWith('.xml')) return 'tally_xml';

  throw new UnsupportedSource(
    `No extractor for vendor "${vendor}" with mime type "${mimeType}". ` +
      'M1 ships Tally Prime, CSV and Excel; NetSuite and Dynamics BC land Week 11. ' +
      'architecture.md Part II · M1.',
  );
}

export function extractorFor(format: SourceFormat): Extractor {
  return EXTRACTORS[format];
}

export { extractCsv, extractExcel, extractTally };
export { extractTabular } from './tabular';
export type { TabularRow } from './tabular';

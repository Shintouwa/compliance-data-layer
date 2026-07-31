/**
 * The canonical document — EN 16931 semantic model, source-system agnostic.
 * architecture.md Part I §2.5, Part IV §4 job 2.
 *
 * This is what every extractor produces and the only shape the rest of the
 * pipeline knows about. Adding a source system means adding an extractor, never
 * touching anything downstream.
 *
 * Part I §1.10: **every function that touches a raw invoice value lives in
 * `modules/ingestion` or `apps/validator`, and never returns a raw value to any
 * caller.** The canonical document is the one place inside this module where
 * raw values legitimately exist; nothing here may hand one to another module.
 */

import { createHash } from 'node:crypto';
import type { DefectClass, DocType, Scenario } from '@repo/db/schema/client-data';
import type { ValueShape } from '@repo/db/schema/_shared';

export interface CanonicalLine {
  readonly lineNumber: number;
  readonly description: string | null;      // BT-153
  /** Decimal as a STRING. Never a float — 0.1 + 0.2 is a rejected invoice. */
  readonly quantity: string | null;         // BT-129
  readonly unitCode: string | null;         // BT-130
  readonly netAmountMinor: number | null;   // BT-131
  readonly taxCategoryCode: string | null;  // BT-151
  readonly taxRate: string | null;          // BT-152
}

export interface CanonicalDoc {
  readonly docType: DocType;
  readonly scenario: Scenario;
  readonly invoiceNumber: string;           // BT-1
  /** ISO 8601 date, `YYYY-MM-DD`. */
  readonly issueDate: string;               // BT-2
  readonly currency: string;                // BT-5
  readonly buyerName: string | null;        // BT-44
  readonly buyerTrn: string | null;         // BT-48
  readonly sellerTrn: string | null;        // BT-31
  readonly predecessorRef: string | null;   // BT-25
  readonly lineExtensionMinor: number | null;  // BT-106
  readonly taxAmountMinor: number | null;      // BT-110
  readonly payableMinor: number | null;        // BT-115
  readonly hasAllowanceCharge: boolean;
  readonly hasMultiTaxRate: boolean;
  readonly lines: readonly CanonicalLine[];
  /**
   * Where in the source this came from — a row number, a voucher index, a sheet
   * name. Used to report a defect without quoting a value.
   */
  readonly sourceRef: string;
}

/**
 * A row the extractor could not turn into a document, or a quality problem it
 * observed on the way. **Partial failure is permitted and expected**: a 300-row
 * Tally export with 12 unparseable rows records 288 invoices plus 12
 * `master_data_defect` rows. **Never fail the whole run for a subset of bad
 * rows — the bad rows *are* the product.** Part IV §4 job 2.
 */
export interface ExtractionDefect {
  readonly defectClass: DefectClass;
  readonly sourceRef: string;
  /** Shape only. A raw value here would defeat the entire redaction design. */
  readonly sampleShape: ValueShape | null;
}

export interface ExtractionResult {
  readonly documents: readonly CanonicalDoc[];
  readonly defects: readonly ExtractionDefect[];
}

export interface ExtractorOptions {
  /**
   * Default when the source does not state one. Tally exports frequently omit
   * the currency on domestic vouchers.
   */
  readonly defaultCurrency: string;
}

/**
 * `(bytes, opts) => CanonicalDoc[]`. **Pure**: no I/O, no database, no clock,
 * no randomness — the same bytes produce the same documents on every machine,
 * forever. That is what makes `docHash` a stable corpus key and what makes
 * these functions trivially unit-testable.
 *
 * `Promise` rather than a plain return only because the XLSX reader is
 * async-by-construction; nothing here awaits anything outside its own input.
 */
export type Extractor = (
  bytes: Uint8Array,
  opts: ExtractorOptions,
) => Promise<ExtractionResult>;

/* -------------------------------------------------------------------------- */
/* docHash                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * `docHash = sha256(canonicalJson)` — Part IV §4 job 2, and it becomes
 * `corpus.document.doc_hash`.
 *
 * The JSON is built field-by-field in a fixed order rather than by
 * `JSON.stringify(doc)`, for the same reason as `recurrenceKey`: object key
 * order is an implementation detail, and a reordering would silently fork every
 * historical hash in a permanent, append-only table.
 */
export function docHash(doc: CanonicalDoc): string {
  const canonical = JSON.stringify([
    doc.docType,
    doc.scenario,
    doc.invoiceNumber,
    doc.issueDate,
    doc.currency,
    doc.buyerName,
    doc.buyerTrn,
    doc.sellerTrn,
    doc.predecessorRef,
    doc.lineExtensionMinor,
    doc.taxAmountMinor,
    doc.payableMinor,
    doc.hasAllowanceCharge,
    doc.hasMultiTaxRate,
    doc.lines.map((l) => [
      l.lineNumber, l.description, l.quantity, l.unitCode,
      l.netAmountMinor, l.taxCategoryCode, l.taxRate,
    ]),
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}

/** `sha256` of raw bytes — `ingestion_run.checksum`, `raw_document.checksum`. */
export function sha256Bytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

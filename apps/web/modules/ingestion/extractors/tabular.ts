/**
 * Row-and-column exports → canonical documents. Shared by the CSV and Excel
 * extractors, which differ only in how they turn bytes into rows.
 *
 * Pure. No I/O, no database, no clock.
 *
 * SHAPE. One row per invoice LINE, invoice-level columns repeated on every row
 * of the invoice, grouped by `invoice_number`. A file with no line columns is
 * read as one single-line invoice per row.
 *
 * DATES ARE ISO-ONLY, DELIBERATELY. `03/04/2026` is 3 April in Dubai and
 * 4 March in New York, and nothing in a CSV says which. Accepting it means
 * choosing, and choosing wrong puts an invoice in the wrong tax period —
 * a wrong answer, not a crash. A non-ISO date is a `parse_error` defect for
 * that row and the row is not ingested.
 */

import type { DocType, Scenario } from '@repo/db/schema/client-data';
import { DOC_TYPES, SCENARIOS } from '@repo/db/schema/client-data';
import type { CanonicalDoc, CanonicalLine, ExtractionDefect, ExtractionResult, ExtractorOptions }
  from '../canonical';
import { tryToMinor } from '../money';
import { valueShape } from '../shape';

export type TabularRow = Readonly<Record<string, string>>;

/**
 * Accepted header spellings. Everything is compared after lowercasing and
 * collapsing spaces, hyphens and underscores, so `Invoice Number`,
 * `invoice-number` and `INVOICE_NUMBER` are the same column.
 */
const COLUMNS = {
  invoiceNumber: ['invoicenumber', 'invoiceno', 'documentnumber', 'voucherno', 'bt1'],
  issueDate: ['issuedate', 'invoicedate', 'date', 'bt2'],
  docType: ['doctype', 'documenttype', 'type'],
  scenario: ['scenario', 'supplytype'],
  currency: ['currency', 'currencycode', 'bt5'],
  buyerName: ['buyername', 'customername', 'partyname', 'bt44'],
  buyerTrn: ['buyertrn', 'customertrn', 'buyervatid', 'customergstin', 'bt48'],
  sellerTrn: ['sellertrn', 'suppliertrn', 'companytrn', 'companygstin', 'bt31'],
  predecessorRef: ['predecessorref', 'originalinvoice', 'referenceinvoice', 'bt25'],
  lineExtension: ['lineextensionamount', 'netamount', 'subtotal', 'bt106'],
  taxAmount: ['taxamount', 'vatamount', 'gstamount', 'bt110'],
  payable: ['payableamount', 'grandtotal', 'invoicetotal', 'total', 'bt115'],
  lineNumber: ['linenumber', 'lineno', 'srno'],
  lineDescription: ['linedescription', 'itemname', 'description', 'bt153'],
  lineQuantity: ['linequantity', 'quantity', 'qty', 'bt129'],
  lineUnitCode: ['lineunitcode', 'unitcode', 'uom', 'unit', 'bt130'],
  lineNetAmount: ['linenetamount', 'lineamount', 'linetotal', 'bt131'],
  lineTaxCategory: ['linetaxcategory', 'taxcategory', 'taxcategorycode', 'bt151'],
  lineTaxRate: ['linetaxrate', 'taxrate', 'vatrate', 'gstrate', 'bt152'],
} as const;

type ColumnKey = keyof typeof COLUMNS;

const normaliseHeader = (header: string): string =>
  header.toLowerCase().replace(/[\s_\-.]/g, '');

/** Header → canonical key, built once per file. */
function buildHeaderMap(headers: readonly string[]): Map<string, ColumnKey> {
  const byAlias = new Map<string, ColumnKey>();
  for (const [key, aliases] of Object.entries(COLUMNS) as [ColumnKey, readonly string[]][]) {
    for (const alias of aliases) byAlias.set(alias, key);
  }
  const map = new Map<string, ColumnKey>();
  for (const header of headers) {
    const key = byAlias.get(normaliseHeader(header));
    if (key !== undefined && !map.has(header)) map.set(header, key);
  }
  return map;
}

function readRow(row: TabularRow, headerMap: Map<string, ColumnKey>): Partial<Record<ColumnKey, string>> {
  const out: Partial<Record<ColumnKey, string>> = {};
  for (const [header, key] of headerMap) {
    const raw = row[header];
    if (raw !== undefined && raw.trim() !== '') out[key] = raw.trim();
  }
  return out;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function asDocType(raw: string | undefined): DocType | null {
  if (raw === undefined) return 'invoice';
  const normalised = raw.toLowerCase().replace(/[\s-]/g, '_');
  return (DOC_TYPES as readonly string[]).includes(normalised) ? (normalised as DocType) : null;
}

function asScenario(raw: string | undefined): Scenario | null {
  if (raw === undefined) return null;
  const normalised = raw.toLowerCase().replace(/[\s-]/g, '_');
  return (SCENARIOS as readonly string[]).includes(normalised) ? (normalised as Scenario) : null;
}

export function extractTabular(
  rows: readonly TabularRow[],
  headers: readonly string[],
  opts: ExtractorOptions,
): ExtractionResult {
  const headerMap = buildHeaderMap(headers);
  const defects: ExtractionDefect[] = [];

  if (!new Set(headerMap.values()).has('invoiceNumber')) {
    // Without BT-1 there is no document identity anywhere in the file. One
    // defect for the file; nothing is ingested.
    return {
      documents: [],
      defects: [{ defectClass: 'parse_error', sourceRef: 'header', sampleShape: null }],
    };
  }

  interface Draft {
    header: Partial<Record<ColumnKey, string>>;
    lines: CanonicalLine[];
    sourceRef: string;
    currency: string;
  }
  const drafts = new Map<string, Draft>();

  rows.forEach((raw, index) => {
    const sourceRef = `row[${String(index + 2)}]`;   // +2: 1-based, past the header
    const row = readRow(raw, headerMap);

    const invoiceNumber = row.invoiceNumber;
    const issueDate = row.issueDate;
    if (invoiceNumber === undefined || issueDate === undefined || !ISO_DATE.test(issueDate)) {
      defects.push({ defectClass: 'parse_error', sourceRef, sampleShape: null });
      return;
    }

    const currency = row.currency ?? opts.defaultCurrency;
    let draft = drafts.get(invoiceNumber);
    if (draft === undefined) {
      draft = { header: row, lines: [], sourceRef, currency };
      drafts.set(invoiceNumber, draft);
    } else if (draft.currency !== currency) {
      // The same invoice cannot be in two currencies. Recording either one
      // would be a coin toss with an audit report on the other side.
      defects.push({
        defectClass: 'currency_inconsistent',
        sourceRef,
        sampleShape: valueShape(currency),
      });
      return;
    }

    const hasLineData = row.lineNetAmount !== undefined || row.lineDescription !== undefined
      || row.lineQuantity !== undefined;
    if (!hasLineData && draft.lines.length > 0) return;

    const netAmount = tryToMinor(row.lineNetAmount, currency);
    if (!netAmount.ok && netAmount.reason === 'unknown_currency') {
      defects.push({
        defectClass: 'currency_inconsistent',
        sourceRef,
        sampleShape: valueShape(currency),
      });
    }

    const unitCode = row.lineUnitCode;
    if (unitCode !== undefined && !/^[A-Z0-9]{2,3}$/.test(unitCode)) {
      // BT-130 must be a UNECE Rec 20 code. A free-text unit is a defect, not
      // something to translate here.
      defects.push({
        defectClass: 'unit_code_freetext',
        sourceRef,
        sampleShape: valueShape(unitCode),
      });
    }

    draft.lines.push({
      lineNumber: Number(row.lineNumber ?? draft.lines.length + 1),
      description: row.lineDescription ?? null,
      quantity: row.lineQuantity ?? null,
      unitCode: unitCode !== undefined && /^[A-Z0-9]{2,3}$/.test(unitCode) ? unitCode : null,
      netAmountMinor: netAmount.ok ? netAmount.minor : null,
      taxCategoryCode: row.lineTaxCategory ?? null,
      taxRate: row.lineTaxRate ?? null,
    });
  });

  const documents: CanonicalDoc[] = [];
  for (const [invoiceNumber, draft] of drafts) {
    const { header, currency } = draft;
    const docType = asDocType(header.docType);
    if (docType === null) {
      defects.push({ defectClass: 'parse_error', sourceRef: draft.sourceRef, sampleShape: null });
      continue;
    }

    const declaredScenario = asScenario(header.scenario);
    if (header.scenario !== undefined && declaredScenario === null) {
      defects.push({
        defectClass: 'identifier_inconsistent',
        sourceRef: draft.sourceRef,
        sampleShape: valueShape(header.scenario),
      });
    }

    if (header.buyerTrn === undefined) {
      defects.push({
        defectClass: 'trn_missing',
        sourceRef: draft.sourceRef,
        sampleShape: valueShape(null),
      });
    }

    if (draft.lines.length > 0 && draft.lines.every((l) => l.taxCategoryCode === null)) {
      defects.push({
        defectClass: 'tax_category_unmapped',
        sourceRef: draft.sourceRef,
        sampleShape: valueShape(null),
      });
    }

    const lineExtension = tryToMinor(header.lineExtension, currency);
    const taxAmount = tryToMinor(header.taxAmount, currency);
    const payable = tryToMinor(header.payable, currency);
    const lineSum = draft.lines.reduce<number | null>(
      (sum, l) => (sum === null || l.netAmountMinor === null ? null : sum + l.netAmountMinor),
      0,
    );

    const rates = new Set(draft.lines.map((l) => l.taxRate).filter((r) => r !== null));

    documents.push({
      docType,
      // Only a scenario the SOURCE stated. `standard` otherwise — never
      // inferred from a rate, which would be a tax interpretation (§4.4).
      scenario: declaredScenario ?? 'standard',
      invoiceNumber,
      issueDate: header.issueDate ?? '',
      currency,
      buyerName: header.buyerName ?? null,
      buyerTrn: header.buyerTrn ?? null,
      sellerTrn: header.sellerTrn ?? null,
      predecessorRef: header.predecessorRef ?? null,
      lineExtensionMinor: lineExtension.ok ? lineExtension.minor : lineSum,
      taxAmountMinor: taxAmount.ok ? taxAmount.minor : null,
      payableMinor: payable.ok ? payable.minor : null,
      hasAllowanceCharge: false,
      hasMultiTaxRate: rates.size > 1,
      lines: draft.lines,
      sourceRef: draft.sourceRef,
    });
  }

  return { documents, defects };
}

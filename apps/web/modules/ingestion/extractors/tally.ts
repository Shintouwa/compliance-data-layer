/**
 * Tally Prime XML voucher export → canonical documents.
 * architecture.md Part II · M1: **Tally Prime first (Week 5)**, then CSV/Excel.
 *
 * Pure: bytes in, documents and defects out. No I/O, no database, no clock.
 *
 * ---
 *
 * WHAT THIS EXTRACTOR WILL NOT DO
 *
 * It never guesses. Tally's export is a bookkeeping document, not an invoice
 * document, and several EN 16931 business terms simply are not in it. Where a
 * term is absent, the extractor emits a `master_data_defect` and leaves the
 * field null. It does not:
 *
 *   - infer a scenario from a tax rate. That is a tax interpretation, and
 *     CLAUDE.md §4.4 forbids it without qualification. A voucher with no
 *     scenario evidence is recorded as `standard` — the value the source
 *     implies — and a zero or absent tax rate raises `tax_category_unmapped`
 *     so the ambiguity appears in the defect register instead of being decided
 *     here.
 *   - derive BT-110 as `payable - lineExtension`. That identity only holds when
 *     there are no allowances or charges, and a silently wrong tax total is the
 *     worst possible output.
 *   - map a free-text unit ("Nos", "Pcs") to a UNECE Rec 20 code. It records
 *     the text as absent and raises `unit_code_freetext`; the mapping profile,
 *     human-confirmed, is where that decision belongs (Part III §1.2).
 *
 * ⚠️ The element names below are Tally Prime's standard voucher export shape.
 * They MUST be checked against a real client export before the first pilot
 * (Part II · M1 exit criteria). A tag that does not match produces a
 * `parse_error` defect for that voucher — loudly, one row at a time — rather
 * than a silently empty invoice.
 */

import { XMLParser } from 'fast-xml-parser';
import type { DocType } from '@repo/db/schema/client-data';
import type { CanonicalDoc, CanonicalLine, ExtractionDefect, Extractor } from '../canonical';
import { tryToMinor } from '../money';
import { valueShape } from '../shape';

/** Tally voucher type → EN 16931 document type. Anything else is a defect. */
const VOUCHER_TYPE_TO_DOC_TYPE: Readonly<Record<string, DocType>> = {
  sales: 'invoice',
  'credit note': 'credit_note',
  'debit note': 'debit_note',
};

/**
 * Tags Tally uses for the counterparty's tax registration, in the order they
 * are consulted. Absent from all of them means absent — never inferred.
 */
const PARTY_TRN_TAGS = ['PARTYGSTIN', 'PARTYVATTINNUMBER', 'VATTINNUMBER', 'PARTYTINNUMBER'];
const COMPANY_TRN_TAGS = ['COMPANYGSTIN', 'COMPANYVATTINNUMBER', 'CMPVATTINNUMBER'];

type XmlNode = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,   // every value stays a string; see money.ts
  parseAttributeValue: false,
  trimValues: true,
});

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function text(node: XmlNode, key: string): string | null {
  const raw = node[key];
  if (typeof raw === 'string') return raw.trim() === '' ? null : raw.trim();
  if (typeof raw === 'number') return String(raw);
  return null;
}

function firstText(node: XmlNode, keys: readonly string[]): string | null {
  for (const key of keys) {
    const found = text(node, key);
    if (found !== null) return found;
  }
  return null;
}

/** Tally writes dates as `YYYYMMDD`. Anything else is not a date we recognise. */
function toIsoDate(raw: string | null): string | null {
  if (raw === null) return null;
  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(raw);
  if (compact !== null) return `${compact[1] ?? ''}-${compact[2] ?? ''}-${compact[3] ?? ''}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return null;
}

/** `"2 Nos"` → `{ quantity: "2", unit: "Nos" }`. `"2"` → unit null. */
function splitQuantity(raw: string | null): { quantity: string | null; unit: string | null } {
  if (raw === null) return { quantity: null, unit: null };
  const match = /^\s*([+-]?[\d.,]+)\s*(.*)$/.exec(raw);
  if (match === null) return { quantity: null, unit: null };
  const unit = (match[2] ?? '').trim();
  return { quantity: match[1] ?? null, unit: unit === '' ? null : unit };
}

/** Tally signs sales amounts negative (credit). The invoice value is the magnitude. */
function magnitude(raw: string | null): string | null {
  if (raw === null) return null;
  return raw.trim().replace(/^-/, '');
}

function collectVouchers(root: unknown): XmlNode[] {
  const out: XmlNode[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    if (typeof node !== 'object' || node === null) return;
    const record = node as XmlNode;
    for (const [key, value] of Object.entries(record)) {
      if (key === 'VOUCHER') {
        for (const v of asArray(value)) {
          if (typeof v === 'object' && v !== null) out.push(v as XmlNode);
        }
        continue;
      }
      walk(value);
    }
  };
  walk(root);
  return out;
}

export const extractTally: Extractor = (bytes, opts) => {
  const xml = new TextDecoder('utf-8').decode(bytes);
  const documents: CanonicalDoc[] = [];
  const defects: ExtractionDefect[] = [];

  let parsed: unknown;
  try {
    parsed = parser.parse(xml);
  } catch {
    // A whole file that is not XML is one defect, not one per voucher. The run
    // still completes: a malformed document is a finding, not an outage.
    return Promise.resolve({
      documents: [],
      defects: [{ defectClass: 'parse_error', sourceRef: 'file', sampleShape: null }],
    });
  }

  const vouchers = collectVouchers(parsed);
  if (vouchers.length === 0) {
    defects.push({ defectClass: 'parse_error', sourceRef: 'file', sampleShape: null });
    return Promise.resolve({ documents, defects });
  }

  vouchers.forEach((voucher, index) => {
    const sourceRef = `voucher[${String(index)}]`;

    const voucherType = (text(voucher, 'VOUCHERTYPENAME') ?? '').toLowerCase();
    const docType = VOUCHER_TYPE_TO_DOC_TYPE[voucherType];
    const invoiceNumber = text(voucher, 'VOUCHERNUMBER');
    const issueDate = toIsoDate(text(voucher, 'DATE') ?? text(voucher, 'EFFECTIVEDATE'));

    // BT-1 and BT-2 are the identity of the document. Without them there is
    // nothing to record, so the voucher becomes a defect rather than a row.
    if (docType === undefined || invoiceNumber === null || issueDate === null) {
      defects.push({ defectClass: 'parse_error', sourceRef, sampleShape: null });
      return;
    }

    const currency = text(voucher, 'CURRENCYNAME') ?? opts.defaultCurrency;
    const partyName = text(voucher, 'PARTYLEDGERNAME') ?? text(voucher, 'PARTYNAME');
    const buyerTrn = firstText(voucher, PARTY_TRN_TAGS);
    const sellerTrn = firstText(voucher, COMPANY_TRN_TAGS);

    if (buyerTrn === null) {
      defects.push({ defectClass: 'trn_missing', sourceRef, sampleShape: valueShape(null) });
    }

    const lines: CanonicalLine[] = [];

    const inventory = asArray(voucher['ALLINVENTORYENTRIES.LIST'])
      .filter((e): e is XmlNode => typeof e === 'object' && e !== null);

    inventory.forEach((entry, lineIndex) => {
      const { quantity, unit } = splitQuantity(
        text(entry, 'BILLEDQTY') ?? text(entry, 'ACTUALQTY'),
      );
      const amount = tryToMinor(magnitude(text(entry, 'AMOUNT')), currency);

      if (unit !== null) {
        // BT-130 must exist in UNECE Rec 20 — a top-8 rejection cause. "Nos"
        // is not a Rec 20 code, and choosing one for it is a mapping decision.
        defects.push({
          defectClass: 'unit_code_freetext',
          sourceRef: `${sourceRef}.line[${String(lineIndex)}]`,
          sampleShape: valueShape(unit),
        });
      }

      lines.push({
        lineNumber: lineIndex + 1,
        description: text(entry, 'STOCKITEMNAME'),
        quantity,
        unitCode: null,
        netAmountMinor: amount.ok ? amount.minor : null,
        taxCategoryCode: null,
        taxRate: text(entry, 'RATEOFVAT') ?? text(entry, 'GSTRATE'),
      });
    });

    const lineSum = lines.length > 0 && lines.every((l) => l.netAmountMinor !== null)
      ? lines.reduce((sum, l) => sum + (l.netAmountMinor ?? 0), 0)
      : null;

    // In Tally the party ledger entry carries the invoice total; identifying it
    // by name is structural, not an interpretation of the ledger.
    const ledgerEntries = asArray(voucher['ALLLEDGERENTRIES.LIST'])
      .filter((e): e is XmlNode => typeof e === 'object' && e !== null);
    const partyEntry = ledgerEntries.find((e) => text(e, 'LEDGERNAME') === partyName);
    const payable = tryToMinor(magnitude(text(partyEntry ?? {}, 'AMOUNT')), currency);

    if (!payable.ok && payable.reason === 'unknown_currency') {
      defects.push({
        defectClass: 'currency_inconsistent',
        sourceRef,
        sampleShape: valueShape(currency),
      });
    }

    // BT-151 absent on every line. Second-most-common rejection cause, and the
    // one place where guessing would be a tax interpretation.
    if (lines.length > 0 && lines.every((l) => l.taxCategoryCode === null)) {
      defects.push({
        defectClass: 'tax_category_unmapped',
        sourceRef,
        sampleShape: valueShape(null),
      });
    }

    documents.push({
      docType,
      // Not derived from tax data — see the header comment. The mapping profile
      // sets this where the client's chart of accounts encodes it.
      scenario: 'standard',
      invoiceNumber,
      issueDate,
      currency,
      buyerName: partyName,
      buyerTrn,
      sellerTrn,
      predecessorRef: text(voucher, 'REFERENCE'),
      // The sum is reported only when EVERY line amount parsed. A partial sum
      // is a wrong total, and a wrong total is worse than an absent one.
      lineExtensionMinor: lineSum,
      // BT-110 is left null unless Tally states it. Deriving it arithmetically
      // is only valid without allowances or charges.
      taxAmountMinor: null,
      payableMinor: payable.ok ? payable.minor : null,
      hasAllowanceCharge: ledgerEntries.length > lines.length + 1,
      hasMultiTaxRate: new Set(lines.flatMap((l) => (l.taxRate === null ? [] : [l.taxRate]))).size > 1,
      lines,
      sourceRef,
    });
  });

  return Promise.resolve({ documents, defects });
};

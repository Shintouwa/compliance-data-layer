/**
 * Canonical document → UBL 2.1. Pure.
 *
 * The sidecar's `POST /validate` takes a base64 UBL or CII document
 * (Part III §5); the canonical model is not XML. Something has to bridge the
 * two, and this is it.
 *
 * ---
 *
 * WHAT THIS SERIALISER WILL NOT DO
 *
 * **It never fills a gap.** A business term the extractor did not find is
 * OMITTED from the document, not emitted empty and not defaulted. That is the
 * whole point of the audit: `BR-06` firing because `cac:PartyLegalEntity` is
 * absent is the finding the client is paying for. Emitting an empty element to
 * make the XML "look complete" would move a real failure into a different rule,
 * or hide it.
 *
 * **`CustomizationID` and `ProfileID` are required inputs, never defaulted.**
 * They are external identifiers owned by the specification (PINT AE, Peppol
 * BIS, XRechnung each publish their own), and CLAUDE.md §4.7(1) is explicit:
 * do not invent an external identifier. A caller without them cannot serialise.
 *
 * The element set and ordering follow `tests/corpus/**` — the Golden File
 * Corpus is the executable specification of what this system considers a
 * conformant document (§3.1).
 */

import { minorToDecimal } from '../ingestion';
import type { CanonicalDoc } from '../ingestion';

/** UNTDID 1001. `380` invoice · `381` credit note · `383` debit note. */
const TYPE_CODE: Readonly<Record<CanonicalDoc['docType'], string>> = {
  invoice: '380',
  credit_note: '381',
  debit_note: '383',
  self_billed: '389',
};

export interface UblContext {
  /**
   * ⚠️ Published by the specification. Not defaulted, not guessed.
   * e.g. the `urn:peppol:pint:billing-1@ae-1` family for PINT AE.
   */
  readonly customizationId: string;
  /** ⚠️ Published by the specification. */
  readonly profileId: string;
  /** `app.entity.legal_name` — configuration, not extracted client data. */
  readonly sellerName: string | null;
  /** `app.entity.jurisdiction`. */
  readonly sellerCountry: string | null;
  readonly buyerCountry: string | null;
}

export class MissingSpecIdentifiers extends Error {
  public override readonly name = 'MissingSpecIdentifiers';
  public constructor(missing: readonly string[]) {
    super(
      `Cannot serialise UBL without ${missing.join(' and ')}. These are published by the ` +
        'specification and must be resolved from primary source, never defaulted. ' +
        'architecture.md CLAUDE.md §4.7(1); packages/config/specs.json.',
    );
  }
}

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const el = (name: string, value: string, attrs = ''): string =>
  `<${name}${attrs}>${escapeXml(value)}</${name}>`;

const amount = (name: string, minor: number, currency: string): string =>
  el(name, minorToDecimal(minor, currency), ` currencyID="${escapeXml(currency)}"`);

function taxCategory(tag: string, categoryCode: string | null, rate: string | null): string {
  const parts: string[] = [];
  if (categoryCode !== null) parts.push(el('cbc:ID', categoryCode));
  if (rate !== null) parts.push(el('cbc:Percent', rate));
  parts.push('<cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>');
  return `<${tag}>${parts.join('')}</${tag}>`;
}

function party(tag: string, name: string | null, trn: string | null, country: string | null): string {
  const inner: string[] = [];
  if (country !== null) {
    inner.push(
      `<cac:PostalAddress><cac:Country>${el('cbc:IdentificationCode', country)}` +
      '</cac:Country></cac:PostalAddress>',
    );
  }
  if (trn !== null) {
    inner.push(
      `<cac:PartyTaxScheme>${el('cbc:CompanyID', trn)}` +
      '<cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>',
    );
  }
  if (name !== null) {
    inner.push(`<cac:PartyLegalEntity>${el('cbc:RegistrationName', name)}</cac:PartyLegalEntity>`);
  }
  return `<${tag}><cac:Party>${inner.join('')}</cac:Party></${tag}>`;
}

/**
 * `true` for a credit note, which UBL models as a different document type with
 * a different root element and a different line/quantity element name.
 */
const isCreditNote = (doc: CanonicalDoc): boolean => doc.docType === 'credit_note';

export function toUbl(doc: CanonicalDoc, ctx: UblContext): string {
  const missing: string[] = [];
  if (ctx.customizationId.trim() === '') missing.push('CustomizationID');
  if (ctx.profileId.trim() === '') missing.push('ProfileID');
  if (missing.length > 0) throw new MissingSpecIdentifiers(missing);

  const credit = isCreditNote(doc);
  const root = credit ? 'CreditNote' : 'Invoice';
  const lineTag = credit ? 'cac:CreditNoteLine' : 'cac:InvoiceLine';
  const quantityTag = credit ? 'cbc:CreditedQuantity' : 'cbc:InvoicedQuantity';
  const typeCodeTag = credit ? 'cbc:CreditNoteTypeCode' : 'cbc:InvoiceTypeCode';
  const { currency } = doc;

  const head: string[] = [
    el('cbc:CustomizationID', ctx.customizationId),
    el('cbc:ProfileID', ctx.profileId),
    el('cbc:ID', doc.invoiceNumber),
    el('cbc:IssueDate', doc.issueDate),
    el(typeCodeTag, TYPE_CODE[doc.docType]),
    el('cbc:DocumentCurrencyCode', currency),
  ];

  // BT-25. Credit-note lineage — a top-8 rejection cause when absent, so it is
  // emitted whenever the source had it and omitted (visibly) when it did not.
  if (doc.predecessorRef !== null) {
    head.push(
      '<cac:BillingReference><cac:InvoiceDocumentReference>' +
      el('cbc:ID', doc.predecessorRef) +
      '</cac:InvoiceDocumentReference></cac:BillingReference>',
    );
  }

  head.push(party('cac:AccountingSupplierParty', ctx.sellerName, doc.sellerTrn, ctx.sellerCountry));
  head.push(party('cac:AccountingCustomerParty', doc.buyerName, doc.buyerTrn, ctx.buyerCountry));

  if (doc.taxAmountMinor !== null) {
    const subtotal = doc.lineExtensionMinor === null
      ? ''
      : `<cac:TaxSubtotal>${amount('cbc:TaxableAmount', doc.lineExtensionMinor, currency)}` +
        amount('cbc:TaxAmount', doc.taxAmountMinor, currency) +
        taxCategory('cac:TaxCategory', doc.lines[0]?.taxCategoryCode ?? null,
          doc.lines[0]?.taxRate ?? null) + '</cac:TaxSubtotal>';
    head.push(
      `<cac:TaxTotal>${amount('cbc:TaxAmount', doc.taxAmountMinor, currency)}` +
      `${subtotal}</cac:TaxTotal>`,
    );
  }

  const totals: string[] = [];
  if (doc.lineExtensionMinor !== null) {
    totals.push(amount('cbc:LineExtensionAmount', doc.lineExtensionMinor, currency));
    totals.push(amount('cbc:TaxExclusiveAmount', doc.lineExtensionMinor, currency));
  }
  if (doc.payableMinor !== null) {
    totals.push(amount('cbc:TaxInclusiveAmount', doc.payableMinor, currency));
    totals.push(amount('cbc:PayableAmount', doc.payableMinor, currency));
  }
  if (totals.length > 0) {
    head.push(`<cac:LegalMonetaryTotal>${totals.join('')}</cac:LegalMonetaryTotal>`);
  }

  const lines = doc.lines.map((line) => {
    const parts: string[] = [el('cbc:ID', String(line.lineNumber))];
    if (line.quantity !== null) {
      parts.push(el(
        quantityTag,
        line.quantity,
        line.unitCode === null ? '' : ` unitCode="${escapeXml(line.unitCode)}"`,
      ));
    }
    if (line.netAmountMinor !== null) {
      parts.push(amount('cbc:LineExtensionAmount', line.netAmountMinor, currency));
    }
    const item: string[] = [];
    if (line.description !== null) item.push(el('cbc:Name', line.description));
    if (line.taxCategoryCode !== null || line.taxRate !== null) {
      item.push(taxCategory('cac:ClassifiedTaxCategory', line.taxCategoryCode, line.taxRate));
    }
    if (item.length > 0) parts.push(`<cac:Item>${item.join('')}</cac:Item>`);
    return `<${lineTag}>${parts.join('')}</${lineTag}>`;
  });

  const namespace = `urn:oasis:names:specification:ubl:schema:xsd:${root}-2`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<${root} xmlns="${namespace}" ` +
    'xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" ' +
    'xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2">' +
    `${head.join('')}${lines.join('')}</${root}>`;
}

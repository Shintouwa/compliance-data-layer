import { describe, expect, it } from 'vitest';
import type { CanonicalDoc } from '../ingestion';
import { MissingSpecIdentifiers, toUbl } from './ubl';

const CTX = {
  customizationId: 'urn:cdl:synthetic:m0',
  profileId: 'urn:cdl:billing',
  sellerName: 'Synthetic Seller LLC',
  sellerCountry: 'AE',
  buyerCountry: 'AE',
} as const;

const doc = (over: Partial<CanonicalDoc> = {}): CanonicalDoc => ({
  docType: 'invoice',
  scenario: 'standard',
  invoiceNumber: 'CDL-0001',
  issueDate: '2026-08-10',
  currency: 'AED',
  buyerName: 'Synthetic Buyer FZE',
  buyerTrn: 'AE100000000000002',
  sellerTrn: 'AE100000000000001',
  predecessorRef: null,
  lineExtensionMinor: 100_000,
  taxAmountMinor: 5_000,
  payableMinor: 105_000,
  hasAllowanceCharge: false,
  hasMultiTaxRate: false,
  lines: [{
    lineNumber: 1,
    description: 'Consultancy services',
    quantity: '10',
    unitCode: 'H87',
    netAmountMinor: 100_000,
    taxCategoryCode: 'S',
    taxRate: '5',
  }],
  sourceRef: 'row[2]',
  ...over,
});

describe('toUbl', () => {
  it('produces the element set the Golden File Corpus treats as conformant', () => {
    const xml = toUbl(doc(), CTX);
    for (const fragment of [
      '<cbc:CustomizationID>urn:cdl:synthetic:m0</cbc:CustomizationID>',
      '<cbc:ProfileID>urn:cdl:billing</cbc:ProfileID>',
      '<cbc:ID>CDL-0001</cbc:ID>',
      '<cbc:IssueDate>2026-08-10</cbc:IssueDate>',
      '<cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>',
      '<cbc:DocumentCurrencyCode>AED</cbc:DocumentCurrencyCode>',
      '<cbc:TaxAmount currencyID="AED">50.00</cbc:TaxAmount>',
      '<cbc:LineExtensionAmount currencyID="AED">1000.00</cbc:LineExtensionAmount>',
      '<cbc:PayableAmount currencyID="AED">1050.00</cbc:PayableAmount>',
      '<cbc:InvoicedQuantity unitCode="H87">10</cbc:InvoicedQuantity>',
      '<cbc:Name>Consultancy services</cbc:Name>',
    ]) {
      expect(xml).toContain(fragment);
    }
  });

  it('formats amounts through the currency exponent, never through a float', () => {
    const xml = toUbl(doc({ taxAmountMinor: 7, payableMinor: 100_007 }), CTX);
    expect(xml).toContain('<cbc:TaxAmount currencyID="AED">0.07</cbc:TaxAmount>');
    expect(xml).toContain('<cbc:PayableAmount currencyID="AED">1000.07</cbc:PayableAmount>');
  });

  it('OMITS a missing business term rather than emitting it empty', () => {
    // BR-06 firing because cac:PartyLegalEntity is absent IS the finding the
    // client is paying for. An empty element would move it to a different rule.
    const xml = toUbl(doc({ buyerTrn: null, buyerName: null }), CTX);
    expect(xml).not.toContain('<cbc:CompanyID></cbc:CompanyID>');
    expect(xml).not.toContain('<cbc:RegistrationName></cbc:RegistrationName>');
    expect(xml).toContain('<cac:AccountingCustomerParty>');
    // The seller's identifiers are still there — only the absent ones are gone.
    expect(xml).toContain('AE100000000000001');
  });

  it('omits LegalMonetaryTotal entirely when no total is known', () => {
    const xml = toUbl(
      doc({ lineExtensionMinor: null, payableMinor: null, taxAmountMinor: null }),
      CTX,
    );
    expect(xml).not.toContain('cac:LegalMonetaryTotal');
    expect(xml).not.toContain('cac:TaxTotal');
  });

  it('switches root, line and quantity elements for a credit note', () => {
    const xml = toUbl(doc({ docType: 'credit_note', predecessorRef: 'CDL-0001' }), CTX);
    expect(xml).toContain('<CreditNote ');
    expect(xml).toContain('<cbc:CreditNoteTypeCode>381</cbc:CreditNoteTypeCode>');
    expect(xml).toContain('<cac:CreditNoteLine>');
    expect(xml).toContain('<cbc:CreditedQuantity unitCode="H87">10</cbc:CreditedQuantity>');
    expect(xml).toContain(
      '<cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>CDL-0001</cbc:ID>',
    );
  });

  it('escapes XML metacharacters in a client value', () => {
    const xml = toUbl(doc({ buyerName: 'Smith & Sons <Trading> "Ltd"' }), CTX);
    expect(xml).toContain('Smith &amp; Sons &lt;Trading&gt; &quot;Ltd&quot;');
    expect(xml).not.toContain('<Trading>');
  });

  it('refuses to serialise without the published spec identifiers', () => {
    expect(() => toUbl(doc(), { ...CTX, customizationId: '' }))
      .toThrow(MissingSpecIdentifiers);
    expect(() => toUbl(doc(), { ...CTX, profileId: '   ' }))
      .toThrow(MissingSpecIdentifiers);
  });

  it('is deterministic', () => {
    expect(toUbl(doc(), CTX)).toBe(toUbl(doc(), CTX));
  });
});

import { describe, expect, it } from 'vitest';
import { extractCsv } from './csv';
import { extractTally } from './tally';
import { detectFormat, UnsupportedSource } from './index';

const OPTS = { defaultCurrency: 'AED' } as const;
const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

const TALLY_XML = `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE><BODY><IMPORTDATA><REQUESTDATA>
  <TALLYMESSAGE>
    <VOUCHER VCHTYPE="Sales">
      <DATE>20260715</DATE>
      <VOUCHERNUMBER>INV-0001</VOUCHERNUMBER>
      <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
      <PARTYLEDGERNAME>Acme Trading LLC</PARTYLEDGERNAME>
      <PARTYGSTIN>100000000000003</PARTYGSTIN>
      <ALLINVENTORYENTRIES.LIST>
        <STOCKITEMNAME>Consultancy</STOCKITEMNAME>
        <BILLEDQTY>10 Nos</BILLEDQTY>
        <AMOUNT>-1000.00</AMOUNT>
      </ALLINVENTORYENTRIES.LIST>
      <ALLLEDGERENTRIES.LIST>
        <LEDGERNAME>Acme Trading LLC</LEDGERNAME>
        <AMOUNT>1050.00</AMOUNT>
      </ALLLEDGERENTRIES.LIST>
    </VOUCHER>
    <VOUCHER VCHTYPE="Sales">
      <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
      <DATE>not-a-date</DATE>
      <VOUCHERNUMBER>INV-0002</VOUCHERNUMBER>
    </VOUCHER>
  </TALLYMESSAGE>
</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;

describe('extractTally', () => {
  it('extracts a voucher into the canonical model', async () => {
    const { documents } = await extractTally(bytes(TALLY_XML), OPTS);
    const doc = documents[0];

    expect(documents).toHaveLength(1);
    expect(doc?.invoiceNumber).toBe('INV-0001');
    expect(doc?.issueDate).toBe('2026-07-15');
    expect(doc?.docType).toBe('invoice');
    expect(doc?.currency).toBe('AED');
    expect(doc?.buyerName).toBe('Acme Trading LLC');
    expect(doc?.buyerTrn).toBe('100000000000003');
    // Tally signs sales credits negative; the invoice value is the magnitude.
    expect(doc?.lines[0]?.netAmountMinor).toBe(100_000);
    expect(doc?.payableMinor).toBe(105_000);
    expect(doc?.lineExtensionMinor).toBe(100_000);
  });

  it('leaves BT-110 null rather than deriving it arithmetically', async () => {
    // payable - lineExtension would be 5000 here, and that identity only holds
    // when there are no allowances or charges. A silently wrong tax total is
    // the worst possible output.
    const { documents } = await extractTally(bytes(TALLY_XML), OPTS);
    expect(documents[0]?.taxAmountMinor).toBeNull();
  });

  it('records a free-text unit as a defect instead of mapping it', async () => {
    const { documents, defects } = await extractTally(bytes(TALLY_XML), OPTS);
    expect(documents[0]?.lines[0]?.unitCode).toBeNull();
    expect(defects.some((d) => d.defectClass === 'unit_code_freetext')).toBe(true);
  });

  it('raises tax_category_unmapped rather than choosing a category', async () => {
    const { defects } = await extractTally(bytes(TALLY_XML), OPTS);
    expect(defects.some((d) => d.defectClass === 'tax_category_unmapped')).toBe(true);
  });

  it('records the bad voucher as a defect and keeps the good one', async () => {
    // Partial failure is permitted and expected. Part IV §4 job 2.
    const { documents, defects } = await extractTally(bytes(TALLY_XML), OPTS);
    expect(documents).toHaveLength(1);
    expect(defects.filter((d) => d.defectClass === 'parse_error')).toHaveLength(1);
  });

  it('never puts a raw value in a defect', async () => {
    const { defects } = await extractTally(bytes(TALLY_XML), OPTS);
    const serialised = JSON.stringify(defects);
    expect(serialised).not.toContain('100000000000003');
    expect(serialised).not.toContain('Acme');
  });

  it('reports a non-XML file as one defect, not an exception', async () => {
    const { documents, defects } = await extractTally(bytes('this is not xml at all'), OPTS);
    expect(documents).toHaveLength(0);
    expect(defects).toHaveLength(1);
    expect(defects[0]?.defectClass).toBe('parse_error');
  });

  it('is pure — the same bytes give the same result', async () => {
    const a = await extractTally(bytes(TALLY_XML), OPTS);
    const b = await extractTally(bytes(TALLY_XML), OPTS);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

const CSV = [
  'invoice_number,issue_date,currency,buyer_name,buyer_trn,line_description,line_quantity,line_unit_code,line_net_amount,line_tax_category,line_tax_rate,tax_amount,payable_amount',
  'INV-1,2026-07-15,AED,Acme,100000000000003,Widget,2,H87,1000.00,S,5,50.00,1050.00',
  'INV-1,2026-07-15,AED,Acme,100000000000003,Gadget,1,H87,500.00,S,5,50.00,1050.00',
  'INV-2,15/07/2026,AED,Beta,100000000000004,Thing,1,H87,10.00,S,5,0.50,10.50',
].join('\n');

describe('extractCsv', () => {
  it('groups line rows into one invoice', async () => {
    const { documents } = await extractCsv(bytes(CSV), OPTS);
    const first = documents.find((d) => d.invoiceNumber === 'INV-1');
    expect(first?.lines).toHaveLength(2);
    expect(first?.lineExtensionMinor).toBe(150_000);
    expect(first?.taxAmountMinor).toBe(5_000);
    expect(first?.payableMinor).toBe(105_000);
  });

  it('refuses an ambiguous date instead of choosing a reading of it', async () => {
    // 15/07/2026 is 15 July in Dubai and invalid in New York. Choosing puts an
    // invoice in the wrong tax period.
    const { documents, defects } = await extractCsv(bytes(CSV), OPTS);
    expect(documents.map((d) => d.invoiceNumber)).not.toContain('INV-2');
    expect(defects.some((d) => d.defectClass === 'parse_error')).toBe(true);
  });

  it('accepts a header row in any case or separator style', async () => {
    const alternate = [
      'Invoice Number,Invoice Date,Currency,Line Net Amount',
      'INV-9,2026-07-15,AED,10.00',
    ].join('\n');
    const { documents } = await extractCsv(bytes(alternate), OPTS);
    expect(documents[0]?.invoiceNumber).toBe('INV-9');
    expect(documents[0]?.lines[0]?.netAmountMinor).toBe(1000);
  });

  it('handles quoted fields containing the delimiter', async () => {
    const quoted = [
      'invoice_number,issue_date,line_description,line_net_amount',
      'INV-3,2026-07-15,"Widget, large",1.00',
    ].join('\n');
    const { documents } = await extractCsv(bytes(quoted), OPTS);
    expect(documents[0]?.lines[0]?.description).toBe('Widget, large');
    expect(documents[0]?.lines[0]?.netAmountMinor).toBe(100);
  });

  it('reports a file with no invoice-number column as one header defect', async () => {
    const { documents, defects } = await extractCsv(bytes('a,b\n1,2'), OPTS);
    expect(documents).toHaveLength(0);
    expect(defects).toEqual([
      { defectClass: 'parse_error', sourceRef: 'header', sampleShape: null },
    ]);
  });
});

describe('detectFormat', () => {
  it('lets the vendor decide before the mime type', () => {
    expect(detectFormat('tally', 'application/xml', 'daybook.xml')).toBe('tally_xml');
    expect(detectFormat('csv', 'text/csv', 'export.csv')).toBe('csv');
    expect(detectFormat('other', 'application/octet-stream', 'export.xlsx')).toBe('xlsx');
  });

  it('refuses a source it has no extractor for', () => {
    expect(() => detectFormat('sap', 'application/edi-x12', 'idoc.txt'))
      .toThrow(UnsupportedSource);
  });
});

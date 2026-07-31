/**
 * `ingest.normalise` — the domain half. architecture.md Part IV §4 job 2.
 *
 * Dispatches to the extractor for `entity.sourceSystem`. **Extractors are pure
 * functions:** `(bytes, opts) => CanonicalDoc[]`.
 *
 * **Partial failure is permitted and expected.** A 300-row Tally export with 12
 * unparseable rows records 288 invoices plus 12 `master_data_defect` rows with
 * `defectClass='parse_error'`. **Never fail the whole run for a subset of bad
 * rows — the bad rows *are* the product.**
 *
 * This is the ONLY place a sealed blob is opened. Part V §1.4.
 */

import { and, eq } from 'drizzle-orm';
import { invoice, invoiceLine, ingestionRun, masterDataDefect, rawDocument }
  from '@repo/db/schema/client-data';
import type { TxContext } from '@repo/db/transaction';
import { withTenantAccess } from '../tenancy';
import { docHash } from './canonical';
import type { CanonicalDoc, ExtractionDefect } from './canonical';
import { openBlob } from './crypto';
import { detectFormat, extractorFor } from './extractors';
import { expiresInNinetyDays } from './retention';
import { getSealed } from './storage';
import type { SourceSystemVendor } from '@repo/db/schema/_shared';

export interface NormaliseInput {
  readonly runId: string;
  readonly tenantId: string;
  readonly entityId: string;
  readonly actorId: string;
  readonly rawDocumentId: string;
  readonly sourceSystem: SourceSystemVendor;
  readonly defaultCurrency: string;
  readonly traceId?: string;
}

export interface NormaliseResult {
  readonly invoiceIds: readonly string[];
  readonly documentsWritten: number;
  readonly defectsWritten: number;
}

export async function normaliseRun(
  input: NormaliseInput,
  enqueue: (tx: TxContext, result: NormaliseResult) => Promise<void>,
): Promise<NormaliseResult> {
  const access = {
    tenantId: input.tenantId,
    actorId: input.actorId,
    reason: 'scheduled_job' as const,
    ...(input.traceId === undefined ? {} : { traceId: input.traceId }),
  };

  // The blob is fetched and opened outside the write transaction: decryption is
  // CPU-bound and a large export would otherwise hold a connection open for the
  // whole of it. RLS still governs the row lookup, which happens first.
  const document = await withTenantAccess(access, async (ctx) => {
    const [row] = await ctx.tx
      .select({
        storageKey: rawDocument.storageKey,
        mimeType: rawDocument.mimeType,
        encryptedDataKey: rawDocument.encryptedDataKey,
        iv: rawDocument.iv,
      })
      .from(rawDocument)
      .where(and(
        eq(rawDocument.id, input.rawDocumentId),
        eq(rawDocument.tenantId, input.tenantId),
      ));
    if (row === undefined) {
      throw new Error(
        `No client_data.raw_document ${input.rawDocumentId} for this tenant. Either the ` +
          'row was purged or the RLS context does not match.',
      );
    }
    return row;
  });

  const ciphertext = await getSealed(document.storageKey);
  const plaintext = openBlob(document, input.tenantId, ciphertext);

  const format = detectFormat(input.sourceSystem, document.mimeType, document.storageKey);
  const extracted = await extractorFor(format)(plaintext, {
    defaultCurrency: input.defaultCurrency,
  });

  return withTenantAccess(access, async (ctx) => {
    const invoiceIds = await writeDocuments(ctx, input, extracted.documents);
    await writeDefects(ctx, input, extracted.defects);

    await ctx.tx.update(ingestionRun)
      .set({ status: 'mapping', docCount: extracted.documents.length })
      .where(and(
        eq(ingestionRun.runId, input.runId),
        eq(ingestionRun.tenantId, input.tenantId),
      ));

    const result: NormaliseResult = {
      invoiceIds,
      documentsWritten: extracted.documents.length,
      defectsWritten: extracted.defects.length,
    };
    await enqueue(ctx, result);
    return result;
  });
}

async function writeDocuments(
  ctx: TxContext,
  input: NormaliseInput,
  documents: readonly CanonicalDoc[],
): Promise<string[]> {
  const expiresAt = expiresInNinetyDays();
  const ids: string[] = [];

  for (const doc of documents) {
    const [row] = await ctx.tx.insert(invoice).values({
      tenantId: input.tenantId,
      entityId: input.entityId,
      runId: input.runId,
      direction: 'ar',
      counterpartyId: null,
      docHash: docHash(doc),
      docType: doc.docType,
      scenario: doc.scenario,
      invoiceNumber: doc.invoiceNumber,
      issueDate: new Date(`${doc.issueDate}T00:00:00Z`),
      currency: doc.currency,
      buyerName: doc.buyerName,
      buyerTrn: doc.buyerTrn,
      sellerTrn: doc.sellerTrn,
      predecessorRef: doc.predecessorRef,
      lineExtensionMinor: doc.lineExtensionMinor,
      taxAmountMinor: doc.taxAmountMinor,
      payableMinor: doc.payableMinor,
      hasAllowanceCharge: doc.hasAllowanceCharge,
      hasMultiTaxRate: doc.hasMultiTaxRate,
      lineCount: doc.lines.length,
      expiresAt,
    }).returning({ id: invoice.id });

    if (row === undefined) {
      throw new Error('invoice insert returned no row — RLS context is missing.');
    }
    ids.push(row.id);

    if (doc.lines.length > 0) {
      await ctx.tx.insert(invoiceLine).values(doc.lines.map((line) => ({
        tenantId: input.tenantId,
        invoiceId: row.id,
        lineNumber: line.lineNumber,
        description: line.description,
        quantity: line.quantity,
        unitCode: line.unitCode,
        netAmountMinor: line.netAmountMinor,
        taxCategoryCode: line.taxCategoryCode,
        taxRate: line.taxRate,
        expiresAt,
      })));
    }
  }

  return ids;
}

/**
 * Defects are aggregated by class before they are written: the register is
 * "how many documents have this problem and roughly what does it cost to fix",
 * not one row per occurrence. `sampleShape` keeps the FIRST shape seen, which
 * is enough to render the `value_shape` chip in Part III §1.3.
 */
async function writeDefects(
  ctx: TxContext,
  input: NormaliseInput,
  defects: readonly ExtractionDefect[],
): Promise<void> {
  if (defects.length === 0) return;

  const byClass = new Map<string, { defect: ExtractionDefect; count: number }>();
  for (const defect of defects) {
    const seen = byClass.get(defect.defectClass);
    if (seen === undefined) byClass.set(defect.defectClass, { defect, count: 1 });
    else seen.count += 1;
  }

  await ctx.tx.insert(masterDataDefect).values([...byClass.values()].map(({ defect, count }) => ({
    tenantId: input.tenantId,
    entityId: input.entityId,
    runId: input.runId,
    defectClass: defect.defectClass,
    affectedCount: count,
    effortMinutes: null,
    sampleShape: defect.sampleShape,
    expiresAt: expiresInNinetyDays(),
  })));
}

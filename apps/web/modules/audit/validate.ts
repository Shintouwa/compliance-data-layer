/**
 * `validate.run` — the domain half. architecture.md Part IV §4 job 4.
 *
 * | Writes | `client_data.finding` → enqueues `corpus.record` and `report.generate` |
 * | Retry  | 5×, exponential — the sidecar is a network hop and Heroku dynos cycle |
 *
 * **Persists `specVersion` and `rulesetHash` from every response onto every
 * downstream record.** Two invocations of the same rule under different ruleset
 * hashes are different facts; without the hash the corpus cannot be replayed.
 *
 * | Response | Behaviour |
 * |---|---|
 * | `504` | Retry **once** with `stop_on_first_error: true` (in `validator-client.ts`) |
 * | `422` | **Do not retry.** Record a `parse_error` defect and continue — a malformed document is a finding, not an outage. |
 * | `500` | Retry per policy; Sentry with `run_id` and `correlation_id` |
 */

import { and, eq, inArray } from 'drizzle-orm';
import {
  finding, ingestionRun, invoice, invoiceLine, masterDataDefect,
} from '@repo/db/schema/client-data';
import type { FailureClass, FlowDirection, ValueShape } from '@repo/db/schema/_shared';
import type { TxContext } from '@repo/db/transaction';
import type { Finding as ContractFinding, ValidateRequest, ValueShape as ContractValueShape }
  from '@repo/contracts';
import { validateDocument, ValidatorParseError } from '../../lib/validator-client';
import type { Logger } from '../../lib/logger';
import { recurrenceKey } from '../corpus';
import { expiresInNinetyDays } from '../ingestion';
import type { CanonicalDoc } from '../ingestion';
import { toUbl, ublSpecIdentifiers } from '../mapping';
import type { SpecIdentifiers, UblContext } from '../mapping';
import { withTenantAccess } from '../tenancy';

/**
 * Part IV §4 job 4: "Batches to `POST /validate` at 50 documents per request."
 *
 * The wire contract (Part III §5) carries ONE `document` per request, so this
 * is the unit of work per chunk rather than a request body size: 50 documents
 * are validated, then their findings are written in one transaction. Chunking
 * bounds how much is lost to a mid-run retry and keeps a 5,000-document export
 * off a single database connection for half an hour.
 */
export const VALIDATE_BATCH_SIZE = 50;

export interface ValidateRunInput {
  readonly runId: string;
  readonly tenantId: string;
  readonly entityId: string;
  readonly actorId: string;
  readonly entityHash: string;
  readonly invoiceIds: readonly string[];
  readonly profile: ValidateRequest['profile'];
  readonly specVersion: string;
  readonly direction: FlowDirection;
  /**
   * The party half of the UBL context. The specification identifiers are NOT
   * here: they depend on the document, not on the run — Peppol models a
   * self-billed invoice as a different business process
   * (`urn:peppol:bis:selfbilling`) from an ordinary one, and a batch can mix
   * both. One context for a whole batch would stamp the wrong process onto
   * every self-billed document in it.
   */
  readonly ubl: Omit<UblContext, 'customizationId' | 'profileId'>;
  /**
   * Forces one identifier pair for every document in the run, instead of
   * deriving it from `profile` and the document type.
   *
   * The escape hatch for a profile `ublSpecIdentifiers` cannot answer for. The
   * caller then owns the value, and CLAUDE.md §4.7(1) still applies to it: it
   * must have been resolved from primary source, not composed here.
   */
  readonly ublIdentifiers?: SpecIdentifiers;
  readonly traceId?: string;
}

export interface ValidatedDocument {
  readonly docHash: string;
  readonly docType: string;
  readonly scenario: string;
  readonly currency: string;
  readonly lineCount: number;
  readonly hasAllowanceCharge: boolean;
  readonly hasMultiTaxRate: boolean;
}

export interface ValidateRunResult {
  readonly rulesetHash: string | null;
  readonly documents: readonly ValidatedDocument[];
  readonly findings: readonly PersistedFinding[];
  readonly parseErrors: number;
}

export interface PersistedFinding {
  readonly docHash: string;
  readonly stage: 'post_map';
  readonly outcome: 'pass' | 'fail' | 'warn';
  readonly rule_id: string | null;
  readonly business_term: string | null;
  readonly xpath: string | null;
  readonly failure_class: FailureClass | null;
  readonly value_shape: ValueShape | null;
  readonly message?: string;
}

/** Wire `value_shape` (snake) → the column type (camel). §2.3, Part III §5. */
function toColumnShape(shape: ContractValueShape | null | undefined): ValueShape | null {
  if (shape === null || shape === undefined) return null;
  return {
    len: shape.len ?? null,
    charset: shape.charset ?? null,
    regexClass: shape.regex_class ?? null,
    expected: shape.expected ?? null,
  };
}

export async function runValidation(
  input: ValidateRunInput,
  log: Logger,
  enqueue: (tx: TxContext, result: ValidateRunResult) => Promise<void>,
): Promise<ValidateRunResult> {
  const access = {
    tenantId: input.tenantId,
    actorId: input.actorId,
    reason: 'audit_delivery' as const,
    ...(input.traceId === undefined ? {} : { traceId: input.traceId }),
  };

  const documents: ValidatedDocument[] = [];
  const persisted: PersistedFinding[] = [];
  let rulesetHash: string | null = null;
  let parseErrors = 0;

  for (let offset = 0; offset < input.invoiceIds.length; offset += VALIDATE_BATCH_SIZE) {
    const chunk = input.invoiceIds.slice(offset, offset + VALIDATE_BATCH_SIZE);
    const loaded = await withTenantAccess(access, (ctx) => loadCanonical(ctx, input, chunk));

    for (const { invoiceId, docHash, doc } of loaded) {
      // Resolved per document. `ublSpecIdentifiers` throws for a profile whose
      // identifiers are unresolved rather than defaulting — the handler checks
      // for that before enqueuing any work, so it does not fire mid-batch.
      const ubl: UblContext = {
        ...input.ubl,
        ...(input.ublIdentifiers ?? ublSpecIdentifiers(input.profile, doc.docType)),
      };

      let response;
      try {
        response = await validateDocument({
          run_id: input.runId,
          document: Buffer.from(toUbl(doc, ubl), 'utf8').toString('base64'),
          syntax: 'UBL-2.1',
          profile: input.profile,
          spec_version: input.specVersion,
          direction: input.direction,
          options: { include_warnings: true, stop_on_first_error: false },
        });
      } catch (err) {
        if (err instanceof ValidatorParseError) {
          // A malformed document is a finding, not an outage. Do not retry.
          parseErrors += 1;
          log.warn('parse_error from sidecar', { doc_hash: docHash, invoice_id: invoiceId });
          await withTenantAccess(access, async (ctx) => {
            await ctx.tx.insert(masterDataDefect).values({
              tenantId: input.tenantId,
              entityId: input.entityId,
              runId: input.runId,
              defectClass: 'parse_error',
              affectedCount: 1,
              sampleShape: null,
              expiresAt: expiresInNinetyDays(),
            });
          });
          continue;
        }
        throw err;
      }

      rulesetHash = response.ruleset_hash;
      documents.push({
        docHash,
        docType: doc.docType,
        scenario: doc.scenario,
        currency: doc.currency,
        lineCount: doc.lines.length,
        hasAllowanceCharge: doc.hasAllowanceCharge,
        hasMultiTaxRate: doc.hasMultiTaxRate,
      });

      const rows = response.findings.length === 0
        ? [passRow(docHash)]
        : response.findings.map((f) => findingRow(docHash, f, response.outcome));
      persisted.push(...rows);

      await withTenantAccess(access, async (ctx) => {
        await writeFindings(ctx, input, invoiceId, docHash, response.spec_version,
          response.ruleset_hash, rows);
      });
    }
  }

  return withTenantAccess(access, async (ctx) => {
    await ctx.tx.update(ingestionRun)
      .set({ status: 'reporting' })
      .where(and(
        eq(ingestionRun.runId, input.runId),
        eq(ingestionRun.tenantId, input.tenantId),
      ));

    const result: ValidateRunResult = { rulesetHash, documents, findings: persisted, parseErrors };
    await enqueue(ctx, result);
    return result;
  });
}

const passRow = (docHash: string): PersistedFinding => ({
  docHash,
  stage: 'post_map',
  outcome: 'pass',
  rule_id: null,
  business_term: null,
  xpath: null,
  failure_class: null,
  value_shape: null,
});

function findingRow(
  docHash: string,
  f: ContractFinding,
  documentOutcome: 'pass' | 'fail' | 'warn',
): PersistedFinding {
  // A finding whose severity is `warning` is a warn even when the document as a
  // whole failed on a different rule.
  const outcome = f.severity === 'warning' ? 'warn' : documentOutcome;
  const row: PersistedFinding = {
    docHash,
    stage: 'post_map',
    outcome,
    rule_id: f.rule_id,
    business_term: f.business_term ?? null,
    xpath: f.xpath ?? null,
    failure_class: f.failure_class ?? null,
    value_shape: toColumnShape(f.value_shape),
  };
  return f.message === null || f.message === undefined ? row : { ...row, message: f.message };
}

async function writeFindings(
  ctx: TxContext,
  input: ValidateRunInput,
  invoiceId: string,
  docHash: string,
  specVersion: string,
  rulesetHash: string,
  rows: readonly PersistedFinding[],
): Promise<void> {
  if (rows.length === 0) return;
  await ctx.tx.insert(finding).values(rows.map((row) => ({
    tenantId: input.tenantId,
    entityId: input.entityId,
    runId: input.runId,
    invoiceId,
    docHash,
    direction: input.direction,
    specId: input.profile,
    specVersion,
    rulesetHash,
    stage: row.stage,
    validator: 'own_schematron',
    outcome: row.outcome,
    ruleId: row.rule_id,
    nativeRuleCode: null,
    severity: null,
    businessTerm: row.business_term,
    xpath: row.xpath,
    failureClass: row.failure_class,
    valueShape: row.value_shape,
    // Templated by the sidecar WITHOUT interpolating the offending value.
    message: row.message ?? null,
    recurrenceKey: recurrenceKey(input.entityHash, row.rule_id, row.xpath, row.value_shape),
    expiresAt: expiresInNinetyDays(),
  })));
}

interface LoadedInvoice {
  readonly invoiceId: string;
  readonly docHash: string;
  readonly doc: CanonicalDoc;
}

/**
 * Rebuilds the canonical document from the persisted rows. It is not re-derived
 * from the raw bytes: those are what `ingest.normalise` already interpreted, and
 * validating a second interpretation of the same file would make the audit
 * report describe a document the pipeline never stored.
 */
async function loadCanonical(
  ctx: TxContext,
  input: ValidateRunInput,
  invoiceIds: readonly string[],
): Promise<LoadedInvoice[]> {
  if (invoiceIds.length === 0) return [];

  const invoices = await ctx.tx.select().from(invoice)
    .where(and(
      eq(invoice.tenantId, input.tenantId),
      inArray(invoice.id, [...invoiceIds]),
    ));

  const lines = await ctx.tx.select().from(invoiceLine)
    .where(and(
      eq(invoiceLine.tenantId, input.tenantId),
      inArray(invoiceLine.invoiceId, [...invoiceIds]),
    ));

  const linesByInvoice = new Map<string, typeof lines>();
  for (const line of lines) {
    const bucket = linesByInvoice.get(line.invoiceId);
    if (bucket === undefined) linesByInvoice.set(line.invoiceId, [line]);
    else bucket.push(line);
  }

  return invoices.map((row) => ({
    invoiceId: row.id,
    docHash: row.docHash,
    doc: {
      docType: row.docType,
      scenario: row.scenario,
      invoiceNumber: row.invoiceNumber,
      issueDate: row.issueDate.toISOString().slice(0, 10),
      currency: row.currency,
      buyerName: row.buyerName,
      buyerTrn: row.buyerTrn,
      sellerTrn: row.sellerTrn,
      predecessorRef: row.predecessorRef,
      lineExtensionMinor: row.lineExtensionMinor,
      taxAmountMinor: row.taxAmountMinor,
      payableMinor: row.payableMinor,
      hasAllowanceCharge: row.hasAllowanceCharge,
      hasMultiTaxRate: row.hasMultiTaxRate,
      lines: (linesByInvoice.get(row.id) ?? [])
        .sort((a, b) => a.lineNumber - b.lineNumber)
        .map((line) => ({
          lineNumber: line.lineNumber,
          description: line.description,
          quantity: line.quantity,
          unitCode: line.unitCode,
          netAmountMinor: line.netAmountMinor,
          taxCategoryCode: line.taxCategoryCode,
          taxRate: line.taxRate,
        })),
      sourceRef: row.id,
    },
  }));
}

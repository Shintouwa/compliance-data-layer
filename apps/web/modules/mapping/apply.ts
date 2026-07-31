/**
 * `map.apply` — the domain half. architecture.md Part IV §4 job 3,
 * Part III §1.2.
 *
 * **A profile cannot be used until `confirmedBy` and `confirmedAt` are set.**
 * AI suggests mappings; a human confirms them; nothing runs on a guess. That
 * rule is enforced HERE, in code — CLAUDE.md §4.4 is explicit that it must not
 * live in a review checklist.
 */

import { and, eq } from 'drizzle-orm';
import { invoice, invoiceLine, ingestionRun, mappingProfile }
  from '@repo/db/schema/client-data';
import type { TxContext } from '@repo/db/transaction';
import { withTenantAccess } from '../tenancy';

/**
 * One business term's derivation. `path` is a dotted path into the source
 * record; `transform` names a transform from a closed set — a free-text
 * expression here would be a scripting language nobody audits.
 */
export interface MappingRule {
  readonly path: string;
  readonly transform?: string;
}

export type MappingDefinition = Readonly<Record<string, MappingRule>>;

/**
 * Business terms that must be mapped before a profile can be used. Part III
 * §1.2: "Unmapped mandatory terms render a red banner listing them by `BT-xx`
 * and block submission."
 */
export const MANDATORY_BUSINESS_TERMS = [
  'BT-1',   // Invoice number
  'BT-2',   // Issue date
  'BT-5',   // Invoice currency code
  'BT-31',  // Seller VAT identifier
  'BT-44',  // Buyer name
  'BT-48',  // Buyer VAT identifier
  'BT-106', // Sum of line net amounts
  'BT-112', // Invoice total with VAT
] as const;

export class UnconfirmedMappingProfile extends Error {
  public override readonly name = 'UnconfirmedMappingProfile';
  public constructor() {
    super(
      'Mapping profile is unconfirmed. AI suggests mappings; a human confirms them ' +
      'before any client data is processed. architecture.md Part III §1.2, Part I §4.4.',
    );
  }
}

export interface ApplyMappingInput {
  readonly runId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly mappingProfileId: string;
  readonly traceId?: string;
}

export interface ApplyMappingResult {
  readonly invoiceIds: readonly string[];
  readonly profileVersion: number;
  readonly unmappedMandatoryTerms: readonly string[];
}

export function unmappedMandatoryTerms(mapping: MappingDefinition): string[] {
  return MANDATORY_BUSINESS_TERMS.filter((term) => mapping[term] === undefined);
}

export async function applyMapping(
  input: ApplyMappingInput,
  enqueue: (tx: TxContext, result: ApplyMappingResult) => Promise<void>,
): Promise<ApplyMappingResult> {
  return withTenantAccess(
    {
      tenantId: input.tenantId,
      actorId: input.actorId,
      reason: 'scheduled_job',
      ...(input.traceId === undefined ? {} : { traceId: input.traceId }),
    },
    async (ctx) => {
      const [profile] = await ctx.tx.select().from(mappingProfile)
        .where(and(
          eq(mappingProfile.id, input.mappingProfileId),
          eq(mappingProfile.tenantId, input.tenantId),
        ));

      if (profile === undefined) {
        throw new UnconfirmedMappingProfile();
      }
      if (profile.confirmedAt === null || profile.confirmedBy === null) {
        throw new UnconfirmedMappingProfile();
      }

      const mapping = profile.mapping as MappingDefinition;
      const missing = unmappedMandatoryTerms(mapping);
      if (missing.length > 0) {
        throw new UnconfirmedMappingProfile();
      }

      const rows = await ctx.tx
        .select({
          id: invoice.id,
          docHash: invoice.docHash,
          docType: invoice.docType,
          scenario: invoice.scenario,
          invoiceNumber: invoice.invoiceNumber,
          issueDate: invoice.issueDate,
          currency: invoice.currency,
          buyerName: invoice.buyerName,
          buyerTrn: invoice.buyerTrn,
          sellerTrn: invoice.sellerTrn,
          predecessorRef: invoice.predecessorRef,
          lineExtensionMinor: invoice.lineExtensionMinor,
          taxAmountMinor: invoice.taxAmountMinor,
          payableMinor: invoice.payableMinor,
        })
        .from(invoice)
        .where(and(eq(invoice.runId, input.runId), eq(invoice.tenantId, input.tenantId)));

      const invoiceIds: string[] = [];
      for (const row of rows) {
        const lines = await ctx.tx.select().from(invoiceLine)
          .where(and(
            eq(invoiceLine.invoiceId, row.id),
            eq(invoiceLine.tenantId, input.tenantId),
          ));

        await ctx.tx.update(invoice)
          .set({
            mappedPayload: {
              profileId: profile.id,
              profileVersion: profile.version,
              terms: projectTerms(mapping, row, lines),
            },
          })
          .where(and(eq(invoice.id, row.id), eq(invoice.tenantId, input.tenantId)));
        invoiceIds.push(row.id);
      }

      await ctx.tx.update(ingestionRun)
        .set({ status: 'validating' })
        .where(and(
          eq(ingestionRun.runId, input.runId),
          eq(ingestionRun.tenantId, input.tenantId),
        ));

      const result: ApplyMappingResult = {
        invoiceIds,
        profileVersion: profile.version,
        unmappedMandatoryTerms: [],
      };
      await enqueue(ctx, result);
      return result;
    },
  );
}

interface InvoiceProjection {
  docHash: string; docType: string; scenario: string; invoiceNumber: string;
  issueDate: Date; currency: string; buyerName: string | null; buyerTrn: string | null;
  sellerTrn: string | null; predecessorRef: string | null;
  lineExtensionMinor: number | null; taxAmountMinor: number | null;
  payableMinor: number | null;
}

/**
 * The canonical document already IS the EN 16931 semantic model — the extractor
 * did that work. The profile records which source field each term came from, so
 * an audit report can explain a derivation four years later. That provenance is
 * why `mapping_profile` is never purged (§2.5).
 */
function projectTerms(
  mapping: MappingDefinition,
  row: InvoiceProjection,
  lines: readonly { lineNumber: number; unitCode: string | null; taxCategoryCode: string | null }[],
): Record<string, { source: string; present: boolean }> {
  const present: Record<string, boolean> = {
    'BT-1': row.invoiceNumber !== '',
    'BT-2': true,
    'BT-5': row.currency !== '',
    'BT-25': row.predecessorRef !== null,
    'BT-31': row.sellerTrn !== null,
    'BT-44': row.buyerName !== null,
    'BT-48': row.buyerTrn !== null,
    'BT-106': row.lineExtensionMinor !== null,
    'BT-110': row.taxAmountMinor !== null,
    'BT-112': row.payableMinor !== null,
    'BT-130': lines.some((l) => l.unitCode !== null),
    'BT-151': lines.some((l) => l.taxCategoryCode !== null),
  };

  const out: Record<string, { source: string; present: boolean }> = {};
  for (const [term, rule] of Object.entries(mapping)) {
    out[term] = { source: rule.path, present: present[term] ?? false };
  }
  return out;
}

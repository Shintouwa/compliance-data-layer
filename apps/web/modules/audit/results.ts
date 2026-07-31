/**
 * What `/audits/[runId]` reads. architecture.md Part III §1.3.
 *
 * **Reads `client_data.finding`, not the corpus.** The two hold the same facts
 * with different lifecycles and different trust boundaries (§2.5); the UI is
 * tenant-scoped and therefore reads the tenant-scoped table.
 *
 * **A raw value must never appear in this UI.** Nothing here selects
 * `buyer_trn`, `buyer_name` or any line description — only rule metadata,
 * counts and `value_shape`.
 */

import { and, eq, sql } from 'drizzle-orm';
import { finding, ingestionRun, invoice, masterDataDefect } from '@repo/db/schema/client-data';
import type { DefectClass, Scenario } from '@repo/db/schema/client-data';
import type { FailureClass, ValueShape } from '@repo/db/schema/_shared';
import { withTenantAccess } from '../tenancy';
import { band } from './score';
import type { ReadinessBand } from './score';

export interface FindingGroup {
  readonly ruleId: string | null;
  readonly businessTerm: string | null;
  readonly failureClass: FailureClass | null;
  readonly severity: string | null;
  readonly xpath: string | null;
  readonly valueShape: ValueShape | null;
  readonly affectedCount: number;
}

export interface DefectRow {
  readonly defectClass: DefectClass;
  readonly affectedCount: number;
  readonly effortMinutes: number | null;
  readonly sampleShape: ValueShape | null;
}

export interface AuditResults {
  readonly runId: string;
  readonly status: string;
  readonly docCount: number | null;
  readonly specVersion: string | null;
  readonly rulesetHash: string | null;
  readonly outcomes: { pass: number; fail: number; warn: number };
  readonly findings: readonly FindingGroup[];
  readonly defects: readonly DefectRow[];
  readonly observedScenarios: readonly Scenario[];
  /**
   * Only what was actually persisted. `ingestion_run.readiness_score` stores
   * the number; the band is derived from it by the one formula in `score.ts`.
   *
   * The per-component contributions are NOT reconstructed here. Splitting a
   * single stored total back into five weighted ratios would require inventing
   * four of them, and Part III §1.4 requires showing the contributions — a
   * fabricated breakdown is worse than none. Whoever needs the breakdown
   * recomputes it from the inputs.
   */
  readonly readiness: { score: number; band: ReadinessBand } | null;
}

export async function auditResults(input: {
  runId: string; tenantId: string; actorId: string; traceId?: string;
}): Promise<AuditResults> {
  return withTenantAccess(
    {
      tenantId: input.tenantId,
      actorId: input.actorId,
      reason: 'audit_delivery',
      ...(input.traceId === undefined ? {} : { traceId: input.traceId }),
    },
    async (ctx) => {
      const [run] = await ctx.tx.select().from(ingestionRun)
        .where(and(
          eq(ingestionRun.runId, input.runId),
          eq(ingestionRun.tenantId, input.tenantId),
        ));
      if (run === undefined) {
        throw new Error(`No ingestion_run ${input.runId} for this tenant.`);
      }

      const outcomeRows = await ctx.tx
        .select({ outcome: finding.outcome, n: sql<number>`count(*)::int` })
        .from(finding)
        .where(and(eq(finding.runId, input.runId), eq(finding.tenantId, input.tenantId)))
        .groupBy(finding.outcome);

      const outcomes = { pass: 0, fail: 0, warn: 0 };
      for (const row of outcomeRows) outcomes[row.outcome] = row.n;

      // Grouped by failure class, sorted by count desc — Part III §1.3.
      const findingRows = await ctx.tx
        .select({
          ruleId: finding.ruleId,
          businessTerm: finding.businessTerm,
          failureClass: finding.failureClass,
          severity: finding.severity,
          xpath: finding.xpath,
          valueShape: finding.valueShape,
          affectedCount: sql<number>`count(*)::int`,
        })
        .from(finding)
        .where(and(
          eq(finding.runId, input.runId),
          eq(finding.tenantId, input.tenantId),
          eq(finding.outcome, 'fail'),
        ))
        .groupBy(
          finding.ruleId, finding.businessTerm, finding.failureClass,
          finding.severity, finding.xpath, finding.valueShape,
        )
        .orderBy(sql`count(*) desc`);

      const defectRows = await ctx.tx
        .select({
          defectClass: masterDataDefect.defectClass,
          affectedCount: masterDataDefect.affectedCount,
          effortMinutes: masterDataDefect.effortMinutes,
          sampleShape: masterDataDefect.sampleShape,
        })
        .from(masterDataDefect)
        .where(and(
          eq(masterDataDefect.runId, input.runId),
          eq(masterDataDefect.tenantId, input.tenantId),
        ));

      const scenarioRows = await ctx.tx
        .selectDistinct({ scenario: invoice.scenario })
        .from(invoice)
        .where(and(eq(invoice.runId, input.runId), eq(invoice.tenantId, input.tenantId)));

      const specRow = findingRows.length > 0
        ? await ctx.tx
          .select({ specVersion: finding.specVersion, rulesetHash: finding.rulesetHash })
          .from(finding)
          .where(and(eq(finding.runId, input.runId), eq(finding.tenantId, input.tenantId)))
          .limit(1)
        : [];

      return {
        runId: run.runId,
        status: run.status,
        docCount: run.docCount,
        specVersion: specRow[0]?.specVersion ?? null,
        rulesetHash: specRow[0]?.rulesetHash ?? null,
        outcomes,
        findings: findingRows,
        defects: defectRows,
        observedScenarios: scenarioRows.map((r) => r.scenario),
        readiness: run.readinessScore === null
          ? null
          : { score: run.readinessScore, band: band(run.readinessScore) },
      };
    },
  );
}

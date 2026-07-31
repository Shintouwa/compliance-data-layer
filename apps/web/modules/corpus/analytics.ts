/**
 * Corpus analytics reads. architecture.md Part I §2.2 — through
 * `ANALYTICS_DATABASE_URL` (`readonly_analytics`), never through `app_user`.
 *
 * These feed client-facing numbers, so they carry a sample size wherever they
 * are rendered. CLAUDE.md §4.4: no remediation suggestion below n = 3, and
 * Part II · M1: the working-capital `basis` flips at n = 40 entities.
 */

import { and, eq, sql } from 'drizzle-orm';
import { analyticsDb } from '@repo/db/analytics-connection';
import { corpusEntity } from '@repo/db/schema/corpus';

/**
 * How many distinct entities the corpus holds for a jurisdiction and source
 * system. The denominator behind `basis: 'estimate' | 'corpus'`.
 */
export async function entityCount(input: {
  jurisdiction: string;
  sourceSystem: string;
}): Promise<number> {
  const [row] = await analyticsDb
    .select({ n: sql<number>`count(*)::int` })
    .from(corpusEntity)
    .where(and(
      eq(corpusEntity.jurisdiction, input.jurisdiction),
      eq(corpusEntity.sysId, input.sourceSystem),
    ));
  return row?.n ?? 0;
}

/**
 * Tenant and entity resolution. architecture.md Part I §1.4.
 *
 * `app` is not tenant-scoped by RLS in the way `client_data` is, so these reads
 * use the ordinary connection. They return the small amount of configuration a
 * job needs — jurisdiction, source system, scenario profile, corpus hashes —
 * and never a client value.
 */

import { and, eq } from 'drizzle-orm';
import { db } from '@repo/db';
import { entity, membership, tenant, user } from '@repo/db/schema/app';
import type { Jurisdiction, SourceSystemVendor } from '@repo/db/schema/_shared';

export interface EntityContext {
  readonly entityId: string;
  readonly tenantId: string;
  readonly jurisdiction: Jurisdiction;
  readonly sourceSystem: SourceSystemVendor;
  readonly tenantCorpusHash: string;
  readonly entityCorpusHash: string;
  readonly sectorCode: string | null;
  readonly sizeBand: string | null;
  readonly country: string;
  readonly scenarioProfile: Record<string, boolean>;
}

export async function resolveEntity(entityId: string): Promise<EntityContext> {
  const [row] = await db
    .select({
      entityId: entity.id,
      tenantId: entity.tenantId,
      jurisdiction: entity.jurisdiction,
      sourceSystem: entity.sourceSystem,
      entityCorpusHash: entity.corpusHash,
      scenarioProfile: entity.scenarioProfile,
      tenantCorpusHash: tenant.corpusHash,
      sectorCode: tenant.sectorCode,
      sizeBand: tenant.sizeBand,
      country: tenant.country,
    })
    .from(entity)
    .innerJoin(tenant, eq(tenant.id, entity.tenantId))
    .where(eq(entity.id, entityId));

  if (row === undefined) {
    throw new Error(`No app.entity row for id ${entityId}.`);
  }

  return {
    entityId: row.entityId,
    tenantId: row.tenantId,
    jurisdiction: row.jurisdiction,
    sourceSystem: row.sourceSystem,
    tenantCorpusHash: row.tenantCorpusHash,
    entityCorpusHash: row.entityCorpusHash,
    sectorCode: row.sectorCode,
    sizeBand: row.sizeBand,
    country: row.country,
    scenarioProfile: row.scenarioProfile,
  };
}

/**
 * The tenant an actor may act for. Membership is the authorisation boundary in
 * the application; RLS is the boundary in the database. Both, always — one is a
 * forgotten `WHERE` clause away from a leak and the other is not.
 */
export async function resolveTenantForActor(
  clerkUserId: string,
  tenantId: string,
): Promise<{ actorId: string; tenantId: string } | null> {
  const [row] = await db
    .select({ actorId: user.id, tenantId: membership.tenantId })
    .from(user)
    .innerJoin(membership, eq(membership.userId, user.id))
    .where(and(eq(user.clerkUserId, clerkUserId), eq(membership.tenantId, tenantId)));

  return row ?? null;
}

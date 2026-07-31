/**
 * Mapping profiles. architecture.md Part I §2.5, Part III §1.2.
 *
 * **Versioned. Never edited in place.** A confirmed profile is the provenance
 * of every run that used it; changing it retroactively rewrites the explanation
 * of an audit report that has already been delivered. `confirmProfile` writes
 * the confirmation; a change writes a new version.
 */

import { and, desc, eq } from 'drizzle-orm';
import { mappingProfile } from '@repo/db/schema/client-data';
import type { Jurisdiction, SourceSystemVendor } from '@repo/db/schema/_shared';
import { withTenantAccess } from '../tenancy';
import type { MappingDefinition } from './apply';
import { unmappedMandatoryTerms } from './apply';

export interface ProfileSummary {
  readonly id: string;
  readonly version: number;
  readonly sourceSystem: SourceSystemVendor;
  readonly jurisdiction: Jurisdiction;
  readonly confirmedAt: Date | null;
  readonly confirmedBy: string | null;
  readonly unmappedMandatoryTerms: readonly string[];
}

export async function listProfiles(input: {
  tenantId: string; actorId: string; entityId?: string;
}): Promise<ProfileSummary[]> {
  return withTenantAccess(
    { tenantId: input.tenantId, actorId: input.actorId, reason: 'client_support' },
    async (ctx) => {
      const rows = await ctx.tx.select().from(mappingProfile)
        .where(eq(mappingProfile.tenantId, input.tenantId))
        .orderBy(desc(mappingProfile.version));

      return rows
        .filter((r) => input.entityId === undefined || r.entityId === input.entityId)
        .map((r) => ({
          id: r.id,
          version: r.version,
          sourceSystem: r.sourceSystem,
          jurisdiction: r.jurisdiction,
          confirmedAt: r.confirmedAt,
          confirmedBy: r.confirmedBy,
          unmappedMandatoryTerms: unmappedMandatoryTerms(r.mapping as MappingDefinition),
        }));
    },
  );
}

export interface CreateProfileInput {
  readonly tenantId: string;
  readonly actorId: string;
  readonly entityId: string | null;
  readonly sourceSystem: SourceSystemVendor;
  readonly jurisdiction: Jurisdiction;
  readonly mapping: MappingDefinition;
}

/**
 * Creates the NEXT version. Never updates an existing row — see the file
 * header. A profile arrives unconfirmed by construction: `confirmedBy` and
 * `confirmedAt` are set only by `confirmProfile`, only by a human.
 */
export async function createProfile(input: CreateProfileInput): Promise<ProfileSummary> {
  return withTenantAccess(
    { tenantId: input.tenantId, actorId: input.actorId, reason: 'client_support' },
    async (ctx) => {
      const [latest] = await ctx.tx
        .select({ version: mappingProfile.version })
        .from(mappingProfile)
        .where(and(
          eq(mappingProfile.tenantId, input.tenantId),
          eq(mappingProfile.sourceSystem, input.sourceSystem),
          eq(mappingProfile.jurisdiction, input.jurisdiction),
        ))
        .orderBy(desc(mappingProfile.version))
        .limit(1);

      const [row] = await ctx.tx.insert(mappingProfile).values({
        tenantId: input.tenantId,
        entityId: input.entityId,
        sourceSystem: input.sourceSystem,
        jurisdiction: input.jurisdiction,
        version: (latest?.version ?? 0) + 1,
        mapping: input.mapping,
        confirmedBy: null,
        confirmedAt: null,
      }).returning();

      if (row === undefined) {
        throw new Error('mapping_profile insert returned no row — RLS context is missing.');
      }

      return {
        id: row.id,
        version: row.version,
        sourceSystem: row.sourceSystem,
        jurisdiction: row.jurisdiction,
        confirmedAt: row.confirmedAt,
        confirmedBy: row.confirmedBy,
        unmappedMandatoryTerms: unmappedMandatoryTerms(input.mapping),
      };
    },
  );
}

export class MandatoryTermsUnmapped extends Error {
  public override readonly name = 'MandatoryTermsUnmapped';
  public constructor(public readonly terms: readonly string[]) {
    super(`Cannot confirm a profile with unmapped mandatory terms: ${terms.join(', ')}.`);
  }
}

/**
 * The human confirmation. `confirmedBy` is `app.user.id` — a person, never a
 * service account, because the whole point of the gate is that a person looked.
 */
export async function confirmProfile(input: {
  tenantId: string; actorId: string; profileId: string; confirmedBy: string;
}): Promise<void> {
  await withTenantAccess(
    { tenantId: input.tenantId, actorId: input.actorId, reason: 'client_support' },
    async (ctx) => {
      const [row] = await ctx.tx.select().from(mappingProfile)
        .where(and(
          eq(mappingProfile.id, input.profileId),
          eq(mappingProfile.tenantId, input.tenantId),
        ));
      if (row === undefined) {
        throw new Error(`No mapping_profile ${input.profileId} for this tenant.`);
      }

      const missing = unmappedMandatoryTerms(row.mapping as MappingDefinition);
      if (missing.length > 0) throw new MandatoryTermsUnmapped(missing);

      await ctx.tx.update(mappingProfile)
        .set({ confirmedBy: input.confirmedBy, confirmedAt: new Date() })
        .where(and(
          eq(mappingProfile.id, input.profileId),
          eq(mappingProfile.tenantId, input.tenantId),
        ));
    },
  );
}

/**
 * Actor and tenant resolution for routes and Server Actions.
 * architecture.md Part I §1.2 (Clerk; orgs → `app.tenant`), Part V §1.2.
 *
 * Two boundaries, both always: Clerk establishes WHO, `app.membership`
 * establishes WHETHER they may act for this tenant, and RLS makes the database
 * refuse the query if the answer was wrong. Application-layer filtering alone
 * is one forgotten `WHERE` clause away from a cross-tenant leak.
 */

import { auth } from '@clerk/nextjs/server';
import { resolveTenantForActor } from '@/modules/tenancy';

export interface TenantActor {
  readonly actorId: string;
  readonly tenantId: string;
}

export class NotAuthenticated extends Error {
  public override readonly name = 'NotAuthenticated';
}

export class NotAMember extends Error {
  public override readonly name = 'NotAMember';
}

/**
 * The Clerk organisation IS the tenant (§1.2). Deriving the tenant from
 * anything the request controls — a path segment, a query parameter, a header —
 * would let a member of one tenant name another.
 */
export async function requireTenantActor(): Promise<TenantActor> {
  const { userId, orgId } = await auth();

  if (userId === null) {
    throw new NotAuthenticated('No Clerk session on this request.');
  }
  if (orgId === undefined) {
    throw new NotAMember(
      'No active Clerk organisation. A tenant is a Clerk org (architecture.md Part I §1.2); ' +
        'without one there is no tenant to scope this request to.',
    );
  }

  const membership = await resolveTenantForActor(userId, orgId);
  if (membership === null) {
    throw new NotAMember(`Clerk user has no app.membership row for tenant ${orgId}.`);
  }
  return membership;
}

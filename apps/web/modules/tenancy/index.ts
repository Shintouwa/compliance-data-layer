/**
 * `tenancy` — tenants, entities, users, memberships, tenant-context resolution,
 * access logging. architecture.md Part I §1.4. First needed: M1.
 *
 * Cross-module imports go through this barrel only (§1.3), enforced by
 * eslint-plugin-boundaries.
 */

export { withTenantAccess } from './with-tenant';
export type { TenantAccess } from './with-tenant';
export { resolveEntity, resolveTenantForActor } from './resolve';
export type { EntityContext } from './resolve';

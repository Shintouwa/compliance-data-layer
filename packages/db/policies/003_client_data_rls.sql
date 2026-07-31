-- packages/db/policies/003_client_data_rls.sql
--
-- 🔒 HUMAN-OWNED — CLAUDE.md §4.3. Review as SQL, not as TypeScript.
-- architecture.md Part I §2.6.
--
-- Application-layer tenant filtering is one forgotten WHERE clause away from a
-- cross-tenant leak, which for this business is not a bug but the end of the
-- company. **Enforce structurally.**
--
-- Applied to EVERY table in client_data. A new table without this fails CI
-- (§3.5, scripts/assert-rls-coverage.sh). Re-applied by `make migrate` after
-- EVERY migration (§2.10).
--
-- **Three details that are not optional. An agent will be tempted to remove
-- each.**
--
--   FORCE ROW LEVEL SECURITY
--       The table owner bypasses the policy — and your migration user *is* the
--       owner. Without FORCE, RLS is decorative.
--
--   current_setting('app.tenant_id', true)
--       The `true` returns NULL instead of raising when unset. Without it, a
--       code path that misses middleware throws instead of returning zero rows.
--
--   FOR ALL + WITH CHECK
--       USING governs reads only. Without WITH CHECK, a cross-tenant INSERT
--       succeeds.
--
-- The context itself is set by `withTenantAccess` (apps/web/modules/tenancy),
-- with `set_config(…, true)` — transaction-local. Never plain SET: a pooled
-- connection would leak the tenant to the next request. CLAUDE.md §4.6.

\set ON_ERROR_STOP on

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'client_data'
  LOOP
    EXECUTE format('ALTER TABLE client_data.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE client_data.%I FORCE  ROW LEVEL SECURITY;', t);
    EXECUTE format($f$
      DROP POLICY IF EXISTS tenant_isolation ON client_data.%I;
      CREATE POLICY tenant_isolation ON client_data.%I
        FOR ALL
        USING      (tenant_id = current_setting('app.tenant_id', true)::uuid)
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
    $f$, t, t);
  END LOOP;
END $$;

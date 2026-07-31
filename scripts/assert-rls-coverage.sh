#!/usr/bin/env bash
# architecture.md Part I §3.5 — one of the three coverage guards.
#
# "What stops a new table or job from silently escaping its protection."
#
# A `client_data` table without RLS and FORCE is a cross-tenant leak waiting for
# the first forgotten WHERE clause (§2.6). `make migrate` re-applies
# 003_client_data_rls.sql after every migration, and this asserts, independently,
# that it worked.
set -euo pipefail

if [ -z "${NEON_BRANCH_URL:-}" ]; then
  if [ "${CDL_SCHEMA_GUARDS:-}" = "skipped" ]; then
    echo "::warning file=scripts/assert-rls-coverage.sh::RLS coverage NOT RUN - no Neon branch was created (see the earlier warning). This is a KNOWN GAP, not a pass. architecture.md Part I §3.5."
    exit 0
  fi
  echo "::error::NEON_BRANCH_URL is not set and the migration step did not report a skip. Something removed scripts/neon-branch-migrate.sh from the pipeline."
  exit 1
fi

psql "$NEON_BRANCH_URL" -tAc "
  SELECT string_agg(c.relname, ', ')
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname='client_data' AND c.relkind='r'
    AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity);
" | grep -q '^$' || { echo "::error::client_data tables missing RLS/FORCE. §2.6."; exit 1; }

# A guard that inspects zero tables passes vacuously. Assert it saw the schema.
tables=$(psql "$NEON_BRANCH_URL" -tAc "
  SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname='client_data' AND c.relkind='r';
")
if [ "${tables:-0}" -lt 1 ]; then
  echo "::error::client_data has no tables. The migration did not run, so this guard proved nothing."
  exit 1
fi

echo "RLS + FORCE present on all ${tables} client_data tables."

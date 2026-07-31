#!/usr/bin/env bash
# architecture.md Part I §3.5 — one of the three coverage guards.
#
# A corpus table without the append-only trigger can be UPDATEd, and the corpus
# is the asset being sold in 2029 (§2.7). `make migrate` re-applies
# 002_corpus_append_only.sql after every migration; this asserts it worked.
set -euo pipefail

if [ -z "${NEON_BRANCH_URL:-}" ]; then
  if [ "${CDL_SCHEMA_GUARDS:-}" = "skipped" ]; then
    echo "::warning file=scripts/assert-corpus-triggers.sh::Corpus trigger coverage NOT RUN - no Neon branch was created (see the earlier warning). This is a KNOWN GAP, not a pass. architecture.md Part I §3.5."
    exit 0
  fi
  echo "::error::NEON_BRANCH_URL is not set and the migration step did not report a skip. Something removed scripts/neon-branch-migrate.sh from the pipeline."
  exit 1
fi

psql "$NEON_BRANCH_URL" -tAc "
  SELECT string_agg(t.tablename, ', ')
  FROM pg_tables t
  WHERE t.schemaname='corpus'
    AND NOT EXISTS (SELECT 1 FROM pg_trigger g
                    JOIN pg_class c ON c.oid=g.tgrelid
                    JOIN pg_namespace n ON n.oid=c.relnamespace
                    WHERE n.nspname='corpus' AND c.relname=t.tablename
                      AND g.tgname='corpus_append_only');
" | grep -q '^$' || { echo "::error::corpus tables missing append-only trigger. §2.7."; exit 1; }

tables=$(psql "$NEON_BRANCH_URL" -tAc "SELECT count(*) FROM pg_tables WHERE schemaname='corpus';")
if [ "${tables:-0}" -lt 1 ]; then
  echo "::error::corpus has no tables. The migration did not run, so this guard proved nothing."
  exit 1
fi

# Belt and braces: prove the trigger actually refuses, rather than trusting that
# a row in pg_trigger means what its name says. A rule that silently discards
# the write would satisfy the query above and violate §2.7 completely.
if psql "$NEON_BRANCH_URL" -v ON_ERROR_STOP=1 -q -c "
  BEGIN;
  INSERT INTO corpus.specification (spec_id, jurisdiction, name, version, effective_from)
    VALUES ('cdl-guard-probe', 'XX', 'guard probe', '0', now());
  UPDATE corpus.specification SET name = 'mutated' WHERE spec_id = 'cdl-guard-probe';
  ROLLBACK;
" >/dev/null 2>&1; then
  echo "::error::corpus.specification accepted an UPDATE. The append-only trigger is not enforcing. §2.7."
  exit 1
fi

echo "Append-only trigger present on all ${tables} corpus tables, and it refuses an UPDATE."

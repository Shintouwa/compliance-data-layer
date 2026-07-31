#!/usr/bin/env bash
# architecture.md Part I §2.10 — "Every PR gets an isolated Neon branch; CI runs
# a migration dry-run there." Part I §3.5 wires it into the pipeline.
#
# Creates a throwaway Neon branch, applies the generated migrations AND
# packages/db/policies/*.sql to it, and exports NEON_BRANCH_URL for the three
# coverage guards that follow. The branch is deleted by the cleanup step in
# .github/workflows/ci.yml, which runs with if: always().
#
# WHY THE POLICIES ARE APPLIED HERE TOO: a table added by Drizzle has no RLS and
# no append-only trigger until those scripts re-run (§2.10). Migrating without
# them would hand the guards a database where every new table is unprotected —
# and they would correctly fail, for the wrong reason.
set -euo pipefail

API="https://console.neon.tech/api/v2"

# --------------------------------------------------------------------------
# Preconditions. A missing secret is a KNOWN GAP announced as a warning, not a
# silent pass — the same treatment the KoSIT cross-check gets, and for the same
# reason: a check that quietly succeeds without running reports agreement it
# never established.
# --------------------------------------------------------------------------
if [ -z "${NEON_API_KEY:-}" ]; then
  echo "::warning file=.github/workflows/ci.yml::Neon branch migration NOT RUN - NEON_API_KEY is not set. The migration dry-run and the RLS / corpus-trigger coverage guards (architecture.md Part I §3.5) are therefore NOT RUN either. This is a KNOWN GAP, not a pass."
  if [ -n "${GITHUB_ENV:-}" ]; then
    echo "CDL_SCHEMA_GUARDS=skipped" >> "$GITHUB_ENV"
  fi
  exit 0
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "::error::psql is required to apply packages/db/policies/*.sql. ubuntu-latest ships it; a local run needs postgresql-client."
  exit 1
fi

api() {
  local method="$1" path="$2"
  shift 2
  curl --silent --show-error --fail-with-body \
    -X "$method" "${API}${path}" \
    -H "Authorization: Bearer ${NEON_API_KEY}" \
    -H "Accept: application/json" \
    -H "Content-Type: application/json" \
    "$@"
}

# --------------------------------------------------------------------------
# Project id. Explicit if supplied; otherwise discovered ONLY when the account
# holds exactly one project. Never guessed — CLAUDE.md §4.7(1) forbids
# inventing an external identifier, and writing migrations to the wrong project
# is not a recoverable mistake.
# --------------------------------------------------------------------------
project_id="${NEON_PROJECT_ID:-}"
if [ -z "$project_id" ]; then
  projects_json=$(api GET "/projects")
  count=$(printf '%s' "$projects_json" | jq '.projects | length')
  if [ "$count" != "1" ]; then
    echo "::error::NEON_PROJECT_ID is not set and the account has ${count} projects, so it cannot be inferred. Add NEON_PROJECT_ID to the repository secrets."
    exit 1
  fi
  project_id=$(printf '%s' "$projects_json" | jq -r '.projects[0].id')
fi

branch_name="ci-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}"
echo "Creating Neon branch ${branch_name} in project ${project_id}"

branch_json=$(api POST "/projects/${project_id}/branches" -d "$(jq -n \
  --arg name "$branch_name" \
  '{branch: {name: $name}, endpoints: [{type: "read_write"}]}')")

branch_id=$(printf '%s' "$branch_json" | jq -r '.branch.id')
branch_url=$(printf '%s' "$branch_json" | jq -r '.connection_uris[0].connection_uri')

if [ -z "$branch_url" ] || [ "$branch_url" = "null" ]; then
  echo "::error::Neon returned no connection URI for branch ${branch_id}."
  exit 1
fi

# Hand the branch to the cleanup step even if everything below fails.
if [ -n "${GITHUB_ENV:-}" ]; then
  {
    echo "NEON_PROJECT_ID=${project_id}"
    echo "NEON_BRANCH_ID=${branch_id}"
    echo "NEON_BRANCH_URL=${branch_url}"
  } >> "$GITHUB_ENV"
fi
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "branch_id=${branch_id}" >> "$GITHUB_OUTPUT"
fi

# --------------------------------------------------------------------------
# Migrate, then re-apply the policies — the order `make migrate` uses (§2.10).
# --------------------------------------------------------------------------
echo "Applying migrations"
( cd packages/db && DATABASE_URL="$branch_url" pnpm drizzle-kit migrate )

# Throwaway credentials for a throwaway branch. The roles must exist for the
# grants and the RLS policies to bind to something.
rand() { head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24; }

echo "Applying packages/db/policies/*.sql"
psql "$branch_url" -v ON_ERROR_STOP=1 \
  -v app_user_pw="$(rand)" \
  -v corpus_writer_pw="$(rand)" \
  -v analytics_pw="$(rand)" \
  -f packages/db/policies/001_roles_and_grants.sql
psql "$branch_url" -v ON_ERROR_STOP=1 -f packages/db/policies/002_corpus_append_only.sql
psql "$branch_url" -v ON_ERROR_STOP=1 -f packages/db/policies/003_client_data_rls.sql

echo "Neon branch ${branch_name} migrated."

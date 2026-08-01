/**
 * Drizzle Kit configuration. architecture.md Part I §2.10.
 *
 * Migrations are **forward-only**. There are no down migrations — rolling back
 * means a new forward migration. Generated migrations are 🔒 and human-reviewed
 * **as SQL**, not as TypeScript, before merge.
 *
 * `make migrate` re-applies `policies/*.sql` after every migration: a new table
 * added by Drizzle has no RLS and no append-only trigger until those scripts
 * re-run. That is wired into the Makefile target, not left to memory, and CI
 * asserts coverage independently (§3.5).
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// `make migrate` runs drizzle-kit from packages/db (see comment below), but
// .env lives at the repo root, so the default `dotenv/config` CWD lookup
// misses it — point at it explicitly.
const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(here, '../../.env') });

export default defineConfig({
  dialect: 'postgresql',
  schema: './schema/*.ts',
  out: './migrations',
  // Drizzle only manages the three schemas it declares. `pgboss` is created and
  // owned by pg-boss at runtime and must never appear in a generated migration.
  schemaFilter: ['app', 'client_data', 'corpus'],
  strict: true,
  verbose: true,
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
});

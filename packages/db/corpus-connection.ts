/**
 * `@repo/db/corpus-connection` — the `corpus_writer` connection.
 *
 * architecture.md Part I §2.2 and Part IV §4 job 5: **`corpus.record` is the
 * only job that connects through this handle.** Every other job uses `app_user`,
 * which has no `INSERT` on `corpus`.
 *
 * `corpus_writer` holds `SELECT, INSERT` on `corpus` and nothing else — no
 * `UPDATE`, no `DELETE`, and no access to `app` or `client_data` at all. Two
 * layers back that up: the `REVOKE` in `001_roles_and_grants.sql` stops the
 * common case at the permission layer, and the `corpus_append_only` trigger
 * (§2.7) raises for anything run as superuser or by a future role.
 *
 * `INSERT … ON CONFLICT DO NOTHING` is safe here — it inserts or does nothing,
 * never updates, so it does not trip the trigger. Do not "improve" a dimension
 * upsert to `onConflictDoUpdate`.
 */

import { lazyDb } from './pool';

export const corpusDb = lazyDb('corpus_writer');

export type CorpusDb = typeof corpusDb;

/**
 * `@repo/db/analytics-connection` — the `readonly_analytics` connection.
 *
 * architecture.md Part I §2.2. `SELECT` on `corpus` only. Used by the dashboard
 * moat block, benchmarking, supplier scoring, and by
 * `modules/audit/working-capital.ts`, whose `basis` flips from `estimate` to
 * `corpus` at n = 40 entities (Part II · M1).
 *
 * Reads that inform a client-facing number go through this handle rather than
 * `app_user` so that an aggregate query cannot accidentally be written as a
 * mutation, and so the corpus read path is separately revocable.
 */

import { lazyDb } from './pool';

export const analyticsDb = lazyDb('readonly_analytics');

export type AnalyticsDb = typeof analyticsDb;

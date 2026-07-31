/**
 * `GET /api/cron/work` — the pg-boss worker, as a Vercel Cron Job.
 *
 * architecture.md Part I §1.7 and §1.9 pull in opposite directions: pg-boss
 * workers want a process that outlives a request, and the web app runs on
 * Vercel, which has none. §4.6 forbids the usual escapes — no Redis, no second
 * web deployable. The remaining shape is a scheduled request that claims and
 * runs whatever is queued, then returns. `jobs/drain.ts` explains the mechanics
 * and the latency tradeoff; configuration is in apps/web/README.md.
 *
 * **The route is a route.** It authenticates, calls one function, serialises the
 * result. Every decision about what to run lives in `jobs/` (CLAUDE.md §4.6:
 * business logic in `app/` routes is forbidden).
 */

import { timingSafeEqual } from 'node:crypto';
import { drainQueues } from '@/jobs/drain';
import { getBoss } from '@/lib/queue';
import { logger, serialiseError } from '@/lib/logger';

// `pg` needs `fs` and `dns`; the edge runtime has neither.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Vercel's cap for this invocation, in seconds. It must exceed
 * `CRON_WORK_BUDGET_MS` — the drain stops itself with headroom to settle the
 * job it is holding, and only a platform kill can leave a job `active` with
 * nobody running it.
 */
export const maxDuration = 60;

/**
 * Constant-time, and length-safe: `timingSafeEqual` throws on a length
 * mismatch, so the lengths are compared first and the result folded in rather
 * than returned early.
 */
function secretMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function GET(request: Request): Promise<Response> {
  const expected = process.env.CRON_SECRET;

  // Closed by default. An unset secret is a misconfiguration, not permission —
  // the alternative is a public endpoint that drains the queue for anyone who
  // guesses the path.
  if (expected === undefined || expected === '') {
    logger.error('cron drain refused: CRON_SECRET is not set');
    return Response.json(
      { status: 'misconfigured', detail: 'CRON_SECRET is not set on this deployment.' },
      { status: 503 },
    );
  }

  const presented = request.headers.get('authorization') ?? '';
  const prefix = 'Bearer ';
  if (!presented.startsWith(prefix) || !secretMatches(presented.slice(prefix.length), expected)) {
    // No detail. A 401 that explains itself is a 401 that helps.
    return Response.json({ status: 'unauthorized' }, { status: 401 });
  }

  try {
    const result = await drainQueues(getBoss());
    return Response.json({ status: 'ok', ...result });
  } catch (err) {
    // A drain that cannot start — no database, unmigrated pgboss schema — is an
    // outage of the whole pipeline. 503 so the cron shows as failing rather
    // than as a minute that quietly did nothing.
    logger.error('cron drain failed to run', serialiseError(err));
    return Response.json(
      { status: 'error', detail: err instanceof Error ? err.name : 'unknown' },
      { status: 503 },
    );
  }
}

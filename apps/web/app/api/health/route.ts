/**
 * `GET /api/health` — Better Stack uptime, Datadog heartbeat. Part V §2.
 *
 * This is the WEB deployable's health. The sidecar has its own `/health`, which
 * validates a golden invoice; this one checks that the web app can reach the
 * database, because a web app that renders but cannot query is not up.
 *
 * It does not proxy the sidecar's health: two deployables, two probes. A
 * combined probe hides which one is down.
 */

import { sql } from 'drizzle-orm';
import { db } from '@repo/db';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    await db.execute(sql`SELECT 1`);
  } catch (err) {
    return Response.json(
      { status: 'degraded', detail: err instanceof Error ? err.name : 'unknown' },
      { status: 503 },
    );
  }
  return Response.json({ status: 'ok' });
}

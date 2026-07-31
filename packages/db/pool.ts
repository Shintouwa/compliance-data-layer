/**
 * Connection construction, shared by the three connection modules.
 *
 * architecture.md Part I §2.2 — three roles, three connection strings. **This
 * separation is what makes the append-only guarantee real rather than
 * aspirational.** Do not consolidate them; an agent that does has removed the
 * guarantee. CLAUDE.md §4.6.
 *
 * | Variable                   | Role                 | Used by                                |
 * |----------------------------|----------------------|----------------------------------------|
 * | `DATABASE_URL`             | `app_user`           | Web app, all jobs EXCEPT corpus.record |
 * | `CORPUS_DATABASE_URL`      | `corpus_writer`      | `corpus.record` only                   |
 * | `ANALYTICS_DATABASE_URL`   | `readonly_analytics` | Dashboard moat block, benchmarking     |
 *
 * Construction is deliberately lazy — see `lazyDb`.
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

export type ConnectionRole = 'app_user' | 'corpus_writer' | 'readonly_analytics';

const VAR_FOR_ROLE: Record<ConnectionRole, string> = {
  app_user: 'DATABASE_URL',
  corpus_writer: 'CORPUS_DATABASE_URL',
  readonly_analytics: 'ANALYTICS_DATABASE_URL',
};

/**
 * Two roles pointing at one connection string is the failure §2.2 exists to
 * prevent, and it is invisible at runtime — everything works, and the corpus is
 * writable by the web app. Checked here so it is loud instead.
 */
function assertNotConsolidated(role: ConnectionRole, url: string): void {
  if (role === 'app_user') return;
  const appUrl = process.env.DATABASE_URL;
  if (appUrl !== undefined && appUrl === url) {
    throw new Error(
      `${VAR_FOR_ROLE[role]} is identical to DATABASE_URL. Two roles pointing at one ` +
        'connection string removes the append-only and least-privilege guarantees ' +
        'they exist to provide. architecture.md Part I §2.2; CLAUDE.md §4.6.',
    );
  }
}

function connectionString(role: ConnectionRole): string {
  const varName = VAR_FOR_ROLE[role];
  const url = process.env[varName];
  if (url === undefined || url === '') {
    throw new Error(
      `${varName} is not set. It is the connection string for the ${role} role ` +
        '(architecture.md Part I §2.2).',
    );
  }
  assertNotConsolidated(role, url);
  return url;
}

/**
 * Next.js dev reloads modules on every edit; without a cache each reload leaks a
 * pool and Neon runs out of connections in about a minute.
 */
const POOLS = new Map<ConnectionRole, Pool>();

export function poolFor(role: ConnectionRole): Pool {
  const existing = POOLS.get(role);
  if (existing) return existing;
  const created = new Pool({
    connectionString: connectionString(role),
    // Serverless functions are short-lived and Neon's pooler fans out; a large
    // per-instance pool starves the project's connection budget.
    max: role === 'app_user' ? 10 : 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  POOLS.set(role, created);
  return created;
}

export type Database = NodePgDatabase;

/**
 * `import { db } from '@repo/db'` must be free of side effects: a unit test
 * that imports a module for its pure functions must not need a database URL,
 * and a route that never queries must not open a pool.
 *
 * The laziness is on the DRIZZLE instance, not on the pool. Deferring only the
 * pool does not work — `drizzle()` inspects the client it is handed (its
 * `isConfig` probe reads properties), so a lazy pool is resolved at
 * construction and the environment is read anyway. Verified: it threw
 * `DATABASE_URL is not set` from a test that touches no database at all.
 */
export function lazyDb(role: ConnectionRole): Database {
  let real: Database | undefined;
  const resolve = (): Database => (real ??= drizzle(poolFor(role)));

  return new Proxy({} as Database, {
    get(_target, property, receiver): unknown {
      const instance = resolve();
      const value = Reflect.get(instance, property, receiver) as unknown;
      return typeof value === 'function' ? value.bind(instance) : value;
    },
    has: (_target, property) => Reflect.has(resolve(), property),
    getPrototypeOf: () => Reflect.getPrototypeOf(resolve()),
  });
}

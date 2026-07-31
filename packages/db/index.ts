/**
 * `@repo/db` — the `app_user` connection.
 *
 * architecture.md Part I §2.2. Used by the web app and by every job EXCEPT
 * `corpus.record`, which connects as `corpus_writer` through
 * `@repo/db/corpus-connection`. `app_user` has `SELECT` on `corpus` and no
 * `INSERT`, so a corpus write through this handle fails at the permission layer
 * rather than succeeding quietly against the wrong role.
 *
 * No `schema` option is passed to `drizzle()`: the relational query builder
 * (`db.query.*`) needs a flat table map, and `app.tenant` / `corpus.tenant` and
 * `app.entity` / `corpus.entity` collide by name. Queries are written against
 * the imported table objects, which are unambiguous.
 */

import { lazyDb } from './pool';

export const db = lazyDb('app_user');

export type Db = typeof db;

export * from './schema/_shared';
export * as appSchema from './schema/app';
export * as clientDataSchema from './schema/client-data';
export * as corpusSchema from './schema/corpus';

/**
 * Schema barrel. `drizzle.config.ts` points at `./schema/*.ts` directly, so this
 * file exists for application code and for `drizzle(pool, { schema })`.
 *
 * `app` and `corpus` both define a table called `tenant`, and `client_data` and
 * `corpus` both define `entity`. They are different tables in different schemas
 * with different lifecycles, so they are re-exported under their qualified
 * names rather than flattened — `export *` from all three would silently drop
 * one of each pair.
 */

export * as appSchema from './app';
export * as clientDataSchema from './client-data';
export * as corpusSchema from './corpus';
export * from './_shared';

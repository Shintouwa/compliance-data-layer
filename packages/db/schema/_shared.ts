/**
 * Shared column helpers and the closed unions every schema draws from.
 * architecture.md Part I §2.3.
 *
 * Drizzle enums are avoided in favour of `text()` with `$type<Union>()` plus a
 * database `CHECK`. Enum migrations are a frequent failure mode (`ALTER TYPE` to
 * add, near-impossible to remove); `CHECK` constraints are transparent in `\d+`.
 * **Deliberate. Do not "improve" to `pgEnum`.** CLAUDE.md §4.6.
 *
 * Three dimensions are present from the FIRST migration so that M6 and M7 are
 * new handlers rather than a rewrite: `direction` on every document-shaped
 * table, `dataset` on the ingestion path, and a cross-tenant-stable counterparty
 * identity. Moving M0 → M7 never drops a column or rewrites a table.
 */

import { sql } from 'drizzle-orm';
import { check, timestamp } from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

export const tsCol = (n: string) => timestamp(n, { withTimezone: true, mode: 'date' });
export const createdAt = () => tsCol('created_at').notNull().defaultNow();
export const updatedAt = () => tsCol('updated_at').notNull().defaultNow();

export type FlowDirection = 'ar' | 'ap';
export type Dataset = 'invoice' | 'gl_ledger' | 'vat_return' | 'asp_response';
export type Jurisdiction = 'AE' | 'OM' | 'BH' | 'SA' | 'FR' | 'DE' | 'PL' | 'ES' | 'BE' | 'IN';
export type SourceSystemVendor =
  | 'tally' | 'sap' | 'netsuite' | 'dynamics_bc' | 'odoo'
  | 'zoho_books' | 'quickbooks' | 'focus' | 'sage_300' | 'csv' | 'other';
export type SizeBand = 'lt_10' | '10_49' | '50_249' | '250_999' | 'gte_1000';

export type FailureClass =
  | 'missing_mandatory' | 'invalid_code' | 'format_mismatch'
  | 'arithmetic_mismatch' | 'identifier_invalid' | 'cardinality'
  | 'cross_field_dependency' | 'encoding' | 'date_logic' | 'rounding';

export interface ValueShape {
  len: number | null;
  charset: 'numeric' | 'alpha' | 'alnum' | 'mixed' | 'empty' | null;
  regexClass: string | null;
  expected: string | null;
}

export type ResolutionAction = 'field_map_change' | 'master_data_fix'
  | 'erp_config_change' | 'spec_misinterpretation' | 'asp_config' | 'wontfix';

/* -------------------------------------------------------------------------- */
/* The runtime half of `$type<Union>()`                                        */
/* -------------------------------------------------------------------------- */

/**
 * `$type<Union>()` is erased at runtime — it constrains TypeScript and nothing
 * else. Without a `CHECK`, an unmapped extractor writes `docType='Inv'` and the
 * corpus quietly accumulates a value no query groups by. §2.3 pairs the two
 * deliberately; the type alone is half a constraint.
 *
 * The literal arrays below are the single source for both halves: the `as const`
 * tuple types the column, and the same tuple builds the `CHECK`.
 */
export const FLOW_DIRECTIONS = ['ar', 'ap'] as const satisfies readonly FlowDirection[];
export const DATASETS = ['invoice', 'gl_ledger', 'vat_return', 'asp_response'] as const satisfies readonly Dataset[];
export const JURISDICTIONS = ['AE', 'OM', 'BH', 'SA', 'FR', 'DE', 'PL', 'ES', 'BE', 'IN'] as const satisfies readonly Jurisdiction[];
export const SOURCE_SYSTEM_VENDORS = [
  'tally', 'sap', 'netsuite', 'dynamics_bc', 'odoo',
  'zoho_books', 'quickbooks', 'focus', 'sage_300', 'csv', 'other',
] as const satisfies readonly SourceSystemVendor[];
export const SIZE_BANDS = ['lt_10', '10_49', '50_249', '250_999', 'gte_1000'] as const satisfies readonly SizeBand[];
export const FAILURE_CLASSES = [
  'missing_mandatory', 'invalid_code', 'format_mismatch',
  'arithmetic_mismatch', 'identifier_invalid', 'cardinality',
  'cross_field_dependency', 'encoding', 'date_logic', 'rounding',
] as const satisfies readonly FailureClass[];
export const RESOLUTION_ACTIONS = [
  'field_map_change', 'master_data_fix', 'erp_config_change',
  'spec_misinterpretation', 'asp_config', 'wontfix',
] as const satisfies readonly ResolutionAction[];
export const OUTCOMES = ['pass', 'fail', 'warn'] as const;
export const SEVERITIES = ['fatal', 'error', 'warning'] as const;

/**
 * `CHECK ("col" IN (…))`. A nullable column needs no `OR col IS NULL`: `NULL IN
 * (…)` evaluates to NULL, and a CHECK passes on NULL. One form covers both, and
 * it reads identically in `\d+`.
 *
 * `sql.raw` rather than parameter interpolation: a bound parameter renders as
 * `$1`, which is not legal in DDL, so the literals must reach the generated
 * migration inline. The values are our own closed unions — the guard below
 * fails loudly if one ever stops being a bare identifier-shaped token.
 */
export function inList(name: string, column: AnyPgColumn, values: readonly string[]) {
  for (const v of values) {
    if (!/^[a-z0-9_]+$/i.test(v)) {
      throw new Error(
        `inList(${name}): ${JSON.stringify(v)} is not identifier-shaped and cannot be ` +
          'inlined into DDL safely. architecture.md Part I §2.3.',
      );
    }
  }
  const list = values.map((v) => `'${v}'`).join(', ');
  return check(name, sql.raw(`"${column.name}" IN (${list})`));
}

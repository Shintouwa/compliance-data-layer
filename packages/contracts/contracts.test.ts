/**
 * Contract guards on the committed artefacts.
 *
 * `scripts/contract-check.sh` proves the artefacts match the Python models.
 * These tests assert the properties the rest of the system depends on being
 * true of that contract — the things that would still be "in sync" while being
 * wrong.
 */

import { describe, expect, it } from 'vitest';

import openapi from './validator.openapi.json' with { type: 'json' };
import type { Finding, ValidateResponse, ValueShape } from './index.js';

type Schemas = Record<string, { properties?: Record<string, unknown>; enum?: string[] }>;
const schemas = (openapi as { components: { schemas: Schemas } }).components.schemas;

describe('the validator API surface', () => {
  it('exposes the endpoints Part III §5 names', () => {
    const paths = Object.keys((openapi as { paths: Record<string, unknown> }).paths);
    expect(paths).toContain('/validate');
    expect(paths).toContain('/specs');
    expect(paths).toContain('/health');
  });
});

describe('ValidateResponse', () => {
  it('carries ruleset_hash', () => {
    // Part I §2.9: two invocations of the same rule under different ruleset
    // hashes are different facts. Without the hash the corpus cannot be
    // replayed, so this field is not optional decoration.
    expect(Object.keys(schemas.ValidateResponse?.properties ?? {})).toContain(
      'ruleset_hash',
    );
  });

  it('types outcome as the three-way union, not a boolean', () => {
    // "Did it fail?" is not an answer. warn is distinct from fail.
    const outcome: ValidateResponse['outcome'] = 'warn';
    expect(['pass', 'fail', 'warn']).toContain(outcome);
  });
});

describe('Finding', () => {
  it('has no field that could carry a raw commercial value', () => {
    // CLAUDE.md §4.6: raw values never reach a log, error, message, corpus or
    // UI. If a field named like this ever appears, the boundary has moved.
    const fields = Object.keys(schemas.Finding?.properties ?? {});
    for (const forbidden of ['value', 'raw_value', 'actual', 'actual_value', 'document']) {
      expect(fields).not.toContain(forbidden);
    }
  });

  it('always offers a rule_id and an xpath', () => {
    // §4.4: "If a client asks why you said something fails, the answer is a
    // rule ID and an XPath. Never 'the model determined.'"
    const fields = Object.keys(schemas.Finding?.properties ?? {});
    expect(fields).toContain('rule_id');
    expect(fields).toContain('xpath');
    expect(fields).toContain('value_shape');
  });

  it('binds severity to the three published levels', () => {
    const severity: NonNullable<Finding['severity']> = 'fatal';
    expect(['fatal', 'error', 'warning']).toContain(severity);
  });
});

describe('ValueShape', () => {
  it('is exactly the four fields in packages/db/schema/_shared.ts', () => {
    // The TypeScript ValueShape and the Python one must not diverge: the corpus
    // asserts on this object on both sides of the boundary.
    expect(Object.keys(schemas.ValueShape?.properties ?? {}).sort()).toEqual([
      'charset',
      'expected',
      'len',
      'regex_class',
    ]);
  });

  it('admits the shapes redaction.py actually produces', () => {
    const absent: ValueShape = { len: null, charset: null, regex_class: null, expected: null };
    const empty: ValueShape = {
      len: 0,
      charset: 'empty',
      regex_class: null,
      expected: '^[0-9]{15}$',
    };
    expect(absent.len).toBeNull();
    expect(empty.charset).toBe('empty');
  });
});

describe('failure classification', () => {
  it('offers exactly the ten FailureClass values from Part I §2.3', () => {
    // The corpus asserts on classification, not just detection, and the
    // Drizzle FailureClass union must stay identical to this one.
    const property = schemas.Finding?.properties?.failure_class;
    const serialised = JSON.stringify(property);
    for (const value of [
      'missing_mandatory',
      'invalid_code',
      'format_mismatch',
      'arithmetic_mismatch',
      'identifier_invalid',
      'cardinality',
      'cross_field_dependency',
      'encoding',
      'date_logic',
      'rounding',
    ]) {
      expect(serialised).toContain(value);
    }
  });
});

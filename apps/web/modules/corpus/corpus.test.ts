import { describe, expect, it } from 'vitest';
import type { ValueShape } from '@repo/db/schema/_shared';
import { assertRedacted } from './assert-redacted';
import { lineCountBucket, recurrenceKey } from './recurrence';

const shape = (over: Partial<ValueShape> = {}): ValueShape => ({
  len: 0, charset: 'empty', regexClass: null, expected: '^[0-9]{15}$', ...over,
});

describe('assertRedacted', () => {
  it('passes a shape-only finding', () => {
    expect(() => {
      assertRedacted({ value_shape: shape(), message: 'Expected 15 digits; received empty.' });
    }).not.toThrow();
  });

  it('fires on a UAE TRN in the message — the leak path people forget', () => {
    expect(() => {
      assertRedacted({ value_shape: shape(), message: 'Invalid TRN: 100000000000003' });
    }).toThrow(/REDACTION FAILURE/);
  });

  it('fires on a TRN that reached the shape', () => {
    expect(() => {
      assertRedacted({ value_shape: shape({ expected: '100000000000003' }) });
    }).toThrow(/REDACTION FAILURE/);
  });

  it('fires on an IBAN and on an email address', () => {
    expect(() => { assertRedacted({ value_shape: null, message: 'AE070331234567890123456' }); })
      .toThrow(/REDACTION FAILURE/);
    expect(() => { assertRedacted({ value_shape: null, message: 'a.b@example.ae' }); })
      .toThrow(/REDACTION FAILURE/);
  });

  it('names the failure as a Sev-1 with the section that explains it', () => {
    expect(() => { assertRedacted({ value_shape: null, message: '100000000000003' }); })
      .toThrow(/Sev-1[\s\S]*§2\.9/);
  });

  it('still detects a bare TRN when value_shape is null', () => {
    // The §6 snippet concatenates JSON.stringify(value_shape) onto the message.
    // With a null shape that prepends the literal "null", which destroys the
    // word boundary before the digits and suppresses the match, in exactly
    // the case a missing_mandatory finding produces. Probed separately instead.
    expect(() => { assertRedacted({ value_shape: null, message: '100000000000003' }); })
      .toThrow(/REDACTION FAILURE/);
    expect(() => { assertRedacted({ value_shape: null, message: 'x100000000000003' }); })
      .not.toThrow();
  });
});

describe('recurrenceKey', () => {
  it('is deterministic', () => {
    const a = recurrenceKey('entity-hash', 'PINT-AE-R041', '/Invoice/cac:X', shape());
    const b = recurrenceKey('entity-hash', 'PINT-AE-R041', '/Invoice/cac:X', shape());
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('separates fields so two different facts cannot collide', () => {
    // Without a separator, (len 1, charset "2") and (len 12, charset "") would
    // serialise identically — one key for two different failures, and every
    // recurrence statistic derived from it would be wrong.
    const a = recurrenceKey('e', 'R', '/x', shape({ len: 1, charset: null, expected: null }));
    const b = recurrenceKey('e', 'R', '/x', shape({ len: 12, charset: null, expected: null }));
    expect(a).not.toBe(b);
  });

  it('distinguishes an absent shape from an empty one', () => {
    expect(recurrenceKey('e', 'R', '/x', null))
      .not.toBe(recurrenceKey('e', 'R', '/x', shape({ expected: null })));
  });

  it('changes when the entity, rule or xpath changes', () => {
    const base = recurrenceKey('e', 'R', '/x', null);
    expect(recurrenceKey('e2', 'R', '/x', null)).not.toBe(base);
    expect(recurrenceKey('e', 'R2', '/x', null)).not.toBe(base);
    expect(recurrenceKey('e', 'R', '/y', null)).not.toBe(base);
  });

  it('treats a null rule id and a null xpath as absent, not as a crash', () => {
    expect(recurrenceKey('e', null, null, null)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('lineCountBucket', () => {
  it('buckets rather than disclosing an exact count', () => {
    expect(lineCountBucket(0)).toBe('1');
    expect(lineCountBucket(1)).toBe('1');
    expect(lineCountBucket(2)).toBe('2-5');
    expect(lineCountBucket(5)).toBe('2-5');
    expect(lineCountBucket(6)).toBe('6-20');
    expect(lineCountBucket(20)).toBe('6-20');
    expect(lineCountBucket(21)).toBe('21-100');
    expect(lineCountBucket(100)).toBe('21-100');
    expect(lineCountBucket(101)).toBe('100+');
    expect(lineCountBucket(9999)).toBe('100+');
  });
});

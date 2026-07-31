import { describe, expect, it } from 'vitest';
import { valueShape } from './shape';

/**
 * `apps/validator/src/validator/redaction.py` 🔒 is the specification. These
 * cases are taken from it, so the two implementations cannot drift silently.
 */
describe('valueShape', () => {
  it('reproduces the redaction.py regex_class example', () => {
    expect(valueShape('AE-12345').regexClass).toBe('[A-Z]{2}[^A-Za-z0-9]{1}[0-9]{5}');
  });

  it('classifies charsets the way _classify does', () => {
    expect(valueShape('123456789012345').charset).toBe('numeric');
    expect(valueShape('abcDEF').charset).toBe('alpha');
    expect(valueShape('abc123').charset).toBe('alnum');
    expect(valueShape('abc 123').charset).toBe('mixed');
    expect(valueShape('').charset).toBe('empty');
    expect(valueShape(null).charset).toBeNull();
  });

  it('carries no character from the value', () => {
    const raw = 'ahmed.hassan@example.ae';
    const shape = valueShape(raw);
    const serialised = JSON.stringify(shape);
    for (const fragment of ['ahmed', 'hassan', 'example', '@', '.ae']) {
      expect(serialised).not.toContain(fragment);
    }
  });

  it('nulls any field whose string form IS the value (_enforce_no_echo)', () => {
    // The value "1" has len 1, and String(1) === "1" — so `len` would disclose
    // the value itself, and is suppressed.
    expect(valueShape('1').len).toBeNull();
    // "7" has len 1 too, but String(1) !== "7", so len discloses nothing.
    expect(valueShape('7').len).toBe(1);
    expect(valueShape('12').len).toBe(2);
  });

  it('collapses a high-entropy value rather than fingerprinting it', () => {
    const alternating = 'a1'.repeat(40);
    expect(valueShape(alternating).regexClass).toBe(`[\\s\\S]{${String(alternating.length)}}`);
  });

  it('keeps `expected`, which is rule metadata rather than client data', () => {
    expect(valueShape('', '^[0-9]{15}$')).toEqual({
      len: 0,
      charset: 'empty',
      regexClass: null,
      expected: '^[0-9]{15}$',
    });
  });
});

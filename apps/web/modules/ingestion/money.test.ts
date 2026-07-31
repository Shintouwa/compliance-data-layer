import { describe, expect, it } from 'vitest';
import {
  isKnownCurrency, MalformedAmount, minorToDecimal, toMinor, tryToMinor, UnknownCurrency,
} from './money';

describe('toMinor', () => {
  it('scales by the currency exponent', () => {
    expect(toMinor('1000.00', 'AED')).toBe(100_000);
    expect(toMinor('1000', 'AED')).toBe(100_000);
    expect(toMinor('0.07', 'AED')).toBe(7);
    expect(toMinor('1.5', 'AED')).toBe(150);
  });

  it('handles three-decimal currencies', () => {
    expect(toMinor('1.234', 'BHD')).toBe(1234);
    expect(toMinor('1', 'OMR')).toBe(1000);
  });

  it('does not go through a float', () => {
    // parseFloat('0.07') * 100 === 7.000000000000001. The whole reason this
    // function does string arithmetic.
    expect(toMinor('0.07', 'AED')).toBe(7);
    expect(toMinor('1234567890.12', 'AED')).toBe(123_456_789_012);
  });

  it('accepts a leading sign and thousands separators', () => {
    expect(toMinor('-42.50', 'AED')).toBe(-4250);
    expect(toMinor('1,000.00', 'AED')).toBe(100_000);
  });

  it('refuses more significant fraction digits than the currency has', () => {
    expect(() => toMinor('1.005', 'AED')).toThrow(MalformedAmount);
    // Trailing zeros are not significant.
    expect(toMinor('1.500', 'AED')).toBe(150);
  });

  it('refuses a currency it has no exponent for, rather than assuming 2', () => {
    expect(() => toMinor('10.00', 'JPY')).toThrow(UnknownCurrency);
    expect(() => toMinor('10.00', 'XYZ')).toThrow(UnknownCurrency);
    expect(isKnownCurrency('JPY')).toBe(false);
    expect(isKnownCurrency('aed')).toBe(true);
  });

  it('refuses text', () => {
    expect(() => toMinor('one thousand', 'AED')).toThrow(MalformedAmount);
    expect(() => toMinor('', 'AED')).toThrow(MalformedAmount);
  });

  it('never puts the offending value in the message', () => {
    try {
      toMinor('AE100000000000001', 'AED');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as Error).message).not.toContain('AE100000000000001');
    }
  });
});

describe('tryToMinor', () => {
  it('reports the reason instead of throwing', () => {
    expect(tryToMinor('10.00', 'AED')).toEqual({ ok: true, minor: 1000 });
    expect(tryToMinor('10.00', 'JPY')).toEqual({ ok: false, reason: 'unknown_currency' });
    expect(tryToMinor('abc', 'AED')).toEqual({ ok: false, reason: 'malformed' });
    expect(tryToMinor(null, 'AED')).toEqual({ ok: false, reason: 'malformed' });
    expect(tryToMinor(undefined, 'AED')).toEqual({ ok: false, reason: 'malformed' });
  });
});

describe('minorToDecimal', () => {
  it('round-trips', () => {
    for (const [decimal, currency] of [
      ['1000.00', 'AED'], ['0.07', 'AED'], ['-42.50', 'AED'], ['1.234', 'BHD'],
    ] as const) {
      expect(minorToDecimal(toMinor(decimal, currency), currency)).toBe(decimal);
    }
  });

  it('pads amounts smaller than one unit', () => {
    expect(minorToDecimal(7, 'AED')).toBe('0.07');
    expect(minorToDecimal(0, 'AED')).toBe('0.00');
    expect(minorToDecimal(5, 'BHD')).toBe('0.005');
  });
});

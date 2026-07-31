/**
 * Decimal → minor units. Pure, exact, and deliberately unhelpful about
 * currencies it does not know.
 *
 * `client_data.invoice.*_minor` and `invoice_line.net_amount_minor` are
 * `bigint`, so an amount has to be scaled by the currency's minor-unit
 * exponent. **The exponent is external data.** ISO 4217 amends it (a
 * redenomination changes it), and getting it wrong scales an invoice by 10 or
 * 1000 — a wrong answer of the exact kind §1.1 calls company-ending.
 *
 * So: a currency that is not in the table below produces `null` amounts and a
 * `currency_inconsistent` defect on the run, never a guessed exponent. The
 * document is still ingested and still validated; only the money is withheld,
 * and the defect register says so. **The bad rows are the product.**
 *
 * ⚠️ RESOLVE FROM PRIMARY SOURCE. This table is the in-scope subset only, and
 * carries the same caveat as `apps/validator/src/validator/codelists/*.json`:
 * it is `partial`, it must be regenerated from the ISO 4217 maintenance-agency
 * file, and until then its absence of a currency means "unknown", never
 * "invalid".
 */

/** Jurisdictions in scope: AE, OM, BH, SA, FR, DE, PL, ES, BE, IN (§2.3). */
const MINOR_UNIT_EXPONENT: Readonly<Record<string, number>> = {
  AED: 2,
  BHD: 3,
  EUR: 2,
  GBP: 2,
  INR: 2,
  OMR: 3,
  PLN: 2,
  SAR: 2,
  USD: 2,
};

export class UnknownCurrency extends Error {
  public override readonly name = 'UnknownCurrency';
  public constructor(public readonly currency: string) {
    super(
      `No ISO 4217 minor-unit exponent on file for "${currency}". Amounts are left ` +
        'null rather than scaled by a guessed exponent. modules/ingestion/money.ts.',
    );
  }
}

export class MalformedAmount extends Error {
  public override readonly name = 'MalformedAmount';
}

export function isKnownCurrency(currency: string): boolean {
  return currency.toUpperCase() in MINOR_UNIT_EXPONENT;
}

export function minorUnitExponent(currency: string): number {
  const exponent = MINOR_UNIT_EXPONENT[currency.toUpperCase()];
  if (exponent === undefined) throw new UnknownCurrency(currency);
  return exponent;
}

/**
 * Exact string arithmetic. Never `parseFloat` — `parseFloat('0.07') * 100` is
 * `7.000000000000001`, and `Math.round` hides that until the one input where it
 * does not.
 */
export function toMinor(decimal: string, currency: string): number {
  const exponent = minorUnitExponent(currency);
  const trimmed = decimal.trim().replace(/,/g, '');
  const match = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(trimmed);
  if (match === null || (match[2] === '' && (match[3] ?? '') === '')) {
    throw new MalformedAmount(`Not a decimal number (${String(trimmed.length)} characters).`);
  }

  const sign = match[1] === '-' ? -1 : 1;
  const whole = match[2] ?? '';
  const fraction = match[3] ?? '';

  if (fraction.replace(/0+$/, '').length > exponent) {
    throw new MalformedAmount(
      `More significant fraction digits than ${currency} has minor units (${String(exponent)}).`,
    );
  }

  const padded = (whole + fraction.padEnd(exponent, '0').slice(0, exponent)) || '0';
  const value = Number(padded);
  if (!Number.isSafeInteger(value)) {
    throw new MalformedAmount('Amount exceeds Number.MAX_SAFE_INTEGER in minor units.');
  }
  return sign * value;
}

/** `toMinor` that reports failure instead of throwing, for row-level tolerance. */
export function tryToMinor(
  decimal: string | null | undefined,
  currency: string,
): { ok: true; minor: number } | { ok: false; reason: 'unknown_currency' | 'malformed' } {
  if (decimal === null || decimal === undefined || decimal.trim() === '') {
    return { ok: false, reason: 'malformed' };
  }
  try {
    return { ok: true, minor: toMinor(decimal, currency) };
  } catch (err) {
    if (err instanceof UnknownCurrency) return { ok: false, reason: 'unknown_currency' };
    if (err instanceof MalformedAmount) return { ok: false, reason: 'malformed' };
    throw err;
  }
}

/**
 * Minor units back to the decimal string a UBL document carries. Exact: string
 * surgery on the integer, never `value / 100`.
 */
export function minorToDecimal(minor: number, currency: string): string {
  const exponent = minorUnitExponent(currency);
  const sign = minor < 0 ? '-' : '';
  const digits = String(Math.abs(minor)).padStart(exponent + 1, '0');
  if (exponent === 0) return sign + digits;
  return `${sign}${digits.slice(0, -exponent)}.${digits.slice(-exponent)}`;
}

/**
 * `value_shape` for defects found during EXTRACTION.
 *
 * architecture.md Part I §2.9 is explicit that the authoritative derivation
 * lives in `apps/validator/src/validator/redaction.py` 🔒, before the value
 * crosses the HTTP boundary. That covers everything the sidecar sees.
 *
 * `master_data_defect` rows are the gap: `ingest.normalise` finds them while
 * parsing a Tally or CSV export, which is before any sidecar call exists, and
 * `master_data_defect.sample_shape` still must never hold a raw value.
 *
 * This is therefore a deliberate second implementation of the SAME derivation,
 * kept byte-compatible with `redaction.py` (`_classify`, `_char_class`,
 * `_regex_class`, `_MAX_RUNS`) so the two produce identical shapes for
 * identical input. `shape.test.ts` pins the examples from that file.
 *
 * **`redaction.py` remains the specification.** If the two ever disagree, this
 * file is wrong.
 */

import type { ValueShape } from '@repo/db/schema/_shared';

/** redaction.py `_MAX_RUNS`. Above this, the signature itself starts to leak. */
const MAX_RUNS = 32;

type Charset = NonNullable<ValueShape['charset']>;

function classify(value: string): Charset {
  if (value === '') return 'empty';
  if (/^\d+$/.test(value)) return 'numeric';
  if (/^[A-Za-z]+$/.test(value)) return 'alpha';
  if (/^[A-Za-z0-9]+$/.test(value)) return 'alnum';
  return 'mixed';
}

function charClass(char: string): string {
  if (/\d/.test(char)) return '[0-9]';
  if (/[A-Z]/.test(char)) return '[A-Z]';
  if (/[a-z]/.test(char)) return '[a-z]';
  if (/\s/.test(char)) return '[\\s]';
  // Everything else — punctuation, symbols, non-ASCII letters — collapses to a
  // single generic class. Emitting the literal character here would put an "@"
  // or a "-" from the client's value into the shape. Structure, not content.
  return '[^A-Za-z0-9]';
}

/**
 * Run-length encode `value` as a character-class signature.
 * `"AE-12345"` → `"[A-Z]{2}[^A-Za-z0-9]{1}[0-9]{5}"`.
 */
function regexClass(value: string): string | null {
  if (value === '') return null;

  const runs: { cls: string; count: number }[] = [];
  for (const char of value) {
    const cls = charClass(char);
    const last = runs.at(-1);
    if (last?.cls === cls) {
      last.count += 1;
    } else {
      runs.push({ cls, count: 1 });
    }
    if (runs.length > MAX_RUNS) return `[\\s\\S]{${String(value.length)}}`;
  }
  return runs.map((r) => `${r.cls}{${String(r.count)}}`).join('');
}

/**
 * redaction.py `_enforce_no_echo` — M0 exit criterion 3. Null any field whose
 * string form equals the input, because a one-character numeric value has
 * `len: 1` and `"1"` is the value.
 */
function enforceNoEcho(shape: ValueShape, raw: string): ValueShape {
  return {
    len: String(shape.len) === raw ? null : shape.len,
    charset: shape.charset === raw ? null : shape.charset,
    regexClass: shape.regexClass === raw ? null : shape.regexClass,
    expected: shape.expected === raw ? null : shape.expected,
  };
}

/**
 * Derive the shape of a client value. **The value itself does not leave this
 * function.**
 */
export function valueShape(raw: string | null | undefined, expected: string | null = null):
ValueShape {
  if (raw === null || raw === undefined) {
    return { len: null, charset: null, regexClass: null, expected };
  }
  return enforceNoEcho(
    { len: raw.length, charset: classify(raw), regexClass: regexClass(raw), expected },
    raw,
  );
}

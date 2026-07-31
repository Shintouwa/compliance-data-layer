/**
 * `recurrence_key` — `hash(entity_hash, rule_id, xpath, value_shape)`.
 * architecture.md Part I §2.9.
 *
 * This is the join that connects a failure to its fix: `corpus.validation_event`
 * and `corpus.resolution_event` share nothing else. §2.9 calls resolution "THE
 * MORE VALUABLE TABLE" — failures are commodity, fixes are proprietary — and
 * this key is the only thing tying the two together.
 *
 * It must therefore be STABLE across runs and across releases. The serialisation
 * below is explicit and ordered rather than `JSON.stringify(valueShape)`,
 * because object key order is an implementation detail and a reordering would
 * silently fork every historical key, breaking every recurrence statistic in
 * the corpus without any test noticing.
 *
 * Part IV §4 job 1 makes the same point from the other end: re-ingesting a
 * duplicate export **corrupts the `recurrence_key` statistics the whole moat
 * depends on.**
 */

import { createHash } from 'node:crypto';
import type { ValueShape } from '@repo/db/schema/_shared';

/**
 * A separator that cannot be produced by any of the joined fields. Joining on
 * `''` would let `len=1, charset="2"` and `len=12, charset=""` hash to the same
 * key — a silent collision between two different facts.
 */
const SEP = '\u001f';

/** Field order is part of the key. Appending is safe; reordering is not. */
function canonicaliseShape(shape: ValueShape | null | undefined): string {
  if (shape === null || shape === undefined) return 'no-shape';
  return [
    'shape',
    String(shape.len ?? ''),
    shape.charset ?? '',
    shape.regexClass ?? '',
    shape.expected ?? '',
  ].join(SEP);
}

export function recurrenceKey(
  entityHash: string,
  ruleId: string | null | undefined,
  xpath: string | null | undefined,
  valueShape: ValueShape | null | undefined,
): string {
  const parts = [
    entityHash,
    ruleId ?? '',
    xpath ?? '',
    canonicaliseShape(valueShape),
  ].join(SEP);
  return createHash('sha256').update(parts).digest('hex');
}

/**
 * An exact line count is weakly identifying, so the corpus stores a bucket.
 * §2.9, `corpus.document.line_count_bucket`.
 */
export function lineCountBucket(lineCount: number): '1' | '2-5' | '6-20' | '21-100' | '100+' {
  if (lineCount <= 1) return '1';
  if (lineCount <= 5) return '2-5';
  if (lineCount <= 20) return '6-20';
  if (lineCount <= 100) return '21-100';
  return '100+';
}

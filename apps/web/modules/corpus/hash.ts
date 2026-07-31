/**
 * Corpus identity hashing. architecture.md Part I §2.8.
 *
 * HMAC rather than a plain hash: deterministic (rows join across time),
 * non-reversible (the corpus is not personal data), and unguessable — plain
 * `sha256(uuid)` is brute-forceable against a known tenant list.
 */

import { createHmac } from 'node:crypto';
import { corpusEnv } from '../../lib/env';

/**
 * 32+ bytes, Doppler, **never rotated without a documented re-keying plan.**
 * Read through `corpusEnv()` rather than `process.env.CORPUS_PEPPER!` so that a
 * missing pepper fails with a sentence explaining what it is, instead of
 * silently hashing the string "undefined" into the permanent corpus.
 */
const pepper = (): string => corpusEnv().CORPUS_PEPPER;

export const corpusHash = (kind: 'tenant' | 'entity', id: string): string =>
  createHmac('sha256', pepper()).update(`${kind}:${id}`).digest('hex');

/**
 * Counterparty hashes MUST derive from normalised jurisdiction+TRN, never from
 * an internal id — that is what makes the same supplier resolve to the same
 * hash across two unrelated tenants, and it is the mechanism behind the Year-3
 * two-sided network effect.
 *
 * Getting this wrong is NOT RECOVERABLE: hashes derived from internal ids
 * cannot be re-linked later without re-identifying the parties, which is
 * exactly what the corpus design forbids.
 */
export const counterpartyHash = (jurisdiction: string, trn: string): string =>
  createHmac('sha256', pepper())
    .update(`counterparty:${jurisdiction.toUpperCase()}:${trn.replace(/[\s-]/g, '')}`)
    .digest('hex');

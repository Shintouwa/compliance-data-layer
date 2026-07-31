/**
 * `ingestion` — SFTP, signed upload, API pull, checksums, envelope encryption,
 * raw storage. architecture.md Part I §1.4. First needed: M1.
 *
 * Part I §1.10, the data-residency boundary, states the rule this module
 * exists to hold:
 *
 * > **Every function that touches a raw invoice value lives in
 * > `modules/ingestion` or `apps/validator`, and never returns a raw value to
 * > any caller.**
 *
 * So `crypto.ts` is deliberately NOT re-exported. `openBlob` is reachable only
 * from inside this directory, which is what makes "decryption happens only
 * inside `ingest.normalise`" (Part V §1.4) a property of the code rather than a
 * comment. Cross-module imports go through this barrel only (§1.3).
 */

export { docHash, sha256Bytes } from './canonical';
export type {
  CanonicalDoc, CanonicalLine, ExtractionDefect, ExtractionResult, Extractor,
  ExtractorOptions,
} from './canonical';

export { detectFormat, extractorFor, UnsupportedSource } from './extractors';
export type { SourceFormat } from './extractors';

export {
  isKnownCurrency, MalformedAmount, minorToDecimal, minorUnitExponent, toMinor, tryToMinor,
  UnknownCurrency,
} from './money';

export { receiveDocument } from './receive';
export type { ReceiveInput, ReceiveResult } from './receive';

export { normaliseRun } from './normalise';
export type { NormaliseInput, NormaliseResult } from './normalise';

export { createIngestionRun } from './run';
export type { CreateIngestionRunInput } from './run';

export {
  EVIDENCE_RETENTION_YEARS, expiresInNinetyDays, expiresInSevenYears, RAW_RETENTION_DAYS,
} from './retention';

export { deleteObjects, storageKeyFor } from './storage';

export { valueShape } from './shape';

/**
 * `corpus` — all `corpus.*` writes; hashing, redaction assertion, analytics
 * reads. architecture.md Part I §1.4. First needed: **M1 — day zero.**
 *
 * Cross-module imports go through this barrel only (§1.3).
 */

export { assertRedacted } from './assert-redacted';
export { corpusHash, counterpartyHash } from './hash';
export { lineCountBucket, recurrenceKey } from './recurrence';
export { recordCorpus, seedSpecCatalogue, SpecCatalogueIncomplete } from './record';
export type {
  CorpusDocumentInput, CorpusFindingInput, RecordCorpusInput, RecordCorpusResult,
  SeedSpecCatalogueInput, SpecCatalogueRule,
} from './record';
export { entityCount } from './analytics';

/**
 * `audit` — readiness orchestration, scenario coverage, working-capital calc,
 * readiness score. architecture.md Part I §1.4. First needed: M1.
 *
 * Cross-module imports go through this barrel only (§1.3).
 */

export { auditResults } from './results';
export type { AuditResults, DefectRow, FindingGroup } from './results';
export { band, readinessScore, WEIGHTS } from './score';
export type {
  ReadinessBand, ReadinessScore, ScoreComponent, ScoreContribution, ScoreInputs,
} from './score';
export { CORPUS_BASIS_THRESHOLD, frozenReceivables } from './working-capital';
export type { FrozenReceivables, FrozenReceivablesInput } from './working-capital';
export { scenarioCoverage } from './coverage';
export type { ScenarioCoverage } from './coverage';
export { runValidation, VALIDATE_BATCH_SIZE } from './validate';
export type {
  PersistedFinding, ValidateRunInput, ValidateRunResult, ValidatedDocument,
} from './validate';

/**
 * `mapping` — ERP field → EN 16931 profiles; per-source-system adapters.
 * architecture.md Part I §1.4. First needed: M1.
 *
 * Cross-module imports go through this barrel only (§1.3).
 */

export { applyMapping, MANDATORY_BUSINESS_TERMS, UnconfirmedMappingProfile, unmappedMandatoryTerms }
  from './apply';
export type {
  ApplyMappingInput, ApplyMappingResult, MappingDefinition, MappingRule,
} from './apply';
export { confirmProfile, createProfile, listProfiles } from './profile';
export type { ProfileSummary } from './profile';
export { MissingSpecIdentifiers, toUbl } from './ubl';
export type { UblContext } from './ubl';

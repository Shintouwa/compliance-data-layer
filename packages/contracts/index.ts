/**
 * `@repo/contracts` — the validator API surface, generated and committed.
 *
 * architecture.md Part I §1.6. `validator.openapi.json` and `validator.d.ts` are
 * generated from `apps/validator/src/validator/models.py` by
 * `make contract-update`, and both are committed. The web app imports the types
 * from here and NEVER hand-writes a validator request or response shape.
 *
 * This file is the only hand-written part of the package: it names the schemas
 * that matter so callers do not have to reach through `components['schemas']`.
 */

import type { components, operations, paths } from './validator.js';

export type { components, operations, paths };

type Schemas = components['schemas'];

export type ValidateRequest = Schemas['ValidateRequest'];
export type ValidateResponse = Schemas['ValidateResponse'];
export type Finding = Schemas['Finding'];

/**
 * The ONLY representation of a failing value that crosses the sidecar boundary.
 * architecture.md Part I §2.9. Derived in `redaction.py` before serialisation.
 *
 * If you find yourself wanting the raw value here, the answer is no — see
 * CLAUDE.md §4.6, "Raw values in logs, errors, messages, corpus, or UI".
 */
export type ValueShape = Schemas['ValueShape'];

export type SpecDescriptor = Schemas['SpecDescriptor'];
export type SpecsResponse = Schemas['SpecsResponse'];
export type HealthResponse = Schemas['HealthResponse'];

export type ParseErrorBody = Schemas['ParseErrorBody'];
export type UnknownSpecBody = Schemas['UnknownSpecBody'];
export type EngineFailureBody = Schemas['EngineFailureBody'];
export type InvalidRequestBody = Schemas['InvalidRequestBody'];

/** Every error shape `/validate` can return, discriminated on `error`. */
export type ValidatorErrorBody =
  | ParseErrorBody
  | UnknownSpecBody
  | EngineFailureBody
  | InvalidRequestBody;

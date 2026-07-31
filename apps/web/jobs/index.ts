/**
 * pg-boss handlers — architecture.md Part IV.
 *
 * `app/` routes and `modules/` never import a handler; they enqueue through
 * `enqueueInTransaction`, inside the transaction of the domain write that
 * justifies the job (Part IV §7).
 */

export { bootQueues, start, startWorkers } from './boot';
export { budgetFromEnv, DEFAULT_BUDGET_MS, drainQueues, ensureStarted } from './drain';
export type { DrainOptions, DrainResult } from './drain';
export { enqueueInTransaction, txExecutor } from './enqueue';
export { defineHandler } from './_handler';
export type { BaseJobPayload, JobCtx, RegisteredHandler } from './_handler';
export { HANDLERS } from './handlers';
export { idempotent, LeaseHeld, UnrecoverableError } from './idempotent';
export { ALL_JOB_NAMES, JOB, QUEUES, queueSpec } from './registry';
export type { JobName, Milestone } from './registry';

/**
 * Environment access. architecture.md Part I §1.9, Part V §1.1.
 *
 * Zod at every I/O boundary, no exceptions (§1.2) — the process environment is
 * an I/O boundary. Nothing in this app reads `process.env` directly; a missing
 * secret must fail with the name of the variable and what it is for, not with
 * `undefined is not a function` four call frames later.
 *
 * Validation is LAZY. Reading the whole environment at module load would make
 * importing a pure extractor into a unit test require R2 credentials. Each
 * getter validates only the group it owns, on first use, and caches.
 */

import { z } from 'zod';

/* -------------------------------------------------------------------------- */
/* §1.9 — the commercial-use line. A module-level side effect, deliberately.   */
/* -------------------------------------------------------------------------- */

/**
 * Vercel Hobby is restricted to non-commercial use and Vercel enforces it with
 * account disablement. For a compliance vendor, an outage caused by a licensing
 * violation is not an infrastructure incident — it is a reference-destroying
 * event. architecture.md Part I §1.9.
 */
if (process.env.NODE_ENV === 'production' && process.env.VERCEL_PLAN !== 'pro') {
  throw new Error('Production requires Vercel Pro (commercial use). architecture.md §1.9.');
}

/* -------------------------------------------------------------------------- */

function lazy<T>(name: string, schema: z.ZodType<T>, read: () => unknown): () => T {
  let cached: { value: T } | undefined;
  return () => {
    if (cached) return cached.value;
    const parsed = schema.safeParse(read());
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ');
      throw new Error(`Environment group "${name}" is not configured — ${detail}`);
    }
    cached = { value: parsed.data };
    return cached.value;
  };
}

const nonEmpty = (what: string) => z.string().min(1, `required (${what})`);

/* -------------------------------------------------------------------------- */
/* Corpus hashing                                                              */
/* -------------------------------------------------------------------------- */

/**
 * 32+ bytes, held in Doppler, **never rotated without a documented re-keying
 * plan** — every `corpus_hash` in the database derives from it, and a rotation
 * without a plan silently forks every entity into a new identity. §2.8.
 */
export const corpusEnv = lazy(
  'corpus',
  z.object({
    CORPUS_PEPPER: z.string().min(32, 'must be at least 32 characters (architecture.md §2.8)'),
  }),
  () => ({ CORPUS_PEPPER: process.env.CORPUS_PEPPER }),
);

/* -------------------------------------------------------------------------- */
/* Validator sidecar                                                           */
/* -------------------------------------------------------------------------- */

export const validatorEnv = lazy(
  'validator',
  z.object({
    VALIDATOR_URL: z.string().url('must be the sidecar base URL, e.g. https://…herokuapp.com'),
    VALIDATOR_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  }),
  () => ({
    VALIDATOR_URL: process.env.VALIDATOR_URL,
    VALIDATOR_TIMEOUT_MS: process.env.VALIDATOR_TIMEOUT_MS,
  }),
);

/* -------------------------------------------------------------------------- */
/* Object storage — Cloudflare R2 (S3-compatible)                              */
/* -------------------------------------------------------------------------- */

export const storageEnv = lazy(
  'storage',
  z.object({
    R2_ACCOUNT_ID: nonEmpty('Cloudflare account id'),
    R2_ACCESS_KEY_ID: nonEmpty('R2 access key'),
    R2_SECRET_ACCESS_KEY: nonEmpty('R2 secret key'),
    R2_BUCKET: nonEmpty('R2 bucket holding raw client documents'),
  }),
  () => ({
    R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
    R2_BUCKET: process.env.R2_BUCKET,
  }),
);

/* -------------------------------------------------------------------------- */
/* Envelope encryption — Part V §1.4                                           */
/* -------------------------------------------------------------------------- */

/**
 * The master key that wraps every per-blob AES-256-GCM data key. R2 encrypts at
 * rest already; this is the second layer, so that **an R2 credential leak alone
 * does not expose client invoices.**
 */
export const cryptoEnv = lazy(
  'crypto',
  z.object({
    BLOB_MASTER_KEY: z
      .string()
      .regex(/^[0-9a-f]{64}$/i, 'must be 32 bytes hex-encoded (64 hex characters)'),
  }),
  () => ({ BLOB_MASTER_KEY: process.env.BLOB_MASTER_KEY }),
);

/* -------------------------------------------------------------------------- */
/* Runtime posture                                                             */
/* -------------------------------------------------------------------------- */

export const isProduction = (): boolean => process.env.NODE_ENV === 'production';

/**
 * pg-boss workers need a process that outlives a request. Vercel's serverless
 * runtime does not provide one, so the job runner is started only where this is
 * set. See apps/web/instrumentation.ts.
 */
export const isJobRunner = (): boolean => process.env.JOB_RUNNER === '1';

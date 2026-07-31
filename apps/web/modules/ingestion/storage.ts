/**
 * Object storage. architecture.md Part I §1.2, Part V §1.4.
 *
 * Only sealed bytes are written here — `sealBlob` runs first, always. R2's own
 * at-rest encryption is the first layer; the envelope is the second, and the
 * second is the one that survives a leaked R2 credential.
 *
 * Storage keys are `tenant/<tenantId>/run/<runId>/<checksum>`: tenant-first so
 * a bucket policy or a lifecycle rule can be scoped per tenant, and
 * checksum-named so the duplicate-detection rule in Part IV §4 job 1 has
 * something to be idempotent against.
 *
 * ---
 *
 * TWO BACKENDS, CHOSEN BY WHETHER R2 IS CONFIGURED
 *
 * Cloudflare R2 is the real one. When `R2_ACCOUNT_ID` is absent the module
 * writes the same sealed bytes to a local directory instead, so the whole
 * ingestion pipeline — receive → normalise → map → validate → corpus — runs on
 * a laptop with no bucket and no cloud credentials.
 *
 * **The local backend refuses to engage in production.** A serverless
 * filesystem is per-invocation and ephemeral: a run would write its raw
 * documents, report success, and find them gone on the next request, with
 * `raw_document.storage_key` pointing at nothing and `expires_at` promising a
 * 90-day residency the bytes never had. That is a silent success over lost
 * client data, so an unconfigured production process fails at the first write
 * with the names of the four variables it needs.
 *
 * The fallback is a development convenience and nothing more. It is not a
 * second supported deployment target, and `tmp/` is gitignored.
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { DeleteObjectsCommand, GetObjectCommand, PutObjectCommand, S3Client }
  from '@aws-sdk/client-s3';
import { isProduction, storageEnv } from '../../lib/env';

/* -------------------------------------------------------------------------- */
/* Key construction                                                            */
/* -------------------------------------------------------------------------- */

export function storageKeyFor(tenantId: string, runId: string, checksum: string): string {
  return `tenant/${tenantId}/run/${runId}/${checksum}`;
}

/* -------------------------------------------------------------------------- */
/* Backend selection                                                           */
/* -------------------------------------------------------------------------- */

interface StorageBackend {
  readonly kind: 'r2' | 'local';
  put(key: string, ciphertext: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  remove(keys: readonly string[]): Promise<number>;
}

/**
 * Read live rather than cached: `lib/env` validates lazily so that importing a
 * pure extractor into a unit test does not require R2 credentials, and a test
 * that sets the variable after import must see it.
 */
function r2IsConfigured(): boolean {
  const accountId = process.env.R2_ACCOUNT_ID;
  return accountId !== undefined && accountId !== '';
}

export class LocalStorageRefusedInProduction extends Error {
  public override readonly name = 'LocalStorageRefusedInProduction';
  public constructor() {
    super(
      'Object storage is not configured and NODE_ENV=production. The local-filesystem ' +
        'fallback is a development convenience: a serverless filesystem does not survive ' +
        'the invocation, so raw client documents would be reported as stored and then be ' +
        'gone, with raw_document.storage_key pointing at nothing. Set R2_ACCOUNT_ID, ' +
        'R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET. architecture.md Part V §1.4.',
    );
  }
}

let backend: StorageBackend | undefined;

function storage(): StorageBackend {
  if (backend) return backend;
  if (r2IsConfigured()) {
    backend = r2Backend();
  } else {
    if (isProduction()) throw new LocalStorageRefusedInProduction();
    backend = localBackend();
  }
  return backend;
}

/** Test seam, and the escape hatch when a process changes environment. */
export function __resetStorageBackendForTesting(): void {
  backend = undefined;
  client = undefined;
}

/** Which backend is in use. For the startup log line and for tests. */
export const storageBackendKind = (): 'r2' | 'local' => storage().kind;

/* -------------------------------------------------------------------------- */
/* Cloudflare R2 (S3-compatible)                                               */
/* -------------------------------------------------------------------------- */

let client: S3Client | undefined;

function s3(): S3Client {
  if (client) return client;
  const env = storageEnv();
  client = new S3Client({
    region: 'auto',
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  });
  return client;
}

function r2Backend(): StorageBackend {
  return {
    kind: 'r2',

    async put(key, ciphertext) {
      await s3().send(new PutObjectCommand({
        Bucket: storageEnv().R2_BUCKET,
        Key: key,
        Body: ciphertext,
        ContentType: 'application/octet-stream',
      }));
    },

    async get(key) {
      const response = await s3().send(new GetObjectCommand({
        Bucket: storageEnv().R2_BUCKET,
        Key: key,
      }));
      if (response.Body === undefined) {
        throw new Error(`R2 object ${key} has no body.`);
      }
      return response.Body.transformToByteArray();
    },

    async remove(keys) {
      let deleted = 0;
      // S3 DeleteObjects caps at 1000 keys per request.
      for (let offset = 0; offset < keys.length; offset += 1000) {
        const batch = keys.slice(offset, offset + 1000);
        const response = await s3().send(new DeleteObjectsCommand({
          Bucket: storageEnv().R2_BUCKET,
          Delete: { Objects: batch.map((Key) => ({ Key })) },
        }));
        deleted += response.Deleted?.length ?? 0;
      }
      return deleted;
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Local filesystem                                                            */
/* -------------------------------------------------------------------------- */

/** `LOCAL_STORAGE_DIR`, else `./tmp/storage` relative to the process cwd. */
function localRoot(): string {
  const configured = process.env.LOCAL_STORAGE_DIR;
  return configured === undefined || configured === ''
    ? resolve(process.cwd(), 'tmp', 'storage')
    : resolve(configured);
}

export class UnsafeStorageKey extends Error {
  public override readonly name = 'UnsafeStorageKey';
  public constructor(key: string) {
    super(
      `Storage key ${JSON.stringify(key)} does not resolve inside the storage root. ` +
        'Keys reach this module from job payloads; one that escapes the root would read ' +
        'or overwrite an arbitrary file. Rejected.',
    );
  }
}

/**
 * A key is an S3-style path, and S3 has no `..`. On a filesystem it does, and
 * `stagingKey` arrives on a job payload, so containment is checked rather than
 * assumed. `resolve` normalises the traversal first; the prefix test is then
 * meaningful.
 */
function localPathFor(key: string): string {
  const root = localRoot();
  const full = resolve(join(root, key));
  if (full !== root && !full.startsWith(root + sep)) {
    throw new UnsafeStorageKey(key);
  }
  return full;
}

function localBackend(): StorageBackend {
  return {
    kind: 'local',

    async put(key, ciphertext) {
      const path = localPathFor(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, ciphertext);
    },

    async get(key) {
      const path = localPathFor(key);
      try {
        return new Uint8Array(await readFile(path));
      } catch (err) {
        // Same shape of failure as a missing R2 object: say which key, and say
        // which backend was asked, because "not found" against the wrong
        // backend is the confusing half of an hour otherwise.
        throw new Error(
          `Local storage has no object for key ${key} (looked in ${path}). ` +
            'R2 is not configured, so this process is using the local backend.',
          { cause: err },
        );
      }
    },

    async remove(keys) {
      let deleted = 0;
      for (const key of keys) {
        // Resolved OUTSIDE the try. An unsafe key must propagate; only the
        // unlink itself is allowed to fail quietly. Folding the two together
        // turns a rejected traversal into a silent "already gone" — which is
        // how this was written first, and what storage.test.ts caught.
        const path = localPathFor(key);
        try {
          await rm(path);
          deleted += 1;
        } catch {
          // Already gone. `data.purge` is retried, so this is the normal path
          // on a second attempt, not an error — and, matching S3
          // DeleteObjects, an absent key is not counted as deleted.
        }
      }
      return deleted;
    },
  };
}

/* -------------------------------------------------------------------------- */
/* The API the rest of `ingestion` uses                                        */
/* -------------------------------------------------------------------------- */

export async function putSealed(key: string, ciphertext: Uint8Array): Promise<void> {
  await storage().put(key, ciphertext);
}

export async function getSealed(key: string): Promise<Uint8Array> {
  return storage().get(key);
}

/**
 * Called by `data.purge` alongside the row deletion. Part IV §4 job 8: without
 * it, `expires_at` is decoration and the 90-day residency promise is false.
 */
export async function deleteObjects(keys: readonly string[]): Promise<number> {
  if (keys.length === 0) return 0;
  return storage().remove(keys);
}

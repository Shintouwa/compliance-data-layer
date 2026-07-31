/**
 * Cloudflare R2 (S3-compatible). architecture.md Part I §1.2, Part V §1.4.
 *
 * Only sealed bytes are written here — `sealBlob` runs first, always. R2's own
 * at-rest encryption is the first layer; the envelope is the second, and the
 * second is the one that survives a leaked R2 credential.
 *
 * Storage keys are `tenant/<tenantId>/run/<runId>/<checksum>`: tenant-first so
 * a bucket policy or a lifecycle rule can be scoped per tenant, and
 * checksum-named so the duplicate-detection rule in Part IV §4 job 1 has
 * something to be idempotent against.
 */

import { DeleteObjectsCommand, GetObjectCommand, PutObjectCommand, S3Client }
  from '@aws-sdk/client-s3';
import { storageEnv } from '../../lib/env';

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

export function storageKeyFor(tenantId: string, runId: string, checksum: string): string {
  return `tenant/${tenantId}/run/${runId}/${checksum}`;
}

export async function putSealed(key: string, ciphertext: Uint8Array): Promise<void> {
  await s3().send(new PutObjectCommand({
    Bucket: storageEnv().R2_BUCKET,
    Key: key,
    Body: ciphertext,
    ContentType: 'application/octet-stream',
  }));
}

export async function getSealed(key: string): Promise<Uint8Array> {
  const response = await s3().send(new GetObjectCommand({
    Bucket: storageEnv().R2_BUCKET,
    Key: key,
  }));
  if (response.Body === undefined) {
    throw new Error(`R2 object ${key} has no body.`);
  }
  return response.Body.transformToByteArray();
}

/**
 * Called by `data.purge` alongside the row deletion. Part IV §4 job 8: without
 * it, `expires_at` is decoration and the 90-day residency promise is false.
 */
export async function deleteObjects(keys: readonly string[]): Promise<number> {
  if (keys.length === 0) return 0;
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
}

/**
 * Envelope encryption for raw blobs. architecture.md Part V §1.4.
 *
 * R2 encrypts at rest. The roadmap asks for a second layer so that **an R2
 * credential leak alone does not expose client invoices.**
 *
 * AES-256-GCM. Per-blob data key, wrapped by a Doppler-held master key.
 * `raw_document.encrypted_data_key` and `raw_document.iv` are `NOT NULL`
 * (Part I §2.5) — **a blob cannot be written unsealed.**
 *
 * **Decryption happens ONLY inside `ingest.normalise`. No other module may
 * import this file.** enforced by eslint-plugin-boundaries: `crypto.ts` is not
 * re-exported from `modules/ingestion/index.ts`, so nothing outside this
 * directory can reach it.
 */

import {
  createCipheriv, createDecipheriv, randomBytes, timingSafeEqual,
} from 'node:crypto';
import { cryptoEnv } from '../../lib/env';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;      // 96 bits — the size GCM is specified for
const TAG_BYTES = 16;

const masterKey = (): Buffer => Buffer.from(cryptoEnv().BLOB_MASTER_KEY, 'hex');

export interface SealedBlob {
  readonly ciphertext: Buffer;
  /** base64 of `iv ‖ tag ‖ wrappedKey`, wrapped under the master key. */
  readonly encryptedDataKey: string;
  /** base64 of the payload IV. Distinct from the key-wrapping IV. */
  readonly iv: string;
}

/**
 * `tenantId` is bound into the wrap as additional authenticated data, so a data
 * key lifted from one tenant's row cannot open another tenant's blob even with
 * the master key and both ciphertexts.
 */
export function sealBlob(tenantId: string, plaintext: Uint8Array): SealedBlob {
  const dataKey = randomBytes(KEY_BYTES);
  const payloadIv = randomBytes(IV_BYTES);

  const cipher = createCipheriv(ALGORITHM, dataKey, payloadIv);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const bodyTag = cipher.getAuthTag();

  const wrapIv = randomBytes(IV_BYTES);
  const wrapper = createCipheriv(ALGORITHM, masterKey(), wrapIv);
  wrapper.setAAD(Buffer.from(tenantId, 'utf8'));
  const wrappedKey = Buffer.concat([wrapper.update(dataKey), wrapper.final()]);
  const wrapTag = wrapper.getAuthTag();

  return {
    // The payload tag travels with the ciphertext: it authenticates the bytes,
    // and separating them lets a blob be stored without its tag by accident.
    ciphertext: Buffer.concat([body, bodyTag]),
    encryptedDataKey: Buffer.concat([wrapIv, wrapTag, wrappedKey]).toString('base64'),
    iv: payloadIv.toString('base64'),
  };
}

export function openBlob(
  row: { encryptedDataKey: string; iv: string },
  tenantId: string,
  ciphertext: Uint8Array,
): Buffer {
  const wrapper = Buffer.from(row.encryptedDataKey, 'base64');
  if (wrapper.length <= IV_BYTES + TAG_BYTES) {
    throw new Error('encrypted_data_key is truncated. The blob cannot be opened.');
  }
  const wrapIv = wrapper.subarray(0, IV_BYTES);
  const wrapTag = wrapper.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const wrappedKey = wrapper.subarray(IV_BYTES + TAG_BYTES);

  const unwrapper = createDecipheriv(ALGORITHM, masterKey(), wrapIv);
  unwrapper.setAAD(Buffer.from(tenantId, 'utf8'));
  unwrapper.setAuthTag(wrapTag);
  const dataKey = Buffer.concat([unwrapper.update(wrappedKey), unwrapper.final()]);

  const bytes = Buffer.from(ciphertext);
  if (bytes.length < TAG_BYTES) {
    throw new Error('Ciphertext is shorter than its authentication tag.');
  }
  const body = bytes.subarray(0, bytes.length - TAG_BYTES);
  const bodyTag = bytes.subarray(bytes.length - TAG_BYTES);

  const decipher = createDecipheriv(ALGORITHM, dataKey, Buffer.from(row.iv, 'base64'));
  decipher.setAuthTag(bodyTag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

/**
 * Constant-time checksum comparison, for the "server recomputes and rejects on
 * mismatch" step of the upload path (Part III §1.1).
 */
export function checksumMatches(expected: string, actual: string): boolean {
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(actual, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

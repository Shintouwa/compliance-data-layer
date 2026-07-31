/**
 * The local storage backend, and the two refusals that keep it honest.
 *
 * The behaviour worth testing here is not "bytes round-trip" — it is that the
 * fallback cannot engage in production and cannot be walked out of its root.
 * Both are reached from a job payload, and both fail silently if wrong.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetStorageBackendForTesting, deleteObjects, getSealed, LocalStorageRefusedInProduction,
  putSealed, storageBackendKind, storageKeyFor, UnsafeStorageKey,
} from './storage';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cdl-storage-'));
  // `vi.stubEnv` rather than assignment: @types/node declares NODE_ENV
  // read-only, and `vi.unstubAllEnvs` restores every key including deletions.
  vi.stubEnv('LOCAL_STORAGE_DIR', root);
  vi.stubEnv('R2_ACCOUNT_ID', undefined);
  __resetStorageBackendForTesting();
});

afterEach(() => {
  vi.unstubAllEnvs();
  __resetStorageBackendForTesting();
  rmSync(root, { recursive: true, force: true });
});

describe('backend selection', () => {
  it('uses the local backend when R2_ACCOUNT_ID is absent', () => {
    expect(storageBackendKind()).toBe('local');
  });

  it('uses R2 as soon as an account id is present', () => {
    vi.stubEnv('R2_ACCOUNT_ID', 'acct');
    __resetStorageBackendForTesting();
    expect(storageBackendKind()).toBe('r2');
  });

  it('refuses the local fallback in production rather than losing the bytes', () => {
    vi.stubEnv('NODE_ENV', 'production');
    __resetStorageBackendForTesting();
    expect(() => storageBackendKind()).toThrow(LocalStorageRefusedInProduction);
  });
});

describe('the local backend', () => {
  const key = storageKeyFor('tenant-1', 'run-1', 'a'.repeat(64));

  it('round-trips sealed bytes through a nested key', async () => {
    const sealed = new Uint8Array([0, 1, 2, 253, 254, 255]);
    await putSealed(key, sealed);
    expect(await getSealed(key)).toEqual(sealed);
  });

  it('names the key and the backend when an object is missing', async () => {
    await expect(getSealed(key)).rejects.toThrow(/Local storage has no object/);
  });

  it('deletes, and treats an already-absent key as a no-op', async () => {
    await putSealed(key, new Uint8Array([1]));
    expect(await deleteObjects([key])).toBe(1);
    expect(await deleteObjects([key])).toBe(0);
  });

  it('does no work for an empty key list', async () => {
    expect(await deleteObjects([])).toBe(0);
  });

  it('refuses a key that escapes the storage root', async () => {
    await expect(putSealed('../escaped', new Uint8Array([1]))).rejects.toThrow(UnsafeStorageKey);
    await expect(getSealed('tenant/../../escaped')).rejects.toThrow(UnsafeStorageKey);
    await expect(deleteObjects(['../../escaped'])).rejects.toThrow(UnsafeStorageKey);
  });
});

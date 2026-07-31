/**
 * The cron drain, against a fake pg-boss.
 *
 * What matters here is not that jobs run — it is that every job is SETTLED, and
 * settled the right way. An unsettled job stays `active` until its lease
 * expires (up to 30 minutes for `validate.run`), and a failing job marked
 * `complete` is a job that silently never retries. Both are invisible in the
 * response body, so they are asserted here.
 */

import type PgBoss from 'pg-boss';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetDrainStateForTesting, budgetFromEnv, DEFAULT_BUDGET_MS, drainQueues, ensureStarted }
  from './drain';
import { HANDLERS } from './handlers';
import { LeaseHeld } from './idempotent';

interface Settled { queue: string; id: string; how: 'complete' | 'fail' }

/**
 * Enough of pg-boss to drive `drainQueues`. Deliberately not a mock of the
 * class: the surface used is four methods, and a fake that implements them
 * exactly is a better description of the contract than a partial `vi.mock`.
 */
function fakeBoss(queued: Record<string, unknown[]>) {
  const settled: Settled[] = [];
  const created: string[] = [];
  let starts = 0;
  let nextId = 1;

  // `Promise.resolve` rather than `async` bodies: none of these awaits
  // anything, and `@typescript-eslint/require-await` is right that an `async`
  // with no `await` is a claim the function does not make.
  const boss = {
    start: () => { starts += 1; return Promise.resolve(boss as unknown as PgBoss); },
    createQueue: (name: string) => { created.push(name); return Promise.resolve(); },
    fetch: (name: string) => {
      const data = queued[name]?.shift();
      if (data === undefined) return Promise.resolve([]);
      return Promise.resolve([{ id: `job-${String(nextId++)}`, name, data, expireInSeconds: 60 }]);
    },
    complete: (queue: string, id: string) => {
      settled.push({ queue, id, how: 'complete' });
      return Promise.resolve();
    },
    fail: (queue: string, id: string) => {
      settled.push({ queue, id, how: 'fail' });
      return Promise.resolve();
    },
  };

  return {
    boss: boss as unknown as PgBoss,
    settled,
    created,
    starts: () => starts,
  };
}

/** A clock that advances a fixed amount on every read. */
function tickingClock(stepMs: number): () => number {
  let t = 0;
  return () => (t += stepMs) - stepMs;
}

const FIRST = HANDLERS[0]?.name ?? '';

beforeEach(() => { __resetDrainStateForTesting(); });
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  __resetDrainStateForTesting();
});

describe('budgetFromEnv', () => {
  it('defaults when unset', () => {
    vi.stubEnv('CRON_WORK_BUDGET_MS', undefined);
    expect(budgetFromEnv()).toBe(DEFAULT_BUDGET_MS);
  });

  it('reads a positive number', () => {
    vi.stubEnv('CRON_WORK_BUDGET_MS', '25000');
    expect(budgetFromEnv()).toBe(25_000);
  });

  it('refuses a value it would have to guess at', () => {
    for (const bad of ['0', '-1', 'ten', 'NaN']) {
      vi.stubEnv('CRON_WORK_BUDGET_MS', bad);
      expect(() => budgetFromEnv()).toThrow(/not a positive number/);
    }
  });
});

describe('ensureStarted', () => {
  it('starts and registers every queue once per instance', async () => {
    const { boss, created, starts } = fakeBoss({});
    await ensureStarted(boss);
    await ensureStarted(boss);
    expect(starts()).toBe(1);
    // Every declared queue, not just the ones with handlers — a queue that is
    // not created silently drops its jobs.
    expect(created.length).toBeGreaterThan(HANDLERS.length);
  });

  it('does not memoise a failed start', async () => {
    let attempts = 0;
    const boss = {
      start: () => { attempts += 1; return Promise.reject(new Error('no database')); },
      createQueue: () => Promise.resolve(),
    } as unknown as PgBoss;

    await expect(ensureStarted(boss)).rejects.toThrow('no database');
    await expect(ensureStarted(boss)).rejects.toThrow('no database');
    expect(attempts).toBe(2);
  });
});

describe('drainQueues', () => {
  it('returns immediately when every queue is empty', async () => {
    const { boss, settled } = fakeBoss({});
    const result = await drainQueues(boss, { budgetMs: 60_000 });
    expect(result.fetched).toBe(0);
    expect(result.budgetExhausted).toBe(false);
    expect(settled).toEqual([]);
  });

  it('runs a queued job and completes it', async () => {
    const { boss, settled } = fakeBoss({ [FIRST]: [{ runId: 'r1' }] });
    const spy = vi.spyOn(HANDLERS[0] as { work: PgBoss.WorkHandler<unknown> }, 'work')
      .mockResolvedValue({ ok: true });

    const result = await drainQueues(boss, { budgetMs: 60_000 });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ fetched: 1, completed: 1, failed: 0, leaseHeld: 0 });
    expect(result.byQueue[FIRST]).toBe(1);
    expect(settled).toEqual([{ queue: FIRST, id: 'job-1', how: 'complete' }]);
  });

  it('FAILS a throwing job rather than completing it', async () => {
    const { boss, settled } = fakeBoss({ [FIRST]: [{ runId: 'r1' }] });
    vi.spyOn(HANDLERS[0] as { work: PgBoss.WorkHandler<unknown> }, 'work')
      .mockRejectedValue(new Error('handler blew up'));

    const result = await drainQueues(boss, { budgetMs: 60_000 });

    expect(result).toMatchObject({ fetched: 1, completed: 0, failed: 1 });
    expect(settled).toEqual([{ queue: FIRST, id: 'job-1', how: 'fail' }]);
  });

  it('counts a held lease apart from a failure, and still settles the job', async () => {
    const { boss, settled } = fakeBoss({ [FIRST]: [{ runId: 'r1' }] });
    vi.spyOn(HANDLERS[0] as { work: PgBoss.WorkHandler<unknown> }, 'work')
      .mockRejectedValue(new LeaseHeld('another worker owns run r1'));

    const result = await drainQueues(boss, { budgetMs: 60_000 });

    expect(result).toMatchObject({ fetched: 1, failed: 0, leaseHeld: 1 });
    expect(settled).toEqual([{ queue: FIRST, id: 'job-1', how: 'fail' }]);
  });

  it('drains several jobs from one queue across passes', async () => {
    const { boss, settled } = fakeBoss({
      [FIRST]: [{ runId: 'r1' }, { runId: 'r2' }, { runId: 'r3' }],
    });
    vi.spyOn(HANDLERS[0] as { work: PgBoss.WorkHandler<unknown> }, 'work')
      .mockResolvedValue(undefined);

    const result = await drainQueues(boss, { budgetMs: 60_000 });

    expect(result.fetched).toBe(3);
    expect(settled).toHaveLength(3);
    expect(settled.every((s) => s.how === 'complete')).toBe(true);
  });

  it('stops on the budget and says so, without leaving a job unsettled', async () => {
    const { boss, settled } = fakeBoss({
      [FIRST]: Array.from({ length: 50 }, (_, i) => ({ runId: `r${String(i)}` })),
    });
    vi.spyOn(HANDLERS[0] as { work: PgBoss.WorkHandler<unknown> }, 'work')
      .mockResolvedValue(undefined);

    // Each clock read jumps 5s, so the deadline passes almost at once.
    const result = await drainQueues(boss, { budgetMs: 10_000, now: tickingClock(5_000) });

    expect(result.budgetExhausted).toBe(true);
    expect(settled).toHaveLength(result.fetched);
  });
});

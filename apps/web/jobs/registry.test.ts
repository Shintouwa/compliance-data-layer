/**
 * Queue registration coverage. architecture.md Part I §3.5:
 *
 * > `scripts/assert-queue-coverage.sh` asserts that every member of the `JOB`
 * > const has a `QUEUES` entry and a registered handler (except `sinkOnly`
 * > queues), and that every `deadLetter` target is itself a registered queue.
 *
 * The assertion lives here rather than in shell so that it typechecks against
 * the registry it is checking; `scripts/assert-queue-coverage.sh` runs exactly
 * this file, so CI and `make check` cannot disagree about what it says.
 *
 * `plannedFor` is the extension §3.5 does not have: Part IV §1 declares queue
 * names for M1 through M7, and thirteen of them have no handler yet. Without a
 * marker, "no handler" is indistinguishable from "handler forgotten". The
 * assertions run in BOTH directions — a planned queue must have no handler, so
 * landing one without deleting the marker fails the build.
 */

import { describe, expect, it } from 'vitest';
import { HANDLERS } from './handlers';
import { ALL_JOB_NAMES, JOB, QUEUES } from './registry';
import type { JobName } from './registry';

const handlerNames = new Set<JobName>(HANDLERS.map((h) => h.name));
const entries = Object.entries(QUEUES) as [JobName, (typeof QUEUES)[JobName]][];

describe('queue registry', () => {
  it('has a QUEUES entry for every JOB', () => {
    for (const name of ALL_JOB_NAMES) {
      expect(QUEUES[name], `no QUEUES entry for ${name}`).toBeDefined();
    }
    expect(entries).toHaveLength(ALL_JOB_NAMES.length);
  });

  it('registers a handler for every live queue', () => {
    const live = entries
      .filter(([, spec]) => spec.sinkOnly !== true && spec.plannedFor === undefined)
      .map(([name]) => name);

    expect(live.length).toBeGreaterThan(0);
    for (const name of live) {
      expect(handlerNames.has(name), `${name} has no registered handler`).toBe(true);
    }
  });

  it('registers NO handler for a sink or a planned queue', () => {
    for (const [name, spec] of entries) {
      if (spec.sinkOnly === true || spec.plannedFor !== undefined) {
        expect(
          handlerNames.has(name),
          `${name} is marked ${spec.sinkOnly === true ? 'sinkOnly' : String(spec.plannedFor)} ` +
            'but has a handler. Delete the marker in the same commit as the handler.',
        ).toBe(false);
      }
    }
  });

  it('registers no handler for a queue that is not in JOB', () => {
    for (const name of handlerNames) {
      expect(ALL_JOB_NAMES).toContain(name);
    }
    expect(HANDLERS).toHaveLength(handlerNames.size);   // no duplicate registration
  });

  it('points every deadLetter at a registered queue', () => {
    for (const [name, spec] of entries) {
      if (spec.deadLetter === undefined) continue;
      expect(ALL_JOB_NAMES, `${name} dead-letters to an unregistered queue`)
        .toContain(spec.deadLetter);
      expect(QUEUES[spec.deadLetter].sinkOnly).toBe(true);
    }
  });

  it('keeps corpus.record on an effectively infinite retry', () => {
    // Losing corpus data is the only truly unrecoverable failure in this
    // system. Part IV §1.
    expect(QUEUES[JOB.CORPUS_RECORD].retryLimit).toBe(2_147_483_647);
    expect(QUEUES[JOB.CORPUS_RECORD].deadLetter).toBe(JOB.CORPUS_RECORD_DLQ);
  });

  it('registers exactly the five M1 pipeline handlers', () => {
    expect([...handlerNames].sort()).toEqual([
      JOB.CORPUS_RECORD,
      JOB.INGEST_NORMALISE,
      JOB.INGEST_RECEIVE,
      JOB.MAP_APPLY,
      JOB.VALIDATE_RUN,
    ].sort());
  });
});

/**
 * Queue registry — declared once, in one file. architecture.md Part IV §1.
 *
 * `JOB` is the complete set of queue names for the life of the product, M1
 * through M7, exactly as Part IV §1 declares it. Naming a queue years before it
 * has a handler is deliberate: the name is the thing that must not drift, and
 * `corpus.record.dlq` has to be a registered queue rather than a bare string
 * before anything can dead-letter to it.
 *
 * That leaves a gap the queue-coverage guard would otherwise miss — a queue
 * that is declared, created at boot, and has nobody consuming it. `plannedFor`
 * closes it: scripts/assert-queue-coverage.sh (and jobs/registry.test.ts, which
 * is the same assertion in a form that runs under `make check`) requires that
 *
 *   - every JOB has a QUEUES entry;
 *   - every queue that is neither `sinkOnly` nor `plannedFor` HAS a handler;
 *   - every queue that IS `plannedFor` has NO handler — so landing the handler
 *     without deleting the marker fails the build rather than leaving a stale
 *     claim about what is built;
 *   - every `deadLetter` target is itself a registered queue.
 */

import type { QueuePolicy } from 'pg-boss';

export const JOB = {
  // core pipeline — M1
  INGEST_RECEIVE:    'ingest.receive',
  INGEST_NORMALISE:  'ingest.normalise',
  MAP_APPLY:         'map.apply',
  VALIDATE_RUN:      'validate.run',
  CORPUS_RECORD:     'corpus.record',
  CORPUS_RECORD_DLQ: 'corpus.record.dlq',   // registered queue, not a bare string
  REPORT_GENERATE:   'report.generate',
  NOTIFY_DELIVER:    'notify.deliver',
  // operational — M1
  DATA_PURGE:        'data.purge',
  // M6
  AP_RECEIVE:        'ap.receive',
  AP_MATCH:          'ap.match',
  AP_RESPOND:        'ap.respond',
  SUPPLIER_SCORE:    'supplier.score',
  // M7
  LEDGER_INGEST:     'ledger.ingest',
  VAT_INGEST:        'vat.ingest',
  RECONCILE_RUN:     'reconcile.run',
  ASSURANCE_SCORE:   'assurance.score',
  EVIDENCE_PACK:     'evidence.pack',
} as const;

export type JobName = (typeof JOB)[keyof typeof JOB];

/** The milestone whose scope lands the handler. Not a schedule — a marker. */
export type Milestone = 'M1' | 'M2' | 'M6' | 'M7';

interface QueueSpec {
  retryLimit: number;
  retryBackoff: boolean;
  retryDelay: number;        // seconds
  expireInSeconds: number;   // hard timeout for a single attempt
  policy?: QueuePolicy;
  deadLetter?: JobName;
  /** Dead-letter sinks. CI expects NO handler for these. */
  sinkOnly?: true;
  /** Declared now, handler not yet built. CI expects NO handler for these. */
  plannedFor?: Milestone;
}

export const QUEUES: Record<JobName, QueueSpec> = {
  [JOB.INGEST_RECEIVE]:    { retryLimit: 3, retryBackoff: true, retryDelay: 30,  expireInSeconds: 900  },
  [JOB.INGEST_NORMALISE]:  { retryLimit: 3, retryBackoff: true, retryDelay: 30,  expireInSeconds: 1800 },
  [JOB.MAP_APPLY]:         { retryLimit: 2, retryBackoff: true, retryDelay: 30,  expireInSeconds: 900  },
  [JOB.VALIDATE_RUN]:      { retryLimit: 5, retryBackoff: true, retryDelay: 15,  expireInSeconds: 1800 },
  // INFINITE. Losing corpus data is the only truly unrecoverable failure here.
  [JOB.CORPUS_RECORD]:     { retryLimit: 2_147_483_647, retryBackoff: true, retryDelay: 10,
                             expireInSeconds: 300, deadLetter: JOB.CORPUS_RECORD_DLQ },
  [JOB.CORPUS_RECORD_DLQ]: { retryLimit: 0, retryBackoff: false, retryDelay: 0,
                             expireInSeconds: 300, sinkOnly: true },
  [JOB.REPORT_GENERATE]:   { retryLimit: 3, retryBackoff: true, retryDelay: 60,  expireInSeconds: 1800,
                             plannedFor: 'M2' },
  [JOB.NOTIFY_DELIVER]:    { retryLimit: 5, retryBackoff: true, retryDelay: 60,  expireInSeconds: 300,
                             plannedFor: 'M2' },
  [JOB.DATA_PURGE]:        { retryLimit: 3, retryBackoff: true, retryDelay: 300, expireInSeconds: 3600,
                             policy: 'singleton', plannedFor: 'M2' },

  [JOB.AP_RECEIVE]:        { retryLimit: 3,  retryBackoff: true, retryDelay: 30,  expireInSeconds: 900,
                             plannedFor: 'M6' },
  [JOB.AP_MATCH]:          { retryLimit: 3,  retryBackoff: true, retryDelay: 30,  expireInSeconds: 900,
                             plannedFor: 'M6' },
  // Deadline-driven. Retries until sent or dueAt passes. §5.
  [JOB.AP_RESPOND]:        { retryLimit: 20, retryBackoff: true, retryDelay: 60,  expireInSeconds: 300,
                             plannedFor: 'M6' },
  [JOB.SUPPLIER_SCORE]:    { retryLimit: 3,  retryBackoff: true, retryDelay: 300, expireInSeconds: 1800,
                             policy: 'singleton', plannedFor: 'M6' },

  [JOB.LEDGER_INGEST]:     { retryLimit: 3, retryBackoff: true, retryDelay: 30,  expireInSeconds: 1800,
                             plannedFor: 'M7' },
  [JOB.VAT_INGEST]:        { retryLimit: 3, retryBackoff: true, retryDelay: 30,  expireInSeconds: 900,
                             plannedFor: 'M7' },
  [JOB.RECONCILE_RUN]:     { retryLimit: 3, retryBackoff: true, retryDelay: 120, expireInSeconds: 3600,
                             plannedFor: 'M7' },
  [JOB.ASSURANCE_SCORE]:   { retryLimit: 3, retryBackoff: true, retryDelay: 60,  expireInSeconds: 900,
                             plannedFor: 'M7' },
  [JOB.EVIDENCE_PACK]:     { retryLimit: 2, retryBackoff: true, retryDelay: 300, expireInSeconds: 3600,
                             plannedFor: 'M7' },
} as const;

export const ALL_JOB_NAMES: readonly JobName[] = Object.values(JOB);

export function queueSpec(name: JobName): QueueSpec {
  const spec = QUEUES[name];
  // Record<JobName, …> makes this unreachable through the type system; it is
  // here because `name` can arrive from a pg-boss row, which is a string.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (spec === undefined) {
    throw new Error(`No QUEUES entry for "${name}". architecture.md Part IV §1.`);
  }
  return spec;
}

/**
 * Registered handlers. `boot.ts` reads this list and so does the queue-coverage
 * guard, so there is no second, hand-maintained list to drift.
 *
 * M1 registers the first five core jobs. `report.generate`, `notify.deliver`
 * and `data.purge` are declared in `registry.ts` with `plannedFor: 'M2'`, and
 * the guard asserts that a `plannedFor` queue has NO handler — so adding one
 * here without deleting the marker fails the build.
 */

import { handler as corpusRecord } from './corpus-record';
import { handler as ingestNormalise } from './ingest-normalise';
import { handler as ingestReceive } from './ingest-receive';
import { handler as mapApply } from './map-apply';
import { handler as validateRun } from './validate-run';
import type { RegisteredHandler } from '../_handler';

export const HANDLERS: readonly RegisteredHandler[] = [
  ingestReceive,
  ingestNormalise,
  mapApply,
  validateRun,
  corpusRecord,
];

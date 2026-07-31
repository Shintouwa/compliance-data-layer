'use server';

/**
 * `createIngestionRun()` — architecture.md Part III §1.1.
 *
 * > inserts `ingestion_run` (`status='received'`, `dataset='invoice'`,
 * > `expiresAt = now() + 90d`) → enqueues `ingest.receive` **in the same
 * > transaction**. Redirect to `/audits/[runId]`.
 *
 * Part III global conventions: **all mutations are Server Actions returning
 * `{ ok: true, data } | { ok: false, error }` — never throw across the
 * boundary.** `redirect()` is the documented exception; Next implements it by
 * throwing a control-flow signal, so it is called after the action has
 * succeeded and outside any try/catch.
 */

import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createIngestionRun } from '@/modules/ingestion';
import { resolveEntity } from '@/modules/tenancy';
import { requireTenantActor } from '@/lib/auth';
import { enqueueInTransaction } from '@/jobs';
import { JOB } from '@/jobs';

const formSchema = z.object({
  entityId: z.string().uuid('Entity id must be a uuid.'),
  source: z.literal('upload'),
  stagingKey: z.string().min(1, 'The uploaded object key is required.'),
  checksum: z.string().regex(/^[0-9a-f]{64}$/, 'Checksum must be a hex sha256.'),
  scenarios: z.array(z.string()).min(1, 'At least one scenario is required.'),
});

export type ActionResult =
  | { ok: true; data: { runId: string } }
  | { ok: false; error: string };

/** `useActionState` shape: (previousState, formData). */
export async function createAuditRun(
  _previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const parsed = formSchema.safeParse({
    entityId: form.get('entityId'),
    source: form.get('source'),
    stagingKey: form.get('stagingKey'),
    checksum: form.get('checksum'),
    scenarios: form.getAll('scenarios').map(String),
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join(' ') };
  }

  let runId: string;
  try {
    const actor = await requireTenantActor();
    const entity = await resolveEntity(parsed.data.entityId);
    if (entity.tenantId !== actor.tenantId) {
      // The entity belongs to another tenant. RLS would refuse the write
      // anyway; refusing here makes the reason legible.
      return { ok: false, error: 'That entity does not belong to this tenant.' };
    }

    runId = randomUUID();
    const traceId = runId;

    await createIngestionRun(
      {
        runId,
        tenantId: actor.tenantId,
        entityId: entity.entityId,
        actorId: actor.actorId,
        source: parsed.data.source,
        checksum: parsed.data.checksum,
        stagingKey: parsed.data.stagingKey,
        traceId,
      },
      (tx) => enqueueInTransaction(tx, JOB.INGEST_RECEIVE, {
        runId,
        tenantId: actor.tenantId,
        entityId: entity.entityId,
        actorId: actor.actorId,
        source: parsed.data.source,
        dataset: 'invoice' as const,
        stagingKey: parsed.data.stagingKey,
        mimeType: 'application/octet-stream',
        sourceSystem: entity.sourceSystem,
        // ⚠️ The document currency when the export does not state one. Held on
        // the entity in a later milestone; the jurisdiction does not imply it.
        defaultCurrency: 'AED',
        traceId,
      }),
    );
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown failure.' };
  }

  redirect(`/audits/${runId}`);
}

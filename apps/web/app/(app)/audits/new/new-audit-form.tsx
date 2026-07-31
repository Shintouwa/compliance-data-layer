'use client';

/**
 * The one interactive leaf of `/audits/new`. architecture.md Part III: Server
 * Components by default; `'use client'` only for interactive leaves.
 *
 * It exists to surface the `{ ok: false, error }` half of the Server Action
 * contract — a mutation never throws across the boundary, so something has to
 * render the failure.
 */

import { useActionState } from 'react';
import { createAuditRun } from './actions';
import type { ActionResult } from './actions';

const SCENARIOS = [
  'standard', 'zero_rated', 'exempt', 'reverse_charge', 'designated_zone', 'export',
] as const;

export function NewAuditForm() {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    createAuditRun,
    null,
  );

  return (
    <form action={action} className="mt-6 space-y-8">
      <fieldset className="space-y-2">
        <legend className="font-medium">1 · Entity</legend>
        <label className="block text-sm">
          Entity
          <input
            name="entityId"
            required
            placeholder="entity id"
            className="mt-1 block w-full rounded border px-2 py-1"
          />
        </label>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="font-medium">2 · Source</legend>
        <p className="text-xs opacity-70">
          M1 ships the signed-upload path. SFTP and API pull land with M2 scheduling;
          the local agent needs its own specification first (Part I §1.10).
        </p>
        <label className="block text-sm">
          <input type="radio" name="source" value="upload" defaultChecked /> Signed upload
        </label>
        <label className="block text-sm">
          Uploaded object key
          <input name="stagingKey" required className="mt-1 block w-full rounded border px-2 py-1" />
        </label>
        <label className="block text-sm">
          sha256 computed in the browser
          <input
            name="checksum"
            required
            pattern="[0-9a-f]{64}"
            className="mono mt-1 block w-full rounded border px-2 py-1"
          />
        </label>
        <p className="text-xs opacity-70">
          The server recomputes this and rejects on mismatch.
        </p>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="font-medium">3 · Scope</legend>
        <label className="block text-sm">
          Sample size
          <input
            name="sampleSize"
            type="number"
            min={1}
            defaultValue={25}
            className="mt-1 block w-32 rounded border px-2 py-1"
          />
        </label>
        <div className="text-sm">
          <span className="opacity-70">Scenario coverage — at least one required</span>
          <div className="mt-1 grid grid-cols-2 gap-1">
            {SCENARIOS.map((scenario) => (
              <label key={scenario} className="block">
                <input type="checkbox" name="scenarios" value={scenario} /> {scenario}
              </label>
            ))}
          </div>
        </div>
      </fieldset>

      {state !== null && !state.ok && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}

      <button type="submit" disabled={pending} className="rounded border px-3 py-1 text-sm">
        {pending ? 'Starting…' : 'Start audit'}
      </button>
    </form>
  );
}

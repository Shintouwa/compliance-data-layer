/**
 * Mapping review — `/audits/[runId]/mapping`. architecture.md Part III §1.2.
 *
 * Three columns: **source field** → **proposed business term** → **confidence +
 * action**.
 *
 * - **A profile cannot be used until `confirmedBy` and `confirmedAt` are set.**
 *   `map.apply` hard-fails on an unconfirmed profile. AI suggests; a human
 *   confirms; nothing runs on a guess.
 * - Unmapped mandatory terms render a red banner listing them by `BT-xx` and
 *   block submission.
 */

import { listProfiles, MANDATORY_BUSINESS_TERMS } from '@/modules/mapping';
import { requireTenantActor } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function MappingReviewPage(
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const actor = await requireTenantActor();
  const profiles = await listProfiles({ tenantId: actor.tenantId, actorId: actor.actorId });

  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="text-xl font-semibold">Mapping review</h1>
      <p className="mt-1 text-sm opacity-70 mono">{runId}</p>

      <p className="mt-4 rounded border p-3 text-sm">
        AI suggests mappings. <strong>A human confirms them.</strong> A profile with no
        confirmation cannot process client data — <code className="mono">map.apply</code>{' '}
        refuses it.
      </p>

      {profiles.length === 0 ? (
        <p className="mt-6 text-sm opacity-70">
          No mapping profile for this tenant yet. Create one for the entity&apos;s source
          system and jurisdiction, then confirm it here.
        </p>
      ) : (
        <table className="mt-6 w-full text-left text-sm">
          <thead className="opacity-60">
            <tr>
              <th className="py-1 pr-3">Profile</th>
              <th className="py-1 pr-3">Source system</th>
              <th className="py-1 pr-3">Jurisdiction</th>
              <th className="py-1 pr-3">Version</th>
              <th className="py-1 pr-3">Confirmed</th>
              <th className="py-1">Unmapped mandatory terms</th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((profile) => (
              <tr key={profile.id} className="border-t align-top">
                <td className="py-1 pr-3 mono">{profile.id.slice(0, 8)}…</td>
                <td className="py-1 pr-3">{profile.sourceSystem}</td>
                <td className="py-1 pr-3">{profile.jurisdiction}</td>
                <td className="py-1 pr-3">v{profile.version}</td>
                <td className="py-1 pr-3">
                  {profile.confirmedAt === null
                    ? <span className="text-red-600">not confirmed</span>
                    : profile.confirmedAt.toISOString().slice(0, 10)}
                </td>
                <td className="py-1">
                  {profile.unmappedMandatoryTerms.length === 0
                    ? '—'
                    : (
                      <span className="text-red-600">
                        {profile.unmappedMandatoryTerms.join(', ')}
                      </span>
                    )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="mt-6 text-xs opacity-70">
        Mandatory terms: {MANDATORY_BUSINESS_TERMS.join(', ')}
      </p>
    </main>
  );
}

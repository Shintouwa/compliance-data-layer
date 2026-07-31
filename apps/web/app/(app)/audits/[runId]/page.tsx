/**
 * Validation results — `/audits/[runId]`. architecture.md Part III §1.3.
 *
 * Reads `client_data.finding` (not the corpus).
 *
 * **A raw value must never appear in this UI.** If one does, `redaction.py` has
 * a defect and the Rule-1 guarantee is void — **treat as Sev-1, halt the
 * pipeline.** Nothing on this page renders anything but rule metadata, counts
 * and `value_shape`.
 *
 * This route parses params, calls ONE module function and renders. No business
 * logic, no database queries, no job enqueues — §1.3.
 */

import { auditResults } from '@/modules/audit';
import { requireTenantActor } from '@/lib/auth';
import { ValueShapeChip } from '@/components/value-shape-chip';
import { ScopeDisclaimer } from '@/components/scope-disclaimer';

export const dynamic = 'force-dynamic';

export default async function AuditResultsPage(
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const actor = await requireTenantActor();
  const results = await auditResults({
    runId,
    tenantId: actor.tenantId,
    actorId: actor.actorId,
  });

  return (
    <main className="mx-auto max-w-5xl p-8">
      <header className="border-b pb-4">
        <h1 className="text-xl font-semibold">Audit run</h1>
        <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
          <div><dt className="opacity-60">Status</dt><dd>{results.status}</dd></div>
          <div><dt className="opacity-60">Documents</dt><dd>{results.docCount ?? '—'}</dd></div>
          <div>
            <dt className="opacity-60">Spec version</dt>
            <dd className="mono">{results.specVersion ?? '—'}</dd>
          </div>
          <div>
            <dt className="opacity-60">Ruleset hash</dt>
            {/* Truncated, full value in the title attribute — Part III §1.3. */}
            <dd className="mono" title={results.rulesetHash ?? ''}>
              {results.rulesetHash === null ? '—' : `${results.rulesetHash.slice(0, 18)}…`}
            </dd>
          </div>
        </dl>
      </header>

      <section className="mt-8">
        <h2 className="text-lg font-medium">Outcome summary</h2>
        <p className="mt-2 text-sm">
          {results.outcomes.pass} pass · {results.outcomes.fail} fail · {results.outcomes.warn} warn
        </p>
        {results.readiness !== null && (
          <p className="mt-2 text-sm">
            Readiness {results.readiness.score}/100 — {results.readiness.band.replace('_', ' ')}
          </p>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-medium">Findings</h2>
        {results.findings.length === 0 ? (
          <p className="mt-2 text-sm opacity-70">
            No failing rules recorded for this run. Run validation to populate this table.
          </p>
        ) : (
          <table className="mt-3 w-full text-left text-sm">
            <thead className="opacity-60">
              <tr>
                <th className="py-1 pr-3">Rule</th>
                <th className="py-1 pr-3">Term</th>
                <th className="py-1 pr-3">Class</th>
                <th className="py-1 pr-3">Affected</th>
                <th className="py-1 pr-3">XPath</th>
                <th className="py-1">Shape</th>
              </tr>
            </thead>
            <tbody>
              {results.findings.map((f, index) => (
                <tr key={`${f.ruleId ?? 'none'}:${String(index)}`} className="border-t align-top">
                  <td className="py-1 pr-3 mono">{f.ruleId ?? '—'}</td>
                  <td className="py-1 pr-3">{f.businessTerm ?? '—'}</td>
                  <td className="py-1 pr-3">{f.failureClass ?? '—'}</td>
                  <td className="py-1 pr-3">{f.affectedCount}</td>
                  <td className="py-1 pr-3 mono max-w-xs truncate" title={f.xpath ?? ''}>
                    {f.xpath ?? '—'}
                  </td>
                  <td className="py-1"><ValueShapeChip shape={f.valueShape} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-medium">Master-data defects</h2>
        {results.defects.length === 0 ? (
          <p className="mt-2 text-sm opacity-70">
            No master-data defects recorded. Ingest an export to populate the register.
          </p>
        ) : (
          <ul className="mt-3 space-y-1 text-sm">
            {results.defects.map((d) => (
              <li key={d.defectClass} className="flex gap-3">
                <span className="w-56">{d.defectClass}</span>
                <span>{d.affectedCount} affected</span>
                <ValueShapeChip shape={d.sampleShape} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-medium">Scenario coverage</h2>
        <p className="mt-2 text-sm">
          Observed: {results.observedScenarios.length === 0
            ? 'none — ingest an export to observe scenarios'
            : results.observedScenarios.join(', ')}
        </p>
      </section>

      <ScopeDisclaimer
        specName={null}
        version={results.specVersion}
        rulesetHash={results.rulesetHash}
      />
    </main>
  );
}

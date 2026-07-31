/**
 * Ingestion — `/audits/new`. architecture.md Part III §1.1.
 *
 * Three-step wizard, one screen, no page transitions.
 *
 * This route renders and nothing else. The action lives beside it in
 * `actions.ts` and calls one module function (§1.3: `app/` contains routes
 * only — no business logic, no database queries, no job enqueues).
 */

import { NewAuditForm } from './new-audit-form';

export const dynamic = 'force-dynamic';

export default function NewAuditPage() {
  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-xl font-semibold">New audit</h1>
      <NewAuditForm />
    </main>
  );
}

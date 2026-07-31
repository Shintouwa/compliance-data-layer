/**
 * `expires_at`. architecture.md Part I §2.1, Part IV §4 job 8.
 *
 * **Retention is column-driven, never hard-coded.** The purge job reads
 * `expires_at`; these helpers are the only place that computes it, so the two
 * horizons live side by side where the difference between them is visible.
 *
 * Hard-coding 90 days in the purge job deletes the evidence Product 3 exists to
 * preserve. CLAUDE.md §4.6 names it.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Raw extracts, invoices, findings, exceptions, notifications. */
export const RAW_RETENTION_DAYS = 90;

/**
 * Reports, GL entries, VAT returns, reconciliation runs and divergences.
 * Audit-defence requires an evidentiary trail; M7 needs seven years of it.
 */
export const EVIDENCE_RETENTION_YEARS = 7;

export function expiresInNinetyDays(from: Date = new Date()): Date {
  return new Date(from.getTime() + RAW_RETENTION_DAYS * DAY_MS);
}

export function expiresInSevenYears(from: Date = new Date()): Date {
  const out = new Date(from.getTime());
  out.setUTCFullYear(out.getUTCFullYear() + EVIDENCE_RETENTION_YEARS);
  return out;
}

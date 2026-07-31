/**
 * The working-capital calculator — the number in every proposal.
 * architecture.md Part II · M1.
 *
 * `basis` is not cosmetic. Below 40 entities the UI renders *"from what I've
 * seen, typically 8–15%"*. At ≥40 it renders *"companies on your ERP, in your
 * sector, fail these six rules 34% of the time."* **That transition is when the
 * sales process becomes unbeatable, and the code must know which side of it it
 * is on.**
 *
 * `sampleSize` travels with the number, always — CLAUDE.md §4.4 forbids a
 * remediation suggestion below n = 3, and a figure without its denominator is
 * how that rule gets broken by accident.
 */

import type { Jurisdiction, SourceSystemVendor } from '@repo/db/schema/_shared';
import { entityCount } from '../corpus';

/** The basis flips here. Part II · M1. */
export const CORPUS_BASIS_THRESHOLD = 40;

export interface FrozenReceivablesInput {
  readonly monthlyInvoiceCount: number;
  readonly averageInvoiceMinor: number;
  /** 0.08–0.15 pre-remediation. */
  readonly projectedFailureRate: number;
  /** Default 21. */
  readonly resubmissionDays?: number;
  readonly jurisdiction: Jurisdiction;
  readonly sourceSystem: SourceSystemVendor;
}

export interface FrozenReceivables {
  readonly monthlyAtRiskMinor: number;
  readonly frozenMinor: number;
  readonly basis: 'corpus' | 'estimate';
  readonly sampleSize: number;
  /**
   * The arithmetic, in order. Part III §1.3: the working-capital figure is
   * rendered with **the arithmetic shown inline — never just the total.**
   */
  readonly workings: readonly string[];
}

export async function frozenReceivables(
  input: FrozenReceivablesInput,
): Promise<FrozenReceivables> {
  const resubmissionDays = input.resubmissionDays ?? 21;

  const monthlyAtRiskMinor = Math.round(
    input.monthlyInvoiceCount * input.projectedFailureRate * input.averageInvoiceMinor,
  );

  // Reads via ANALYTICS_DATABASE_URL. The basis flips at n=40 entities.
  const n = await entityCount({
    jurisdiction: input.jurisdiction,
    sourceSystem: input.sourceSystem,
  });

  const frozenMinor = Math.round(monthlyAtRiskMinor * (resubmissionDays / 30));

  return {
    monthlyAtRiskMinor,
    frozenMinor,
    basis: n >= CORPUS_BASIS_THRESHOLD ? ('corpus' as const) : ('estimate' as const),
    sampleSize: n,
    workings: [
      `${String(input.monthlyInvoiceCount)} invoices/month`,
      `× ${(input.projectedFailureRate * 100).toFixed(1)}% projected failure rate`,
      `× ${String(input.averageInvoiceMinor)} minor units average value`,
      `= ${String(monthlyAtRiskMinor)} minor units at risk per month`,
      `× ${String(resubmissionDays)} days to resubmit ÷ 30`,
      `= ${String(frozenMinor)} minor units frozen`,
    ],
  };
}

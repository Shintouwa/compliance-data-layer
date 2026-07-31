/**
 * Audit-readiness score. architecture.md Part III §1.4.
 *
 * **0–100, deterministic, NEVER model-generated.** CLAUDE.md §4.4 lists
 * "producing a readiness or assurance score" as an absolute NO for AI:
 * deterministic weighted formulas only.
 *
 * **Never show the number alone.** Show the band, the weighted contributions,
 * and the single highest-value next action.
 */

export const WEIGHTS = {
  mandatoryFieldCoverage: 30,   // % of required BTs populated across the sample
  masterDataQuality:      25,   // 1 - (defect-weighted affected / total)
  scenarioCoverage:       20,   // observed / declared
  ruleFailureRate:        15,   // 1 - fail_rate, fatal-weighted
  lifecycleReadiness:     10,   // ASP appointed, response handling in place
} as const;

export type ScoreComponent = keyof typeof WEIGHTS;

export type ReadinessBand = 'not_ready' | 'at_risk' | 'nearly_ready' | 'ready';

export interface ScoreInputs {
  /** 0–1. Required business terms populated across the sample. */
  readonly mandatoryFieldCoverage: number;
  /** 0–1. `1 - (defect-weighted affected / total)`. */
  readonly masterDataQuality: number;
  /** 0–1. Observed scenarios over declared scenarios. */
  readonly scenarioCoverage: number;
  /** 0–1. `1 - fail_rate`, fatal-weighted. */
  readonly ruleFailureRate: number;
  /** 0–1. ASP appointed, response handling in place. */
  readonly lifecycleReadiness: number;
}

export interface ScoreContribution {
  readonly component: ScoreComponent;
  readonly weight: number;
  readonly ratio: number;
  readonly points: number;
}

export interface ReadinessScore {
  readonly score: number;
  readonly band: ReadinessBand;
  readonly contributions: readonly ScoreContribution[];
  /** The component furthest from its weight. Part III §1.4's "next action". */
  readonly largestGap: ScoreComponent;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error('Readiness score inputs must be finite ratios in [0, 1].');
  }
  return Math.min(1, Math.max(0, value));
}

/** 0–39 Not ready · 40–69 At risk · 70–89 Nearly ready · 90–100 Ready. */
export function band(score: number): ReadinessBand {
  if (score < 40) return 'not_ready';
  if (score < 70) return 'at_risk';
  if (score < 90) return 'nearly_ready';
  return 'ready';
}

export function readinessScore(inputs: ScoreInputs): ReadinessScore {
  const contributions: ScoreContribution[] = (
    Object.keys(WEIGHTS) as ScoreComponent[]
  ).map((component) => {
    const weight = WEIGHTS[component];
    const ratio = clamp01(inputs[component]);
    return { component, weight, ratio, points: weight * ratio };
  });

  const score = Math.round(contributions.reduce((sum, c) => sum + c.points, 0));

  let largestGap = contributions[0];
  for (const contribution of contributions) {
    if (largestGap === undefined
      || contribution.weight - contribution.points > largestGap.weight - largestGap.points) {
      largestGap = contribution;
    }
  }
  if (largestGap === undefined) {
    throw new Error('WEIGHTS is empty — the readiness score has no components.');
  }

  return { score, band: band(score), contributions, largestGap: largestGap.component };
}

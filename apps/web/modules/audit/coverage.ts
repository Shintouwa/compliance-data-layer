/**
 * Scenario coverage matrix. architecture.md Part III §1.3.
 *
 * > Rows = declared scenarios, columns = observed. **Declared-but-unobserved is
 * > a finding, not a gap** — the sample is unrepresentative and the audit
 * > understates risk.
 *
 * Pure. The distinction matters commercially: an entity that declares
 * `reverse_charge` and shows none in a 25-document sample has not been audited
 * for reverse charge, and saying "ready" would be a wrong answer.
 */

import type { Scenario } from '@repo/db/schema/client-data';

/** `entity.scenario_profile` keys → the `Scenario` union. §2.4, §2.5. */
const PROFILE_KEY_TO_SCENARIO: Readonly<Record<string, Scenario>> = {
  standard: 'standard',
  zeroRated: 'zero_rated',
  exempt: 'exempt',
  reverseCharge: 'reverse_charge',
  designatedZone: 'designated_zone',
  export: 'export',
};

export interface ScenarioCoverage {
  readonly declared: readonly Scenario[];
  readonly observed: readonly Scenario[];
  /** Declared but not seen in the sample. Each of these is a FINDING. */
  readonly unobserved: readonly Scenario[];
  /** Seen but not declared — the entity's profile is wrong, also a finding. */
  readonly undeclared: readonly Scenario[];
  /** `observed ∩ declared` over `declared`. Feeds the readiness score. */
  readonly ratio: number;
}

export function scenarioCoverage(
  scenarioProfile: Readonly<Record<string, boolean>>,
  observedScenarios: readonly Scenario[],
): ScenarioCoverage {
  const declared: Scenario[] = [];
  for (const [key, enabled] of Object.entries(scenarioProfile)) {
    const scenario = PROFILE_KEY_TO_SCENARIO[key];
    // `selfBilled` is a document type, not a tax scenario, and has no column in
    // the Scenario union. Skipped rather than coerced.
    if (enabled && scenario !== undefined) declared.push(scenario);
  }

  const observed = [...new Set(observedScenarios)];
  const observedSet = new Set(observed);
  const declaredSet = new Set(declared);

  const unobserved = declared.filter((s) => !observedSet.has(s));
  const undeclared = observed.filter((s) => !declaredSet.has(s));

  return {
    declared,
    observed,
    unobserved,
    undeclared,
    // An entity declaring nothing is not 100% covered; it is unconfigured.
    ratio: declared.length === 0 ? 0 : (declared.length - unobserved.length) / declared.length,
  };
}

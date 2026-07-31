import { describe, expect, it } from 'vitest';
import { scenarioCoverage } from './coverage';
import { band, readinessScore, WEIGHTS } from './score';

const perfect = {
  mandatoryFieldCoverage: 1,
  masterDataQuality: 1,
  scenarioCoverage: 1,
  ruleFailureRate: 1,
  lifecycleReadiness: 1,
};

describe('readinessScore', () => {
  it('sums to 100 at full marks and 0 at none', () => {
    expect(readinessScore(perfect).score).toBe(100);
    expect(readinessScore({
      mandatoryFieldCoverage: 0,
      masterDataQuality: 0,
      scenarioCoverage: 0,
      ruleFailureRate: 0,
      lifecycleReadiness: 0,
    }).score).toBe(0);
  });

  it('uses the weights from Part III §1.4 and nothing else', () => {
    expect(WEIGHTS).toEqual({
      mandatoryFieldCoverage: 30,
      masterDataQuality: 25,
      scenarioCoverage: 20,
      ruleFailureRate: 15,
      lifecycleReadiness: 10,
    });
    const sum = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBe(100);
  });

  it('is deterministic', () => {
    const inputs = { ...perfect, masterDataQuality: 0.42, ruleFailureRate: 0.87 };
    expect(readinessScore(inputs)).toEqual(readinessScore(inputs));
  });

  it('reports the contributions, never only the number', () => {
    const result = readinessScore({ ...perfect, masterDataQuality: 0 });
    expect(result.score).toBe(75);
    expect(result.contributions).toHaveLength(5);
    expect(result.contributions.find((c) => c.component === 'masterDataQuality')?.points).toBe(0);
    expect(result.largestGap).toBe('masterDataQuality');
  });

  it('names the highest-value next action by weighted gap, not by ratio', () => {
    // scenarioCoverage is worth 20 and is at 0.5 → 10 points lost.
    // ruleFailureRate is worth 15 and is at 0.2 → 12 points lost. The second
    // one is the bigger win despite the higher-looking ratio elsewhere.
    const result = readinessScore({
      ...perfect, scenarioCoverage: 0.5, ruleFailureRate: 0.2,
    });
    expect(result.largestGap).toBe('ruleFailureRate');
  });

  it('clamps out-of-range inputs instead of producing a score above 100', () => {
    expect(readinessScore({ ...perfect, masterDataQuality: 5 }).score).toBe(100);
    expect(readinessScore({ ...perfect, masterDataQuality: -3 }).score).toBe(75);
  });

  it('refuses a non-finite input rather than reporting NaN as a score', () => {
    expect(() => readinessScore({ ...perfect, masterDataQuality: Number.NaN })).toThrow();
  });
});

describe('band', () => {
  it('matches the published bands', () => {
    expect(band(0)).toBe('not_ready');
    expect(band(39)).toBe('not_ready');
    expect(band(40)).toBe('at_risk');
    expect(band(69)).toBe('at_risk');
    expect(band(70)).toBe('nearly_ready');
    expect(band(89)).toBe('nearly_ready');
    expect(band(90)).toBe('ready');
    expect(band(100)).toBe('ready');
  });
});

describe('scenarioCoverage', () => {
  const profile = {
    standard: true, zeroRated: true, exempt: false, reverseCharge: true,
    designatedZone: false, export: false, selfBilled: true,
  };

  it('treats declared-but-unobserved as a finding, not a gap', () => {
    const result = scenarioCoverage(profile, ['standard']);
    expect(result.declared).toEqual(['standard', 'zero_rated', 'reverse_charge']);
    expect(result.unobserved).toEqual(['zero_rated', 'reverse_charge']);
    expect(result.ratio).toBeCloseTo(1 / 3);
  });

  it('reports observed-but-undeclared too — the entity profile is wrong', () => {
    const result = scenarioCoverage(profile, ['standard', 'export']);
    expect(result.undeclared).toEqual(['export']);
  });

  it('skips selfBilled, which is a document type rather than a tax scenario', () => {
    expect(scenarioCoverage(profile, []).declared).not.toContain('self_billed');
  });

  it('scores an entity that declares nothing as 0, not as fully covered', () => {
    const none = {
      standard: false, zeroRated: false, exempt: false, reverseCharge: false,
      designatedZone: false, export: false, selfBilled: false,
    };
    expect(scenarioCoverage(none, []).ratio).toBe(0);
  });

  it('reaches 1 only when every declared scenario was observed', () => {
    expect(scenarioCoverage(profile, ['standard', 'zero_rated', 'reverse_charge']).ratio).toBe(1);
  });
});

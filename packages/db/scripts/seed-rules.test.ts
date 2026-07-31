/**
 * The spec-catalogue seeder.
 *
 * Two kinds of test here, and the second kind is the one that matters.
 *
 * The unit tests below drive `extractRules` and `buildPlan` over fixtures. They
 * prove the parser refuses what it must refuse — the whole value of this script
 * is that it cannot invent a `failure_class`, because `corpus` is append-only
 * and a guess is permanent.
 *
 * The last block runs the REAL registry against the REAL Golden File Corpus and
 * asserts that every rule the corpus proves can fire is in the plan. That is
 * the property the script exists for: `corpus.record` raises
 * `SpecCatalogueIncomplete` for any finding naming a rule that is not seeded,
 * and a corpus case is executable evidence that a rule fires. If the two ever
 * disagree, the pipeline stalls in production, silently, on the retry queue.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildPlan, extractRules, readRegistry, UnseedableRule,
} from './seed-rules';
import type { RegistryEntry } from './seed-rules';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

const sch = (body: string, prefix = 'sch:'): string =>
  `<?xml version="1.0" encoding="UTF-8"?>
<${prefix}schema xmlns:sch="http://purl.oclc.org/dsdl/schematron"
  xmlns:cdl="https://compliance-data-layer.dev/schematron-extensions/v1">
  <${prefix}pattern id="p">
    <${prefix}rule context="ubl:Invoice">
      ${body}
    </${prefix}rule>
  </${prefix}pattern>
</${prefix}schema>`;

const ASSERT = `<sch:assert id="X-1" test="true()" flag="fatal"
    cdl:business-term="BT-1" cdl:failure-class="missing_mandatory"
    cdl:expected-description="an invoice number">
  The invoice number shall be present.
</sch:assert>`;

/* -------------------------------------------------------------------------- */
/* extractRules                                                                */
/* -------------------------------------------------------------------------- */

describe('extractRules', () => {
  it('reads every field the corpus row needs', () => {
    const [r] = extractRules(sch(ASSERT), 'fixture.sch');
    expect(r).toMatchObject({
      ruleId: 'X-1',
      severity: 'fatal',
      businessTerm: 'BT-1',
      failureClass: 'missing_mandatory',
      xpathContext: 'ubl:Invoice',
      assertText: 'The invoice number shall be present.',
      source: 'fixture.sch',
    });
  });

  it('hashes the assertion text, so an upstream edit is detectable', () => {
    const [r] = extractRules(sch(ASSERT), 'fixture.sch');
    const expected = createHash('sha256')
      .update('The invoice number shall be present.').digest('hex');
    expect(r?.canonicalTextHash).toBe(`sha256:${expected}`);
  });

  it('parses a default-namespaced ruleset the same way as a prefixed one', () => {
    // The provisional rulesets use `sch:`; the published distributions do not.
    const prefixed = extractRules(sch(ASSERT), 'a.sch');
    const plain = extractRules(
      sch(ASSERT.replaceAll('sch:', ''), '').replaceAll('<schema', '<schema'),
      'a.sch',
    );
    expect(plain.map((r) => r.ruleId)).toEqual(prefixed.map((r) => r.ruleId));
  });

  it('defaults severity to error, matching engine.py', () => {
    const [r] = extractRules(
      sch(ASSERT.replace(' flag="fatal"', '')), 'fixture.sch');
    expect(r?.severity).toBe('error');
  });

  it('falls back to the rule id for native_rule_code, and uses cdl:native-code when given', () => {
    const [without] = extractRules(sch(ASSERT), 'fixture.sch');
    expect(without?.nativeRuleCode).toBe('X-1');

    const [withCode] = extractRules(
      sch(ASSERT.replace('cdl:business-term', 'cdl:native-code="BR-AE-08" cdl:business-term')),
      'fixture.sch',
    );
    expect(withCode?.nativeRuleCode).toBe('BR-AE-08');
  });

  it('picks up sch:report as well as sch:assert', () => {
    const report = ASSERT.replaceAll('sch:assert', 'sch:report').replace('X-1', 'X-2');
    expect(extractRules(sch(report), 'fixture.sch').map((r) => r.ruleId)).toEqual(['X-2']);
  });

  it('leaves businessTerm null when the rule has none', () => {
    const [r] = extractRules(
      sch(ASSERT.replace('cdl:business-term="BT-1"', '')), 'fixture.sch');
    expect(r?.businessTerm).toBeNull();
  });

  /* -- the refusals ------------------------------------------------------- */

  it('REFUSES a rule with no cdl:failure-class rather than defaulting one', () => {
    const naked = ASSERT.replace('cdl:failure-class="missing_mandatory"', '');
    expect(() => extractRules(sch(naked), 'published.sch'))
      .toThrow(UnseedableRule);
    expect(() => extractRules(sch(naked), 'published.sch'))
      .toThrow(/NOT NULL[\s\S]*NOT defaulted here/);
  });

  it('refuses a failure class outside the ten in §2.3', () => {
    const bad = ASSERT.replace('missing_mandatory', 'looks_wrong');
    expect(() => extractRules(sch(bad), 'fixture.sch')).toThrow(/not one of/);
  });

  it('refuses an unknown @flag rather than narrowing it', () => {
    const bad = ASSERT.replace('flag="fatal"', 'flag="info"');
    expect(() => extractRules(sch(bad), 'fixture.sch')).toThrow(/expected one of/);
  });

  it('refuses an anonymous assertion', () => {
    const bad = ASSERT.replace('id="X-1"', '');
    expect(() => extractRules(sch(bad), 'fixture.sch')).toThrow(/has no @id/);
  });

  it('refuses an assertion with no text, because hashing "" detects nothing', () => {
    const bad = ASSERT.replace('The invoice number shall be present.', '  ');
    expect(() => extractRules(sch(bad), 'fixture.sch')).toThrow(/no assertion text/);
  });
});

/* -------------------------------------------------------------------------- */
/* buildPlan                                                                   */
/* -------------------------------------------------------------------------- */

const entry = (over: Partial<RegistryEntry> = {}): RegistryEntry => ({
  specId: 'pint-ae',
  jurisdiction: 'AE',
  version: 'RESOLVE_IN_WEEK_1',
  schematron: ['pint-ae/PINT-AE.sch'],
  ...over,
});

const reader = (files: Record<string, string>) => (path: string): string => {
  const found = files[path];
  if (found === undefined) throw new Error(`unexpected read: ${path}`);
  return found;
};

describe('buildPlan', () => {
  it('attributes a rule to the spec whose directory holds its file', () => {
    const plan = buildPlan(
      [
        entry({ schematron: ['pint-ae/PINT-AE.sch', 'en16931/EN16931-UBL-model.sch'] }),
        entry({ specId: 'en16931', jurisdiction: 'EU',
                schematron: ['en16931/EN16931-UBL-model.sch'] }),
      ],
      reader({
        'pint-ae/PINT-AE.sch': sch(ASSERT),
        'en16931/EN16931-UBL-model.sch': sch(ASSERT.replace('X-1', 'X-2')),
      }),
    );

    expect(plan.rules.find((r) => r.ruleId === 'X-1')?.specId).toBe('pint-ae');
    expect(plan.rules.find((r) => r.ruleId === 'X-2')?.specId).toBe('en16931');
  });

  it('parses a shared ruleset once, not once per profile that declares it', () => {
    const plan = buildPlan(
      [
        entry({ schematron: ['en16931/EN16931-UBL-model.sch'] }),
        entry({ specId: 'en16931', jurisdiction: 'EU',
                schematron: ['en16931/EN16931-UBL-model.sch'] }),
      ],
      reader({ 'en16931/EN16931-UBL-model.sch': sch(ASSERT) }),
    );
    expect(plan.rules).toHaveLength(1);
  });

  it('skips a quarantined profile and reports why', () => {
    const plan = buildPlan(
      [entry({ unavailable: 'QUARANTINED — no SVRL stylesheet.' })],
      reader({}),
    );
    expect(plan.rules).toEqual([]);
    expect(plan.skipped).toEqual([{ specId: 'pint-ae', reason: 'QUARANTINED — no SVRL stylesheet.' }]);
  });

  it('refuses when a declared ruleset belongs to a spec with no registry entry', () => {
    expect(() => buildPlan([entry({ schematron: ['xrechnung/X.sch'] })], reader({})))
      .toThrow(/no registry entry for "xrechnung"/);
  });

  it('refuses when a live profile pulls in a quarantined profile\'s ruleset', () => {
    expect(() => buildPlan(
      [
        entry({ schematron: ['peppol-bis-3.0/PEPPOL-BIS-3.0.sch'] }),
        entry({ specId: 'peppol-bis-3.0', unavailable: 'QUARANTINED' }),
      ],
      reader({}),
    )).toThrow(/is quarantined/);
  });

  it('refuses two rulesets that share a rule id', () => {
    expect(() => buildPlan(
      [
        entry({ schematron: ['pint-ae/PINT-AE.sch'] }),
        entry({ specId: 'en16931', jurisdiction: 'EU',
                schematron: ['en16931/EN16931-UBL-model.sch'] }),
      ],
      reader({
        'pint-ae/PINT-AE.sch': sch(ASSERT),
        'en16931/EN16931-UBL-model.sch': sch(ASSERT),
      }),
    )).toThrow(/Duplicate rule ids/);
  });
});

/* -------------------------------------------------------------------------- */
/* The real registry against the real Golden File Corpus                       */
/* -------------------------------------------------------------------------- */

const SPECS = new URL('../../../apps/validator/src/validator/specs/', import.meta.url);
const CORPUS = new URL('../../../tests/corpus/', import.meta.url);

interface ExpectedCase {
  spec: { spec_id: string };
  expect: {
    fired_rules?: string[];
    failure_classes?: Record<string, string>;
    business_terms?: Record<string, string>;
  };
}

function corpusCases(): ExpectedCase[] {
  const root = fileURLToPath(CORPUS);
  const out: ExpectedCase[] = [];
  for (const dir of readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory() || dir.name === 'schemas') continue;
    for (const file of readdirSync(new URL(`${dir.name}/`, CORPUS))) {
      if (!file.endsWith('.expected.json')) continue;
      out.push(JSON.parse(
        readFileSync(new URL(`${dir.name}/${file}`, CORPUS), 'utf8'),
      ) as ExpectedCase);
    }
  }
  return out;
}

describe('the real plan covers the Golden File Corpus', () => {
  const registry = readRegistry();
  const plan = buildPlan(registry, (p) => readFileSync(new URL(p, SPECS), 'utf8'));
  const seeded = new Map(plan.rules.map((r) => [r.ruleId, r]));
  const quarantined = new Set(
    registry.filter((e) => e.unavailable !== undefined).map((e) => e.specId),
  );

  const live = corpusCases().filter((c) => !quarantined.has(c.spec.spec_id));

  it('reads a corpus with cases in it', () => {
    // A filter that matches nothing would make every assertion below vacuous.
    expect(live.length).toBeGreaterThan(10);
    expect(plan.rules.length).toBeGreaterThan(10);
  });

  it('seeds every rule the corpus proves can fire', () => {
    const missing = new Set<string>();
    for (const c of live) {
      for (const ruleId of c.expect.fired_rules ?? []) {
        if (!seeded.has(ruleId)) missing.add(ruleId);
      }
    }
    // Anything here is a rule that WILL block corpus.record on the retry queue.
    expect([...missing]).toEqual([]);
  });

  it('agrees with the corpus on failure class and business term', () => {
    const disagreements: string[] = [];
    for (const c of live) {
      for (const [ruleId, failureClass] of Object.entries(c.expect.failure_classes ?? {})) {
        const row = seeded.get(ruleId);
        if (row !== undefined && row.failureClass !== failureClass) {
          disagreements.push(`${ruleId}: corpus ${failureClass} vs seed ${row.failureClass}`);
        }
      }
      for (const [ruleId, businessTerm] of Object.entries(c.expect.business_terms ?? {})) {
        const row = seeded.get(ruleId);
        if (row !== undefined && row.businessTerm !== businessTerm) {
          disagreements.push(
            `${ruleId}: corpus ${businessTerm} vs seed ${String(row.businessTerm)}`);
        }
      }
    }
    expect(disagreements).toEqual([]);
  });

  it('carries the RESOLVE_IN_WEEK_1 sentinel through, rather than inventing a version', () => {
    for (const spec of plan.specifications) {
      expect(spec.version).toBe('RESOLVE_IN_WEEK_1');
    }
  });
});

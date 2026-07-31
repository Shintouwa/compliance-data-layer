/**
 * The identifiers are RE-DERIVED from the vendored Schematron here.
 *
 * A constant copied out of a specification and then asserted against itself
 * proves nothing. These tests read the published `.sch` bytes under
 * `apps/validator/src/validator/specs/` — 🔒, read-only, never written by this
 * suite — and fail if the rule that constrains the value stops saying what
 * `spec-identifiers.ts` claims it says.
 *
 * That makes the failure mode loud in both directions: a hand-edit here fails,
 * and a re-vendored ruleset that changes the identifier fails too, instead of
 * this app quietly stamping a stale `cbc:CustomizationID` onto every document
 * it sends for validation.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  billingProcessFor, hasSpecIdentifiers, SpecIdentifiersUnresolved, ublSpecIdentifiers,
} from './spec-identifiers';

const SPECS = new URL('../../../../apps/validator/src/validator/specs/', import.meta.url);

const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, SPECS)), 'utf8');

/** The rule's whole `<assert …>…</assert>` element, whitespace intact. */
function assertion(source: string, ruleId: string): string {
  const match = new RegExp(`<assert id="${ruleId}"[\\s\\S]*?</assert>`).exec(source);
  if (match === null) throw new Error(`No <assert id="${ruleId}"> in the vendored ruleset.`);
  return match[0];
}

describe('PINT AE identifiers match the vendored ruleset', () => {
  const invoice = read('pint-ae/published/trn-invoice/PINT-jurisdiction-aligned-rules.sch');
  const creditNote = read('pint-ae/published/trn-creditnote/PINT-jurisdiction-aligned-rules.sch');

  it('reads a ruleset that actually contains the two rules', () => {
    // Guards the regexes above: a checker that matches nothing passes silently.
    expect(assertion(invoice, 'aligned-ibrp-001-ae')).toContain('cbc:CustomizationID');
    expect(assertion(invoice, 'aligned-ibrp-002-ae')).toContain('cbc:ProfileID');
  });

  it('constrains CustomizationID to exactly the two values we emit', () => {
    const rule = assertion(invoice, 'aligned-ibrp-001-ae');
    expect(rule).toContain(ublSpecIdentifiers('pint-ae', 'invoice').customizationId);
    expect(rule).toContain(ublSpecIdentifiers('pint-ae', 'self_billed').customizationId);

    // The rule names two customization identifiers and no others. A third
    // appearing upstream is a decision, not a detail to absorb silently.
    const quoted = [...rule.matchAll(/'(urn:peppol:pint:[^']+)'/g)].map((m) => m[1]);
    expect(new Set(quoted)).toEqual(new Set([
      'urn:peppol:pint:billing-1@ae-1',
      'urn:peppol:pint:selfbilling-1@ae-1',
    ]));
  });

  it('constrains ProfileID to exactly the two values we emit', () => {
    const rule = assertion(invoice, 'aligned-ibrp-002-ae');
    expect(rule).toContain(ublSpecIdentifiers('pint-ae', 'invoice').profileId);
    expect(rule).toContain(ublSpecIdentifiers('pint-ae', 'self_billed').profileId);

    const quoted = [...rule.matchAll(/'(urn:peppol:bis:[^']+)'/g)].map((m) => m[1]);
    expect(new Set(quoted)).toEqual(new Set([
      'urn:peppol:bis:billing',
      'urn:peppol:bis:selfbilling',
    ]));
  });

  it('holds for credit notes too — the two rulesets agree', () => {
    for (const ruleId of ['aligned-ibrp-001-ae', 'aligned-ibrp-002-ae']) {
      expect(assertion(creditNote, ruleId)).toEqual(assertion(invoice, ruleId));
    }
  });
});

describe('ublSpecIdentifiers', () => {
  it('maps document type to the Peppol billing process', () => {
    expect(billingProcessFor('invoice')).toBe('billing');
    expect(billingProcessFor('credit_note')).toBe('billing');
    expect(billingProcessFor('debit_note')).toBe('billing');
    expect(billingProcessFor('self_billed')).toBe('selfbilling');
  });

  it('gives a credit note the same identifiers as an invoice', () => {
    expect(ublSpecIdentifiers('pint-ae', 'credit_note'))
      .toEqual(ublSpecIdentifiers('pint-ae', 'invoice'));
  });

  it('refuses every profile whose identifiers are not resolved', () => {
    for (const specId of ['en16931', 'peppol-bis-3.0', 'xrechnung', 'ksef-fa3']) {
      expect(hasSpecIdentifiers(specId)).toBe(false);
      expect(() => ublSpecIdentifiers(specId, 'invoice')).toThrow(SpecIdentifiersUnresolved);
    }
  });

  it('names the profile and the reason, so the fix is obvious from the log', () => {
    expect(() => ublSpecIdentifiers('en16931', 'invoice'))
      .toThrow(/BR-01|never states a value/);
    expect(() => ublSpecIdentifiers('peppol-bis-3.0', 'invoice')).toThrow(/quarantined/);
  });

  it('returns frozen objects — a caller cannot rewrite what documents claim', () => {
    const ids = ublSpecIdentifiers('pint-ae', 'invoice');
    expect(Object.isFrozen(ids)).toBe(true);
  });
});

/**
 * `cbc:CustomizationID` and `cbc:ProfileID`, resolved from primary source.
 *
 * These two values are how a document states which specification it claims
 * conformance to. Get one wrong and the document is validated against a ruleset
 * nobody agreed to — the receiver's ASP either rejects it outright or, worse,
 * accepts it under different rules than the ones the audit report cited.
 *
 * CLAUDE.md §4.7(1) forbids inventing an external identifier. So every value
 * below is quoted from a vendored published Schematron, with the file, the rule
 * id and the assertion that constrains it. **`spec-identifiers.test.ts` re-reads
 * those files and fails if a constant here stops matching the bytes**, which is
 * what makes this a derivation rather than a transcription that can rot.
 *
 * ---
 *
 * PINT AE — RESOLVED
 *
 * `apps/validator/src/validator/specs/pint-ae/published/trn-invoice/PINT-jurisdiction-aligned-rules.sch`
 * (byte-identical copy under `trn-creditnote/`):
 *
 *   aligned-ibrp-001-ae  @test starts-with(normalize-space(cbc:CustomizationID/text()),
 *                                          'urn:peppol:pint:billing-1@ae-1')
 *                             or starts-with(…, 'urn:peppol:pint:selfbilling-1@ae-1')
 *     "Specification identifier (ibt-024) MUST start with the value
 *      'urn:peppol:pint:billing-1@ae-1' or 'urn:peppol:pint:selfbilling-1@ae-1'."
 *
 *   aligned-ibrp-002-ae  @test /*\/cbc:ProfileID and
 *                              (matches(…, 'urn:peppol:bis:billing') or
 *                               matches(…, 'urn:peppol:bis:selfbilling'))
 *     "Business process (ibt-023) MUST be in the format 'urn:peppol:bis:billing'
 *      or 'urn:peppol:bis:selfbilling'."
 *
 * The customization rule is `starts-with`, so a longer string is also
 * conformant. The base value is what we emit; nothing appends to it, because a
 * suffix would be an identifier we invented.
 *
 * ⚠️ **Provenance caveat, carried deliberately.** `packages/config/specs.json`
 * records that the vendored PINT AE files arrived with no verifiable
 * provenance — no commit, no tag, no origin, no version string — unlike the
 * EN 16931 and Peppol BIS distributions beside them. The identifiers here are
 * therefore quoted accurately from a source that is itself unconfirmed. They
 * are wired in because the alternative is guessing at runtime, which is worse,
 * and because the test pins them to the bytes so a corrected vendoring shows up
 * as a failing test rather than as silent agreement. Confirm them against the
 * OpenPeppol PINT AE specification when `specs.json` `published_source` is
 * resolved. This does NOT open the `RESOLVE_IN_WEEK_1` version gate — the
 * sidecar still refuses to report a verdict, and that is a separate lock.
 *
 * ---
 *
 * EN 16931 and Peppol BIS 3.0 — NOT RESOLVED, deliberately
 *
 * `en16931`: the vendored ruleset constrains `cbc:CustomizationID` only to
 * being non-empty (`BR-01`) and never states a value, and EN 16931 alone
 * defines no `ProfileID`. There is nothing here to quote.
 *
 * `peppol-bis-3.0`: `PEPPOL-EN16931-UBL.sch` does fix the customization prefix,
 * but its `ProfileID` constraint is the pattern
 * `urn:fdc:peppol.eu:2017:poacc:billing:([0-9]{2}):1.0` — a family of process
 * identifiers, not one value, and choosing a process number is a decision the
 * document's business context makes. The profile is also quarantined
 * (`specs/registry/peppol-bis-3.0.json`).
 *
 * Both therefore throw. Depth before breadth, and a loud failure over a plausible
 * default.
 */

import type { CanonicalDoc } from '../ingestion';

export interface SpecIdentifiers {
  readonly customizationId: string;
  readonly profileId: string;
}

/**
 * Peppol's two billing processes. Which one applies is a property of the
 * document — a self-billed invoice is issued by the buyer — not a setting.
 */
export type BillingProcess = 'billing' | 'selfbilling';

export function billingProcessFor(docType: CanonicalDoc['docType']): BillingProcess {
  return docType === 'self_billed' ? 'selfbilling' : 'billing';
}

/**
 * Frozen so that a caller cannot mutate the identifier every downstream
 * document then claims conformance to.
 */
const PINT_AE: Readonly<Record<BillingProcess, SpecIdentifiers>> = Object.freeze({
  billing: Object.freeze({
    customizationId: 'urn:peppol:pint:billing-1@ae-1',
    profileId: 'urn:peppol:bis:billing',
  }),
  selfbilling: Object.freeze({
    customizationId: 'urn:peppol:pint:selfbilling-1@ae-1',
    profileId: 'urn:peppol:bis:selfbilling',
  }),
});

const RESOLVED: Readonly<Record<string, Readonly<Record<BillingProcess, SpecIdentifiers>>>> =
  Object.freeze({ 'pint-ae': PINT_AE });

/** Why a profile has no identifiers, in the words the caller should surface. */
const UNRESOLVED: Readonly<Record<string, string>> = Object.freeze({
  en16931:
    'the vendored EN 16931 ruleset constrains cbc:CustomizationID only to being non-empty ' +
    '(BR-01) and never states a value, and EN 16931 defines no ProfileID',
  'peppol-bis-3.0':
    'the profile is quarantined (specs/registry/peppol-bis-3.0.json), and its published ' +
    'ProfileID constraint is a pattern over a family of process identifiers rather than ' +
    'one value',
});

export class SpecIdentifiersUnresolved extends Error {
  public override readonly name = 'SpecIdentifiersUnresolved';
  public constructor(specId: string) {
    const reason = UNRESOLVED[specId] ?? 'no published ruleset for it has been vendored';
    super(
      `cbc:CustomizationID and cbc:ProfileID are not resolved for profile "${specId}" — ` +
        `${reason}. They are published by the specification and must be resolved from ` +
        'primary source, never defaulted or guessed at runtime. ' +
        'CLAUDE.md §4.7(1); apps/web/modules/mapping/spec-identifiers.ts.',
    );
  }
}

/**
 * The identifiers for a profile and document type, or a throw naming why not.
 *
 * There is no overload that returns `null` or a fallback pair. A caller that
 * cannot obtain these cannot serialise a document, and that is the correct
 * outcome — see the header of `ubl.ts`.
 */
export function ublSpecIdentifiers(
  specId: string,
  docType: CanonicalDoc['docType'],
): SpecIdentifiers {
  const byProcess = RESOLVED[specId];
  if (byProcess === undefined) throw new SpecIdentifiersUnresolved(specId);
  return byProcess[billingProcessFor(docType)];
}

/** Whether `ublSpecIdentifiers` will answer for this profile. */
export const hasSpecIdentifiers = (specId: string): boolean => specId in RESOLVED;

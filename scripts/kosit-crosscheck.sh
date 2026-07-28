#!/usr/bin/env bash
# architecture.md Part I §3.5 — KoSIT cross-check.
#
# STATUS: BLOCKED ON A ⚠️ VALUE. This script deliberately fails.
#
# §1.2 marks the KoSIT Validator version "⚠️ RESOLVE FROM PRIMARY SOURCE IN
# WEEK 1", and CLAUDE.md §4.7(1) says: stop and ask, do not invent an external
# identifier. So this exits non-zero with an explanation rather than either
# guessing a release or quietly passing.
#
# A cross-check that silently passes is worse than one that fails: it reports
# agreement between our validator and a reference implementation that was never
# actually run.
set -euo pipefail

# The scoping detail that would otherwise waste days (§3.5): KoSIT validates
# EN 16931 and XRechnung. It has no knowledge of PINT AE, KSeF, or any Gulf
# profile. Cross-checking a PINT-AE-Rxxx rule against KoSIT produces a
# guaranteed spurious failure. Rule IDs outside this set are ignored on BOTH
# sides. Do not "fix" a KoSIT disagreement on a PINT-AE rule by changing our
# validator — it is not a real disagreement.
COMPARABLE_PREFIXES="BR-|BR-CO-|BR-DEC-|BR-S-|BR-Z-|BR-E-|BR-AE-|BR-IC-|BR-G-|BR-O-"

cat >&2 <<'BLOCKED'
::error::KoSIT cross-check is not yet runnable.

  Blocked on two ⚠️ RESOLVE FROM PRIMARY SOURCE IN WEEK 1 values:

    1. The KoSIT Validator release and its EN 16931 / XRechnung scenario
       configuration  (architecture.md Part I §1.2)
    2. The published EN 16931 Schematron. Every rule currently shipped in
       apps/validator/src/validator/specs/ is agent-authored and namespaced
       CDL-PROV-*, so NOTHING it emits falls inside COMPARABLE_PREFIXES and
       there is nothing to compare.

  Until (2) lands, this check would compare an empty set against an empty set
  and report success. That is a false green on a conformance control, so it
  fails instead.

  To enable: resolve both values, pin the KoSIT release in
  packages/config/specs.json (cross_check.kosit_validator_version), install the
  published Schematron per specs/RULES.md, then implement the comparison here.

  architecture.md Part I §3.5; CLAUDE.md §4.7(1).
BLOCKED

echo "comparable prefixes when enabled: ${COMPARABLE_PREFIXES}" >&2
exit 1

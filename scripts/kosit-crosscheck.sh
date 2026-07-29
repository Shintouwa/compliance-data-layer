#!/usr/bin/env bash
# architecture.md Part I §3.5 — KoSIT cross-check.
#
# STATUS: STILL BLOCKED. This script deliberately fails.
#
# The KoSIT version IS now resolved — 1.6.2, from the primary source: the
# upstream checkout is v1.6.2-2-g86d9ddf and CHANGELOG.md records 1.6.2 as the
# latest release (2026-02-17). It is pinned in packages/config/specs.json.
#
# Two DIFFERENT blockers remain, and neither is a version string. See below.
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

  RESOLVED: KoSIT validator release 1.6.2 (pinned in packages/config/specs.json).

  Two blockers remain. Neither is a missing version.

    1. NOTHING TO COMPARE. Our validator still emits only agent-authored
       CDL-PROV-* rule IDs. None of them fall inside COMPARABLE_PREFIXES, so
       the comparison set is empty on our side. The published rulesets are
       vendored under specs/*/published/ but are NOT wired in — the engine
       cannot execute them. See specs/ENGINE-SVRL-MIGRATION.md.

    2. NO RUNNABLE KoSIT. What was obtained is the validator SOURCE tree, not
       a distribution: no target/, no built jar. More importantly the
       validator-configuration (scenarios.xml plus the EN 16931 / XRechnung
       resources) is a SEPARATE artefact and is absent. KoSIT validates
       nothing without it — the jar alone is not enough.

  With (1) unfixed this check would compare an empty set against an empty set
  and report success. That is a false green on a conformance control, so it
  fails instead.

  To enable:
    - land the SVRL engine so we emit BR-* IDs (ENGINE-SVRL-MIGRATION.md), and
    - fetch validator-configuration-xrechnung matching KoSIT 1.6.2, then
      implement the comparison here.

  architecture.md Part I §3.5; CLAUDE.md §4.7(1).
BLOCKED

echo "comparable prefixes when enabled: ${COMPARABLE_PREFIXES}" >&2
exit 1

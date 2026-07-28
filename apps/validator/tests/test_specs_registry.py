"""Registry, sentinel and specs.json drift tests.

The drift test is the reason this file exists: `packages/config/specs.json` is
🔒 human-owned and is what the web app and CI read for spec versions and ruleset
hashes. If it can drift from the rulesets actually installed in the sidecar, then
a finding can be recorded against a `ruleset_hash` that never produced it, and
the corpus stops being replayable.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from validator.errors import ProvisionalRulesetRefused, UnknownSpecError
from validator.specs_registry import (
    RESOLVE_SENTINEL,
    assert_usable,
    available_spec_ids,
    get_ruleset,
    load_spec,
)

SPECS_JSON = Path(__file__).resolve().parents[3] / "packages" / "config" / "specs.json"


def test_the_three_m0_profiles_are_installed() -> None:
    """architecture.md Part II · M0: "Profiles live: en16931, peppol-bis-3.0, pint-ae"."""
    assert set(available_spec_ids()) == {"en16931", "peppol-bis-3.0", "pint-ae"}


def test_every_spec_is_still_unresolved() -> None:
    """A guard, not a goal.

    When someone resolves a version from its primary source this test fails, and
    the failure is the reminder to replace the provisional Schematron and rewrite
    the affected corpus expectations in the same commit.
    """
    for spec_id in available_spec_ids():
        entry = load_spec(spec_id)
        assert entry.version == RESOLVE_SENTINEL, (
            f"{spec_id} now declares version {entry.version!r}. Replace the "
            f"provisional ruleset (specs/RULES.md), update specs.json, and "
            f"rewrite the CDL-PROV-* rule IDs in tests/corpus."
        )
        assert entry.is_resolved is False


def test_an_unresolved_spec_is_refused_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CDL_ALLOW_PROVISIONAL_RULESET", raising=False)
    with pytest.raises(ProvisionalRulesetRefused, match="RESOLVE_IN_WEEK_1"):
        assert_usable(load_spec("pint-ae"))


def test_the_provisional_flag_unlocks_it(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CDL_ALLOW_PROVISIONAL_RULESET", "1")
    assert_usable(load_spec("pint-ae"))  # must not raise


def test_an_unknown_spec_id_raises_with_the_available_list() -> None:
    with pytest.raises(UnknownSpecError):
        load_spec("not-a-profile")


def test_pint_ae_carries_the_normative_trn_pattern() -> None:
    """architecture.md Part II · M4 gives this verbatim. It is not ours to change."""
    entry = load_spec("pint-ae")
    assert entry.identifier_rules["trn"].pattern == "^[0-9]{15}$"
    assert entry.identifier_rules["trn"].checksum == "none"
    assert entry.archival_years == 7
    assert entry.issuance_window_days == 14


def test_pint_ae_scenario_map_matches_architecture_md() -> None:
    scenarios = load_spec("pint-ae").scenario_map
    assert set(scenarios) == {"standard", "reverse_charge", "designated_zone", "export"}
    assert scenarios["standard"].required_terms == ("BT-48", "BT-31", "BT-151")
    assert scenarios["designated_zone"].required_terms == (
        "BT-48", "BT-31", "BT-121", "BT-20",
    )


@pytest.mark.parametrize("spec_id", ["pint-ae", "en16931", "peppol-bis-3.0"])
def test_specs_json_does_not_drift_from_the_installed_rulesets(spec_id: str) -> None:
    """🔒 packages/config/specs.json must describe what is actually installed."""
    declared = json.loads(SPECS_JSON.read_text(encoding="utf-8"))["specs"][spec_id]
    entry = load_spec(spec_id)

    assert declared["version"] == entry.version
    assert declared["jurisdiction"] == entry.jurisdiction
    assert declared["resolved"] == entry.is_resolved
    assert declared["ruleset_hash"] == get_ruleset(spec_id).ruleset_hash, (
        f"specs.json ruleset_hash for {spec_id} is stale. A ruleset or code "
        f"list changed without specs.json being updated, which means a finding "
        f"could be recorded against a hash that never produced it."
    )


def test_ruleset_hashes_are_distinct_per_profile() -> None:
    hashes = {get_ruleset(spec_id).ruleset_hash for spec_id in available_spec_ids()}
    assert len(hashes) == len(available_spec_ids())


def test_pint_ae_layers_the_core_model_under_its_own_rules() -> None:
    """pint-ae = PINT-AE.sch + EN16931-UBL-model.sch, per the M4 registry example."""
    rule_ids = set(get_ruleset("pint-ae").rule_ids)
    assert "CDL-PROV-041" in rule_ids  # from PINT-AE.sch
    assert "CDL-PROV-011" in rule_ids  # from EN16931-UBL-model.sch
    assert "CDL-PROV-060" not in rule_ids  # peppol-only, must not leak in

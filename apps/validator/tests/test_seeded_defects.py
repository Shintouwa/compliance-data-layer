"""M0 exit criterion 2, as an executable assertion.

    "Validator catches 10/10 seeded defects in a synthetic PINT AE invoice
     (Week 4 metric)."  - architecture.md Part II · M0

The corpus already runs this fixture. It is asserted a second time here, in the
unit suite, because an exit criterion that is only checked as a side effect of
another check is one refactor away from not being checked at all.

Catching 10/10 is necessary but not sufficient: the test also asserts that
EXACTLY ten fire. A validator that flags everything catches 10/10 too, and would
be useless.
"""

from __future__ import annotations

import uuid
from pathlib import Path

import pytest

from validator.main import run_validation
from validator.models import ValidateResponse
from validator.specs_registry import PROVISIONAL_ENV_FLAG

FIXTURE = (
    Path(__file__).resolve().parents[3]
    / "tests"
    / "corpus"
    / "uae"
    / "seeded_ten_defects_fail.xml"
)

# One rule per seeded defect. Written from the fixture's own comments, not from
# a validator run.
SEEDED: dict[str, str] = {
    "CDL-PROV-041": "BT-48 buyer TRN present but empty",
    "CDL-PROV-043": "BT-31 seller TRN only 12 digits",
    "CDL-PROV-018": "BT-151 line VAT category not in UNTDID 5305",
    "CDL-PROV-019": "BT-130 unit code is free text",
    "CDL-PROV-011": "BT-106 header total != sum of line BT-131",
    "CDL-PROV-006": "BT-5 currency code lower-case",
    "CDL-PROV-021": "BT-153 line item name missing",
    "CDL-PROV-003": "BT-2 issue date in DD/MM/YYYY",
    "CDL-PROV-015": "BT-110 tax amount carries three decimals",
    "CDL-PROV-024": "BT-118 VAT breakdown category unmapped",
}


@pytest.fixture(scope="module")
def response(monkeypatch_module: None = None) -> ValidateResponse:
    import os

    os.environ[PROVISIONAL_ENV_FLAG] = "1"
    return run_validation(
        document=FIXTURE.read_bytes(),
        profile="pint-ae",
        spec_version=None,
        run_id=uuid.uuid4(),
    )


def test_fixture_exists() -> None:
    assert FIXTURE.is_file(), f"seeded-defect fixture missing at {FIXTURE}"


def test_catches_all_ten_seeded_defects(response: ValidateResponse) -> None:
    fired = {finding.rule_id for finding in response.findings}
    missed = sorted(set(SEEDED) - fired)
    assert not missed, "missed seeded defects: " + ", ".join(
        f"{rule_id} ({SEEDED[rule_id]})" for rule_id in missed
    )


def test_fires_exactly_ten_and_no_more(response: ValidateResponse) -> None:
    """Over-firing is a defect too. A validator that flags everything is useless."""
    fired = {finding.rule_id for finding in response.findings}
    assert fired == set(SEEDED), f"unexpected extra rules: {sorted(fired - set(SEEDED))}"
    assert len(response.findings) == 10


def test_outcome_is_fail(response: ValidateResponse) -> None:
    assert response.outcome == "fail"


def test_every_finding_is_classified_and_located(response: ValidateResponse) -> None:
    """A finding without a rule ID and an XPath is not defensible to a client.

    CLAUDE.md §4.4: "If a client asks why you said something fails, the answer
    is a rule ID and an XPath."
    """
    for finding in response.findings:
        assert finding.rule_id
        assert finding.xpath, f"{finding.rule_id} has no XPath"
        assert finding.failure_class, f"{finding.rule_id} has no failure_class"
        assert finding.severity in ("fatal", "error", "warning")


def test_no_finding_message_contains_a_raw_value(response: ValidateResponse) -> None:
    raw_values = ["100000000001", "Nos.", "10/08/2026", "50.005", "aed", "900.00"]
    for finding in response.findings:
        for raw in raw_values:
            assert raw not in (finding.message or ""), (
                f"{finding.rule_id} leaked {raw!r} into its message"
            )

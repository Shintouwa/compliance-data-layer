"""The inert-artefact guard. architecture.md Part I §1.1.

A `.gc` that is shipped but referenced by no Schematron enforces nothing while
reading as authoritative. This suite is what makes that a build failure instead
of a thing someone notices in a client call.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from validator.errors import CodelistIntegrityError
from validator.specs_audit import (
    assert_no_inert_codelists,
    audit_all_profiles,
    audit_profile_codelists,
)
from validator.specs_registry import available_spec_ids

# The pint-ae vendored code lists are inert as measured on 2026-07-30: the
# preprocessed distribution inlines every enumeration into the compiled test, so
# no .sch references any .gc. This is upstream's design, recorded in
# specs/RULES.md, and it is quarantined here rather than pretended away.
#
# Listed file by file, not as a count. When one of these gets wired in or
# removed, this list must shrink in the same commit -- which is the reminder
# that the decision was made deliberately.
KNOWN_INERT: frozenset[str] = frozenset(
    {
        "pint-ae/published/codelist/Aligned-TaxCategoryCodes.gc",
        "pint-ae/published/codelist/Aligned-TaxExemptionCodes.gc",
        "pint-ae/published/codelist/FreqBilling.gc",
        "pint-ae/published/codelist/GoodsType.gc",
        "pint-ae/published/codelist/ICD.gc",
        "pint-ae/published/codelist/ISO3166.gc",
        "pint-ae/published/codelist/ISO4217.gc",
        "pint-ae/published/codelist/ItemType.gc",
        "pint-ae/published/codelist/MimeCode.gc",
        "pint-ae/published/codelist/UNCL1001-inv.gc",
        "pint-ae/published/codelist/UNCL1153.gc",
        "pint-ae/published/codelist/UNCL4461.gc",
        "pint-ae/published/codelist/UNCL5189.gc",
        "pint-ae/published/codelist/UNCL7143.gc",
        "pint-ae/published/codelist/UNCL7161.gc",
        "pint-ae/published/codelist/UNECERec20.gc",
        "pint-ae/published/codelist/eas.gc",
        "pint-ae/published/codelist/transactiontype.gc",
    }
)


def test_no_new_inert_codelist_appears() -> None:
    """The guard proper. A NEW inert .gc fails the build.

    Asserting equality, not subset: a file leaving the inert set without
    KNOWN_INERT being updated is also a failure, because it means someone wired
    or deleted a vendored artefact without recording the decision.
    """
    found = {
        item.relative
        for items in audit_all_profiles(list(available_spec_ids())).values()
        for item in items
    }
    assert found == set(KNOWN_INERT), (
        f"inert code list set changed.\n"
        f"  newly inert: {sorted(found - KNOWN_INERT)}\n"
        f"  no longer inert: {sorted(set(KNOWN_INERT) - found)}\n"
        f"Wire it or remove it, then update KNOWN_INERT in the same commit."
    )


def test_en16931_and_peppol_ship_no_codelist_files() -> None:
    """Neither profile vendored a .gc, so neither can have an inert one.

    Pinned so that vendoring one later without wiring it trips the guard rather
    than passing silently on an empty audit.
    """
    assert audit_profile_codelists("en16931") == []
    assert audit_profile_codelists("peppol-bis-3.0") == []


def test_the_guard_raises_naming_every_inert_file() -> None:
    with pytest.raises(CodelistIntegrityError) as caught:
        assert_no_inert_codelists("pint-ae")

    message = str(caught.value)
    assert "INERT CODE LIST" in message
    assert "Wire it or remove it" in message
    # Every file named individually. A count is not actionable.
    for relative in KNOWN_INERT:
        assert relative in message, f"{relative} not named in the failure"


def test_a_profile_with_no_inert_codelists_does_not_raise() -> None:
    assert_no_inert_codelists("en16931")  # must not raise


def test_prose_mentions_do_not_count_as_a_reference(tmp_path: Path) -> None:
    """The regression that motivated exact-filename matching.

    `UNCL4461` appears in ibr-cl-16's ASSERT TEXT while the executable
    enumeration is inlined and admits a different set. Matching on the stem
    reported the file as wired and hid the defect the guard exists to surface.
    """
    from validator import specs_audit

    profile = tmp_path / "fake-profile"
    (profile / "published").mkdir(parents=True)
    (profile / "published" / "UNCL4461.gc").write_bytes(b"<gc/>")
    (profile / "published" / "rules.sch").write_bytes(
        b'<schema><assert>MUST be coded using UNCL4461 code list</assert></schema>'
    )

    monkey = pytest.MonkeyPatch()
    monkey.setattr(specs_audit, "_SPECS_DIR", tmp_path)
    try:
        inert = specs_audit.audit_profile_codelists("fake-profile")
    finally:
        monkey.undo()

    assert [item.path.name for item in inert] == ["UNCL4461.gc"], (
        "a prose mention of the stem must NOT count as a functional reference"
    )

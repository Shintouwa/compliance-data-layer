"""Engine tests, focused on the LOUD FAILURE contract.

architecture.md Part I §1.1: a crash is harmless, a wrong answer is
company-ending. Nearly every test here asserts that the engine REFUSES rather
than proceeding, because the alternative to refusing is a validator that
silently skips rules and reports invoices as passing when they will not.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from validator.engine import compile_ruleset, get_engine
from validator.errors import (
    CodelistIntegrityError,
    ParseError,
    SchematronCompileError,
    SchematronUnsupportedError,
)

MINIMAL_DOC = (
    b'<?xml version="1.0"?>'
    b'<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"'
    b' xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">'
    b"<cbc:ID>X-1</cbc:ID></Invoice>"
)


def sch(body: str, binding: str = "xslt2") -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<sch:schema xmlns:sch="http://purl.oclc.org/dsdl/schematron"\n'
        '            xmlns:cdl="https://compliance-data-layer.dev/schematron-extensions/v1"\n'
        f'            queryBinding="{binding}">\n'
        '  <sch:ns prefix="ubl" uri="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"/>\n'
        '  <sch:ns prefix="cbc" uri="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"/>\n'
        f"{body}\n"
        "</sch:schema>\n"
    )


def write(tmp_path: Path, content: str, name: str = "t.sch") -> list[Path]:
    path = tmp_path / name
    path.write_text(content, encoding="utf-8")
    return [path]


GOOD_RULE = """
  <sch:pattern id="p">
    <sch:rule context="ubl:Invoice">
      <sch:assert id="T-001" test="normalize-space(cbc:ID) != ''" flag="fatal"
                  cdl:failure-class="missing_mandatory"
                  cdl:expected-description="an id">must have an id</sch:assert>
    </sch:rule>
  </sch:pattern>
"""


def test_a_well_formed_ruleset_compiles(tmp_path: Path) -> None:
    ruleset = compile_ruleset("en16931", write(tmp_path, sch(GOOD_RULE)), [])
    assert ruleset.rule_ids == ("T-001",)
    assert ruleset.ruleset_hash.startswith("sha256:")


@pytest.mark.parametrize(
    "body",
    [
        pytest.param('  <sch:include href="other.sch"/>', id="include"),
        pytest.param('  <sch:phase id="fast"/>', id="phase"),
        pytest.param('  <sch:diagnostics/>', id="diagnostics"),
    ],
)
def test_unsupported_constructs_are_refused_not_skipped(tmp_path: Path, body: str) -> None:
    """A skipped construct is a rule that never fires. Refuse the whole ruleset."""
    with pytest.raises(SchematronUnsupportedError):
        compile_ruleset("en16931", write(tmp_path, sch(body + GOOD_RULE)), [])


def test_abstract_patterns_are_refused(tmp_path: Path) -> None:
    body = '  <sch:pattern id="abs" abstract="true"><sch:rule context="ubl:Invoice"/></sch:pattern>'
    with pytest.raises(SchematronUnsupportedError):
        compile_ruleset("en16931", write(tmp_path, sch(body)), [])


def test_xpath1_query_binding_is_refused(tmp_path: Path) -> None:
    """XPath 1.0 has different numeric and string semantics - SILENTLY different."""
    with pytest.raises(SchematronUnsupportedError, match="queryBinding"):
        compile_ruleset("en16931", write(tmp_path, sch(GOOD_RULE, binding="xslt")), [])


def test_assertion_without_an_id_is_refused(tmp_path: Path) -> None:
    """The corpus asserts on rule-ID sets; an anonymous assertion is unassertable."""
    body = """
  <sch:pattern id="p"><sch:rule context="ubl:Invoice">
    <sch:assert test="true()" cdl:expected-description="x">t</sch:assert>
  </sch:rule></sch:pattern>"""
    with pytest.raises(SchematronUnsupportedError, match="@id"):
        compile_ruleset("en16931", write(tmp_path, sch(body)), [])


def test_assertion_without_expected_description_is_refused(tmp_path: Path) -> None:
    """Without it the only way to describe the failure is to quote the value."""
    body = """
  <sch:pattern id="p"><sch:rule context="ubl:Invoice">
    <sch:assert id="T-9" test="true()">t</sch:assert>
  </sch:rule></sch:pattern>"""
    with pytest.raises(SchematronUnsupportedError, match="cdl:expected-description"):
        compile_ruleset("en16931", write(tmp_path, sch(body)), [])


def test_unknown_failure_class_is_refused(tmp_path: Path) -> None:
    body = """
  <sch:pattern id="p"><sch:rule context="ubl:Invoice">
    <sch:assert id="T-9" test="true()" cdl:failure-class="vibes"
                cdl:expected-description="x">t</sch:assert>
  </sch:rule></sch:pattern>"""
    with pytest.raises(SchematronUnsupportedError, match="failure-class"):
        compile_ruleset("en16931", write(tmp_path, sch(body)), [])


def test_duplicate_rule_ids_are_refused(tmp_path: Path) -> None:
    with pytest.raises(SchematronCompileError, match="Duplicate rule id"):
        compile_ruleset("en16931", write(tmp_path, sch(GOOD_RULE + GOOD_RULE)), [])


def test_a_missing_ruleset_file_is_refused(tmp_path: Path) -> None:
    """Validating without a declared file silently applies a partial ruleset."""
    with pytest.raises(SchematronCompileError, match="not found"):
        compile_ruleset("en16931", [tmp_path / "absent.sch"], [])


def test_a_partial_codelist_may_not_produce_a_failure(tmp_path: Path) -> None:
    """A list we hold part of can confirm membership, never deny it."""
    body = """
  <sch:pattern id="p"><sch:rule context="ubl:Invoice">
    <sch:assert id="T-9" test="$CODELIST = 'x'" flag="fatal" cdl:codelist="ISO4217"
                cdl:expected-description="x">t</sch:assert>
  </sch:rule></sch:pattern>"""
    with pytest.raises(CodelistIntegrityError, match="completeness"):
        compile_ruleset("en16931", write(tmp_path, sch(body)), ["ISO4217"])


def test_a_partial_codelist_may_warn(tmp_path: Path) -> None:
    body = """
  <sch:pattern id="p"><sch:rule context="ubl:Invoice">
    <sch:assert id="T-9" test="$CODELIST = 'x'" flag="warning" cdl:codelist="ISO4217"
                cdl:expected-description="x">t</sch:assert>
  </sch:rule></sch:pattern>"""
    ruleset = compile_ruleset("en16931", write(tmp_path, sch(body)), ["ISO4217"])
    assert ruleset.rule_ids == ("T-9",)


def test_a_complete_codelist_may_produce_a_failure(tmp_path: Path) -> None:
    body = """
  <sch:pattern id="p"><sch:rule context="ubl:Invoice">
    <sch:assert id="T-9" test="$CODELIST = 'S'" flag="fatal" cdl:codelist="UNTDID5305"
                cdl:expected-description="x">t</sch:assert>
  </sch:rule></sch:pattern>"""
    ruleset = compile_ruleset("en16931", write(tmp_path, sch(body)), ["UNTDID5305"])
    assert ruleset.rule_ids == ("T-9",)


def test_ruleset_hash_is_deterministic(tmp_path: Path) -> None:
    paths = write(tmp_path, sch(GOOD_RULE))
    assert (
        compile_ruleset("en16931", paths, ["UNTDID5305"]).ruleset_hash
        == compile_ruleset("en16931", paths, ["UNTDID5305"]).ruleset_hash
    )


def test_ruleset_hash_covers_the_codelists(tmp_path: Path) -> None:
    """Code lists are inlined into compiled tests, so they change results.

    A result that is not reproducible from its ruleset_hash cannot be replayed,
    and Part I §2.9 makes replayability the point of storing the hash.
    """
    paths = write(tmp_path, sch(GOOD_RULE))
    assert (
        compile_ruleset("en16931", paths, ["UNTDID5305"]).ruleset_hash
        != compile_ruleset("en16931", paths, ["UNTDID5305", "ISO4217"]).ruleset_hash
    )


def test_malformed_xml_raises_parse_error_with_a_position(tmp_path: Path) -> None:
    ruleset = compile_ruleset("en16931", write(tmp_path, sch(GOOD_RULE)), [])
    with pytest.raises(ParseError) as excinfo:
        get_engine().validate(b"<Invoice><unclosed>", ruleset)
    assert excinfo.value.line > 0


def test_parse_error_carries_no_document_content(tmp_path: Path) -> None:
    """Part III §5: the 422 body never echoes document content."""
    ruleset = compile_ruleset("en16931", write(tmp_path, sch(GOOD_RULE)), [])
    secret = "ACME-CONFIDENTIAL-PAYLOAD"
    with pytest.raises(ParseError) as excinfo:
        get_engine().validate(f"<Invoice>{secret}<oops>".encode(), ruleset)
    assert secret not in str(excinfo.value)
    assert secret not in repr(excinfo.value)


def test_first_matching_rule_in_a_pattern_claims_the_node(tmp_path: Path) -> None:
    """ISO Schematron rule-claiming semantics, within one pattern."""
    body = """
  <sch:pattern id="p">
    <sch:rule context="ubl:Invoice">
      <sch:assert id="FIRST" test="false()" flag="error"
                  cdl:expected-description="x">a</sch:assert>
    </sch:rule>
    <sch:rule context="ubl:Invoice">
      <sch:assert id="SECOND" test="false()" flag="error"
                  cdl:expected-description="x">b</sch:assert>
    </sch:rule>
  </sch:pattern>"""
    ruleset = compile_ruleset("en16931", write(tmp_path, sch(body)), [])
    fired = [f.rule_id for f in get_engine().validate(MINIMAL_DOC, ruleset)]
    assert fired == ["FIRST"]


def test_include_warnings_false_drops_warning_findings(tmp_path: Path) -> None:
    body = """
  <sch:pattern id="p"><sch:rule context="ubl:Invoice">
    <sch:assert id="W-1" test="false()" flag="warning"
                cdl:expected-description="x">w</sch:assert>
  </sch:rule></sch:pattern>"""
    ruleset = compile_ruleset("en16931", write(tmp_path, sch(body)), [])
    engine = get_engine()
    assert len(engine.validate(MINIMAL_DOC, ruleset)) == 1
    assert engine.validate(MINIMAL_DOC, ruleset, include_warnings=False) == []


def test_report_fires_on_true_where_assert_fires_on_false(tmp_path: Path) -> None:
    body = """
  <sch:pattern id="p"><sch:rule context="ubl:Invoice">
    <sch:report id="R-1" test="true()" flag="error"
                cdl:expected-description="x">r</sch:report>
  </sch:rule></sch:pattern>"""
    ruleset = compile_ruleset("en16931", write(tmp_path, sch(body)), [])
    assert [f.rule_id for f in get_engine().validate(MINIMAL_DOC, ruleset)] == ["R-1"]


def test_findings_carry_a_readable_xpath(tmp_path: Path) -> None:
    """Q{uri}local is unreadable in an exception inbox; prefix:local is not."""
    ruleset = compile_ruleset("en16931", write(tmp_path, sch(GOOD_RULE)), [])
    doc = MINIMAL_DOC.replace(b"<cbc:ID>X-1</cbc:ID>", b"<cbc:ID></cbc:ID>")
    findings = get_engine().validate(doc, ruleset)
    assert findings[0].xpath is not None
    assert "Q{" not in findings[0].xpath
    assert "ubl:Invoice" in findings[0].xpath

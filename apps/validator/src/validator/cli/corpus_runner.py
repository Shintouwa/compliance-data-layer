"""The Golden File Corpus runner. architecture.md Part I §3.

    "The Golden File Corpus converts the agent from a confident text generator
     into a system that cannot regress silently."  — §3.1

What this asserts, and why each part matters
--------------------------------------------
§3.3: the corpus asserts on the SET OF RULE IDS RETURNED, not on a boolean.
"Did it fail?" is not a test. So every case checks:

  outcome           the pass/fail/warn verdict
  fired_rules       the exact rule-ID set (or a justified superset)
  must_not_fire     negative assertions — catches OVER-firing, which a
                    pass/fail boolean hides completely
  failure_classes   classification, not just detection. The corpus's commercial
                    value depends on classification being right.
  business_terms    the BT the finding is bound to
  value_shapes      that redaction worked. A raw value appearing here means
                    redaction.py has a defect and the Rule-1 guarantee is void.

§3.4 Rule A: every profile carries at least as many expected-FAIL files as
expected-PASS. Without it an agent satisfies the corpus with a validator that
never fails anything.

§3.4 Rule B: no raw commercial values in any client_derived file. A false
positive is fixed by re-scrubbing the fixture, NEVER by weakening the pattern.

Exit status is 0 only if every one of those holds for every case.
"""

from __future__ import annotations

import json
import os
import re
import sys
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Final, Literal

from pydantic import BaseModel, ConfigDict, Field

from ..errors import ValidatorError
from ..models import ProfileId, Syntax
from ..specs_registry import PROVISIONAL_ENV_FLAG

__all__ = ["FORBIDDEN_PATTERNS", "assert_fail_balance", "main"]

# architecture.md Part I §3.4 Rule B, verbatim.
FORBIDDEN_PATTERNS: Final[list[str]] = [
    r"\b\d{15}\b",  # UAE TRN shape
    r"[A-Z]{2}\d{2}[A-Z0-9]{11,30}",  # IBAN shape
    r"\b[\w.+-]+@[\w-]+\.[\w.]+\b",  # email
]

# M0 exit criterion 1 (architecture.md Part II · M0), made executable. A
# criterion that lives only in a document is a criterion nobody checks.
MIN_CASES: Final = 60
MIN_FAIL_CASES: Final = 30


def assert_fail_balance(profile_dir: Path) -> None:
    """architecture.md Part I §3.4 Rule A."""
    passes = len(list(profile_dir.glob("*_pass.expected.json")))
    fails = len(list(profile_dir.glob("*_fail.expected.json")))
    if fails < passes:
        raise SystemExit(
            f"CORPUS BALANCE FAILURE in {profile_dir.name}: "
            f"{fails} fail-cases vs {passes} pass-cases. architecture.md §3.4 Rule A."
        )


class ExpectedShape(BaseModel):
    model_config = ConfigDict(extra="forbid")

    len: int | None = None
    charset: str | None = None
    regex_class: str | None = None
    expected: str | None = None


class ExpectedInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    file: str
    syntax: Syntax


class ExpectedSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    spec_id: ProfileId
    version: str


class Expectation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    outcome: Literal["pass", "fail", "warn"]
    match: Literal["exact", "superset"] = "exact"
    match_justification: str | None = None
    fired_rules: list[str] = Field(default_factory=list)
    must_not_fire: list[str] = Field(default_factory=list)
    failure_classes: dict[str, str] = Field(default_factory=dict)
    business_terms: dict[str, str] = Field(default_factory=dict)
    value_shapes: dict[str, ExpectedShape] = Field(default_factory=dict)


class CorpusCase(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    schema_ref: str | None = Field(default=None, alias="$schema")
    case_id: str
    description: str
    input: ExpectedInput
    spec: ExpectedSpec
    expect: Expectation
    provenance: Literal["synthetic", "client_derived", "spec_example"]
    added_in: str


@dataclass(slots=True)
class Report:
    checked: int = 0
    failed: int = 0
    superset_cases: int = 0
    problems: list[str] = field(default_factory=list)

    def fail(self, case_id: str, message: str) -> None:
        self.failed += 1
        self.problems.append(f"{case_id}: {message}")


def _scrub_check(case: CorpusCase, document: bytes, report: Report) -> None:
    """§3.4 Rule B."""
    if case.provenance != "client_derived":
        return
    text = document.decode("utf-8", errors="replace")
    for pattern in FORBIDDEN_PATTERNS:
        if re.search(pattern, text):
            report.fail(
                case.case_id,
                f"RULE B VIOLATION: a client_derived fixture matches the "
                f"forbidden pattern {pattern!r}. Re-scrub the fixture. Do NOT "
                f"weaken the pattern. architecture.md §3.4 Rule B.",
            )
            return


def _check_case(case_path: Path, report: Report) -> None:
    from ..main import run_validation

    try:
        case = CorpusCase.model_validate(json.loads(case_path.read_text(encoding="utf-8")))
    except Exception as exc:  # noqa: BLE001 — a malformed expectation must be loud
        report.fail(case_path.name, f"expectation file is not valid: {exc}")
        return

    document_path = case_path.parent / case.input.file
    if not document_path.is_file():
        report.fail(case.case_id, f"input file not found: {document_path}")
        return

    document = document_path.read_bytes()
    _scrub_check(case, document, report)

    try:
        response = run_validation(
            document=document,
            profile=case.spec.spec_id,
            spec_version=None,
            run_id=uuid.uuid4(),
            syntax=case.input.syntax,
        )
    except ValidatorError as exc:
        report.fail(case.case_id, f"validator could not reach a verdict: {exc}")
        return

    report.checked += 1
    actual_ids = [finding.rule_id for finding in response.findings]
    actual_set = set(actual_ids)
    expected_set = set(case.expect.fired_rules)

    if response.outcome != case.expect.outcome:
        report.fail(
            case.case_id,
            f"outcome {response.outcome!r}, expected {case.expect.outcome!r} "
            f"(fired: {sorted(actual_set)})",
        )

    if case.expect.match == "exact":
        if actual_set != expected_set:
            missing = sorted(expected_set - actual_set)
            extra = sorted(actual_set - expected_set)
            report.fail(
                case.case_id,
                f"rule-ID set mismatch. missing={missing} unexpected={extra}",
            )
    else:
        report.superset_cases += 1
        if not (case.expect.match_justification or "").strip():
            report.fail(
                case.case_id,
                'match="superset" requires a non-empty match_justification (§3.3).',
            )
        if not expected_set <= actual_set:
            report.fail(
                case.case_id,
                f"superset match: missing={sorted(expected_set - actual_set)}",
            )

    fired_forbidden = sorted(actual_set & set(case.expect.must_not_fire))
    if fired_forbidden:
        report.fail(
            case.case_id,
            f"OVER-FIRING: must_not_fire rules fired: {fired_forbidden}",
        )

    if len(actual_ids) != len(actual_set):
        duplicates = sorted({rid for rid in actual_ids if actual_ids.count(rid) > 1})
        report.fail(case.case_id, f"rule fired more than once: {duplicates}")

    by_id = {finding.rule_id: finding for finding in response.findings}

    for rule_id, expected_class in case.expect.failure_classes.items():
        finding = by_id.get(rule_id)
        if finding is None:
            report.fail(case.case_id, f"{rule_id}: expected to fire, did not")
        elif finding.failure_class != expected_class:
            report.fail(
                case.case_id,
                f"{rule_id}: failure_class {finding.failure_class!r}, "
                f"expected {expected_class!r}",
            )

    for rule_id, expected_term in case.expect.business_terms.items():
        finding = by_id.get(rule_id)
        if finding is None:
            report.fail(case.case_id, f"{rule_id}: expected to fire, did not")
        elif finding.business_term != expected_term:
            report.fail(
                case.case_id,
                f"{rule_id}: business_term {finding.business_term!r}, "
                f"expected {expected_term!r}",
            )

    for rule_id, expected_shape in case.expect.value_shapes.items():
        finding = by_id.get(rule_id)
        if finding is None:
            report.fail(case.case_id, f"{rule_id}: expected to fire, did not")
            continue
        actual_shape = finding.value_shape.model_dump() if finding.value_shape else {}
        wanted = expected_shape.model_dump()
        if actual_shape != wanted:
            report.fail(
                case.case_id,
                f"{rule_id}: value_shape {actual_shape} != expected {wanted}. "
                f"If a RAW VALUE appears above, redaction.py has a defect and "
                f"the Rule-1 guarantee is void — treat as Sev-1.",
            )


def main(argv: list[str] | None = None) -> int:
    args = argv if argv is not None else sys.argv[1:]
    if len(args) != 1:
        print("usage: python -m validator.cli.corpus_runner <corpus-root>", file=sys.stderr)
        return 2

    root = Path(args[0]).resolve()
    if not root.is_dir():
        print(f"corpus root not found: {root}", file=sys.stderr)
        return 2

    # The shipped rulesets are agent-authored and provisional (specs/RULES.md);
    # exercising them is exactly what this runner is for. No client-facing path
    # sets this.
    os.environ[PROVISIONAL_ENV_FLAG] = "1"

    profile_dirs = sorted(
        path
        for path in root.iterdir()
        if path.is_dir() and path.name != "schemas" and any(path.glob("*.expected.json"))
    )
    if not profile_dirs:
        print(f"no corpus profiles found under {root}", file=sys.stderr)
        return 2

    report = Report()
    total_pass = total_fail = 0

    print(f"Golden File Corpus - {root}")
    for profile_dir in profile_dirs:
        assert_fail_balance(profile_dir)  # §3.4 Rule A — raises SystemExit
        passes = len(list(profile_dir.glob("*_pass.expected.json")))
        fails = len(list(profile_dir.glob("*_fail.expected.json")))
        total_pass += passes
        total_fail += fails

        before = report.failed
        for case_path in sorted(profile_dir.glob("*.expected.json")):
            _check_case(case_path, report)
        status = "ok" if report.failed == before else "FAILED"
        print(
            f"  {profile_dir.name:<16} {passes:>3} pass | {fails:>3} fail   "
            f"balance ok   {status}"
        )

    total_cases = total_pass + total_fail

    for problem in report.problems:
        # ASCII only. U+2717 has no cp1252 mapping, so on a default Windows
        # console this line would raise UnicodeEncodeError and the runner would
        # die *while reporting a corpus failure* — losing the diagnosis at
        # exactly the moment it matters.
        print(f"\n  FAIL {problem}", file=sys.stderr)

    print(
        f"\n{report.checked} cases run | {total_fail} expected-fail | "
        f"{report.superset_cases} superset | {report.failed} problems"
    )

    if report.failed:
        print(
            "\nCORPUS FAILURE. architecture.md CLAUDE.md §4.7(2): a corpus test "
            "that fails after your change means YOUR CHANGE IS WRONG. The corpus "
            "is the specification - fix the code, not the expectation.",
            file=sys.stderr,
        )
        return 1

    if total_cases < MIN_CASES or total_fail < MIN_FAIL_CASES:
        print(
            f"\nCORPUS TOO SMALL: {total_cases} cases ({total_fail} expected-fail). "
            f"M0 exit criterion 1 requires >= {MIN_CASES} cases and "
            f">= {MIN_FAIL_CASES} expected-fail.",
            file=sys.stderr,
        )
        return 1

    print("Corpus OK.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

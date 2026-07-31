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
from ..specs_registry import PROVISIONAL_ENV_FLAG, load_spec

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
    # mechanically_derived_pending_review: the document was produced by mutating
    # a known-conformant fixture to violate ONE named rule, and fired_rules was
    # written from that rule's @test, never from engine output. It carries no
    # human sign-off yet — the value exists so that "nobody has reviewed this"
    # is a fact in the file rather than something you have to remember.
    provenance: Literal[
        "synthetic",
        "client_derived",
        "spec_example",
        "mechanically_derived_pending_review",
    ]
    added_in: str


@dataclass(slots=True)
class Report:
    checked: int = 0
    failed: int = 0
    superset_cases: int = 0
    quarantined: int = 0
    problems: list[str] = field(default_factory=list)
    # spec_id -> the rule IDs some case in the corpus actually made fire.
    exercised: dict[str, set[str]] = field(default_factory=dict)
    # spec_id -> the rule IDs whose sch:rule/@context matched at least one node
    # in at least one corpus document. A rule can be in here and NOT in
    # `exercised`: that is the "evaluated, always true" case, and it is the one
    # a bare fired/declared ratio cannot distinguish from "never looked at".
    context_present: dict[str, set[str]] = field(default_factory=dict)
    # spec_id -> rule IDs whose context could not be evaluated for bucketing.
    # Never silently folded into another bucket -- see _report_reachability.
    context_undetermined: dict[str, set[str]] = field(default_factory=dict)

    def fail(self, case_id: str, message: str) -> None:
        self.failed += 1
        self.problems.append(f"{case_id}: {message}")

    def record_exercised(self, spec_id: str, rule_ids: set[str]) -> None:
        self.exercised.setdefault(spec_id, set()).update(rule_ids)

    def record_context_present(self, spec_id: str, rule_ids: set[str]) -> None:
        self.context_present.setdefault(spec_id, set()).update(rule_ids)

    def record_context_undetermined(self, spec_id: str, rule_ids: set[str]) -> None:
        self.context_undetermined.setdefault(spec_id, set()).update(rule_ids)


# Rules PROVEN unable to match any conforming document, by human review, with
# the proof recorded next to the entry. Deliberately empty and deliberately
# hand-maintained: "unreachable" is a claim about every possible document, and a
# corpus cannot establish it by not having got there yet. Anything inferred
# would be a proof this file did not do.
PROVEN_UNREACHABLE: Final[dict[str, frozenset[str]]] = {}

_WRAPPED_CONTEXT: Final = re.compile(r"^//\((.*)\)$", re.S)


def _context_to_xpath1(expr: str) -> str | None:
    """Re-express an engine context expression for lxml, or None if it cannot be.

    engine._context_to_expression wraps a match pattern as `//(A | B)`, which is
    XPath 2.0 syntax that lxml cannot parse. `//A | //B` is the XPath 1.0
    equivalent for the union-of-name-tests forms our rulesets use. Anything else
    returns None and is reported as UNDETERMINED rather than being guessed at.
    """
    expr = expr.strip()
    match = _WRAPPED_CONTEXT.match(expr)
    if match is None:
        return expr if expr.startswith("/") else None
    branches = [branch.strip() for branch in match.group(1).split("|")]
    if not all(branches):
        return None
    return " | ".join(f"//{branch}" for branch in branches)


def _record_context_presence(spec_id: str, document: bytes, report: Report) -> None:
    """Note which rules' contexts this document actually selects a node for.

    This is what separates "the rule ran and was satisfied" from "the rule never
    ran at all". Both look identical in a fired/declared ratio, and only one of
    them is evidence of anything.
    """
    from lxml import etree as _etree

    from ..specs_registry import get_ruleset

    try:
        ruleset = get_ruleset(spec_id)
    except ValidatorError:
        return

    try:
        root = _etree.fromstring(
            document,
            parser=_etree.XMLParser(resolve_entities=False, no_network=True, load_dtd=False),
        )
    except _etree.XMLSyntaxError:
        return  # _check_case already reports the parse failure

    namespaces = {prefix: uri for prefix, uri in ruleset.namespaces if prefix}
    present: set[str] = set()
    undetermined: set[str] = set()

    for pattern in ruleset.patterns:
        for ctx in pattern.contexts:
            rule_ids = {rule.rule_id for rule in ctx.rules}
            xpath1 = _context_to_xpath1(ctx.context_expr)
            if xpath1 is None:
                undetermined |= rule_ids
                continue
            try:
                matched = root.xpath(xpath1, namespaces=namespaces)
            except _etree.XPathError:
                undetermined |= rule_ids
                continue
            if isinstance(matched, list) and matched:
                present |= rule_ids

    report.record_context_present(spec_id, present)
    report.record_context_undetermined(spec_id, undetermined - present)


def _report_reachability(report: Report) -> None:
    """Print how much of each executed ruleset the corpus actually made fire.

    REPORTED, NOT GATED — deliberately, and the distinction is the point.

    A rule no case makes fire records "did not fire", and in a corpus that is
    indistinguishable from a rule that passed. The number below is the size of
    that blind spot for the ruleset the runner is CURRENTLY executing.

    It does not, and must not, claim to be the reachability audit. Three things
    it cannot see:

      - Whether an un-exercised rule COULD fire at all. Some cannot: a guard no
        conforming document can open makes a rule permanently silent, and that
        is a different and worse condition than "no fixture written yet".
        Separating the two needs a proof per rule, not a count.
      - The published rulesets. These numbers cover the provisional
        CDL-PROV-* rules the engine can execute today, not the vendored
        Schematron the corpus is being authored against.
      - Rules that fired but only because a guard was closed, which is a pass
        the corpus cannot distinguish from a real one.

    So: a number that goes UP is good news and a number that goes DOWN is worth
    a look, and neither is a verdict. Gating on it before the published rulesets
    are wired in would gate on the wrong denominator.
    """
    from ..specs_registry import get_ruleset

    # Every spec_id that had at least one case reach a verdict. Keyed on the
    # case's spec_id, never on the corpus directory name: tests/corpus/uae
    # carries spec_id "pint-ae", and joining on the directory would silently
    # report nothing for the one profile that matters most.
    executed = sorted(report.exercised)
    if not executed:
        return

    print("\nRule coverage (reported, NOT gated) - provisional rulesets:")
    print(
        f"  {'profile':<16} {'assert':>6} {'exerc':>6} {'always-T':>9} "
        f"{'ctx-absent':>11} {'unreach':>8} {'undet':>6}"
    )

    totals = dict.fromkeys(
        ("declared", "fired", "always_true", "absent", "unreachable", "undetermined"), 0
    )
    detail: list[tuple[str, list[str], list[str]]] = []

    for spec_id in executed:
        try:
            declared = set(get_ruleset(spec_id).rule_ids)
        except ValidatorError as exc:
            print(f"  {spec_id:<16} ruleset unavailable: {exc}")
            continue

        fired = report.exercised.get(spec_id, set()) & declared
        undetermined = report.context_undetermined.get(spec_id, set()) & declared
        # A rule that fired obviously had its context present, whatever the
        # bucketing pass concluded; union so the two can never disagree.
        present = (report.context_present.get(spec_id, set()) & declared) | fired

        always_true = present - fired
        absent = declared - present - undetermined
        unreachable = PROVEN_UNREACHABLE.get(spec_id, frozenset()) & absent

        totals["declared"] += len(declared)
        totals["fired"] += len(fired)
        totals["always_true"] += len(always_true)
        totals["absent"] += len(absent)
        totals["unreachable"] += len(unreachable)
        totals["undetermined"] += len(undetermined)

        print(
            f"  {spec_id:<16} {len(declared):>6} {len(fired):>6} {len(always_true):>9} "
            f"{len(absent):>11} {len(unreachable):>8} {len(undetermined):>6}"
        )
        detail.append((spec_id, sorted(always_true), sorted(absent)))

    print(
        f"  {'TOTAL':<16} {totals['declared']:>6} {totals['fired']:>6} "
        f"{totals['always_true']:>9} {totals['absent']:>11} "
        f"{totals['unreachable']:>8} {totals['undetermined']:>6}"
    )

    for spec_id, always_true_ids, absent_ids in detail:
        if always_true_ids:
            print(f"    {spec_id} evaluated, never once false: {' '.join(always_true_ids)}")
        if absent_ids:
            print(f"    {spec_id} context never present:       {' '.join(absent_ids)}")

    print(
        "  exerc = made to fire. always-T = context present, assertion never "
        "false.\n"
        "  ctx-absent = no corpus document selects the rule's context, so the "
        "rule\n"
        "  never ran. unreach = of those, PROVEN impossible (human-reviewed; a\n"
        "  corpus cannot establish it). undet = context not bucketable here, "
        "never\n"
        "  folded into another column. Covers the provisional rules the engine\n"
        "  executes today, NOT the vendored published rulesets."
    )


def _quarantine_reason(profile_dir: Path) -> str | None:
    """The `unavailable` string from the registry entry, if the profile is one.

    Resolved from the registry rather than from a list in this file: the reason a
    profile cannot run belongs next to the ruleset, in the reviewed 🔒 registry
    entry, and there must be exactly one place to lift it from.

    A corpus directory with no registry entry is NOT quarantined -- that is a
    real error and _check_case must be allowed to report it.
    """
    try:
        return load_spec(profile_dir.name).unavailable
    except ValidatorError:
        return None


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
    _record_context_presence(case.spec.spec_id, document, report)

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
    report.record_exercised(case.spec.spec_id, actual_set)

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
    quarantine_notes: list[str] = []
    for profile_dir in profile_dirs:
        assert_fail_balance(profile_dir)  # §3.4 Rule A — raises SystemExit
        passes = len(list(profile_dir.glob("*_pass.expected.json")))
        fails = len(list(profile_dir.glob("*_fail.expected.json")))

        reason = _quarantine_reason(profile_dir)
        if reason is not None:
            # Deliberately NOT counted toward total_cases / total_fail. A case
            # that did not execute certified nothing, and letting it satisfy the
            # M0 exit criterion is the "green while asserting nothing" failure
            # the corpus exists to prevent. The debt is printed instead.
            report.quarantined += passes + fails
            quarantine_notes.append(f"{profile_dir.name}: {reason}")
            print(
                f"  {profile_dir.name:<16} {passes:>3} pass | {fails:>3} fail   "
                f"balance ok   QUARANTINED (not run)"
            )
            continue

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

    for note in quarantine_notes:
        print(f"\n  QUARANTINED {note}")

    _report_reachability(report)

    total_cases = total_pass + total_fail

    for problem in report.problems:
        # ASCII only. U+2717 has no cp1252 mapping, so on a default Windows
        # console this line would raise UnicodeEncodeError and the runner would
        # die *while reporting a corpus failure* — losing the diagnosis at
        # exactly the moment it matters.
        print(f"\n  FAIL {problem}", file=sys.stderr)

    print(
        f"\n{report.checked} cases run | {total_fail} expected-fail | "
        f"{report.superset_cases} superset | {report.quarantined} quarantined | "
        f"{report.failed} problems"
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
        shortfall = (
            f" {report.quarantined} further cases exist but are quarantined and did "
            f"not run; they do not count, because a case that did not execute "
            f"certified nothing. Close the gap with EXECUTABLE cases, or lift a "
            f"quarantine by obtaining the ruleset it names."
            if report.quarantined
            else ""
        )
        print(
            f"\nCORPUS TOO SMALL: {total_cases} cases ({total_fail} expected-fail). "
            f"M0 exit criterion 1 requires >= {MIN_CASES} cases and "
            f">= {MIN_FAIL_CASES} expected-fail.{shortfall}",
            file=sys.stderr,
        )
        return 1

    print("Corpus OK.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

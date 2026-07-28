"""Validator error taxonomy.

architecture.md Part I §1.1: a crash is harmless, a wrong answer is
company-ending. Every error in this module exists so that an ambiguous or
unverifiable situation becomes a loud failure rather than a confident output.

The HTTP mapping is Part III §5 "Error handling". Nothing here ever carries a
raw document value — `ParseError` deliberately reports line/column only.
"""

from __future__ import annotations

__all__ = [
    "CodelistIntegrityError",
    "EngineFailureError",
    "ParseError",
    "ProvisionalRulesetRefused",
    "RedactionInvariantError",
    "SchematronCompileError",
    "SchematronUnsupportedError",
    "UnknownSpecError",
    "UnsupportedSyntaxError",
    "ValidatorError",
]


class ValidatorError(Exception):
    """Base for every error this package raises deliberately."""


class ParseError(ValidatorError):
    """Malformed XML. HTTP 422.

    Part III §5: the response body carries line and column and NEVER echoes
    document content. The offending text is not stored on the exception either,
    because exceptions get logged.
    """

    def __init__(self, line: int, column: int) -> None:
        super().__init__(f"parse_error at line {line}, column {column}")
        self.line = line
        self.column = column


class UnknownSpecError(ValidatorError):
    """Unknown profile or spec version. HTTP 400."""

    def __init__(self, requested: str, available: list[str]) -> None:
        super().__init__(f"unknown_spec: {requested!r}; available: {available!r}")
        self.requested = requested
        self.available = available


class UnsupportedSyntaxError(ValidatorError):
    """A syntax the profile does not declare, or one M0 does not implement.

    CII-D16B raises this via parsers/cii.py. architecture.md Part II · M0 makes
    CII a deliberate stub: returning an empty business-term dict instead would
    report a CII invoice as clean, which is the exact failure mode §1.1 forbids.
    """


class EngineFailureError(ValidatorError):
    """Saxon failed. HTTP 500 + Sentry. Job retries 5x."""

    def __init__(self, correlation_id: str, detail: str) -> None:
        super().__init__(f"engine_failure [{correlation_id}]: {detail}")
        self.correlation_id = correlation_id
        self.detail = detail


class SchematronUnsupportedError(ValidatorError):
    """The ruleset uses a Schematron construct this engine does not implement.

    This is a LOUD failure on purpose. The alternative — skipping the construct
    — silently drops rules, and a validator that silently drops rules reports
    invoices as passing when they will not. architecture.md Part I §1.1.

    Expect this the first time a published PINT AE / EN 16931 Schematron is
    installed: those use abstract patterns and sch:include. That is a real task,
    not a bug to paper over.
    """


class SchematronCompileError(ValidatorError):
    """A rule's XPath did not compile.

    Also loud: an uncompilable assert is a rule that would never fire.
    """


class ProvisionalRulesetRefused(ValidatorError):
    """Refused to validate against an unresolved ruleset.

    CLAUDE.md §4.7(1) and architecture.md "How an agent must use this file" (2):
    a spec version marked RESOLVE_IN_WEEK_1 has not been resolved from its
    primary source. Running client data against a provisional interpretation of
    a tax specification and reporting the result as conformance is precisely the
    company-ending wrong answer.

    The corpus runner sets CDL_ALLOW_PROVISIONAL_RULESET=1 because its whole
    purpose is to exercise the machinery. No client-facing path may.
    """


class RedactionInvariantError(ValidatorError):
    """A raw value reached a field that must only ever carry a shape.

    Sev-1. architecture.md Part I §2.9, Part IV §6, Part V §3. Halt the
    pipeline and fix redaction.py. Do not weaken the assertion that caught it.
    """


class CodelistIntegrityError(ValidatorError):
    """A ruleset asked a partial code list to produce a failure.

    A code list we hold only part of can confirm membership but cannot deny it.
    Letting a partial list emit `fail` produces false rejections on codes that
    are perfectly valid and merely absent from our copy.
    """

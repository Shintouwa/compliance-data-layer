"""🔒 HUMAN-OWNED — architecture.md Part I §2.9, CLAUDE.md §4.3.

Produces `value_shape`. The entire legal defensibility of the corpus rests on
this file.

The guarantee
-------------
A raw commercial value never crosses the sidecar's process boundary. Two things
leave this module in place of a value:

  1. `ValueShape` — length, character class, a character-class signature, and
     the pattern the rule expected.
  2. `message` — templated FROM THE SHAPE. Never interpolating the value.

(2) is the leak path that gets forgotten. A message like
`f"Invalid TRN: {value}"` puts a raw TRN into `client_data.finding.message`
and from there into the UI and the logs, and the Rule-1 guarantee is void even
though `value_shape` looks perfect. See Part I §2.9 layer 2.

The no-echo invariant
---------------------
M0 exit criterion 3: no output field ever equals an input value. Enforced by
construction in `_enforce_no_echo`, which nulls any field that collides with the
input. Collisions are rare and pathological (input `"1"` whose length is 1;
input `"alpha"` whose charset is alpha) but "rare" is not a guarantee, and the
criterion says never.

Nulling rather than raising is deliberate: the colliding cases are legitimate
client values, and refusing to emit a finding for them would hide a real
conformance failure. Losing one shape field discloses strictly less and still
reports the failure. The suppression is counted and logged (field name only).

Reading this file is how you write correct code around it.
"""

from __future__ import annotations

import logging
import re
from typing import Final, Literal

from pydantic import BaseModel, ConfigDict, Field

from .errors import RedactionInvariantError

__all__ = [
    "RAW_VALUE_PATTERNS",
    "Charset",
    "ValueShape",
    "assert_redacted",
    "build_message",
    "derive_value_shape",
    "describe_shape",
]

_log: Final = logging.getLogger("validator.redaction")

Charset = Literal["numeric", "alpha", "alnum", "mixed", "empty"]

# Mirror of the web-side backstop in architecture.md Part IV §6
# (apps/web/modules/corpus/assert-redacted.ts). Checked here FIRST, at emit
# time, so a defect is caught in the sidecar's own test suite rather than in
# production at the corpus write boundary.
#
# A false positive is fixed by fixing the emitter, NEVER by weakening a pattern.
RAW_VALUE_PATTERNS: Final[tuple[re.Pattern[str], ...]] = (
    re.compile(r"\b\d{15}\b"),  # UAE TRN shape
    re.compile(r"[A-Z]{2}\d{2}[A-Z0-9]{11,30}"),  # IBAN shape
    re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.]+\b"),  # email
)

# Above this many character-class runs the signature stops being a shape and
# starts being a transcription. Collapse to a coarse form instead.
_MAX_RUNS: Final = 12


class ValueShape(BaseModel):
    """The only representation of a failing value that crosses the boundary.

    Field names are the wire contract (architecture.md Part III §5) and match
    `packages/db/schema/_shared.ts` `ValueShape` on the TypeScript side.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    len: int | None = Field(default=None, description="Character count, or null when the value is absent.")
    charset: Charset | None = Field(default=None, description="Coarse character class of the whole value.")
    regex_class: str | None = Field(default=None, description="Character-class signature. Never contains value characters.")
    expected: str | None = Field(default=None, description="Pattern the rule required. Rule metadata, not client data.")


def _classify(value: str) -> Charset:
    if value == "":
        return "empty"
    if value.isdigit():
        return "numeric"
    if value.isalpha() and value.isascii():
        return "alpha"
    if value.isalnum() and value.isascii():
        return "alnum"
    return "mixed"


def _char_class(char: str) -> str:
    if char.isdigit():
        return "[0-9]"
    if char.isascii() and char.isupper():
        return "[A-Z]"
    if char.isascii() and char.islower():
        return "[a-z]"
    if char.isspace():
        return r"[\s]"
    # Everything else — punctuation, symbols, non-ASCII letters — collapses to a
    # single generic class. Emitting the literal character here would put an "@"
    # or a "-" from the client's value into the shape. Structure, not content.
    return "[^A-Za-z0-9]"


def _regex_class(value: str) -> str | None:
    """Run-length encode `value` as a character-class signature.

    "AE-12345" -> "[A-Z]{2}[^A-Za-z0-9]{1}[0-9]{5}"

    Carries no characters from the value itself, only the classes they belong
    to and how many of each ran consecutively.
    """
    if value == "":
        return None

    runs: list[tuple[str, int]] = []
    for char in value:
        cls = _char_class(char)
        if runs and runs[-1][0] == cls:
            runs[-1] = (cls, runs[-1][1] + 1)
        else:
            runs.append((cls, 1))
        if len(runs) > _MAX_RUNS:
            return rf"[\s\S]{{{len(value)}}}"

    return "".join(f"{cls}{{{count}}}" for cls, count in runs)


def _enforce_no_echo(shape: ValueShape, raw: str) -> ValueShape:
    """M0 exit criterion 3. Null any field whose string form equals the input."""
    suppressed: list[str] = []
    fields: dict[str, object] = {
        "len": shape.len,
        "charset": shape.charset,
        "regex_class": shape.regex_class,
        "expected": shape.expected,
    }
    for name, value in fields.items():
        if value is not None and str(value) == raw:
            fields[name] = None
            suppressed.append(name)

    if not suppressed:
        return shape

    # Field NAMES only. The value that caused the collision is exactly what must
    # not reach a log line.
    _log.warning(
        "redaction: suppressed shape field(s) %s — derived form collided with the input value",
        ",".join(suppressed),
    )
    return ValueShape.model_validate(fields)


def derive_value_shape(raw: str | None, expected: str | None = None) -> ValueShape:
    """Derive the shape of a failing value.

    `raw` is the only place in this process where a client value is held, and it
    is not retained: nothing from it reaches the returned object except length
    and character classes.

    `expected` is the pattern the rule required (`cdl:expected` in the
    Schematron). It is authored rule metadata, not client data.
    """
    if raw is None:
        # Absent is distinct from empty. "The element is not there" and "the
        # element is there and blank" are different conformance failures and
        # different remediations.
        return ValueShape(len=None, charset=None, regex_class=None, expected=expected)

    shape = ValueShape(
        len=len(raw),
        charset=_classify(raw),
        regex_class=_regex_class(raw),
        expected=expected,
    )
    return _enforce_no_echo(shape, raw)


def describe_shape(shape: ValueShape) -> str:
    """Human phrase for what was received. Built only from the shape."""
    if shape.len is None and shape.charset is None:
        return "nothing"
    if shape.charset == "empty" or shape.len == 0:
        return "empty"
    if shape.len is None:
        return f"a {shape.charset} value"
    if shape.charset is None:
        return f"{shape.len} characters"
    return f"{shape.len} characters ({shape.charset})"


def build_message(expected_description: str, shape: ValueShape) -> str:
    """Template a finding message. Part III §5: SHAPE, never the value.

    `expected_description` is authored in the ruleset (`cdl:expected-description`)
    and is rule text, not client data — the same class of content as
    `corpus.rule.assert_text`, which Part I §2.9 explicitly permits storing.
    """
    message = f"Expected {expected_description}; received {describe_shape(shape)}."
    assert_redacted(message, shape)
    return message


def assert_redacted(message: str | None, shape: ValueShape | None) -> None:
    """Runtime backstop. Raises rather than returns — Sev-1, halt the pipeline.

    Mirrors `assertRedacted()` (Part IV §6) on the sidecar side of the boundary,
    so a defect fails `make check` instead of reaching a corpus write.
    """
    probe = (message or "") + (shape.model_dump_json() if shape is not None else "")
    for pattern in RAW_VALUE_PATTERNS:
        if pattern.search(probe):
            raise RedactionInvariantError(
                "REDACTION FAILURE: raw value detected in a finding payload. "
                "redaction.py has a defect. This is a Sev-1 — halt the pipeline. "
                "architecture.md Part I §2.9."
            )

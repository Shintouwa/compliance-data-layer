"""M0 exit criterion 3.

    "redaction.py fuzz test proves no output field ever equals an input value."
    - architecture.md Part II · M0

Deterministic by construction: a fixed seed plus exhaustive coverage of the short
strings where a collision is actually possible. A flaky proof of a redaction
guarantee is not a proof, and a seed that changes per run means the build that
catches the defect is not the build anyone looks at.
"""

from __future__ import annotations

import itertools
import random
import string

import pytest

from validator.redaction import (
    RAW_VALUE_PATTERNS,
    assert_redacted,
    build_message,
    derive_value_shape,
)

SEED = 20260810
ALPHABET = string.ascii_letters + string.digits + " -_.@/+:#'\"\\&%$"

# Inputs chosen because they are the ones that CAN collide with a derived field.
# "alpha" collides with charset; "1" collides with len; the pattern strings
# collide with `expected`.
ADVERSARIAL: list[str] = [
    "",
    "0",
    "1",
    "2",
    "10",
    "numeric",
    "alpha",
    "alnum",
    "mixed",
    "empty",
    "None",
    "null",
    "^[0-9]{15}$",
    "^[A-Z]{3}$",
    "[0-9]{1}",
    "[A-Z]{2}[0-9]{5}",
    r"[\s\S]{18}",
    "100000000000001",
    "AE070331234567890123456",
    "finance@acme-group.example",
    "   ",
    "\t\n",
    "éèê",
    "مرحبا",
    "a" * 512,
]

EXPECTED_PATTERNS: list[str | None] = [
    None,
    "^[0-9]{15}$",
    "^[A-Z]{3}$",
    "alpha",
    "1",
    "",
]


def _corpus() -> list[str]:
    values = list(ADVERSARIAL)

    # Exhaustive over every 1- and 2-character string in the alphabet. This is
    # where len/charset collisions live, and exhaustive beats sampled here.
    values.extend("".join(combo) for combo in itertools.product(ALPHABET, repeat=1))
    values.extend("".join(combo) for combo in itertools.product(ALPHABET, repeat=2))

    rng = random.Random(SEED)
    for _ in range(4000):
        length = rng.randint(1, 40)
        values.append("".join(rng.choice(ALPHABET) for _ in range(length)))
    return values


CORPUS = _corpus()


@pytest.mark.parametrize("expected", EXPECTED_PATTERNS)
def test_no_output_field_ever_equals_the_input(expected: str | None) -> None:
    """The criterion, stated literally and checked literally."""
    offenders: list[tuple[str, str]] = []

    for raw in CORPUS:
        shape = derive_value_shape(raw, expected)
        for name, value in shape.model_dump().items():
            if value is not None and str(value) == raw:
                offenders.append((name, raw))

    assert not offenders, (
        f"redaction echoed the input in {len(offenders)} case(s); "
        f"first: field={offenders[0][0]!r}"
    )


def test_regex_class_never_carries_a_character_from_the_value() -> None:
    """Stronger than non-equality: no content character survives at all.

    Only the characters that make up class notation itself are permitted.
    """
    structural = set("[]{}^\\-0123456789AZazsS")
    for raw in CORPUS:
        shape = derive_value_shape(raw)
        if shape.regex_class is None:
            continue
        for char in raw:
            if char not in structural:
                assert char not in shape.regex_class, (
                    f"character from the value survived into regex_class "
                    f"(len={len(raw)}, charset={shape.charset})"
                )


def test_no_derived_message_ever_trips_the_raw_value_patterns() -> None:
    """Part IV §6 patterns, applied to every message the fuzz corpus produces."""
    for raw in CORPUS:
        shape = derive_value_shape(raw, "^[0-9]{15}$")
        message = build_message("a 15-digit identifier", shape)
        for pattern in RAW_VALUE_PATTERNS:
            assert not pattern.search(message), "message matched a raw-value pattern"
        assert_redacted(message, shape)


def test_shape_is_stable_for_identical_inputs() -> None:
    """Same input, same shape - the corpus asserts on these, so they must not drift."""
    for raw in CORPUS[:500]:
        assert derive_value_shape(raw, "^x$") == derive_value_shape(raw, "^x$")


def test_fuzz_corpus_is_large_enough_to_mean_something() -> None:
    assert len(CORPUS) > 5000

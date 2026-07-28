"""Unit tests for the redaction boundary. architecture.md Part I §2.9."""

from __future__ import annotations

import pytest

from validator.errors import RedactionInvariantError
from validator.redaction import (
    assert_redacted,
    build_message,
    derive_value_shape,
    describe_shape,
)


def test_absent_is_distinct_from_empty() -> None:
    """"Element not there" and "element there but blank" are different defects.

    They have different remediations - one is a mapping gap, the other is a
    master-data gap - so the shape must tell them apart.
    """
    absent = derive_value_shape(None, "^[0-9]{15}$")
    empty = derive_value_shape("", "^[0-9]{15}$")

    assert absent.len is None
    assert absent.charset is None
    assert empty.len == 0
    assert empty.charset == "empty"


@pytest.mark.parametrize(
    ("raw", "charset"),
    [
        ("123456789012345", "numeric"),
        ("ABCDEF", "alpha"),
        ("abc123", "alnum"),
        ("AE-123", "mixed"),
        ("has space", "mixed"),
        ("", "empty"),
    ],
)
def test_charset_classification(raw: str, charset: str) -> None:
    assert derive_value_shape(raw).charset == charset


@pytest.mark.parametrize(
    ("raw", "expected_class"),
    [
        ("AE12345", "[A-Z]{2}[0-9]{5}"),
        ("abc", "[a-z]{3}"),
        ("100000000000001", "[0-9]{15}"),
        ("a-b", "[a-z]{1}[^A-Za-z0-9]{1}[a-z]{1}"),
    ],
)
def test_regex_class_carries_structure_not_content(raw: str, expected_class: str) -> None:
    assert derive_value_shape(raw).regex_class == expected_class


def test_regex_class_never_emits_punctuation_from_the_value() -> None:
    """Punctuation from the value collapses to a generic class.

    Checked against characters that cannot appear in class notation itself.
    '-' is deliberately excluded from this list: it is structural inside
    "[a-z]", so its presence proves nothing either way. The exhaustive
    per-character version of this property lives in test_redaction_fuzz.py.
    """
    shape = derive_value_shape("finance@acme_group.example+tag")
    assert shape.regex_class is not None
    for char in "@._+":
        assert char not in shape.regex_class
    # The punctuation runs are still counted, just not transcribed.
    assert "[^A-Za-z0-9]{1}" in shape.regex_class


def test_long_values_collapse_rather_than_transcribe() -> None:
    """Past a dozen class runs a signature stops being a shape."""
    shape = derive_value_shape("a1b2c3d4e5f6g7h8i9")
    assert shape.regex_class == r"[\s\S]{18}"


def test_message_references_the_shape_never_the_value() -> None:
    shape = derive_value_shape("", "^[0-9]{15}$")
    message = build_message("a buyer Tax Registration Number of 15 digits (BT-48)", shape)
    assert message == (
        "Expected a buyer Tax Registration Number of 15 digits (BT-48); received empty."
    )


def test_message_for_a_real_trn_does_not_leak_it() -> None:
    """The whole point: a 15-digit TRN goes in, no 15-digit run comes out."""
    raw = "100000000000009"
    shape = derive_value_shape(raw, "^[0-9]{15}$")
    message = build_message("a 15-digit TRN", shape)

    assert raw not in message
    assert raw not in shape.model_dump_json()
    assert_redacted(message, shape)  # must not raise


def test_describe_shape_covers_every_branch() -> None:
    assert describe_shape(derive_value_shape(None)) == "nothing"
    assert describe_shape(derive_value_shape("")) == "empty"
    assert describe_shape(derive_value_shape("abc")) == "3 characters (alpha)"


@pytest.mark.parametrize(
    "leaked",
    [
        "TRN is 100000000000001",
        "IBAN AE070331234567890123456",
        "contact finance@acme.example",
    ],
)
def test_assert_redacted_is_the_backstop(leaked: str) -> None:
    """Part IV §6. If this ever fires in production: halt, do not weaken."""
    with pytest.raises(RedactionInvariantError):
        assert_redacted(leaked, None)


def test_assert_redacted_passes_clean_messages() -> None:
    assert_redacted("Expected 15 digits; received 12 characters (numeric).", None)

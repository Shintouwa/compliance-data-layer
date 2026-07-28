"""CII D16B parser — STUB ONLY.

architecture.md Part II · M0:

    CII D16B parser | parsers/cii.py | **Stub only.** The learning curriculum
    explicitly says skip CII in M0. Raise `NotImplementedError`.

Raising is the specified behaviour and it is also the safe one. The tempting
alternative — return an empty business-term dict and let the ruleset run — makes
every CII invoice validate clean, which reports a document as conformant that
was never examined. Part I §1.1: prefer a loud failure to a silent success.

CII lands with Factur-X at M4 (Week 37), not before.
"""

from __future__ import annotations

from typing import NoReturn

__all__ = ["parse"]


def parse(document: bytes) -> NoReturn:
    """Not implemented in M0. See module docstring."""
    del document  # never read; named for signature parity with ubl.parse
    raise NotImplementedError(
        "CII D16B is not implemented in M0. architecture.md Part II · M0 makes "
        "this a deliberate stub; CII arrives with Factur-X at M4 (Week 37). "
        "Returning an empty parse here would report every CII document as "
        "conformant without examining it."
    )

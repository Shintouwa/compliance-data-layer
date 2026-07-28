"""Syntax parsers. lxml -> EN 16931 business-term dictionaries.

Parsers are PURELY STRUCTURAL. They read what the document says; they do not
decide what it means. Nothing here infers a scenario, a tax treatment or a
compliance outcome — that is Schematron's job (CLAUDE.md §4.4) and the reason
the finding a client sees is always a rule ID and an XPath.
"""

from __future__ import annotations

__all__ = ["cii", "ubl"]

from . import cii, ubl

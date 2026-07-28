"""Code list loading and the completeness rule.

architecture.md Part II · M0 lists ISO 4217, ISO 3166, UNECE Rec 20,
UNTDID 5305 and UNCL 1001.

The completeness rule
---------------------
A code list we hold only PART of can confirm membership but cannot deny it. If a
partial list is allowed to emit `fail`, every perfectly valid code that happens
to be missing from our copy becomes a false rejection — a wrong answer, which
Part I §1.1 ranks above a crash in seriousness.

So each list declares `completeness`, and `assert_may_deny()` refuses to let a
partial list back a fail-severity rule. `engine.py` calls it at ruleset load
time, which means the refusal is a build failure and not a runtime surprise.

Only UNTDID 5305 ships `complete`: EN 16931 restricts it to nine category codes
and that restriction is the whole list. Every other list here is `partial` until
resolved from its primary source, and the rules that use them are written as a
structural check at fail severity plus a membership check at warning severity.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Final, Literal

from pydantic import BaseModel, ConfigDict

from ..errors import CodelistIntegrityError

__all__ = ["CodeList", "Completeness", "codelist_source_bytes", "load_codelist"]

Completeness = Literal["complete", "partial"]

_DIR: Final = Path(__file__).parent


class CodeList(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    list_id: str
    name: str
    version: str
    source: str
    completeness: Completeness
    notes: str
    codes: tuple[str, ...]

    @property
    def is_complete(self) -> bool:
        return self.completeness == "complete"

    def contains(self, code: str) -> bool:
        return code in set(self.codes)

    def assert_may_deny(self, rule_id: str) -> None:
        """Refuse to let a partial list produce a failure."""
        if not self.is_complete:
            raise CodelistIntegrityError(
                f"Rule {rule_id!r} asks code list {self.list_id!r} to produce a "
                f"fail-severity finding, but that list is marked "
                f"completeness={self.completeness!r}. A partial list can confirm "
                f"membership, never deny it — denying would reject valid codes "
                f"that are merely absent from our copy. Either resolve the list "
                f"from its primary source and mark it complete, or write the "
                f"rule at warning severity."
            )

    def xpath_sequence(self) -> str:
        """Render as an XPath sequence literal for inlining into a compiled test.

        Inlined rather than bound as a parameter: SaxonC clears external
        variables between evaluations, and a rule that silently loses its
        code list would stop firing without any error at all.
        """
        for code in self.codes:
            if "'" in code or "\\" in code:
                raise CodelistIntegrityError(
                    f"Code list {self.list_id!r} contains a code that cannot be "
                    f"safely inlined into an XPath literal."
                )
        return "(" + ",".join(f"'{code}'" for code in self.codes) + ")"


@lru_cache(maxsize=None)
def load_codelist(list_id: str) -> CodeList:
    path = _DIR / f"{list_id.lower()}.json"
    if not path.is_file():
        raise CodelistIntegrityError(
            f"Code list {list_id!r} not found at {path}. A ruleset referenced a "
            f"list that is not installed; refusing to validate rather than skip "
            f"the rule."
        )
    return CodeList.model_validate(json.loads(path.read_text(encoding="utf-8")))


def codelist_source_bytes(list_id: str) -> bytes:
    """Raw file bytes, for inclusion in the ruleset hash.

    Code lists are inlined into compiled rules, so changing one changes
    validation results. It must therefore change `ruleset_hash`, or a result
    stops being reproducible from the hash alone.
    """
    return (_DIR / f"{list_id.lower()}.json").read_bytes()

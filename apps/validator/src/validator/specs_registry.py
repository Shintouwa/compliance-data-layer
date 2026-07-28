"""Spec registry — profile metadata and compiled-ruleset caching.

Registry entry shape is architecture.md Part II · M4, verbatim.

The RESOLVE_IN_WEEK_1 sentinel
------------------------------
architecture.md, "How an agent must use this file" (2):

    ⚠️ RESOLVE FROM PRIMARY SOURCE IN WEEK 1 marks an external version
    identifier. Do not invent these. A confident wrong version number produces
    a validator that is wrong in a way nobody notices for months.

So `version` carries the literal sentinel until a human resolves it, and the
sentinel is load-bearing rather than decorative: `is_resolved` is False while it
is present, and `/validate` refuses an unresolved spec unless
CDL_ALLOW_PROVISIONAL_RULESET=1 is set.

The corpus runner sets that flag — exercising the machinery is its whole job.
No client-facing path sets it. The day someone writes a real version string into
the registry, provisional mode switches off by itself, and the published
Schematron had better be sitting next to it.
"""

from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path
from typing import Final

from pydantic import BaseModel, ConfigDict, Field

from .engine import CompiledRuleset, compile_ruleset
from .errors import ProvisionalRulesetRefused, UnknownSpecError
from .models import ProfileId, Syntax

__all__ = [
    "PROVISIONAL_ENV_FLAG",
    "RESOLVE_SENTINEL",
    "SpecEntry",
    "assert_usable",
    "available_spec_ids",
    "get_ruleset",
    "load_spec",
    "provisional_allowed",
]

RESOLVE_SENTINEL: Final = "RESOLVE_IN_WEEK_1"
PROVISIONAL_ENV_FLAG: Final = "CDL_ALLOW_PROVISIONAL_RULESET"

_SPECS_DIR: Final = Path(__file__).parent / "specs"
_REGISTRY_DIR: Final = _SPECS_DIR / "registry"


class IdentifierRule(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    pattern: str
    checksum: str


class ScenarioRequirement(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    required_terms: tuple[str, ...]


class SpecEntry(BaseModel):
    """architecture.md Part II · M4 registry shape."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    # Typed as the wire unions, not as str: a registry file naming a profile or
    # syntax the contract does not know now fails at load with a validation
    # error, instead of producing a response the TypeScript client cannot type.
    spec_id: ProfileId
    jurisdiction: str
    version: str
    syntaxes: tuple[Syntax, ...]
    schematron: tuple[str, ...]
    codelists: tuple[str, ...]
    scenario_map: dict[str, ScenarioRequirement] = Field(default_factory=dict)
    identifier_rules: dict[str, IdentifierRule] = Field(default_factory=dict)
    archival_years: int | None = None
    issuance_window_days: int | None = None
    ruleset_hash: str = "COMPUTED_AT_BUILD"

    @property
    def is_resolved(self) -> bool:
        """False while `version` is the unresolved-spec sentinel."""
        return self.version != RESOLVE_SENTINEL

    @property
    def schematron_paths(self) -> list[Path]:
        return [_SPECS_DIR / relative for relative in self.schematron]


def provisional_allowed() -> bool:
    return os.environ.get(PROVISIONAL_ENV_FLAG) == "1"


@lru_cache(maxsize=None)
def available_spec_ids() -> tuple[str, ...]:
    return tuple(sorted(path.stem for path in _REGISTRY_DIR.glob("*.json")))


@lru_cache(maxsize=None)
def load_spec(spec_id: str) -> SpecEntry:
    path = _REGISTRY_DIR / f"{spec_id}.json"
    if not path.is_file():
        raise UnknownSpecError(spec_id, list(available_spec_ids()))
    return SpecEntry.model_validate(json.loads(path.read_text(encoding="utf-8")))


@lru_cache(maxsize=None)
def get_ruleset(spec_id: str) -> CompiledRuleset:
    """Compile (once) and return the ruleset for `spec_id`.

    Cached because compiling re-reads and re-hashes every Schematron and code
    list file. The cache is keyed on spec_id alone, which is correct for a
    stateless sidecar: the files cannot change under a running process.
    """
    entry = load_spec(spec_id)
    return compile_ruleset(
        spec_id=entry.spec_id,
        schematron_paths=entry.schematron_paths,
        codelist_ids=list(entry.codelists),
    )


def assert_usable(entry: SpecEntry, requested_version: str | None = None) -> None:
    """Refuse to validate against an unresolved or mismatched spec version."""
    if not entry.is_resolved and not provisional_allowed():
        raise ProvisionalRulesetRefused(
            f"Spec {entry.spec_id!r} has version={RESOLVE_SENTINEL!r}: its "
            f"version and ruleset have not been resolved from the primary "
            f"source, and the Schematron shipped for it is an agent-authored "
            f"provisional interpretation. Refusing to report a conformance "
            f"outcome against it.\n"
            f"  To exercise the machinery (corpus, tests): set "
            f"{PROVISIONAL_ENV_FLAG}=1.\n"
            f"  To use it for real: resolve the version and the published "
            f"Schematron, then replace both. "
            f"architecture.md 'How an agent must use this file' (2); "
            f"CLAUDE.md §4.7(1)."
        )

    if (
        requested_version is not None
        and entry.is_resolved
        and requested_version != entry.version
    ):
        raise UnknownSpecError(
            f"{entry.spec_id}@{requested_version}",
            [f"{entry.spec_id}@{entry.version}"],
        )

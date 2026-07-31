"""Inert-artefact guard for the vendored spec directories.

The invisible condition this exists to make loud
------------------------------------------------
A `.gc` code list sitting in `specs/<profile>/` looks authoritative. It has a
title, a version, and an enumeration of codes. A human answering "which payment
means codes does the UAE accept?" will open it and read off the answer.

If no Schematron in that profile actually references the file, that answer is
unverified by anything the validator does — and it can be, and in one measured
case IS, narrower than the enumeration the engine actually enforces. The file
then produces a confident wrong answer to a client question while every test in
the repository stays green. architecture.md Part I §1.1: prefer a loud failure
to a silent success in every single case.

So: a `.gc` that is shipped but referenced by no Schematron is INERT, and inert
is a build failure. Wire it or remove it.

What counts as a reference
--------------------------
The exact filename, as a literal substring of the Schematron bytes. Nothing
looser. Matching on the stem instead was tried and is wrong: `UNCL4461` occurs
in the PROSE of `ibr-cl-16`'s assert text ("MUST be coded using UNCL4461 code
list") while the executable enumeration is inlined and admits a different set.
A stem match would have reported that file as wired and hidden the exact defect
this guard is for.

Note the preprocessed distributions inline every code list into the compiled
test as a literal `contains(' a b c ', …)` string, which is why none of the
vendored `.gc` files is referenced. That is upstream's design, not a fault in
the files — but it does mean they enforce nothing here.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Final

from .errors import CodelistIntegrityError

__all__ = [
    "InertCodelist",
    "assert_no_inert_codelists",
    "audit_profile_codelists",
    "audit_all_profiles",
]

_SPECS_DIR: Final = Path(__file__).parent / "specs"


@dataclass(frozen=True, slots=True)
class InertCodelist:
    """A `.gc` shipped under a profile that no Schematron references."""

    spec_id: str
    path: Path
    searched: tuple[Path, ...]

    @property
    def relative(self) -> str:
        return self.path.relative_to(_SPECS_DIR).as_posix()


def _profile_dir(spec_id: str) -> Path:
    return _SPECS_DIR / spec_id


def audit_profile_codelists(spec_id: str) -> list[InertCodelist]:
    """Every `.gc` under `specs/<spec_id>/` that no `.sch` there references.

    Scope is the profile's own directory rather than the registry's `codelists`
    field, deliberately. That field names the curated JSON lists in
    `validator/codelists/`, which the engine really does inline; the vendored
    `.gc` files are declared by nothing at all. Auditing only what is declared
    would pass vacuously over exactly the files at issue — an invisible check on
    an invisible condition.
    """
    profile = _profile_dir(spec_id)
    if not profile.is_dir():
        return []

    schematrons = tuple(sorted(profile.rglob("*.sch")))
    corpus = {path: path.read_bytes() for path in schematrons}

    inert: list[InertCodelist] = []
    for gc_path in sorted(profile.rglob("*.gc")):
        needle = gc_path.name.encode("utf-8")
        if any(needle in blob for blob in corpus.values()):
            continue
        inert.append(InertCodelist(spec_id=spec_id, path=gc_path, searched=schematrons))
    return inert


def audit_all_profiles(spec_ids: list[str]) -> dict[str, list[InertCodelist]]:
    return {spec_id: audit_profile_codelists(spec_id) for spec_id in spec_ids}


def assert_no_inert_codelists(spec_id: str) -> None:
    """Raise naming every inert `.gc` in the profile.

    Names each file individually. A count ("3 inert code lists") is not
    actionable, and the whole point is that someone must look at each file and
    decide whether to wire it or remove it.
    """
    inert = audit_profile_codelists(spec_id)
    if not inert:
        return

    searched = inert[0].searched
    listing = "\n".join(f"    {item.relative}" for item in inert)
    schematrons = "\n".join(
        f"    {path.relative_to(_SPECS_DIR).as_posix()}" for path in searched
    ) or "    (none)"

    raise CodelistIntegrityError(
        f"INERT CODE LIST in profile {spec_id!r}: "
        f"{len(inert)} file(s) are shipped but referenced by no Schematron. "
        f"Wire it or remove it.\n"
        f"  inert:\n{listing}\n"
        f"  searched these Schematrons for the exact filename:\n{schematrons}\n"
        f"  Why this is an error and not a warning: an unreferenced .gc enforces "
        f"nothing, but reads as authoritative to anyone who opens it. It can "
        f"disagree with the enumeration the engine actually applies -- "
        f"pint-ae/published/codelist/UNCL4461.gc lists 9 payment means codes "
        f"while the executable rule ibr-cl-16 admits 91 -- and nothing fails. "
        f"That is a confident wrong answer to a client question. "
        f"architecture.md Part I §1.1; specs/RULES.md."
    )

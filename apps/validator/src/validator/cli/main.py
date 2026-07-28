"""`validate <file> --profile pint-ae --syntax UBL-2.1` -> JSON to stdout.

architecture.md Part II · M0, the CLI row.

Exit codes:
    0  document passed (or passed with warnings only)
    1  document failed validation
    2  the validator could not reach a verdict

2 is deliberately distinct from 1. "This invoice is non-conformant" and "I could
not tell you whether this invoice is conformant" are different answers, and a
caller that conflates them will eventually report the second as the first.
"""

from __future__ import annotations

import argparse
import json
import sys
import uuid
from pathlib import Path
from typing import Final, Sequence

from ..errors import ValidatorError
from ..models import ProfileId, Syntax, ValidateOptions
from ..specs_registry import available_spec_ids

__all__ = ["main"]

_PROFILES: Final[tuple[ProfileId, ...]] = (
    "pint-ae",
    "en16931",
    "peppol-bis-3.0",
    "factur-x",
    "xrechnung",
    "ksef-fa3",
)
_SYNTAXES: Final[tuple[Syntax, ...]] = ("UBL-2.1", "CII-D16B")

EXIT_PASS: Final = 0
EXIT_FAIL: Final = 1
EXIT_NO_VERDICT: Final = 2


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m validator.cli.main",
        description="Validate an e-invoice against a conformance profile.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    validate = sub.add_parser("validate", help="Validate one document.")
    validate.add_argument("file", type=Path)
    validate.add_argument("--profile", required=True, choices=list(_PROFILES))
    validate.add_argument("--syntax", default="UBL-2.1", choices=list(_SYNTAXES))
    validate.add_argument("--spec-version", default=None)
    validate.add_argument(
        "--no-warnings", action="store_true", help="Omit warning-severity findings."
    )
    validate.add_argument(
        "--stop-on-first-error", action="store_true", help="Return after the first error."
    )

    sub.add_parser("specs", help="List installed profiles and their ruleset hashes.")
    return parser


def _narrow_profile(value: str) -> ProfileId:
    for candidate in _PROFILES:
        if candidate == value:
            return candidate
    raise SystemExit(f"unknown profile {value!r}; expected one of {list(_PROFILES)}")


def _narrow_syntax(value: str) -> Syntax:
    for candidate in _SYNTAXES:
        if candidate == value:
            return candidate
    raise SystemExit(f"unknown syntax {value!r}; expected one of {list(_SYNTAXES)}")


def main(argv: Sequence[str] | None = None) -> int:
    # Imported here rather than at module scope: constructing the Saxon
    # processor is expensive, and `--help` should not pay for it.
    from ..main import run_validation, specs as list_specs

    args = _build_parser().parse_args(argv)

    if args.command == "specs":
        print(list_specs().model_dump_json(indent=2))
        return EXIT_PASS

    path: Path = args.file
    if not path.is_file():
        print(f"no such file: {path}", file=sys.stderr)
        return EXIT_NO_VERDICT

    try:
        response = run_validation(
            document=path.read_bytes(),
            profile=_narrow_profile(args.profile),
            spec_version=args.spec_version,
            run_id=uuid.uuid4(),
            syntax=_narrow_syntax(args.syntax),
            options=ValidateOptions(
                include_warnings=not args.no_warnings,
                stop_on_first_error=args.stop_on_first_error,
            ),
        )
    except NotImplementedError as exc:
        print(f"not implemented: {exc}", file=sys.stderr)
        return EXIT_NO_VERDICT
    except ValidatorError as exc:
        print(f"{type(exc).__name__}: {exc}", file=sys.stderr)
        print(f"installed profiles: {list(available_spec_ids())}", file=sys.stderr)
        return EXIT_NO_VERDICT

    print(json.dumps(json.loads(response.model_dump_json()), indent=2, sort_keys=True))
    return EXIT_FAIL if response.outcome == "fail" else EXIT_PASS


if __name__ == "__main__":
    raise SystemExit(main())

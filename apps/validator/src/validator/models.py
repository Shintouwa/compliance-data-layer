"""Pydantic models — the source of the OpenAPI contract.

architecture.md Part I §1.6: `packages/contracts/validator.openapi.json` and
`validator.d.ts` are generated from this module and committed. The web app
imports those types and never hand-writes a validator request or response shape.

Changing anything here without running `make contract-update` is a build break,
which is the point: it converts the one genuine risk of decoupling the sidecar
into a compile error.

Wire shapes are Part III §5, exactly.
"""

from __future__ import annotations

import base64
import binascii
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .redaction import ValueShape

__all__ = [
    "Direction",
    "EngineFailureBody",
    "FailureClass",
    "Finding",
    "HealthResponse",
    "InvalidRequestBody",
    "Outcome",
    "ParseErrorBody",
    "ProfileId",
    "Severity",
    "SpecDescriptor",
    "SpecsResponse",
    "Syntax",
    "UnknownSpecBody",
    "ValidateOptions",
    "ValidateRequest",
    "ValidateResponse",
    "ValidationStage",
]

Syntax = Literal["UBL-2.1", "CII-D16B"]

ProfileId = Literal[
    "pint-ae",
    "en16931",
    "peppol-bis-3.0",
    "factur-x",
    "xrechnung",
    "ksef-fa3",
]

Direction = Literal["ar", "ap"]
Outcome = Literal["pass", "fail", "warn"]
Severity = Literal["fatal", "error", "warning"]

# packages/db/schema/_shared.ts `FailureClass`. The corpus asserts on this, so
# the two unions must stay identical — the contract check is what enforces it.
FailureClass = Literal[
    "missing_mandatory",
    "invalid_code",
    "format_mismatch",
    "arithmetic_mismatch",
    "identifier_invalid",
    "cardinality",
    "cross_field_dependency",
    "encoding",
    "date_logic",
    "rounding",
]

ValidationStage = Literal[
    "pre_map",
    "post_map",
    "pre_submit",
    "asp_response",
    "authority_response",
]


class ValidateOptions(BaseModel):
    model_config = ConfigDict(extra="forbid")

    include_warnings: bool = Field(default=True)
    stop_on_first_error: bool = Field(
        default=False,
        description="Set by the caller on a 504 retry. Part IV §4 job 4.",
    )


class ValidateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_id: UUID
    # repr=False keeps the document out of exception reprs and log lines. The
    # 422 handler in main.py separately strips it from validation error bodies —
    # Pydantic echoes offending input by default, and for this field that would
    # put invoice bytes into an error response. Part III §5.
    document: str = Field(repr=False, description="Base64-encoded source document.")
    syntax: Syntax
    profile: ProfileId
    spec_version: str
    direction: Direction = "ar"
    options: ValidateOptions = Field(default_factory=ValidateOptions)

    @field_validator("document")
    @classmethod
    def _must_be_base64(cls, value: str) -> str:
        try:
            base64.b64decode(value, validate=True)
        except (binascii.Error, ValueError) as exc:
            # No value in the message. The caller knows what it sent.
            raise ValueError("document is not valid base64") from exc
        return value


class Finding(BaseModel):
    """One rule outcome. Part III §5.

    `message` is templated from `value_shape` by redaction.py and never
    interpolates the offending value. `value_shape` is the only representation
    of that value which crosses this boundary.
    """

    model_config = ConfigDict(extra="forbid")

    rule_id: str
    native_rule_code: str | None = None
    severity: Severity
    business_term: str | None = None
    xpath: str | None = None
    failure_class: FailureClass | None = None
    message: str | None = None
    value_shape: ValueShape | None = None


class ValidateResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_id: UUID
    spec_id: ProfileId
    spec_version: str
    ruleset_hash: str = Field(
        description=(
            "sha256 of the compiled ruleset, 'sha256:...'. MUST be persisted on "
            "every finding and validation event — two invocations of the same "
            "rule under different ruleset hashes are different facts."
        )
    )
    outcome: Outcome
    findings: list[Finding]
    timing_ms: int


class SpecDescriptor(BaseModel):
    model_config = ConfigDict(extra="forbid")

    spec_id: ProfileId
    jurisdiction: str
    version: str
    syntaxes: list[Syntax]
    ruleset_hash: str | None = Field(
        description=(
            "null only when `unavailable` is set. A quarantined profile has no "
            "compiled ruleset, so it has no hash — and reporting a plausible "
            "one would let a caller record a finding against a hash that never "
            "produced it."
        )
    )
    resolved: bool = Field(
        description=(
            "False while `version` is the RESOLVE_IN_WEEK_1 sentinel. An "
            "unresolved spec is refused by /validate unless "
            "CDL_ALLOW_PROVISIONAL_RULESET=1. architecture.md 'How an agent "
            "must use this file' (2)."
        )
    )
    unavailable: str | None = Field(
        default=None,
        description=(
            "When non-null, the profile is quarantined and /validate refuses it "
            "unconditionally — the flag does not unlock a quarantine. The string "
            "states who withdrew it and on what evidence. The profile is still "
            "listed rather than hidden: a caller that has been sending this "
            "profile needs to find out why it stopped, not watch it vanish."
        ),
    )


class SpecsResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    specs: list[SpecDescriptor]


class HealthResponse(BaseModel):
    """Part III §5 and Part V §2: /health VALIDATES A GOLDEN INVOICE.

    Not {"ok": true}. If Saxon dies or a spec file goes missing, health goes red.
    """

    model_config = ConfigDict(extra="forbid")

    status: Literal["ok", "degraded"]
    saxon_version: str
    golden_invoice_outcome: Outcome | None
    checked_spec_id: ProfileId
    ruleset_hash: str | None
    detail: str | None = None


class ParseErrorBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    error: Literal["parse_error"] = "parse_error"
    line: int
    column: int


class UnknownSpecBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    error: Literal["unknown_spec"] = "unknown_spec"
    available: list[str]


class EngineFailureBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    error: Literal["engine_failure"] = "engine_failure"
    correlation_id: str


class InvalidRequestBody(BaseModel):
    """Redacted schema-violation body.

    Part III §5 defines four error conditions but not this one, and FastAPI will
    return *something* for a malformed request regardless. Declaring the shape
    here means it is (a) generated into the contract so the web app can type it
    and (b) known not to echo the document — the framework default puts the
    offending input in the body, and here that input is an invoice.
    """

    model_config = ConfigDict(extra="forbid")

    error: Literal["invalid_request"] = "invalid_request"
    fields: list[str]


# Exported for the OpenAPI document so the TS client gets the error shapes too.
ErrorBody = Annotated[
    ParseErrorBody | UnknownSpecBody | EngineFailureBody,
    Field(discriminator="error"),
]

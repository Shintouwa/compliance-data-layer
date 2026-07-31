"""FastAPI app, routes, and the validation orchestration the CLI shares.

API contract: architecture.md Part III §5, exactly.

Stateless. No database. No filesystem writes outside /tmp.

One thing here is easy to get wrong and worth stating: FastAPI's default 422 body
echoes the offending input, and for this service the offending input is an
invoice. `_invalid_request_handler` strips it. Part III §5 requires that a
malformed document response "never echoes document content", and the default
handler would violate that without anybody noticing.
"""

from __future__ import annotations

import base64
import logging
import time
import uuid
from typing import Final
from uuid import UUID

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from . import __version__
from .engine import get_engine
from .errors import (
    CodelistIntegrityError,
    EngineFailureError,
    ParseError,
    ProvisionalRulesetRefused,
    SpecQuarantined,
    RedactionInvariantError,
    SchematronCompileError,
    SchematronUnsupportedError,
    UnknownSpecError,
    UnsupportedSyntaxError,
    ValidatorError,
)
from .models import (
    EngineFailureBody,
    Finding,
    HealthResponse,
    InvalidRequestBody,
    Outcome,
    ParseErrorBody,
    ProfileId,
    SpecDescriptor,
    SpecsResponse,
    Syntax,
    UnknownSpecBody,
    ValidateOptions,
    ValidateRequest,
    ValidateResponse,
)
from .specs_registry import assert_usable, available_spec_ids, get_ruleset, load_spec

__all__ = ["GOLDEN_INVOICE", "app", "run_validation"]

_log: Final = logging.getLogger("validator")

# The golden invoice for GET /health. Part III §5 and Part V §2: health
# VALIDATES this document rather than returning {"ok": true}. If Saxon dies or a
# spec file goes missing, health goes red instead of lying.
#
# Synthetic. Every identifier in it is invented for this purpose.
GOLDEN_INVOICE: Final[bytes] = b"""<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2">
  <cbc:CustomizationID>urn:cdl:golden-invoice:health-check</cbc:CustomizationID>
  <cbc:ProfileID>urn:cdl:billing</cbc:ProfileID>
  <cbc:ID>CDL-HEALTH-0001</cbc:ID>
  <cbc:IssueDate>2026-08-10</cbc:IssueDate>
  <cbc:DueDate>2026-09-09</cbc:DueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>AED</cbc:DocumentCurrencyCode>
  <cbc:BuyerReference>PO-HEALTH-1</cbc:BuyerReference>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PostalAddress><cac:Country><cbc:IdentificationCode>AE</cbc:IdentificationCode></cac:Country></cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>100000000000001</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity><cbc:RegistrationName>Golden Seller FZ-LLC</cbc:RegistrationName></cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PostalAddress><cac:Country><cbc:IdentificationCode>AE</cbc:IdentificationCode></cac:Country></cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>100000000000002</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity><cbc:RegistrationName>Golden Buyer LLC</cbc:RegistrationName></cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="AED">50.00</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="AED">1000.00</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="AED">50.00</cbc:TaxAmount>
      <cac:TaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>5</cbc:Percent></cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="AED">1000.00</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="AED">1000.00</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="AED">1050.00</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="AED">1050.00</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine>
    <cbc:ID>1</cbc:ID>
    <cbc:InvoicedQuantity unitCode="H87">10</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="AED">1000.00</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>Consultancy services</cbc:Name>
      <cac:ClassifiedTaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>5</cbc:Percent></cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="AED">100.00</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>
</Invoice>
"""

_HEALTH_SPEC: Final[ProfileId] = "pint-ae"


def compute_outcome(findings: list[Finding]) -> Outcome:
    """fail if anything fatal/error fired, warn if only warnings, else pass."""
    if any(finding.severity in ("fatal", "error") for finding in findings):
        return "fail"
    if findings:
        return "warn"
    return "pass"


def run_validation(
    *,
    document: bytes,
    profile: ProfileId,
    spec_version: str | None,
    run_id: UUID,
    syntax: Syntax = "UBL-2.1",
    options: ValidateOptions | None = None,
) -> ValidateResponse:
    """Validate one document. Shared by the API, the CLI and the corpus runner."""
    opts = options or ValidateOptions()
    started = time.perf_counter()

    entry = load_spec(profile)

    if syntax not in entry.syntaxes:
        raise UnsupportedSyntaxError(
            f"Profile {profile!r} declares syntaxes {list(entry.syntaxes)}; "
            f"{syntax!r} was requested. M0 implements UBL-2.1 only — "
            f"parsers/cii.py is a deliberate stub."
        )

    assert_usable(entry, spec_version)

    ruleset = get_ruleset(profile)
    findings = get_engine().validate(
        document,
        ruleset,
        include_warnings=opts.include_warnings,
        stop_on_first_error=opts.stop_on_first_error,
    )

    return ValidateResponse(
        run_id=run_id,
        spec_id=entry.spec_id,
        spec_version=entry.version,
        ruleset_hash=ruleset.ruleset_hash,
        outcome=compute_outcome(findings),
        findings=findings,
        timing_ms=int((time.perf_counter() - started) * 1000),
    )


app = FastAPI(
    title="Compliance Data Layer — Validator",
    version=__version__,
    description=(
        "Conformance validation sidecar. Schematron decides; no model is in the "
        "compliance decision path (CLAUDE.md §4.4). A raw commercial value never "
        "crosses this boundary — only `value_shape` (architecture.md Part I §2.9)."
    ),
)


@app.exception_handler(RequestValidationError)
async def _invalid_request_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    del request
    # Field locations only. Pydantic puts the offending input in `input`, and
    # here that input is invoice content.
    fields = [".".join(str(part) for part in err.get("loc", ())) for err in exc.errors()]
    return JSONResponse(
        status_code=422,
        content=InvalidRequestBody(fields=fields).model_dump(),
    )


@app.exception_handler(ValidatorError)
async def _validator_error_handler(request: Request, exc: ValidatorError) -> JSONResponse:
    del request

    if isinstance(exc, ParseError):
        return JSONResponse(
            status_code=422,
            content=ParseErrorBody(line=exc.line, column=exc.column).model_dump(),
        )

    if isinstance(exc, UnknownSpecError):
        return JSONResponse(
            status_code=400,
            content=UnknownSpecBody(available=exc.available).model_dump(),
        )

    if isinstance(exc, SpecQuarantined):
        # 400, not 500: the profile is withdrawn by decision, and the machinery
        # is working exactly as intended. A 500 here would page someone.
        _log.error("spec quarantined: %s", exc)
        return JSONResponse(
            status_code=400,
            content=UnknownSpecBody(
                available=[
                    spec_id
                    for spec_id in available_spec_ids()
                    if not load_spec(spec_id).is_quarantined
                ]
            ).model_dump(),
        )

    if isinstance(exc, ProvisionalRulesetRefused):
        # Semantically "that version is not available for use". The full reason
        # goes to the log, not to an unauthenticated caller.
        _log.error("provisional ruleset refused: %s", exc)
        resolved = [
            spec_id for spec_id in available_spec_ids() if load_spec(spec_id).is_resolved
        ]
        return JSONResponse(
            status_code=400,
            content=UnknownSpecBody(available=resolved).model_dump(),
        )

    if isinstance(exc, UnsupportedSyntaxError):
        return JSONResponse(
            status_code=400,
            content=UnknownSpecBody(available=list(available_spec_ids())).model_dump(),
        )

    correlation_id = str(uuid.uuid4())

    if isinstance(exc, RedactionInvariantError):
        # Part V §3: page, halt the pipeline. Do not weaken the assertion.
        _log.critical(
            "SEV-1 REDACTION FAILURE [%s]: %s — halt the pipeline, fix redaction.py",
            correlation_id,
            exc,
        )
    elif isinstance(
        exc,
        (
            EngineFailureError,
            SchematronCompileError,
            SchematronUnsupportedError,
            CodelistIntegrityError,
        ),
    ):
        _log.error("engine failure [%s]: %s", correlation_id, exc)
    else:
        _log.error("validator error [%s]: %s", correlation_id, exc)

    return JSONResponse(
        status_code=500,
        content=EngineFailureBody(correlation_id=correlation_id).model_dump(),
    )


@app.post(
    "/validate",
    response_model=ValidateResponse,
    # Declared so the error shapes reach the OpenAPI document and the generated
    # TypeScript client. Part III §5 treats them as part of the contract; an
    # undeclared error shape is one the web app ends up hand-writing.
    responses={
        400: {"model": UnknownSpecBody, "description": "Unknown or unusable profile."},
        422: {
            "model": ParseErrorBody | InvalidRequestBody,
            "description": "Malformed document, or a request that failed schema validation. Never echoes document content.",
        },
        500: {"model": EngineFailureBody, "description": "Saxon or ruleset failure."},
    },
)
def validate(request: ValidateRequest) -> ValidateResponse:
    return run_validation(
        document=base64.b64decode(request.document, validate=True),
        profile=request.profile,
        spec_version=request.spec_version,
        run_id=request.run_id,
        syntax=request.syntax,
        options=request.options,
    )


@app.get("/specs", response_model=SpecsResponse)
def specs() -> SpecsResponse:
    descriptors: list[SpecDescriptor] = []
    for spec_id in available_spec_ids():
        entry = load_spec(spec_id)
        # A quarantined profile is listed, with its reason and no hash. Dropping
        # it from the response would leave a caller that has been sending this
        # profile to infer the cause from a 400, and there is nothing in a 400
        # to infer it from.
        descriptors.append(
            SpecDescriptor(
                spec_id=entry.spec_id,
                jurisdiction=entry.jurisdiction,
                version=entry.version,
                syntaxes=list(entry.syntaxes),
                ruleset_hash=(
                    None if entry.is_quarantined else get_ruleset(spec_id).ruleset_hash
                ),
                resolved=entry.is_resolved,
                unavailable=entry.unavailable,
            )
        )
    return SpecsResponse(specs=descriptors)


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    """Validate the golden invoice. Not {"ok": true}."""
    engine = get_engine()
    try:
        ruleset = get_ruleset(_HEALTH_SPEC)
        # Deliberately bypasses assert_usable: this is a self-test of the
        # machinery, not a conformance verdict on a client document.
        findings = engine.validate(GOLDEN_INVOICE, ruleset)
        outcome = compute_outcome(findings)
    except ValidatorError as exc:
        _log.error("health check failed: %s", exc)
        return HealthResponse(
            status="degraded",
            saxon_version=engine.saxon_version,
            golden_invoice_outcome=None,
            checked_spec_id=_HEALTH_SPEC,
            ruleset_hash=None,
            detail=type(exc).__name__,
        )

    if outcome != "pass":
        fired = ", ".join(finding.rule_id for finding in findings)
        _log.error("health check: golden invoice no longer passes (%s)", fired)
        return HealthResponse(
            status="degraded",
            saxon_version=engine.saxon_version,
            golden_invoice_outcome=outcome,
            checked_spec_id=_HEALTH_SPEC,
            ruleset_hash=ruleset.ruleset_hash,
            detail=f"golden invoice fired: {fired}",
        )

    return HealthResponse(
        status="ok",
        saxon_version=engine.saxon_version,
        golden_invoice_outcome=outcome,
        checked_spec_id=_HEALTH_SPEC,
        ruleset_hash=ruleset.ruleset_hash,
        detail=None,
    )

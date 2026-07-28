"""API contract tests. architecture.md Part III §5.

The tests that matter most here are the negative ones: that an error response
never carries document content, and that an unresolved ruleset is refused rather
than quietly used.
"""

from __future__ import annotations

import base64
import uuid
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from validator.main import GOLDEN_INVOICE, app
from validator.specs_registry import PROVISIONAL_ENV_FLAG

SECRET = "ACME-CONFIDENTIAL-INVOICE-BODY"


@pytest.fixture
def client() -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def provisional(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(PROVISIONAL_ENV_FLAG, "1")


def payload(document: bytes, **over: object) -> dict[str, object]:
    return {
        "run_id": str(uuid.uuid4()),
        "document": base64.b64encode(document).decode(),
        "syntax": "UBL-2.1",
        "profile": "pint-ae",
        "spec_version": "RESOLVE_IN_WEEK_1",
        "direction": "ar",
        **over,
    }


def test_validate_returns_the_part_iii_5_shape(
    client: TestClient, provisional: None
) -> None:
    response = client.post("/validate", json=payload(GOLDEN_INVOICE))
    assert response.status_code == 200
    body = response.json()
    assert body["outcome"] == "pass"
    assert body["spec_id"] == "pint-ae"
    assert body["ruleset_hash"].startswith("sha256:")
    assert body["findings"] == []
    assert isinstance(body["timing_ms"], int)


def test_findings_carry_a_value_shape_and_a_templated_message(
    client: TestClient, provisional: None
) -> None:
    broken = GOLDEN_INVOICE.replace(
        b"<cbc:CompanyID>100000000000002</cbc:CompanyID>",
        b"<cbc:CompanyID></cbc:CompanyID>",
    )
    response = client.post("/validate", json=payload(broken))
    assert response.status_code == 200
    body = response.json()
    assert body["outcome"] == "fail"

    finding = next(f for f in body["findings"] if f["rule_id"] == "CDL-PROV-041")
    assert finding["business_term"] == "BT-48"
    assert finding["failure_class"] == "missing_mandatory"
    assert finding["value_shape"] == {
        "len": 0,
        "charset": "empty",
        "regex_class": None,
        "expected": "^[0-9]{15}$",
    }
    assert "received empty" in finding["message"]


def test_no_raw_value_reaches_the_response(client: TestClient, provisional: None) -> None:
    """The Rule-1 guarantee, checked against the wire body itself."""
    trn = "100000000000777"
    broken = GOLDEN_INVOICE.replace(
        b"<cbc:CompanyID>100000000000002</cbc:CompanyID>",
        f"<cbc:CompanyID>{trn}X</cbc:CompanyID>".encode(),
    )
    response = client.post("/validate", json=payload(broken))
    assert response.status_code == 200
    assert trn not in response.text


def test_malformed_xml_returns_422_without_echoing_the_document(
    client: TestClient, provisional: None
) -> None:
    response = client.post("/validate", json=payload(f"<Invoice>{SECRET}<oops>".encode()))
    assert response.status_code == 422
    assert response.json()["error"] == "parse_error"
    assert SECRET not in response.text


def test_schema_violations_do_not_echo_the_document(client: TestClient) -> None:
    """FastAPI's default 422 body includes the offending input. Ours must not."""
    body = payload(GOLDEN_INVOICE)
    body["document"] = f"!!!not base64!!!{SECRET}"
    response = client.post("/validate", json=body)
    assert response.status_code == 422
    assert SECRET not in response.text
    assert response.json()["error"] == "invalid_request"


def test_unknown_profile_returns_400_with_the_available_list(client: TestClient) -> None:
    response = client.post("/validate", json=payload(GOLDEN_INVOICE, profile="ksef-fa3"))
    assert response.status_code == 400
    assert response.json()["error"] == "unknown_spec"


def test_an_unresolved_ruleset_is_refused_without_the_flag(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """CLAUDE.md §4.7(1). No client-facing path validates against a provisional
    interpretation of a tax specification."""
    monkeypatch.delenv(PROVISIONAL_ENV_FLAG, raising=False)
    response = client.post("/validate", json=payload(GOLDEN_INVOICE))
    assert response.status_code == 400
    assert response.json()["error"] == "unknown_spec"
    # No spec is resolved yet, so nothing is offered as an alternative.
    assert response.json()["available"] == []


def test_health_validates_the_golden_invoice(client: TestClient) -> None:
    """Part III §5 and Part V §2: not {"ok": true}."""
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["golden_invoice_outcome"] == "pass"
    assert body["saxon_version"].startswith("SaxonC")
    assert body["ruleset_hash"].startswith("sha256:")


def test_specs_reports_every_profile_as_unresolved(client: TestClient) -> None:
    response = client.get("/specs")
    assert response.status_code == 200
    specs = response.json()["specs"]
    assert {s["spec_id"] for s in specs} == {"en16931", "peppol-bis-3.0", "pint-ae"}
    assert all(s["resolved"] is False for s in specs)
    assert all(s["version"] == "RESOLVE_IN_WEEK_1" for s in specs)


def test_cii_syntax_is_refused_for_a_ubl_only_profile(
    client: TestClient, provisional: None
) -> None:
    response = client.post("/validate", json=payload(GOLDEN_INVOICE, syntax="CII-D16B"))
    assert response.status_code == 400


def test_stop_on_first_error_truncates(client: TestClient, provisional: None) -> None:
    """Part IV §4 job 4: the caller retries once with this after a 504."""
    broken = GOLDEN_INVOICE.replace(b"AED", b"aed").replace(
        b"<cbc:CompanyID>100000000000002</cbc:CompanyID>",
        b"<cbc:CompanyID></cbc:CompanyID>",
    )
    full = client.post("/validate", json=payload(broken)).json()
    truncated = client.post(
        "/validate",
        json=payload(broken, options={"include_warnings": True, "stop_on_first_error": True}),
    ).json()
    assert len(full["findings"]) > 1
    assert len(truncated["findings"]) == 1

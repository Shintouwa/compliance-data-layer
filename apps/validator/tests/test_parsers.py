"""Parser tests: structural extraction, hardening, and the deliberate CII stub."""

from __future__ import annotations

import pytest

from validator.errors import ParseError
from validator.main import GOLDEN_INVOICE
from validator.parsers import cii, ubl

CREDIT_NOTE = b"""<?xml version="1.0" encoding="UTF-8"?>
<CreditNote xmlns="urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2"
            xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
            xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2">
  <cbc:ID>CN-1</cbc:ID>
  <cbc:IssueDate>2026-08-11</cbc:IssueDate>
  <cbc:CreditNoteTypeCode>381</cbc:CreditNoteTypeCode>
  <cbc:DocumentCurrencyCode>AED</cbc:DocumentCurrencyCode>
  <cac:BillingReference><cac:InvoiceDocumentReference>
    <cbc:ID>INV-1</cbc:ID></cac:InvoiceDocumentReference></cac:BillingReference>
  <cac:CreditNoteLine>
    <cbc:ID>1</cbc:ID>
    <cbc:CreditedQuantity unitCode="KGM">2</cbc:CreditedQuantity>
    <cbc:LineExtensionAmount currencyID="AED">10.00</cbc:LineExtensionAmount>
    <cac:Item><cbc:Name>Returned goods</cbc:Name>
      <cac:ClassifiedTaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>5</cbc:Percent>
      </cac:ClassifiedTaxCategory></cac:Item>
  </cac:CreditNoteLine>
</CreditNote>
"""


def test_parses_an_invoice_into_business_terms() -> None:
    parsed = ubl.parse(GOLDEN_INVOICE)
    assert parsed.root_local_name == "Invoice"
    assert parsed.terms["BT-1"] == "CDL-HEALTH-0001"
    assert parsed.terms["BT-2"] == "2026-08-10"
    assert parsed.terms["BT-3"] == "380"
    assert parsed.terms["BT-5"] == "AED"
    assert parsed.terms["BT-27"] == "Golden Seller FZ-LLC"
    assert parsed.terms["BT-44"] == "Golden Buyer LLC"
    assert parsed.terms["BT-115"] == "1050.00"
    assert parsed.line_count == 1


def test_parses_line_and_tax_detail() -> None:
    parsed = ubl.parse(GOLDEN_INVOICE)
    line = parsed.lines[0]
    assert line.unit_code == "H87"
    assert line.quantity == "10"
    assert line.terms["BT-131"] == "1000.00"
    assert line.terms["BT-151"] == "S"
    assert line.terms["BT-153"] == "Consultancy services"

    subtotal = parsed.tax_subtotals[0]
    assert subtotal.category_code == "S"
    assert subtotal.taxable_amount == "1000.00"


def test_parses_a_credit_note_with_its_own_element_names() -> None:
    parsed = ubl.parse(CREDIT_NOTE)
    assert parsed.root_local_name == "CreditNote"
    assert parsed.document_type_code == "381"
    assert parsed.terms["BT-25"] == "INV-1"
    assert parsed.lines[0].unit_code == "KGM"


def test_distinguishes_absent_from_empty() -> None:
    """None means the element is not there; "" means it is there and blank."""
    parsed = ubl.parse(GOLDEN_INVOICE.replace(b"<cbc:DueDate>2026-09-09</cbc:DueDate>", b""))
    assert parsed.terms["BT-9"] is None

    parsed_blank = ubl.parse(
        GOLDEN_INVOICE.replace(b"<cbc:DueDate>2026-09-09</cbc:DueDate>", b"<cbc:DueDate/>")
    )
    assert parsed_blank.terms["BT-9"] == ""


def test_malformed_xml_raises_parse_error() -> None:
    with pytest.raises(ParseError):
        ubl.parse(b"<Invoice><unclosed>")


def test_an_unrecognised_root_is_refused() -> None:
    """Well-formed but not an invoice. Must not parse as an empty valid one."""
    with pytest.raises(ParseError):
        ubl.parse(b'<?xml version="1.0"?><PurchaseOrder><a/></PurchaseOrder>')


def test_external_entities_are_not_resolved() -> None:
    """An invoice is attacker-controlled input arriving over HTTP.

    XXE is how an XML validator becomes a file-read primitive.
    """
    hostile = (
        b'<?xml version="1.0"?>\n'
        b'<!DOCTYPE Invoice [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>\n'
        b'<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"'
        b' xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">'
        b"<cbc:ID>&xxe;</cbc:ID></Invoice>"
    )
    try:
        parsed = ubl.parse(hostile)
    except ParseError:
        return  # refusing outright is also an acceptable outcome
    assert "root:" not in (parsed.terms["BT-1"] or "")


def test_billion_laughs_does_not_expand() -> None:
    hostile = (
        b'<?xml version="1.0"?>\n'
        b"<!DOCTYPE lolz [\n"
        b'  <!ENTITY lol "lol">\n'
        b'  <!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">\n'
        b'  <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">\n'
        b"]>\n"
        b'<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"'
        b' xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">'
        b"<cbc:ID>&lol3;</cbc:ID></Invoice>"
    )
    try:
        parsed = ubl.parse(hostile)
    except ParseError:
        return
    assert len(parsed.terms["BT-1"] or "") < 100


def test_cii_is_a_deliberate_stub_that_raises() -> None:
    """architecture.md Part II · M0: "Stub only. Raise NotImplementedError."

    Returning an empty parse would report every CII document as conformant
    without ever examining it.
    """
    with pytest.raises(NotImplementedError, match="CII D16B"):
        cii.parse(b"<anything/>")

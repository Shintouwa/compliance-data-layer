"""UBL 2.1 -> EN 16931 business-term dictionary.

architecture.md Part II · M0. Structural extraction only: this module reports
what the document contains, never what it means.

Consumers: the CLI (`validate --syntax UBL-2.1`) and, from M1,
`modules/ingestion` normalisation. The Schematron engine does NOT use this
module — it evaluates XPath against the document directly, so a parser bug can
never change a conformance outcome.
"""

from __future__ import annotations

from typing import Final

from lxml import etree
from pydantic import BaseModel, ConfigDict

from ..errors import ParseError

__all__ = [
    "HEADER_TERMS",
    "LINE_TERMS",
    "NS",
    "ParsedDocument",
    "ParsedLine",
    "ParsedTaxSubtotal",
    "parse",
]

NS: Final[dict[str, str]] = {
    "inv": "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
    "cn": "urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2",
    "cbc": "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
    "cac": "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
}

_SUPPLIER: Final = "cac:AccountingSupplierParty/cac:Party"
_CUSTOMER: Final = "cac:AccountingCustomerParty/cac:Party"
_TOTALS: Final = "cac:LegalMonetaryTotal"

# EN 16931 semantic model. Key = business term, value = path relative to the
# document element. Both Invoice and CreditNote roots share these paths except
# where noted in `_root_specific_terms`.
HEADER_TERMS: Final[dict[str, str]] = {
    "BT-1": "cbc:ID",
    "BT-2": "cbc:IssueDate",
    "BT-5": "cbc:DocumentCurrencyCode",
    "BT-6": "cbc:TaxCurrencyCode",
    "BT-9": "cbc:DueDate",
    "BT-10": "cbc:BuyerReference",
    "BT-13": "cac:OrderReference/cbc:ID",
    "BT-22": "cbc:Note",
    "BT-25": "cac:BillingReference/cac:InvoiceDocumentReference/cbc:ID",
    "BT-26": "cac:BillingReference/cac:InvoiceDocumentReference/cbc:IssueDate",
    "BT-27": f"{_SUPPLIER}/cac:PartyLegalEntity/cbc:RegistrationName",
    "BT-31": f"{_SUPPLIER}/cac:PartyTaxScheme/cbc:CompanyID",
    "BT-40": f"{_SUPPLIER}/cac:PostalAddress/cac:Country/cbc:IdentificationCode",
    "BT-44": f"{_CUSTOMER}/cac:PartyLegalEntity/cbc:RegistrationName",
    "BT-48": f"{_CUSTOMER}/cac:PartyTaxScheme/cbc:CompanyID",
    "BT-55": f"{_CUSTOMER}/cac:PostalAddress/cac:Country/cbc:IdentificationCode",
    "BT-106": f"{_TOTALS}/cbc:LineExtensionAmount",
    "BT-107": f"{_TOTALS}/cbc:AllowanceTotalAmount",
    "BT-108": f"{_TOTALS}/cbc:ChargeTotalAmount",
    "BT-109": f"{_TOTALS}/cbc:TaxExclusiveAmount",
    "BT-110": "cac:TaxTotal/cbc:TaxAmount",
    "BT-112": f"{_TOTALS}/cbc:TaxInclusiveAmount",
    "BT-113": f"{_TOTALS}/cbc:PrepaidAmount",
    "BT-115": f"{_TOTALS}/cbc:PayableAmount",
}

LINE_TERMS: Final[dict[str, str]] = {
    "BT-126": "cbc:ID",
    "BT-131": "cbc:LineExtensionAmount",
    "BT-146": "cac:Price/cbc:PriceAmount",
    "BT-151": "cac:Item/cac:ClassifiedTaxCategory/cbc:ID",
    "BT-152": "cac:Item/cac:ClassifiedTaxCategory/cbc:Percent",
    "BT-153": "cac:Item/cbc:Name",
}


class ParsedLine(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    line_number: int
    terms: dict[str, str | None]
    # BT-129 / BT-130 carry the quantity and its unit code attribute; the
    # element name differs between Invoice and CreditNote.
    quantity: str | None
    unit_code: str | None


class ParsedTaxSubtotal(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    taxable_amount: str | None  # BT-116
    tax_amount: str | None  # BT-117
    category_code: str | None  # BT-118
    percent: str | None  # BT-119


class ParsedDocument(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    root_local_name: str
    customization_id: str | None
    profile_id: str | None
    document_type_code: str | None  # BT-3
    terms: dict[str, str | None]
    lines: tuple[ParsedLine, ...]
    tax_subtotals: tuple[ParsedTaxSubtotal, ...]

    @property
    def line_count(self) -> int:
        return len(self.lines)


def _parser() -> etree.XMLParser:
    """Hardened parser for untrusted input.

    Entity resolution, DTD loading and network access are all off. An invoice is
    attacker-controlled input arriving over HTTP; XXE and billion-laughs are the
    two ways an XML validator gets turned into a file-read primitive.
    """
    return etree.XMLParser(
        resolve_entities=False,
        no_network=True,
        load_dtd=False,
        dtd_validation=False,
        huge_tree=False,
        recover=False,
    )


def _text(element: etree._Element, path: str) -> str | None:
    found = element.find(path, namespaces=NS)
    if found is None:
        return None
    return found.text if found.text is not None else ""


def parse(document: bytes) -> ParsedDocument:
    """Parse a UBL 2.1 Invoice or CreditNote.

    Raises `ParseError` (-> HTTP 422) on malformed XML. The exception carries
    line and column only; Part III §5 forbids echoing document content.
    """
    try:
        root = etree.fromstring(document, parser=_parser())
    except etree.XMLSyntaxError as exc:
        line, column = (exc.position if exc.position else (0, 0))
        raise ParseError(line=line, column=column) from exc

    qname = etree.QName(root)
    local = qname.localname

    if local == "Invoice":
        line_path, qty_tag = "cac:InvoiceLine", "cbc:InvoicedQuantity"
        type_code = _text(root, "cbc:InvoiceTypeCode")
    elif local == "CreditNote":
        line_path, qty_tag = "cac:CreditNoteLine", "cbc:CreditedQuantity"
        type_code = _text(root, "cbc:CreditNoteTypeCode")
    else:
        # Not a UBL invoice document. Loud, per §1.1 — an unrecognised root that
        # parsed as XML must not be reported as an empty but valid invoice.
        source_line = root.sourceline
        raise ParseError(
            line=source_line if isinstance(source_line, int) else 0, column=0
        )

    terms: dict[str, str | None] = {
        term: _text(root, path) for term, path in HEADER_TERMS.items()
    }
    terms["BT-3"] = type_code

    lines: list[ParsedLine] = []
    for index, line_el in enumerate(root.findall(line_path, namespaces=NS), start=1):
        qty_el = line_el.find(qty_tag, namespaces=NS)
        lines.append(
            ParsedLine(
                line_number=index,
                terms={t: _text(line_el, p) for t, p in LINE_TERMS.items()},
                quantity=(qty_el.text if qty_el is not None else None),
                unit_code=(qty_el.get("unitCode") if qty_el is not None else None),
            )
        )

    subtotals: list[ParsedTaxSubtotal] = []
    for sub in root.findall("cac:TaxTotal/cac:TaxSubtotal", namespaces=NS):
        subtotals.append(
            ParsedTaxSubtotal(
                taxable_amount=_text(sub, "cbc:TaxableAmount"),
                tax_amount=_text(sub, "cbc:TaxAmount"),
                category_code=_text(sub, "cac:TaxCategory/cbc:ID"),
                percent=_text(sub, "cac:TaxCategory/cbc:Percent"),
            )
        )

    return ParsedDocument(
        root_local_name=local,
        customization_id=_text(root, "cbc:CustomizationID"),
        profile_id=_text(root, "cbc:ProfileID"),
        document_type_code=type_code,
        terms=terms,
        lines=tuple(lines),
        tax_subtotals=tuple(subtotals),
    )

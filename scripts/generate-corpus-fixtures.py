#!/usr/bin/env python3
"""One-time bootstrap generator for the M0 Golden File Corpus.

WHAT THIS IS AND IS NOT
-----------------------
This script wrote the initial 60 M0 corpus cases. It is kept in the repository
because how the fixtures were produced is itself audit-relevant, not because
regenerating them is a normal operation.

**Expectations in the CASES table below are hand-written.** They are what the
rules SHOULD produce, reasoned from the ruleset, and they are not derived from
running the validator. Deriving them from engine output would make the corpus
agree with the engine by construction — which inverts the entire purpose of §3.1
("cannot regress silently") and is precisely the failure CLAUDE.md §4.7(2) warns
about.

From M0 onward the fixtures are hand-owned. `tests/corpus/**/*.expected.json` is
🔒 HUMAN-OWNED (CLAUDE.md §4.3): a new client defect gets a new fixture written
deliberately, not a rerun of this file.

Running it: python scripts/generate-corpus-fixtures.py
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent / "tests" / "corpus"

UBL_INVOICE_NS = "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
UBL_CREDITNOTE_NS = "urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2"

SELLER_TRN = "100000000000001"
BUYER_TRN = "100000000000002"

# `None` means "omit the element entirely"; "" means "the element is present but
# empty". Those are different conformance defects with different remediations,
# and the corpus asserts the difference through value_shape (len null vs len 0).
OMIT = None


def _el(tag: str, value: str | None, attrs: str = "", indent: int = 2) -> str:
    if value is None:
        return ""
    pad = " " * indent
    return f"{pad}<{tag}{attrs}>{value}</{tag}>\n"


def build_document(
    *,
    root: str = "Invoice",
    customization: str | None = "urn:cdl:synthetic:m0",
    profile_id: str | None = "urn:cdl:billing",
    doc_id: str | None = "CDL-0001",
    issue_date: str | None = "2026-08-10",
    due_date: str | None = "2026-09-09",
    type_code: str | None = None,
    currency: str | None = "AED",
    buyer_reference: str | None = "PO-0001",
    order_reference: str | None = None,
    billing_reference: str | None = None,
    seller_name: str | None = "Synthetic Seller LLC",
    buyer_name: str | None = "Synthetic Buyer FZE",
    seller_trn: str | None = SELLER_TRN,
    buyer_trn: str | None = BUYER_TRN,
    seller_country: str | None = "AE",
    buyer_country: str | None = "AE",
    lines: list[dict[str, str | None]] | None = None,
    subtotals: list[dict[str, str | None]] | None = None,
    tax_total: str | None = "50.00",
    line_extension: str | None = "1000.00",
    tax_exclusive: str | None = "1000.00",
    tax_inclusive: str | None = "1050.00",
    prepaid: str | None = None,
    payable: str | None = "1050.00",
) -> str:
    is_credit = root == "CreditNote"
    ns = UBL_CREDITNOTE_NS if is_credit else UBL_INVOICE_NS
    if type_code is None:
        type_code = "381" if is_credit else "380"
    type_tag = "cbc:CreditNoteTypeCode" if is_credit else "cbc:InvoiceTypeCode"
    line_tag = "cac:CreditNoteLine" if is_credit else "cac:InvoiceLine"
    qty_tag = "cbc:CreditedQuantity" if is_credit else "cbc:InvoicedQuantity"

    if lines is None:
        lines = [
            {
                "qty": "10",
                "unit": "H87",
                "amount": "1000.00",
                "name": "Consultancy services",
                "cat": "S",
                "pct": "5",
            }
        ]
    if subtotals is None:
        subtotals = [
            {"taxable": "1000.00", "tax": "50.00", "cat": "S", "pct": "5"}
        ]

    out = [
        '<?xml version="1.0" encoding="UTF-8"?>\n',
        f'<{root} xmlns="{ns}"\n',
        '         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:'
        'CommonBasicComponents-2"\n',
        '         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:'
        'CommonAggregateComponents-2">\n',
    ]
    out.append(_el("cbc:CustomizationID", customization))
    out.append(_el("cbc:ProfileID", profile_id))
    out.append(_el("cbc:ID", doc_id))
    out.append(_el("cbc:IssueDate", issue_date))
    out.append(_el("cbc:DueDate", due_date))
    out.append(_el(type_tag, type_code))
    out.append(_el("cbc:DocumentCurrencyCode", currency))
    out.append(_el("cbc:BuyerReference", buyer_reference))

    if order_reference is not None:
        out.append(
            "  <cac:OrderReference>\n"
            f"    <cbc:ID>{order_reference}</cbc:ID>\n"
            "  </cac:OrderReference>\n"
        )
    if billing_reference is not None:
        out.append(
            "  <cac:BillingReference>\n"
            "    <cac:InvoiceDocumentReference>\n"
            f"      <cbc:ID>{billing_reference}</cbc:ID>\n"
            "    </cac:InvoiceDocumentReference>\n"
            "  </cac:BillingReference>\n"
        )

    for wrapper, name, trn, country in (
        ("cac:AccountingSupplierParty", seller_name, seller_trn, seller_country),
        ("cac:AccountingCustomerParty", buyer_name, buyer_trn, buyer_country),
    ):
        out.append(f"  <{wrapper}>\n    <cac:Party>\n")
        if country is not None:
            out.append(
                "      <cac:PostalAddress><cac:Country>"
                f"<cbc:IdentificationCode>{country}</cbc:IdentificationCode>"
                "</cac:Country></cac:PostalAddress>\n"
            )
        if trn is not None:
            out.append(
                "      <cac:PartyTaxScheme>\n"
                f"        <cbc:CompanyID>{trn}</cbc:CompanyID>\n"
                "        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>\n"
                "      </cac:PartyTaxScheme>\n"
            )
        if name is not None:
            out.append(
                "      <cac:PartyLegalEntity>"
                f"<cbc:RegistrationName>{name}</cbc:RegistrationName>"
                "</cac:PartyLegalEntity>\n"
            )
        out.append(f"    </cac:Party>\n  </{wrapper}>\n")

    if tax_total is not None:
        out.append("  <cac:TaxTotal>\n")
        out.append(f'    <cbc:TaxAmount currencyID="AED">{tax_total}</cbc:TaxAmount>\n')
        for sub in subtotals:
            out.append("    <cac:TaxSubtotal>\n")
            out.append(
                f'      <cbc:TaxableAmount currencyID="AED">{sub["taxable"]}'
                "</cbc:TaxableAmount>\n"
            )
            out.append(
                f'      <cbc:TaxAmount currencyID="AED">{sub["tax"]}</cbc:TaxAmount>\n'
            )
            out.append(
                f'      <cac:TaxCategory><cbc:ID>{sub["cat"]}</cbc:ID>'
                f'<cbc:Percent>{sub["pct"]}</cbc:Percent></cac:TaxCategory>\n'
            )
            out.append("    </cac:TaxSubtotal>\n")
        out.append("  </cac:TaxTotal>\n")

    out.append("  <cac:LegalMonetaryTotal>\n")
    for tag, value in (
        ("cbc:LineExtensionAmount", line_extension),
        ("cbc:TaxExclusiveAmount", tax_exclusive),
        ("cbc:TaxInclusiveAmount", tax_inclusive),
        ("cbc:PrepaidAmount", prepaid),
        ("cbc:PayableAmount", payable),
    ):
        out.append(_el(tag, value, attrs=' currencyID="AED"', indent=4))
    out.append("  </cac:LegalMonetaryTotal>\n")

    for index, line in enumerate(lines, start=1):
        out.append(f"  <{line_tag}>\n")
        out.append(f"    <cbc:ID>{index}</cbc:ID>\n")
        unit_attr = f' unitCode="{line["unit"]}"' if line.get("unit") else ""
        out.append(f'    <{qty_tag}{unit_attr}>{line["qty"]}</{qty_tag}>\n')
        out.append(
            f'    <cbc:LineExtensionAmount currencyID="AED">{line["amount"]}'
            "</cbc:LineExtensionAmount>\n"
        )
        out.append("    <cac:Item>\n")
        out.append(_el("cbc:Name", line.get("name"), indent=6))
        if line.get("cat") is not None:
            out.append(
                "      <cac:ClassifiedTaxCategory>"
                f'<cbc:ID>{line["cat"]}</cbc:ID>'
                f'<cbc:Percent>{line["pct"]}</cbc:Percent>'
                "</cac:ClassifiedTaxCategory>\n"
            )
        out.append("    </cac:Item>\n")
        out.append(
            '    <cac:Price><cbc:PriceAmount currencyID="AED">100.00'
            "</cbc:PriceAmount></cac:Price>\n"
        )
        out.append(f"  </{line_tag}>\n")

    out.append(f"</{root}>\n")
    return "".join(out)


@dataclass
class Case:
    directory: str
    name: str  # must end _pass or _fail — §3.2, naming is load-bearing
    spec_id: str
    description: str
    doc: dict[str, Any]
    fired: list[str] = field(default_factory=list)
    must_not_fire: list[str] = field(default_factory=list)
    classes: dict[str, str] = field(default_factory=dict)
    terms: dict[str, str] = field(default_factory=dict)
    shapes: dict[str, dict[str, Any]] = field(default_factory=dict)

    @property
    def outcome(self) -> str:
        return "fail" if self.name.endswith("_fail") else "pass"


L_STD = {"qty": "10", "unit": "H87", "amount": "1000.00",
         "name": "Consultancy services", "cat": "S", "pct": "5"}


def line(**over: Any) -> dict[str, Any]:
    return {**L_STD, **over}


def sub(taxable: str, tax: str, cat: str, pct: str) -> dict[str, str]:
    return {"taxable": taxable, "tax": tax, "cat": cat, "pct": pct}


CASES: list[Case] = []


# --------------------------------------------------------------------------
# uae/ — profile pint-ae. 10 pass, 16 fail.
# --------------------------------------------------------------------------
def uae(name: str, description: str, doc: dict[str, Any], **kw: Any) -> None:
    CASES.append(Case("uae", name, "pint-ae", description, doc, **kw))


uae("standard_rated_pass", "Standard-rated domestic supply, single line.", {})
uae("export_zero_rated_pass", "Zero-rated export; buyer outside the UAE.",
    {"buyer_country": "IN", "lines": [line(cat="Z", pct="0")],
     "subtotals": [sub("1000.00", "0.00", "Z", "0")], "tax_total": "0.00",
     "tax_inclusive": "1000.00", "payable": "1000.00"})
uae("free_zone_reverse_charge_pass", "Reverse-charge supply, category AE.",
    {"lines": [line(cat="AE", pct="0")],
     "subtotals": [sub("1000.00", "0.00", "AE", "0")], "tax_total": "0.00",
     "tax_inclusive": "1000.00", "payable": "1000.00"})
uae("exempt_supply_pass", "Exempt supply, category E.",
    {"lines": [line(cat="E", pct="0")],
     "subtotals": [sub("1000.00", "0.00", "E", "0")], "tax_total": "0.00",
     "tax_inclusive": "1000.00", "payable": "1000.00"})
uae("services_outside_scope_pass", "Services outside the scope of tax, category O.",
    {"lines": [line(cat="O", pct="0")],
     "subtotals": [sub("1000.00", "0.00", "O", "0")], "tax_total": "0.00",
     "tax_inclusive": "1000.00", "payable": "1000.00"})
uae("multi_line_pass", "Three lines, mixed units, one tax category.",
    {"lines": [line(amount="400.00", unit="H87"),
               line(amount="350.00", unit="KGM", name="Freight"),
               line(amount="250.00", unit="DAY", name="Site supervision")],
     "line_extension": "1000.00"})
uae("multi_tax_rate_pass", "Standard and zero-rated lines in one document.",
    {"lines": [line(amount="1000.00"), line(amount="500.00", cat="Z", pct="0",
                                            name="Exported goods")],
     "subtotals": [sub("1000.00", "50.00", "S", "5"), sub("500.00", "0.00", "Z", "0")],
     "line_extension": "1500.00", "tax_exclusive": "1500.00",
     "tax_inclusive": "1550.00", "payable": "1550.00"})
uae("credit_note_pass", "Credit note carrying its preceding invoice reference.",
    {"root": "CreditNote", "billing_reference": "CDL-0001"})
uae("prepayment_applied_pass", "Prepayment reduces the amount due for payment.",
    {"prepaid": "100.00", "payable": "950.00"})
uae("long_reference_pass", "Optional order reference alongside a buyer reference.",
    {"order_reference": "SO-99887766"})

uae("missing_trn_fail",
    "Buyer TRN element present but empty - the Tally shape, where the TRN sits "
    "in a ledger notes field and never reaches structured BT-48.",
    {"buyer_trn": ""},
    fired=["CDL-PROV-041"], must_not_fire=["CDL-PROV-042"],
    classes={"CDL-PROV-041": "missing_mandatory"},
    terms={"CDL-PROV-041": "BT-48"},
    shapes={"CDL-PROV-041": {"len": 0, "charset": "empty", "regex_class": None,
                             "expected": "^[0-9]{15}$"}})
uae("buyer_identifier_missing_fail",
    "Buyer PartyTaxScheme absent entirely. Distinct from an empty element: "
    "value_shape carries len null rather than len 0.",
    {"buyer_trn": OMIT},
    fired=["CDL-PROV-041"], must_not_fire=["CDL-PROV-042"],
    classes={"CDL-PROV-041": "missing_mandatory"},
    terms={"CDL-PROV-041": "BT-48"},
    shapes={"CDL-PROV-041": {"len": None, "charset": None, "regex_class": None,
                             "expected": "^[0-9]{15}$"}})
uae("seller_trn_missing_fail", "Seller TRN present but empty.",
    {"seller_trn": ""},
    fired=["CDL-PROV-040"], must_not_fire=["CDL-PROV-043"],
    classes={"CDL-PROV-040": "missing_mandatory"}, terms={"CDL-PROV-040": "BT-31"})
uae("buyer_trn_malformed_fail", "Buyer TRN is 13 digits, not 15.",
    {"buyer_trn": "1000000000001"},
    fired=["CDL-PROV-042"], must_not_fire=["CDL-PROV-041"],
    classes={"CDL-PROV-042": "identifier_invalid"}, terms={"CDL-PROV-042": "BT-48"},
    shapes={"CDL-PROV-042": {"len": 13, "charset": "numeric",
                             "regex_class": "[0-9]{13}", "expected": "^[0-9]{15}$"}})
uae("seller_trn_malformed_fail", "Seller TRN carries an alphabetic prefix.",
    {"seller_trn": "TRN100000000001"},
    fired=["CDL-PROV-043"], must_not_fire=["CDL-PROV-040"],
    classes={"CDL-PROV-043": "identifier_invalid"}, terms={"CDL-PROV-043": "BT-31"})
uae("credit_note_bad_predecessor_fail",
    "Credit note whose preceding invoice reference is blank - top-8 rejection cause.",
    {"root": "CreditNote", "billing_reference": ""},
    fired=["CDL-PROV-022"], classes={"CDL-PROV-022": "cross_field_dependency"},
    terms={"CDL-PROV-022": "BT-25"})
uae("unit_code_not_in_rec20_fail", "Unit of measure is free text, not a Rec 20 code.",
    {"lines": [line(unit="Nos.")]},
    fired=["CDL-PROV-019"], must_not_fire=["CDL-PROV-020"],
    classes={"CDL-PROV-019": "invalid_code"}, terms={"CDL-PROV-019": "BT-130"},
    shapes={"CDL-PROV-019": {"len": 4, "charset": "mixed",
                             "regex_class": "[A-Z]{1}[a-z]{2}[^A-Za-z0-9]{1}",
                             "expected": "^[A-Z0-9]{1,3}$"}})
uae("tax_category_unmapped_fail",
    "Line VAT category is the ERP's own string, not an UNTDID 5305 code.",
    {"lines": [line(cat="VAT")]},
    fired=["CDL-PROV-018"], must_not_fire=["CDL-PROV-017", "CDL-PROV-024"],
    classes={"CDL-PROV-018": "invalid_code"}, terms={"CDL-PROV-018": "BT-151"},
    shapes={"CDL-PROV-018": {"len": 3, "charset": "alpha", "regex_class": "[A-Z]{3}",
                             "expected": "^(S|Z|E|AE|K|G|O|L|M)$"}})
uae("line_header_tax_mismatch_fail", "Header BT-106 does not equal the sum of BT-131.",
    {"line_extension": "900.00"},
    fired=["CDL-PROV-011"], classes={"CDL-PROV-011": "arithmetic_mismatch"},
    terms={"CDL-PROV-011": "BT-106"})
uae("currency_rounding_mismatch_fail", "Tax amount carries three decimal places.",
    {"tax_total": "50.005", "subtotals": [sub("1000.00", "50.005", "S", "5")],
     "tax_inclusive": "1050.005", "payable": "1050.005"},
    fired=["CDL-PROV-015"], classes={"CDL-PROV-015": "rounding"},
    terms={"CDL-PROV-015": "BT-110"})
uae("currency_code_lowercase_fail", "Currency code exported in lower case.",
    {"currency": "aed"},
    fired=["CDL-PROV-006"], must_not_fire=["CDL-PROV-007"],
    classes={"CDL-PROV-006": "format_mismatch"}, terms={"CDL-PROV-006": "BT-5"})
uae("issue_date_non_iso_fail", "Issue date exported as DD/MM/YYYY.",
    {"issue_date": "10/08/2026"},
    fired=["CDL-PROV-003"], must_not_fire=["CDL-PROV-002", "CDL-PROV-023"],
    classes={"CDL-PROV-003": "date_logic"}, terms={"CDL-PROV-003": "BT-2"})
uae("missing_line_item_name_fail", "Line has no item name.",
    {"lines": [line(name=OMIT)]},
    fired=["CDL-PROV-021"], classes={"CDL-PROV-021": "missing_mandatory"},
    terms={"CDL-PROV-021": "BT-153"},
    shapes={"CDL-PROV-021": {"len": None, "charset": None, "regex_class": None,
                             "expected": None}})
uae("no_invoice_lines_fail", "Header-only document with no invoice lines.",
    {"lines": [], "line_extension": "0.00", "tax_exclusive": "0.00",
     "tax_inclusive": "0.00", "payable": "0.00", "tax_total": None},
    fired=["CDL-PROV-010"], must_not_fire=["CDL-PROV-011"],
    classes={"CDL-PROV-010": "cardinality"})
uae("customization_id_missing_fail", "Document does not declare a CustomizationID.",
    {"customization": OMIT},
    fired=["CDL-PROV-044"], classes={"CDL-PROV-044": "missing_mandatory"})

# seeded_ten_defects_fail is hand-written (tests/corpus/uae/…xml) — see that file.
CASES.append(Case(
    "uae", "seeded_ten_defects_fail", "pint-ae",
    "M0 exit criterion 2: ten independent seeded defects, one per rule.",
    doc={},
    fired=["CDL-PROV-003", "CDL-PROV-006", "CDL-PROV-011", "CDL-PROV-015",
           "CDL-PROV-018", "CDL-PROV-019", "CDL-PROV-021", "CDL-PROV-024",
           "CDL-PROV-041", "CDL-PROV-043"],
    must_not_fire=["CDL-PROV-002", "CDL-PROV-042", "CDL-PROV-017", "CDL-PROV-023"],
    classes={"CDL-PROV-003": "date_logic", "CDL-PROV-006": "format_mismatch",
             "CDL-PROV-011": "arithmetic_mismatch", "CDL-PROV-015": "rounding",
             "CDL-PROV-018": "invalid_code", "CDL-PROV-019": "invalid_code",
             "CDL-PROV-021": "missing_mandatory", "CDL-PROV-024": "invalid_code",
             "CDL-PROV-041": "missing_mandatory",
             "CDL-PROV-043": "identifier_invalid"},
    terms={"CDL-PROV-041": "BT-48", "CDL-PROV-043": "BT-31",
           "CDL-PROV-018": "BT-151", "CDL-PROV-019": "BT-130"},
    shapes={"CDL-PROV-041": {"len": 0, "charset": "empty", "regex_class": None,
                             "expected": "^[0-9]{15}$"},
            "CDL-PROV-043": {"len": 12, "charset": "numeric",
                             "regex_class": "[0-9]{12}", "expected": "^[0-9]{15}$"}},
))


# --------------------------------------------------------------------------
# en16931/ — core model only, no jurisdiction identifier rules. 8 pass, 12 fail.
# --------------------------------------------------------------------------
def en(name: str, description: str, doc: dict[str, Any], **kw: Any) -> None:
    CASES.append(Case("en16931", name, "en16931", description, doc, **kw))


en("standard_rated_pass", "Standard-rated supply against the core model.",
   {"currency": "EUR"})
en("credit_note_pass", "Credit note with a preceding invoice reference.",
   {"root": "CreditNote", "billing_reference": "CDL-0001", "currency": "EUR"})
en("multi_line_pass", "Three lines summing to the header total.",
   {"currency": "EUR",
    "lines": [line(amount="400.00"), line(amount="350.00", unit="KGM"),
              line(amount="250.00", unit="MTR")], "line_extension": "1000.00"})
en("zero_rated_pass", "Zero-rated supply.",
   {"currency": "EUR", "lines": [line(cat="Z", pct="0")],
    "subtotals": [sub("1000.00", "0.00", "Z", "0")], "tax_total": "0.00",
    "tax_inclusive": "1000.00", "payable": "1000.00"})
en("exempt_pass", "Exempt supply.",
   {"currency": "EUR", "lines": [line(cat="E", pct="0")],
    "subtotals": [sub("1000.00", "0.00", "E", "0")], "tax_total": "0.00",
    "tax_inclusive": "1000.00", "payable": "1000.00"})
en("reverse_charge_pass", "Reverse-charge supply.",
   {"currency": "EUR", "lines": [line(cat="AE", pct="0")],
    "subtotals": [sub("1000.00", "0.00", "AE", "0")], "tax_total": "0.00",
    "tax_inclusive": "1000.00", "payable": "1000.00"})
en("prepayment_pass", "Prepaid amount deducted from the payable amount.",
   {"currency": "EUR", "prepaid": "250.00", "payable": "800.00"})
en("no_identifiers_pass",
   "No tax registration numbers at all: the core model does not require them, "
   "so this must pass here even though it fails under pint-ae.",
   {"currency": "EUR", "seller_trn": OMIT, "buyer_trn": OMIT})

en("missing_invoice_number_fail", "BT-1 present but empty.",
   {"currency": "EUR", "doc_id": ""},
   fired=["CDL-PROV-001"], classes={"CDL-PROV-001": "missing_mandatory"},
   terms={"CDL-PROV-001": "BT-1"})
en("missing_issue_date_fail", "BT-2 present but empty.",
   {"currency": "EUR", "issue_date": ""},
   fired=["CDL-PROV-002"], must_not_fire=["CDL-PROV-003", "CDL-PROV-023"],
   classes={"CDL-PROV-002": "missing_mandatory"}, terms={"CDL-PROV-002": "BT-2"})
en("issue_date_non_iso_fail", "BT-2 in DD-MM-YYYY order.",
   {"currency": "EUR", "issue_date": "10-08-2026"},
   fired=["CDL-PROV-003"], classes={"CDL-PROV-003": "date_logic"})
en("missing_type_code_fail", "BT-3 present but empty.",
   {"currency": "EUR", "type_code": ""},
   fired=["CDL-PROV-004"], must_not_fire=["CDL-PROV-005"],
   classes={"CDL-PROV-004": "missing_mandatory"}, terms={"CDL-PROV-004": "BT-3"})
en("currency_lowercase_fail", "BT-5 in lower case.",
   {"currency": "eur"},
   fired=["CDL-PROV-006"], must_not_fire=["CDL-PROV-007"],
   classes={"CDL-PROV-006": "format_mismatch"})
en("missing_seller_name_fail", "BT-27 present but empty.",
   {"currency": "EUR", "seller_name": ""},
   fired=["CDL-PROV-008"], classes={"CDL-PROV-008": "missing_mandatory"},
   terms={"CDL-PROV-008": "BT-27"})
en("missing_buyer_name_fail", "BT-44 present but empty.",
   {"currency": "EUR", "buyer_name": ""},
   fired=["CDL-PROV-009"], classes={"CDL-PROV-009": "missing_mandatory"},
   terms={"CDL-PROV-009": "BT-44"})
en("no_lines_fail", "No invoice lines.",
   {"currency": "EUR", "lines": [], "line_extension": "0.00",
    "tax_exclusive": "0.00", "tax_inclusive": "0.00", "payable": "0.00",
    "tax_total": None},
   fired=["CDL-PROV-010"], must_not_fire=["CDL-PROV-011"],
   classes={"CDL-PROV-010": "cardinality"})
en("line_sum_mismatch_fail", "BT-106 understates the sum of line net amounts.",
   {"currency": "EUR", "line_extension": "750.00"},
   fired=["CDL-PROV-011"], classes={"CDL-PROV-011": "arithmetic_mismatch"})
en("tax_inclusive_mismatch_fail", "BT-112 does not equal BT-109 plus BT-110.",
   {"currency": "EUR", "tax_inclusive": "1100.00", "payable": "1100.00"},
   fired=["CDL-PROV-012"], must_not_fire=["CDL-PROV-025"],
   classes={"CDL-PROV-012": "arithmetic_mismatch"}, terms={"CDL-PROV-012": "BT-112"})
en("missing_payable_amount_fail", "BT-115 absent.",
   {"currency": "EUR", "payable": OMIT},
   fired=["CDL-PROV-013"], must_not_fire=["CDL-PROV-025"],
   classes={"CDL-PROV-013": "missing_mandatory"}, terms={"CDL-PROV-013": "BT-115"})
en("due_date_before_issue_fail", "BT-9 precedes BT-2.",
   {"currency": "EUR", "due_date": "2026-08-01"},
   fired=["CDL-PROV-023"], classes={"CDL-PROV-023": "date_logic"},
   terms={"CDL-PROV-023": "BT-9"})


# --------------------------------------------------------------------------
# peppol-bis-3.0/ — 6 pass, 8 fail.
# --------------------------------------------------------------------------
def pep(name: str, description: str, doc: dict[str, Any], **kw: Any) -> None:
    CASES.append(Case("peppol-bis-3.0", name, "peppol-bis-3.0", description, doc, **kw))


pep("standard_rated_pass", "Standard-rated supply with both identifiers present.",
    {"currency": "EUR"})
pep("credit_note_pass", "Credit note with a preceding invoice reference.",
    {"root": "CreditNote", "billing_reference": "CDL-0001", "currency": "EUR"})
pep("order_reference_only_pass",
    "No buyer reference, but a purchase order reference is present.",
    {"currency": "EUR", "buyer_reference": OMIT, "order_reference": "SO-4411"})
pep("multi_line_pass", "Three lines summing to the header total.",
    {"currency": "EUR",
     "lines": [line(amount="400.00"), line(amount="350.00", unit="KGM"),
               line(amount="250.00", unit="LTR")], "line_extension": "1000.00"})
pep("zero_rated_pass", "Zero-rated supply.",
    {"currency": "EUR", "lines": [line(cat="Z", pct="0")],
     "subtotals": [sub("1000.00", "0.00", "Z", "0")], "tax_total": "0.00",
     "tax_inclusive": "1000.00", "payable": "1000.00"})
pep("prepayment_pass", "Prepaid amount deducted from the payable amount.",
    {"currency": "EUR", "prepaid": "50.00", "payable": "1000.00"})

pep("missing_customization_id_fail", "CustomizationID absent.",
    {"currency": "EUR", "customization": OMIT},
    fired=["CDL-PROV-060"], classes={"CDL-PROV-060": "missing_mandatory"})
pep("missing_profile_id_fail", "ProfileID absent.",
    {"currency": "EUR", "profile_id": OMIT},
    fired=["CDL-PROV-061"], classes={"CDL-PROV-061": "missing_mandatory"})
pep("missing_buyer_and_order_reference_fail",
    "Neither a buyer reference nor a purchase order reference.",
    {"currency": "EUR", "buyer_reference": OMIT},
    fired=["CDL-PROV-062"], classes={"CDL-PROV-062": "cross_field_dependency"},
    terms={"CDL-PROV-062": "BT-10"})
pep("line_sum_mismatch_fail", "BT-106 does not equal the sum of BT-131.",
    {"currency": "EUR", "line_extension": "1200.00"},
    fired=["CDL-PROV-011"], classes={"CDL-PROV-011": "arithmetic_mismatch"})
pep("tax_category_unmapped_fail", "Line VAT category is not an UNTDID 5305 code.",
    {"currency": "EUR", "lines": [line(cat="STD")]},
    fired=["CDL-PROV-018"], must_not_fire=["CDL-PROV-017"],
    classes={"CDL-PROV-018": "invalid_code"})
pep("unit_code_freetext_fail", "Unit of measure is free text.",
    {"currency": "EUR", "lines": [line(unit="each")]},
    fired=["CDL-PROV-019"], must_not_fire=["CDL-PROV-020"],
    classes={"CDL-PROV-019": "invalid_code"})
pep("missing_item_name_fail", "Line has no item name.",
    {"currency": "EUR", "lines": [line(name=OMIT)]},
    fired=["CDL-PROV-021"], classes={"CDL-PROV-021": "missing_mandatory"})
pep("credit_note_bad_predecessor_fail", "Credit note with a blank BT-25.",
    {"root": "CreditNote", "currency": "EUR", "billing_reference": ""},
    fired=["CDL-PROV-022"], classes={"CDL-PROV-022": "cross_field_dependency"})


def write_all() -> None:
    written = 0
    for case in CASES:
        directory = ROOT / case.directory
        directory.mkdir(parents=True, exist_ok=True)

        xml_path = directory / f"{case.name}.xml"
        # The seeded-defect fixture is hand-written; never overwrite it.
        if case.name != "seeded_ten_defects_fail":
            xml_path.write_text(build_document(**case.doc), encoding="utf-8")

        expectation: dict[str, Any] = {
            "$schema": "../schemas/expected-output.schema.json",
            "case_id": f"{case.directory}-{case.name.replace('_', '-')}",
            "description": case.description,
            "input": {"file": xml_path.name, "syntax": "UBL-2.1"},
            "spec": {"spec_id": case.spec_id, "version": "RESOLVE_IN_WEEK_1"},
            "expect": {
                "outcome": case.outcome,
                "match": "exact",
                "fired_rules": case.fired,
                "must_not_fire": case.must_not_fire,
                "failure_classes": case.classes,
                "business_terms": case.terms,
                "value_shapes": case.shapes,
            },
            "provenance": "synthetic",
            "added_in": "week-04",
        }
        (directory / f"{case.name}.expected.json").write_text(
            json.dumps(expectation, indent=2) + "\n", encoding="utf-8"
        )
        written += 1

    fails = sum(1 for c in CASES if c.outcome == "fail")
    print(f"wrote {written} cases ({fails} expected-fail, {written - fails} expected-pass)")
    for directory in sorted({c.directory for c in CASES}):
        p = sum(1 for c in CASES if c.directory == directory and c.outcome == "pass")
        f = sum(1 for c in CASES if c.directory == directory and c.outcome == "fail")
        marker = "ok" if f >= p else "RULE A VIOLATION"
        print(f"  {directory:<16} {p} pass / {f} fail  {marker}")


if __name__ == "__main__":
    write_all()

<?xml version="1.0" encoding="UTF-8"?>
<!--
  🔒 HUMAN-OWNED — CLAUDE.md §4.3

  AGENT-AUTHORED, PROVISIONAL. Not the published EN 16931 Schematron.
  Rule IDs are namespaced CDL-PROV-### and are never published identifiers.
  See ../RULES.md before changing anything here.

  Scope: structure, cardinality, format and arithmetic over the EN 16931
  semantic model as carried by UBL 2.1 Invoice and CreditNote. No tax
  interpretation of any kind (CLAUDE.md §4.4).

  Every numeric and date test is guarded with `castable as`. Without the guard a
  malformed amount makes the XPath raise, the engine turns that into an
  engine failure, and a document with bad data returns a 500 instead of the
  finding that says its data is bad.
-->
<sch:schema xmlns:sch="http://purl.oclc.org/dsdl/schematron"
            xmlns:cdl="https://compliance-data-layer.dev/schematron-extensions/v1"
            queryBinding="xslt2">

  <sch:title>CDL provisional core model rules (EN 16931 semantic model, UBL 2.1)</sch:title>

  <sch:ns prefix="ubl" uri="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"/>
  <sch:ns prefix="cn"  uri="urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2"/>
  <sch:ns prefix="cbc" uri="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"/>
  <sch:ns prefix="cac" uri="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"/>

  <!-- ==================== document header ==================== -->
  <sch:pattern id="cdl-core-header">
    <sch:rule context="ubl:Invoice | cn:CreditNote">

      <sch:assert id="CDL-PROV-001"
                  test="normalize-space(cbc:ID) != ''"
                  flag="fatal"
                  cdl:business-term="BT-1"
                  cdl:failure-class="missing_mandatory"
                  cdl:value-xpath="cbc:ID"
                  cdl:expected-description="an invoice number (BT-1)">
        An invoice shall have an invoice number (BT-1).
      </sch:assert>

      <sch:assert id="CDL-PROV-002"
                  test="normalize-space(cbc:IssueDate) != ''"
                  flag="fatal"
                  cdl:business-term="BT-2"
                  cdl:failure-class="missing_mandatory"
                  cdl:value-xpath="cbc:IssueDate"
                  cdl:expected-description="an issue date (BT-2)">
        An invoice shall have an issue date (BT-2).
      </sch:assert>

      <sch:assert id="CDL-PROV-003"
                  test="not(normalize-space(cbc:IssueDate) != '') or cbc:IssueDate castable as xs:date"
                  flag="error"
                  cdl:business-term="BT-2"
                  cdl:failure-class="date_logic"
                  cdl:value-xpath="cbc:IssueDate"
                  cdl:expected="^[0-9]{4}-[0-9]{2}-[0-9]{2}$"
                  cdl:expected-description="an ISO 8601 calendar date, YYYY-MM-DD (BT-2)">
        The issue date (BT-2) shall be a valid calendar date.
      </sch:assert>

      <sch:assert id="CDL-PROV-004"
                  test="normalize-space((cbc:InvoiceTypeCode | cbc:CreditNoteTypeCode)[1]) != ''"
                  flag="error"
                  cdl:business-term="BT-3"
                  cdl:failure-class="missing_mandatory"
                  cdl:value-xpath="(cbc:InvoiceTypeCode | cbc:CreditNoteTypeCode)[1]"
                  cdl:expected-description="a document type code (BT-3)">
        An invoice shall have a document type code (BT-3).
      </sch:assert>

      <!-- Partial code list: WARNING only. codelists/__init__.py refuses to let
           a partial list back a fail-severity rule. -->
      <sch:assert id="CDL-PROV-005"
                  test="not(normalize-space((cbc:InvoiceTypeCode | cbc:CreditNoteTypeCode)[1]) != '')
                        or $CODELIST = normalize-space((cbc:InvoiceTypeCode | cbc:CreditNoteTypeCode)[1])"
                  flag="warning"
                  cdl:codelist="UNCL1001"
                  cdl:business-term="BT-3"
                  cdl:failure-class="invalid_code"
                  cdl:value-xpath="(cbc:InvoiceTypeCode | cbc:CreditNoteTypeCode)[1]"
                  cdl:expected-description="a document type code present in our copy of UNCL 1001 (list is partial — this cannot deny validity)">
        The document type code (BT-3) is not in our copy of UNCL 1001.
      </sch:assert>

      <sch:assert id="CDL-PROV-006"
                  test="matches(string(cbc:DocumentCurrencyCode), '^[A-Z]{3}$')"
                  flag="fatal"
                  cdl:business-term="BT-5"
                  cdl:failure-class="format_mismatch"
                  cdl:value-xpath="cbc:DocumentCurrencyCode"
                  cdl:expected="^[A-Z]{3}$"
                  cdl:expected-description="a three-letter upper-case currency code (BT-5)">
        The document currency code (BT-5) shall be three upper-case letters.
      </sch:assert>

      <sch:assert id="CDL-PROV-007"
                  test="not(matches(string(cbc:DocumentCurrencyCode), '^[A-Z]{3}$'))
                        or $CODELIST = string(cbc:DocumentCurrencyCode)"
                  flag="warning"
                  cdl:codelist="ISO4217"
                  cdl:business-term="BT-5"
                  cdl:failure-class="invalid_code"
                  cdl:value-xpath="cbc:DocumentCurrencyCode"
                  cdl:expected-description="a currency code present in our copy of ISO 4217 (list is partial — this cannot deny validity)">
        The document currency code (BT-5) is not in our copy of ISO 4217.
      </sch:assert>

      <sch:assert id="CDL-PROV-008"
                  test="normalize-space(cac:AccountingSupplierParty/cac:Party/cac:PartyLegalEntity/cbc:RegistrationName) != ''"
                  flag="fatal"
                  cdl:business-term="BT-27"
                  cdl:failure-class="missing_mandatory"
                  cdl:value-xpath="cac:AccountingSupplierParty/cac:Party/cac:PartyLegalEntity/cbc:RegistrationName"
                  cdl:expected-description="a seller legal name (BT-27)">
        An invoice shall have a seller name (BT-27).
      </sch:assert>

      <sch:assert id="CDL-PROV-009"
                  test="normalize-space(cac:AccountingCustomerParty/cac:Party/cac:PartyLegalEntity/cbc:RegistrationName) != ''"
                  flag="fatal"
                  cdl:business-term="BT-44"
                  cdl:failure-class="missing_mandatory"
                  cdl:value-xpath="cac:AccountingCustomerParty/cac:Party/cac:PartyLegalEntity/cbc:RegistrationName"
                  cdl:expected-description="a buyer legal name (BT-44)">
        An invoice shall have a buyer name (BT-44).
      </sch:assert>

      <sch:assert id="CDL-PROV-010"
                  test="count(cac:InvoiceLine | cac:CreditNoteLine) &gt;= 1"
                  flag="fatal"
                  cdl:business-term="BG-25"
                  cdl:failure-class="cardinality"
                  cdl:expected-description="at least one invoice line (BG-25)">
        An invoice shall have at least one invoice line (BG-25).
      </sch:assert>

      <sch:assert id="CDL-PROV-013"
                  test="normalize-space(cac:LegalMonetaryTotal/cbc:PayableAmount) != ''"
                  flag="fatal"
                  cdl:business-term="BT-115"
                  cdl:failure-class="missing_mandatory"
                  cdl:value-xpath="cac:LegalMonetaryTotal/cbc:PayableAmount"
                  cdl:expected-description="an amount due for payment (BT-115)">
        An invoice shall have an amount due for payment (BT-115).
      </sch:assert>

      <sch:assert id="CDL-PROV-026"
                  test="not(exists(cac:AccountingSupplierParty/cac:Party/cac:PostalAddress/cac:Country/cbc:IdentificationCode))
                        or matches(string(cac:AccountingSupplierParty/cac:Party/cac:PostalAddress/cac:Country/cbc:IdentificationCode), '^[A-Z]{2}$')"
                  flag="error"
                  cdl:business-term="BT-40"
                  cdl:failure-class="identifier_invalid"
                  cdl:value-xpath="cac:AccountingSupplierParty/cac:Party/cac:PostalAddress/cac:Country/cbc:IdentificationCode"
                  cdl:expected="^[A-Z]{2}$"
                  cdl:expected-description="a two-letter upper-case country code (BT-40)">
        The seller country code (BT-40) shall be two upper-case letters.
      </sch:assert>

    </sch:rule>
  </sch:pattern>

  <!-- ==================== monetary arithmetic ==================== -->
  <sch:pattern id="cdl-core-arithmetic">
    <sch:rule context="ubl:Invoice | cn:CreditNote">
      <sch:let name="lineSum"
               value="sum(for $a in (cac:InvoiceLine | cac:CreditNoteLine)/cbc:LineExtensionAmount[. castable as xs:decimal] return xs:decimal($a))"/>
      <sch:let name="hdrLines" value="cac:LegalMonetaryTotal/cbc:LineExtensionAmount"/>
      <sch:let name="hdrTaxExcl" value="cac:LegalMonetaryTotal/cbc:TaxExclusiveAmount"/>
      <sch:let name="hdrTaxIncl" value="cac:LegalMonetaryTotal/cbc:TaxInclusiveAmount"/>
      <sch:let name="hdrPrepaid" value="cac:LegalMonetaryTotal/cbc:PrepaidAmount"/>
      <sch:let name="hdrPayable" value="cac:LegalMonetaryTotal/cbc:PayableAmount"/>
      <sch:let name="taxTotal" value="cac:TaxTotal/cbc:TaxAmount[1]"/>

      <sch:assert id="CDL-PROV-011"
                  test="not($hdrLines castable as xs:decimal) or xs:decimal($hdrLines) = $lineSum"
                  flag="fatal"
                  cdl:business-term="BT-106"
                  cdl:failure-class="arithmetic_mismatch"
                  cdl:value-xpath="$hdrLines"
                  cdl:expected-description="the sum of all invoice line net amounts (BT-131) in BT-106">
        The sum of line net amounts (BT-106) shall equal the sum of BT-131.
      </sch:assert>

      <sch:assert id="CDL-PROV-012"
                  test="not($hdrTaxIncl castable as xs:decimal and $hdrTaxExcl castable as xs:decimal and $taxTotal castable as xs:decimal)
                        or xs:decimal($hdrTaxIncl) = xs:decimal($hdrTaxExcl) + xs:decimal($taxTotal)"
                  flag="fatal"
                  cdl:business-term="BT-112"
                  cdl:failure-class="arithmetic_mismatch"
                  cdl:value-xpath="$hdrTaxIncl"
                  cdl:expected-description="BT-109 plus BT-110 in BT-112">
        The total with VAT (BT-112) shall equal BT-109 plus BT-110.
      </sch:assert>

      <sch:assert id="CDL-PROV-025"
                  test="not($hdrPayable castable as xs:decimal and $hdrTaxIncl castable as xs:decimal)
                        or xs:decimal($hdrPayable) = xs:decimal($hdrTaxIncl) - (if ($hdrPrepaid castable as xs:decimal) then xs:decimal($hdrPrepaid) else 0)"
                  flag="error"
                  cdl:business-term="BT-115"
                  cdl:failure-class="arithmetic_mismatch"
                  cdl:value-xpath="$hdrPayable"
                  cdl:expected-description="BT-112 less BT-113 in BT-115">
        The amount due for payment (BT-115) shall equal BT-112 less BT-113.
      </sch:assert>

      <sch:assert id="CDL-PROV-014"
                  test="not(exists($hdrLines)) or matches(string($hdrLines), '^-?[0-9]+(\.[0-9]{1,2})?$')"
                  flag="error"
                  cdl:business-term="BT-106"
                  cdl:failure-class="rounding"
                  cdl:value-xpath="$hdrLines"
                  cdl:expected="^-?[0-9]+(\.[0-9]{1,2})?$"
                  cdl:expected-description="an amount with at most two decimal places (BT-106)">
        The sum of line net amounts (BT-106) shall carry at most two decimals.
      </sch:assert>

      <sch:assert id="CDL-PROV-015"
                  test="not(exists($taxTotal)) or matches(string($taxTotal), '^-?[0-9]+(\.[0-9]{1,2})?$')"
                  flag="error"
                  cdl:business-term="BT-110"
                  cdl:failure-class="rounding"
                  cdl:value-xpath="$taxTotal"
                  cdl:expected="^-?[0-9]+(\.[0-9]{1,2})?$"
                  cdl:expected-description="an amount with at most two decimal places (BT-110)">
        The total VAT amount (BT-110) shall carry at most two decimals.
      </sch:assert>

      <sch:assert id="CDL-PROV-023"
                  test="not(cbc:DueDate castable as xs:date and cbc:IssueDate castable as xs:date)
                        or xs:date(cbc:DueDate) &gt;= xs:date(cbc:IssueDate)"
                  flag="error"
                  cdl:business-term="BT-9"
                  cdl:failure-class="date_logic"
                  cdl:value-xpath="cbc:DueDate"
                  cdl:expected-description="a payment due date (BT-9) on or after the issue date (BT-2)">
        The payment due date (BT-9) shall not precede the issue date (BT-2).
      </sch:assert>

    </sch:rule>
  </sch:pattern>

  <!-- ==================== credit-note lineage ==================== -->
  <!--
    architecture.md Part I §2.5 on BT-25: "Credit-note lineage — a top-8
    rejection cause when absent."
  -->
  <sch:pattern id="cdl-core-creditnote">
    <sch:rule context="cn:CreditNote">
      <sch:assert id="CDL-PROV-022"
                  test="normalize-space(cac:BillingReference/cac:InvoiceDocumentReference/cbc:ID) != ''"
                  flag="fatal"
                  cdl:business-term="BT-25"
                  cdl:failure-class="cross_field_dependency"
                  cdl:value-xpath="cac:BillingReference/cac:InvoiceDocumentReference/cbc:ID"
                  cdl:expected-description="a preceding invoice reference (BT-25) on a credit note">
        A credit note shall reference the invoice it corrects (BT-25).
      </sch:assert>
    </sch:rule>
  </sch:pattern>

  <!-- ==================== invoice lines ==================== -->
  <sch:pattern id="cdl-core-lines">
    <sch:rule context="cac:InvoiceLine | cac:CreditNoteLine">
      <sch:let name="qty" value="(cbc:InvoicedQuantity | cbc:CreditedQuantity)[1]"/>
      <sch:let name="taxCat" value="cac:Item/cac:ClassifiedTaxCategory/cbc:ID"/>

      <sch:assert id="CDL-PROV-016"
                  test="normalize-space(cbc:LineExtensionAmount) != ''"
                  flag="fatal"
                  cdl:business-term="BT-131"
                  cdl:failure-class="missing_mandatory"
                  cdl:value-xpath="cbc:LineExtensionAmount"
                  cdl:expected-description="a line net amount (BT-131)">
        Each invoice line shall have a net amount (BT-131).
      </sch:assert>

      <sch:assert id="CDL-PROV-017"
                  test="normalize-space($taxCat) != ''"
                  flag="fatal"
                  cdl:business-term="BT-151"
                  cdl:failure-class="missing_mandatory"
                  cdl:value-xpath="$taxCat"
                  cdl:expected-description="a VAT category code on the line (BT-151)">
        Each invoice line shall have a VAT category code (BT-151).
      </sch:assert>

      <!-- UNTDID 5305 is the ONE code list marked complete, so it is the one
           code list permitted to produce a failure. codelists/__init__.py. -->
      <sch:assert id="CDL-PROV-018"
                  test="not(normalize-space($taxCat) != '') or $CODELIST = normalize-space($taxCat)"
                  flag="fatal"
                  cdl:codelist="UNTDID5305"
                  cdl:business-term="BT-151"
                  cdl:failure-class="invalid_code"
                  cdl:value-xpath="$taxCat"
                  cdl:expected="^(S|Z|E|AE|K|G|O|L|M)$"
                  cdl:expected-description="a VAT category code from UNTDID 5305 as restricted by EN 16931 (BT-151)">
        The line VAT category code (BT-151) shall be an UNTDID 5305 code.
      </sch:assert>

      <sch:assert id="CDL-PROV-019"
                  test="not(exists($qty/@unitCode)) or matches(string($qty/@unitCode), '^[A-Z0-9]{1,3}$')"
                  flag="error"
                  cdl:business-term="BT-130"
                  cdl:failure-class="invalid_code"
                  cdl:value-xpath="$qty/@unitCode"
                  cdl:expected="^[A-Z0-9]{1,3}$"
                  cdl:expected-description="a UN/ECE Recommendation 20 unit code, one to three upper-case alphanumerics, not free text (BT-130)">
        The unit of measure (BT-130) shall be a Rec 20 code, not free text.
      </sch:assert>

      <sch:assert id="CDL-PROV-020"
                  test="not(matches(string($qty/@unitCode), '^[A-Z0-9]{1,3}$')) or $CODELIST = string($qty/@unitCode)"
                  flag="warning"
                  cdl:codelist="UNECE_REC20"
                  cdl:business-term="BT-130"
                  cdl:failure-class="invalid_code"
                  cdl:value-xpath="$qty/@unitCode"
                  cdl:expected-description="a unit code present in our copy of UN/ECE Rec 20 (list is partial — this cannot deny validity)">
        The unit of measure (BT-130) is not in our copy of UN/ECE Rec 20.
      </sch:assert>

      <sch:assert id="CDL-PROV-021"
                  test="normalize-space(cac:Item/cbc:Name) != ''"
                  flag="error"
                  cdl:business-term="BT-153"
                  cdl:failure-class="missing_mandatory"
                  cdl:value-xpath="cac:Item/cbc:Name"
                  cdl:expected-description="an item name on the line (BT-153)">
        Each invoice line shall have an item name (BT-153).
      </sch:assert>

    </sch:rule>
  </sch:pattern>

  <!-- ==================== VAT breakdown ==================== -->
  <sch:pattern id="cdl-core-taxsubtotal">
    <sch:rule context="cac:TaxSubtotal">
      <sch:assert id="CDL-PROV-024"
                  test="not(normalize-space(cac:TaxCategory/cbc:ID) != '') or $CODELIST = normalize-space(cac:TaxCategory/cbc:ID)"
                  flag="fatal"
                  cdl:codelist="UNTDID5305"
                  cdl:business-term="BT-118"
                  cdl:failure-class="invalid_code"
                  cdl:value-xpath="cac:TaxCategory/cbc:ID"
                  cdl:expected="^(S|Z|E|AE|K|G|O|L|M)$"
                  cdl:expected-description="a VAT category code from UNTDID 5305 in the VAT breakdown (BT-118)">
        The VAT breakdown category code (BT-118) shall be an UNTDID 5305 code.
      </sch:assert>
    </sch:rule>
  </sch:pattern>

</sch:schema>

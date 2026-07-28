<?xml version="1.0" encoding="UTF-8"?>
<!--
  🔒 HUMAN-OWNED — CLAUDE.md §4.3

  AGENT-AUTHORED, PROVISIONAL. This is NOT the published OpenPeppol PINT AE
  Schematron. Rule IDs are namespaced CDL-PROV-### precisely so that they can
  never be confused with a published PINT-AE-Rxxx identifier in a corpus row,
  a client report or an ASP integration. See ../RULES.md.

  The one piece of AE-specific semantics used here is normative and comes from
  architecture.md Part II · M4, which specifies for pint-ae:

      "identifier_rules": { "trn": { "pattern": "^[0-9]{15}$", "checksum": "none" } }

  That pattern is reproduced verbatim below. Nothing else about UAE VAT
  treatment is encoded here, and nothing should be: CLAUDE.md §4.4 forbids
  interpreting a tax rule, and that binds the ruleset author too.
-->
<sch:schema xmlns:sch="http://purl.oclc.org/dsdl/schematron"
            xmlns:cdl="https://compliance-data-layer.dev/schematron-extensions/v1"
            queryBinding="xslt2">

  <sch:title>CDL provisional PINT AE identifier rules</sch:title>

  <sch:ns prefix="ubl" uri="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"/>
  <sch:ns prefix="cn"  uri="urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2"/>
  <sch:ns prefix="cbc" uri="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"/>
  <sch:ns prefix="cac" uri="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"/>

  <sch:pattern id="cdl-pint-ae-identifiers">
    <sch:rule context="ubl:Invoice | cn:CreditNote">
      <sch:let name="sellerTrn" value="cac:AccountingSupplierParty/cac:Party/cac:PartyTaxScheme/cbc:CompanyID"/>
      <sch:let name="buyerTrn"  value="cac:AccountingCustomerParty/cac:Party/cac:PartyTaxScheme/cbc:CompanyID"/>

      <sch:assert id="CDL-PROV-040"
                  test="normalize-space($sellerTrn) != ''"
                  flag="fatal"
                  cdl:business-term="BT-31"
                  cdl:failure-class="missing_mandatory"
                  cdl:value-xpath="$sellerTrn"
                  cdl:expected="^[0-9]{15}$"
                  cdl:expected-description="a seller Tax Registration Number of 15 digits (BT-31)">
        The seller Tax Registration Number (BT-31) shall be present.
      </sch:assert>

      <!--
        Provisional counterpart of PINT-AE-R041 (architecture.md §3.3).
        Fires only on absent-or-empty. The wrong-shape case is CDL-PROV-042, so
        one defect produces one finding and the corpus can assert must_not_fire.
      -->
      <sch:assert id="CDL-PROV-041"
                  test="normalize-space($buyerTrn) != ''"
                  flag="fatal"
                  cdl:business-term="BT-48"
                  cdl:failure-class="missing_mandatory"
                  cdl:value-xpath="$buyerTrn"
                  cdl:expected="^[0-9]{15}$"
                  cdl:expected-description="a buyer Tax Registration Number of 15 digits (BT-48)">
        The buyer Tax Registration Number (BT-48) shall be present.
      </sch:assert>

      <!-- Provisional counterpart of BR-CO-26 (architecture.md §3.3). -->
      <sch:assert id="CDL-PROV-042"
                  test="not(normalize-space($buyerTrn) != '')
                        or matches(normalize-space($buyerTrn), '^[0-9]{15}$')"
                  flag="fatal"
                  cdl:business-term="BT-48"
                  cdl:failure-class="identifier_invalid"
                  cdl:value-xpath="$buyerTrn"
                  cdl:expected="^[0-9]{15}$"
                  cdl:expected-description="a buyer Tax Registration Number of exactly 15 digits (BT-48)">
        The buyer Tax Registration Number (BT-48) shall be 15 digits.
      </sch:assert>

      <sch:assert id="CDL-PROV-043"
                  test="not(normalize-space($sellerTrn) != '')
                        or matches(normalize-space($sellerTrn), '^[0-9]{15}$')"
                  flag="fatal"
                  cdl:business-term="BT-31"
                  cdl:failure-class="identifier_invalid"
                  cdl:value-xpath="$sellerTrn"
                  cdl:expected="^[0-9]{15}$"
                  cdl:expected-description="a seller Tax Registration Number of exactly 15 digits (BT-31)">
        The seller Tax Registration Number (BT-31) shall be 15 digits.
      </sch:assert>

      <sch:assert id="CDL-PROV-044"
                  test="normalize-space(cbc:CustomizationID) != ''"
                  flag="error"
                  cdl:failure-class="missing_mandatory"
                  cdl:value-xpath="cbc:CustomizationID"
                  cdl:expected-description="a customization identifier naming the specification the document claims to follow">
        The document shall declare a CustomizationID.
      </sch:assert>

      <sch:assert id="CDL-PROV-045"
                  test="normalize-space(cac:AccountingCustomerParty/cac:Party/cac:PostalAddress/cac:Country/cbc:IdentificationCode) != ''"
                  flag="error"
                  cdl:business-term="BT-55"
                  cdl:failure-class="missing_mandatory"
                  cdl:value-xpath="cac:AccountingCustomerParty/cac:Party/cac:PostalAddress/cac:Country/cbc:IdentificationCode"
                  cdl:expected="^[A-Z]{2}$"
                  cdl:expected-description="a buyer country code (BT-55)">
        The buyer country code (BT-55) shall be present.
      </sch:assert>

    </sch:rule>
  </sch:pattern>

</sch:schema>

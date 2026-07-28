<?xml version="1.0" encoding="UTF-8"?>
<!--
  🔒 HUMAN-OWNED — CLAUDE.md §4.3

  AGENT-AUTHORED, PROVISIONAL. Not the published Peppol BIS Billing 3.0
  Schematron. Rule IDs namespaced CDL-PROV-###. See ../RULES.md.

  Structural document-identification rules only.
-->
<sch:schema xmlns:sch="http://purl.oclc.org/dsdl/schematron"
            xmlns:cdl="https://compliance-data-layer.dev/schematron-extensions/v1"
            queryBinding="xslt2">

  <sch:title>CDL provisional Peppol BIS 3.0 profile rules</sch:title>

  <sch:ns prefix="ubl" uri="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"/>
  <sch:ns prefix="cn"  uri="urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2"/>
  <sch:ns prefix="cbc" uri="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"/>
  <sch:ns prefix="cac" uri="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"/>

  <sch:pattern id="cdl-peppol-identification">
    <sch:rule context="ubl:Invoice | cn:CreditNote">

      <sch:assert id="CDL-PROV-060"
                  test="normalize-space(cbc:CustomizationID) != ''"
                  flag="fatal"
                  cdl:failure-class="missing_mandatory"
                  cdl:value-xpath="cbc:CustomizationID"
                  cdl:expected-description="a customization identifier naming the specification the document claims to follow">
        A Peppol document shall declare a CustomizationID.
      </sch:assert>

      <sch:assert id="CDL-PROV-061"
                  test="normalize-space(cbc:ProfileID) != ''"
                  flag="fatal"
                  cdl:failure-class="missing_mandatory"
                  cdl:value-xpath="cbc:ProfileID"
                  cdl:expected-description="a profile identifier naming the business process">
        A Peppol document shall declare a ProfileID.
      </sch:assert>

      <sch:assert id="CDL-PROV-062"
                  test="normalize-space(cbc:BuyerReference) != ''
                        or normalize-space(cac:OrderReference/cbc:ID) != ''"
                  flag="error"
                  cdl:business-term="BT-10"
                  cdl:failure-class="cross_field_dependency"
                  cdl:value-xpath="cbc:BuyerReference"
                  cdl:expected-description="either a buyer reference (BT-10) or a purchase order reference (BT-13)">
        A buyer reference (BT-10) or an order reference (BT-13) shall be present.
      </sch:assert>

    </sch:rule>
  </sch:pattern>

</sch:schema>

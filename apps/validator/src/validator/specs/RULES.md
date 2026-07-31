# 🔒 `specs/` — ruleset provenance and the Week-1 replacement task

CLAUDE.md §4.3 marks this directory HUMAN-OWNED: it encodes jurisdiction rule
interpretation, scenario maps and identifier rules.

## What is shipped here, precisely

**Every Schematron file in this directory is AGENT-AUTHORED and PROVISIONAL.**
None of it is a published conformance artefact.

The published rulesets — the OpenPeppol PINT AE Schematron, the EN 16931
Schematron, the Peppol BIS 3.0 Schematron — were not available to the agent that
built M0, and CLAUDE.md §4.7(1) forbids inventing external identifiers. So:

| | |
|---|---|
| Rule IDs | Namespaced `CDL-PROV-###`. **Never** a `PINT-AE-Rxxx`, `BR-`, `BR-CO-` or `BR-DEC-` identifier. |
| `version` in the registry | The literal `RESOLVE_IN_WEEK_1` sentinel. |
| Effect of the sentinel | `/validate` and the CLI **refuse** the profile unless `CDL_ALLOW_PROVISIONAL_RULESET=1`. |

Namespacing the IDs is the whole point. A fabricated `PINT-AE-R041` in a
`corpus.validation_event` row is indistinguishable from a real one six months
later, and the corpus is append-only — there is no un-writing it. `CDL-PROV-041`
can never be mistaken for a published rule by a client, an ASP, or a future
version of us.

## What these rules actually assert

Structure and arithmetic only:

- presence and cardinality of EN 16931 business terms
- format of identifiers, dates, amounts and codes
- arithmetic consistency between line totals, tax totals and payable amounts
- membership in a code list, **only where that list is marked `complete`**

They contain **no tax interpretation**. Nothing here decides whether a supply is
zero-rated, exempt, reverse-charged or out of scope. CLAUDE.md §4.4 forbids
interpreting a tax rule, and that prohibition binds the ruleset author exactly as
it binds the model.

## The Week-1 replacement task

1. ~~Obtain the published Schematron for each profile from its primary source.~~
   **DONE 2026-07-29.** Vendored under `<profile>/published/`. Provenance,
   upstream commits and tags: `PROVENANCE.md`.
2. Drop it in beside these files and update `schematron` in the registry entry.
   **BLOCKED — see below.**
3. Replace `RESOLVE_IN_WEEK_1` with the real version string.
4. Update `packages/config/specs.json`.
5. Rewrite the affected `tests/corpus/**/*.expected.json` rule IDs from
   `CDL-PROV-###` to the published IDs.
6. Run `make check`.

**Step 2 failed loudly the first time, exactly as predicted** — all three
published rulesets were refused at load with `SchematronUnsupportedError`. That
failure is correct: it is the engine refusing to run a ruleset it cannot fully
account for, rather than silently dropping the rules it does not understand.

The prediction was right about the behaviour and wrong about the cause.
`sch:include` and abstract patterns are **not** the problem — the preprocessed
distributions ship with both already flattened upstream. The real blockers are
`sch:phase`, `xsl:function` (24 rules in Peppol and 11 in PINT call `u:gln`,
`u:mod11`, `u:slack`, `u:mod97-0208`, which an XPath static context cannot
declare), and the engine's requirement that every assertion carry `cdl:*`
attributes — which would mean hand-authoring `failure_class` and
`business_term` for **1,442 published rules**, an act of tax-rule
interpretation that §4.4 forbids and that this directory is 🔒 to prevent.

> **Corrected 2026-07-31.** This figure previously read `1,301`, which
> reconciles with no measurable combination of the vendored files and
> understated the true distinct count by ~140 — erring in the direction that
> makes the blocked work look *smaller* than it is. Measured by XML parse:
>
> | | |
> |---|---|
> | distinct published rule IDs, union across all profiles | **1442** |
> | `en16931` 979 + `pint-ae` 303 + peppol-specific 159 | 1441 |
> | naive sum of every published `.sch` file | 2420 |
>
> EN 16931 is vendored **twice** — `en16931/published/EN16931-UBL-validation-preprocessed.sch`
> and `peppol-bis-3.0/published/CEN-EN16931-UBL.sch` both carry 979 assertions
> and share 978 rule IDs, differing by exactly one each way (`UBL-SR-56` in the
> former, `BR-CO-25` in the latter). That is the 1442/1441 gap, and it is why a
> denominator that sums across profile directories double-counts ~979
> assertions. Do not re-derive this figure by summing files.

**The required change is a diff, not a patch: `ENGINE-SVRL-MIGRATION.md`.**
Steps 2–6 stay blocked behind it. Do not work around it by annotating published
rules with `cdl:` attributes.

**Order matters on steps 3 and 4.** The version string follows the ruleset; it
never leads it. Writing `1.3.16` into `specs.json` while the engine still
executes the 35 `CDL-PROV-*` rules below would open the provisional gate over a
validator that is not running the ruleset it claims — a wrong answer of exactly
the kind §4.1 calls company-ending.

## Rule index

`CDL-PROV-001` … `CDL-PROV-026` — `en16931/EN16931-UBL-model.sch`
`CDL-PROV-040` … `CDL-PROV-045` — `pint-ae/PINT-AE.sch`
`CDL-PROV-060` … `CDL-PROV-062` — `peppol-bis-3.0/PEPPOL-BIS-3.0.sch`

Two of these have a known published counterpart, named in architecture.md
Part I §3.3. Recorded here so the mapping is not lost:

| Provisional | Published counterpart | Source |
|---|---|---|
| `CDL-PROV-041` (BT-48 absent or empty) | `PINT-AE-R041` | architecture.md §3.3 |
| `CDL-PROV-042` (BT-48 present, wrong shape) | `BR-CO-26` | architecture.md §3.3 |

No other mapping is known. Do not guess the rest.

## Known defects in the vendored published rulesets

Recorded 2026-07-31. Each entry was derived from the `@context` / `@test` bytes
in this directory and quotes them, so every claim re-verifies without trusting
this file. These are defects in the **published upstream artefacts**, not in our
code — they are recorded because an inert rule is indistinguishable from a
satisfied one in a validation report, and we must not later mistake one for the
other.

**The numbering has gaps.** Defects 2, 4, 5 and 7 were identified in an earlier
review whose written record was lost before it reached this repository. Their
subjects are not recoverable from the tree, and inventing entries to close the
numbering would be exactly the fabrication this record exists to prevent. The
slots stay empty until the originals are re-supplied or re-derived.

### Defect 1 — `ibr-191-ae`: wrong quantifier COUNT, guard cannot open

`pint-ae/published/trn-invoice/PINT-jurisdiction-aligned-rules.sch` (and its
byte-identical `trn-creditnote` copy).

    ibr-191-ae guard:  '^[01]1[01]{7}$'    -> requires 9 characters

Every other `ProfileExecutionID` guard in the file matches exactly **8**, which
is the width of a BTAE-02 transaction type code:

| regex | rules | width |
|---|---|---|
| `^[01]{8}$` | `ibr-154-ae` | 8 |
| `^[01]{5}1[01]{2}$` | `ibr-137-ae`, `ibr-176-ae` | 8 |
| `^[01]{7}1$` | `ibr-135-ae`, `ibr-152-ae` | 8 |
| `^[01]{3}1[01]{4}$` | `ibr-138-ae` | 8 |
| `^1[01]{7}$` | `ibr-007-ae` | 8 |
| `^[01]{6}1[01]$` | `ibr-142-ae` | 8 |
| `^[01]1[01]{6}$` | `ibr-127-ae` | 8 |
| `^[01]{2}1[01]{5}$` | `ibr-116-ae` | 8 |

`ibr-127-ae` is the same shape with the correct count. `ibr-191-ae` carries
`{7}` where the family requires `{6}`, so its guard demands a 9-character code
that cannot occur. **The rule is inert.**

### Defect 3 — `ibr-192-ae`: the profiles AGREE on payment means

**Supersedes any wording stating or implying that EN 16931 and PINT AE disagree
on payment means.** They do not. This correction matters beyond tidiness: a
record asserting that two published standards disagree, when they do not, is a
false claim about both of them, and `corpus.validation_event` is append-only.

Both rules carry `@context` `cac:PaymentMeans`:

    BR-61      en16931/published/EN16931-UBL-validation-preprocessed.sch
      @test: (exists(cac:PayeeFinancialAccount/cbc:ID) and
              ((normalize-space(cbc:PaymentMeansCode) = '30') or
               (normalize-space(cbc:PaymentMeansCode) = '58'))) or
             ((normalize-space(cbc:PaymentMeansCode) != '30') and
              (normalize-space(cbc:PaymentMeansCode) != '58'))

    ibr-192-ae pint-ae/published/trn-invoice/PINT-jurisdiction-aligned-rules.sch
      @test: not(cbc:PaymentMeansTypeCode = "30") or
             cac:PayeeFinancialAccount/cbc:ID

Both encode the same requirement — where payment means is credit transfer
(code 30), the payment account identifier must be present. `ibr-192-ae` **is**
the BR-61 analogue, independently authored.

It is nonetheless inert, for a purely syntactic reason: it tests
`cbc:PaymentMeansTypeCode`, and the UBL 2.1 element is `cbc:PaymentMeansCode`.
Element census across every `.sch` in this directory:

| element | occurrences |
|---|---|
| `cbc:PaymentMeansCode` | 123 |
| `cbc:PaymentMeansTypeCode` | 2 — *both are `ibr-192-ae`* (invoice + creditnote) |

`cbc:PaymentMeansTypeCode` never appears in a UBL 2.1 document, so
`not(… = "30")` is unconditionally true and the assertion can never fail.
**Only EN 16931's BR-61 executes.** The rule is not inert because of a
difference of interpretation between the two standards; it is inert because of
a wrong element name in one of them.

### Defect 6 — `ibr-177-ae`: quantifier DELETION

Distinct from Defect 1, and the distinction is the point: Defect 1 is a
quantifier with the wrong *count*; this is a quantifier whose *braces are gone*.
Different edits, different signatures, and they re-verify separately.

    ibr-177-ae guard:   '^[01]51[01]2$'
    sibling (correct):  '^[01]{5}1[01]{2}$'   ibr-137-ae, ibr-176-ae

Delete the four brace characters from the sibling and you get `ibr-177-ae`'s
guard exactly, character for character:

    [01]{5}1[01]{2}   --remove { }-->   [01]51[01]2

With the braces gone `{5}` is no longer a quantifier: `5` and `2` become
literal characters, and the guard matches a 5-character string such as `05102`
against an 8-position code. **It never opens; the rule is inert.**

    @test: not(matches((ancestor::*[local-name()='Invoice' or
           local-name()='CreditNote'][1]/cbc:ProfileExecutionID)[1],
           '^[01]51[01]2$')) or exists(cac:PartyTaxScheme/cbc:CompanyID)
           or exists(cac:PartyIdentification/cbc:ID)

    text:  [ibr-177-ae]-Either Seller tax registration identifier (IBT-032) or
           Seller VAT identifier (IBT-031) MUST be provided

### Defect 8 — `ibr-152-ae`: promises a country check it does not perform

Same class as Defect 7 — the stated condition and the executable condition
diverge. `pint-ae/published/trn-invoice/PINT-jurisdiction-aligned-rules.sch`,
`@context` `/ubl:Invoice | /cn:CreditNote`.

    text:  [ibr-152-ae]-In Delivery Information (IBG-13), Deliver to address
           line 1 (IBT-075), deliver to city (IBT-077), deliver to country
           subdivision (IBT-079) MUST be there, in case the Invoice transaction
           type code [BTAE-02] is XXXXXXX1 (Exports) and the deliver to country
           code [IBT-080] should not be 'AE'.

    @test: not(matches(cbc:ProfileExecutionID, "^[01]{7}1$")) or
           (cac:Delivery/cac:DeliveryLocation/cac:Address/cbc:StreetName and
            cac:Delivery/cac:DeliveryLocation/cac:Address/cbc:CityName and
            cac:Delivery/cac:DeliveryLocation/cac:Address/cbc:CountrySubentity)

The assert text promises a check on the deliver-to country code IBT-080
("should not be 'AE'"). The `@test` contains no reference to a country at all —
no `cac:Country`, no `cbc:IdentificationCode`, no comparison against `'AE'`. It
tests presence of `StreetName`, `CityName` and `CountrySubentity`, and nothing
else. An export invoice delivering to an AE address satisfies this rule so long
as the three address components are present.

Unlike Defects 1 and 6 the guard here is well-formed (`^[01]{7}1$`, 8
characters, consistent with the family), so this rule **does execute** — it
simply executes something narrower than it claims.

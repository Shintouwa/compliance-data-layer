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

1. Obtain the published Schematron for each profile from its primary source.
2. Drop it in beside these files and update `schematron` in the registry entry.
3. Replace `RESOLVE_IN_WEEK_1` with the real version string.
4. Update `packages/config/specs.json`.
5. Rewrite the affected `tests/corpus/**/*.expected.json` rule IDs from
   `CDL-PROV-###` to the published IDs.
6. Run `make check`.

**Step 2 will fail loudly the first time**, with `SchematronUnsupportedError`.
Published rulesets use `sch:include`, abstract patterns and `sch:phase`, none of
which `engine.py` implements. That failure is correct and expected — it is the
engine refusing to run a ruleset it cannot fully account for, rather than
silently dropping the rules it does not understand. Extending the engine is the
task; making it tolerant is not.

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

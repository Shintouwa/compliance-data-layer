# 🔒 `engine.py` — required change to run the published rulesets

**Status: DIFF ONLY. Nothing in `engine.py` has been modified.**

CLAUDE.md §4.3 and §4.7(4) require a diff-and-stop for `engine.py`. This is that
diff. It is a design-level change, not a patch, because the published rulesets
do not fail against one construct — they fail against the engine's whole
evaluation model.

---

## 1. What was measured

All three published rulesets were vendored (see `PROVENANCE.md`) and fed to the
current `compile_ruleset()`. Every one was refused, at load time, as designed:

| Profile | File | Result |
|---|---|---|
| `en16931` | `EN16931-UBL-validation-preprocessed.sch` | `SchematronUnsupportedError: unsupported construct sch:phase` |
| `pint-ae` | `PINT-UBL-validation-preprocessed.sch` | `SchematronUnsupportedError: unsupported construct sch:phase` |
| `peppol-bis-3.0` | `PEPPOL-EN16931-UBL.sch` | `SchematronUnsupportedError: PEPPOL-EN16931-R008 has no cdl:expected-description` |

Scale, for context — the provisional ruleset the engine runs today has **35**
rules:

| File | `assert`/`report` | `xsl:function` | `let` | `phase` | `include` |
|---|---|---|---|---|---|
| `EN16931-UBL-validation-preprocessed.sch` | **979** | 0 | 0 | 2 | 0 |
| `PEPPOL-EN16931-UBL.sch` | **151** | 13 | 48 | 0 | 0 |
| `PINT-UBL-validation-preprocessed.sch` | **171** | 11 | 0 | 2 | 0 |

`sch:include` is **not** a blocker: the preprocessed distributions ship with
includes and abstract patterns already flattened, which is why they were the
files chosen. Flattening by hand, the other option offered, is therefore
unnecessary — it is already done upstream, by the standards body's own build.

## 2. Three defects, only one of which is small

**(a) `sch:phase` — small.** Two phases each in EN 16931 and PINT
(`EN16931model_phase`, `codelist_phase`). Tractable inside the current model:
honour `@defaultPhase`, resolve `sch:active/@pattern`, run the selected
patterns. Perhaps 60 lines. **This one alone is a genuine patch.**

**(b) `xsl:function` — fatal to the current model.** PEPPOL defines 13 and PINT
11 user-defined XSLT functions (`u:gln`, `u:mod11`, `u:slack`, `u:mod97-0208`,
`u:checkCodiceIPA`, …), called from 24 and 11 `test=` expressions respectively.
These implement checksum and tolerance arithmetic — `u:slack` is what makes EN
16931 rounding rules work at all.

The engine evaluates each `test=` through SaxonC's **`PyXPathProcessor`**. An
XPath static context cannot carry user-defined `xsl:function` declarations;
those exist only in an XSLT stylesheet. There is no flag, no registration call,
and no amount of `let` substitution that fixes this. Any rule calling `u:*`
would raise at evaluation. **Evaluating published Schematron through an XPath
processor is the wrong pipeline**, and this is where that stops being an
approximation and starts being a defect.

**(c) The `cdl:` attribute requirement — fatal at this scale, and wrong in
principle.** The engine requires `cdl:expected-description`, `cdl:business-term`,
`cdl:failure-class` and `cdl:value-xpath` on every assertion, because the
redacted `message` is templated from them (Part I §2.9 layer 2). Published
rulesets carry none of these and never will.

Supplying them means hand-authoring four attributes for **1,301 rules**. That is
not merely laborious — deciding that `BR-CO-10` is an `arithmetic_mismatch`
rather than a `rounding` defect is rule interpretation, which CLAUDE.md §4.4
forbids an agent from doing and which `specs/**` is 🔒 to prevent. Editing 1,301
rules to make them loadable would be the largest unreviewed act of tax-rule
interpretation in the codebase.

## 3. The change: evaluate SVRL, stop interpreting Schematron

Schematron's own execution model is a two-stage XSLT compile-then-transform that
emits **SVRL**. All three upstreams ship the compiled stylesheet already, and
they are vendored:

```
en16931/published/EN16931-UBL-validation.xslt
peppol-bis-3.0/published/stylesheet-ubl.xslt
pint-ae/published/trn-invoice/PINT-UBL-validation-preprocessed.xslt
pint-ae/published/trn-invoice/PINT-jurisdiction-aligned-rules.xslt
```

Running these solves (a), (b) and (c) at once: Saxon executes `xsl:function`
natively because it is a stylesheet, phases are already resolved by the
compiler, and SVRL carries rule identity and message text without any `cdl:`
annotation.

### Redaction — the question that decides whether this is allowed at all

An SVRL pipeline is only acceptable if `svrl:text` cannot carry a client value.
Measured across all three rulesets:

```
<value-of> occurrences inside assertion messages:  0 / 0 / 0
```

Every published message is **static text** — `[BR-52]-Each Additional supporting
document (BG-24) shall contain a Supporting document reference (BT-122).` No
interpolation, so no leak path, and the §2.9 guarantee survives. **This must be
re-asserted in CI, not assumed:** a future ruleset release that adds a
`<value-of>` would silently start emitting raw values into
`client_data.finding.message`. A load-time scan that refuses any assertion
message containing `<value-of>` is a required part of this change, not an
optional extra.

### Field derivation

| `Finding` field | Source | Note |
|---|---|---|
| `rule_id` | `svrl:failed-assert/@id` | Published IDs — `BR-52`, `PEPPOL-EN16931-R008` |
| `message` | `svrl:text` | Static; verified no `<value-of>` |
| `xpath` | `svrl:failed-assert/@location` | Saxon emits an absolute path — satisfies "a rule ID and an XPath" |
| `severity` | `@flag` / `@role` | `fatal` \| `warning`, already the upstream convention |
| `value_shape` | evaluate `@location` against the document, then `derive_value_shape()` | **`redaction.py` is unchanged and still the only producer of shapes** |
| `business_term` | regex `BT-\d+` / `BG-\d+` over `svrl:text` | Deterministic extraction, not inference. `None` when absent or ambiguous — never a guess |
| `failure_class` | **`unclassified`** | See below |

`failure_class` cannot be derived from SVRL. CLAUDE.md §4.4 already sanctions the
fallback — classification "falls back to `unclassified`. Never guesses." The
honest path is `unclassified` for all 1,301 rules on day one, plus a small
human-authored `failure_class` map in `specs/` that is filled in as rules are
actually seen in client work, each entry reviewed. A finding with a rule ID, an
XPath and `unclassified` is still fully actionable; a finding with a fabricated
`failure_class` is a wrong answer wearing a confident label.

### Shape of the change

- `compile_ruleset()` → loads a `.xslt`, hashes it (plus the `.sch` it was built
  from) for `ruleset_hash`. The reproducibility guarantee is unchanged.
- `SchematronEngine.validate()` → `PyXslt30Processor.transform_to_string()`,
  then parse SVRL with lxml.
- `_evaluate_rule`, `_substitute_lets`, `_context_to_expression`,
  `_compile_assertion` → **deleted**. Roughly 300 of 729 lines go.
- The dedicated Saxon daemon thread, `shutdown()` and the isolate discipline →
  **kept exactly as-is.** That constraint is a property of SaxonC, not of the
  evaluation model, and it was expensive to find.
- `_UNSUPPORTED_ELEMENTS` → **kept**, applied to the source `.sch` as a
  provenance check, plus the new `<value-of>` refusal above.

## 4. Blast radius — why this is not a quiet refactor

The corpus is keyed on `CDL-PROV-*` rule IDs. Published IDs are different
strings, so **all 60 expectation files change** — every `fired_rules`,
`must_not_fire`, `failure_classes` and `business_terms` entry.

`tests/corpus/**/*.expected.json` is 🔒 for exactly this reason, and CLAUDE.md
§4.2 forbids weakening a corpus assertion. There is one specific trap here:
re-deriving the expectations by running the new engine and recording whatever it
emits would make all 60 cases pass instantly and assert **nothing** — the corpus
would encode the engine's behaviour rather than the specification's, and its
entire purpose inverts. The expectations must be re-authored against the
published rule text, one case at a time, by a human.

That is the real cost of this migration, and it is larger than the engine work.

## 5. Recommended sequence

1. Resolve the PINT AE version and provenance (`PROVENANCE.md`) — it gates the
   only profile with a paying jurisdiction behind it.
2. Land the SVRL engine behind the existing provisional gate, with `en16931`
   only. It has 979 rules, a real version, and no `xsl:function`, so it isolates
   the pipeline change from the function problem.
3. Re-author the 20 `en16931` corpus cases against published rule IDs. Confirm
   the corpus still fails when it should — negative-control it, as in M0.
4. Add `peppol-bis-3.0`, which introduces `xsl:function`.
5. Add `pint-ae` last, once (1) is answered.
6. Only then flip `RESOLVE_IN_WEEK_1` in `packages/config/specs.json`, per
   profile, as each one actually runs its published ruleset.

**Step 6 is last for a reason.** The sentinel is the gate that stops
`/validate` reporting a conformance verdict against rules we cannot stand
behind. Writing `1.3.16` into `specs.json` while the engine still executes 35
agent-authored `CDL-PROV-*` rules would open that gate over a validator that is
not running the ruleset it now claims — the precise failure CLAUDE.md §4.1 calls
company-ending. The version string must follow the ruleset, never lead it.

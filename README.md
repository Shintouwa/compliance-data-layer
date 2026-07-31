# Compliance Data Layer — Validator

A **deterministic, SVRL-based e-invoicing validation engine** for UAE **PINT AE**
and **EN 16931**.

Given an electronic invoice, it answers one question — *does this document
conform to the profile it claims?* — and it answers with a **rule ID and an
XPath**, never with a probability and never with a model's opinion.

---

## Design premise

> A wrong answer is worse than a crash.

A crash retries. A false *pass* tells someone their invoices will clear when
they will not. Every design decision below follows from that asymmetry.

| Principle | How it is enforced |
|---|---|
| **Schematron decides, nothing else** | Verdicts come from executing a Schematron ruleset and reading the SVRL output. There is no heuristic path and no model in the verdict path. |
| **Reproducible verdicts** | Every result carries a `ruleset_hash` — the SHA-256 of every `.sch` file *and* every code list the profile declares. A result can be replayed against the exact bytes that produced it. |
| **Unresolved means refused** | A profile whose spec version is still the `RESOLVE_IN_WEEK_1` sentinel is **refused** at `/validate`. Guessing a version is treated as a defect, not a default. |
| **No raw values escape** | Findings reference a derived `value_shape`, never the client's value. Redaction happens inside the sidecar, before serialisation. |
| **Loud failure over silent success** | A cross-check that cannot run *fails*. Reporting agreement with a reference implementation that was never invoked is the worst available outcome. |

---

## Status

This repository is at **M0**. It is honest about what that means:

- The engine executes **provisional, in-repo rulesets** that emit `CDL-PROV-*`
  rule IDs. The published EN 16931 and Peppol Schematron distributions are
  vendored under `apps/validator/src/validator/specs/*/published/` but are **not
  yet wired in** — see `specs/ENGINE-SVRL-MIGRATION.md`.
- Consequently **every profile still carries the `RESOLVE_IN_WEEK_1` sentinel**
  and `/validate` refuses to return a conformance verdict for it, unless
  `CDL_ALLOW_PROVISIONAL_RULESET=1` is set (only the corpus runner and the test
  suite set it).
- The KoSIT cross-check is **deliberately not green**. It is gated off with an
  explicit CI warning rather than being allowed to pass vacuously.

| Profile | Jurisdiction | State |
|---|---|---|
| `en16931` | EU | Provisional ruleset; version unresolved |
| `pint-ae` | AE | Provisional ruleset; version unresolved, **no verified upstream provenance** (`specs/PROVENANCE.md`) |
| `peppol-bis-3.0` | EU | **Quarantined** — no SVRL-emitting stylesheet obtained |

Syntax support: **UBL 2.1** is parsed. **CII D16B** is a stub that raises
`NotImplementedError` — by design, so it cannot silently under-report.

---

## Getting started

Requires **Node ≥ 22**, **pnpm 10**, **Python 3.12**, and a **JDK 21** for the
CI cross-check only.

```bash
make setup      # Python 3.12 venv + node deps
make check      # everything CI runs, in CI order
```

### `make check` — the verification protocol

`make check` is the single gate. It runs, in order:

```
pnpm tsc --noEmit                     # TypeScript, no implicit any
pnpm eslint . --max-warnings 0        # zero warnings, not "few"
mypy --strict src/                    # sidecar, strict mode
pnpm vitest run && pytest -q          # unit tests
python -m validator.cli.corpus_runner # GOLDEN CORPUS  <- the important one
./scripts/contract-check.sh           # OpenAPI/TS contract drift
```

There is no "passes except for". It is green or the work is not done.

| Target | Purpose |
|---|---|
| `make check` | Everything CI runs, in CI order |
| `make test` | Unit tests only |
| `make corpus` | Golden File Corpus only |
| `make contract` | OpenAPI ⇄ TypeScript drift check |
| `make contract-update` | Regenerate both contract artefacts after an API change |
| `make setup` | One-time local toolchain |

### CLI

```bash
python -m validator.cli.main validate invoice.xml --profile pint-ae --syntax UBL-2.1
python -m validator.cli.corpus_runner ../../tests/corpus
```

---

## Architecture

**Two deployables, and only ever two.**

```
                    ┌──────────────────────────────┐
                    │  web app  (Next.js)          │  deployable 1
                    │  imports types from          │
                    │  @repo/contracts — never     │
                    │  hand-writes a wire shape    │
                    └──────────────┬───────────────┘
                                   │  HTTP, OpenAPI-typed
                    ┌──────────────▼───────────────┐
                    │  validator sidecar           │  deployable 2
                    │  FastAPI + saxonche          │
                    │  STATELESS — no DB, no FS    │
                    │  writes outside /tmp         │
                    └──────────────┬───────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              ▼                    ▼                    ▼
        parsers/            engine.py             redaction.py
        UBL 2.1             Schematron → SVRL     raw value → value_shape
        CII (stub)          + ruleset_hash        (nothing raw gets past here)
```

### Repository layout

```
apps/validator/            The sidecar. FastAPI + saxonche, stateless.
  src/validator/
    engine.py              Schematron execution, SVRL interpretation
    redaction.py           Derives value_shape. Raw values stop here.
    parsers/               UBL 2.1; CII D16B stubbed
    specs/                 Rulesets, registry, provenance
      */published/         Third-party artefacts, vendored VERBATIM
    codelists/             ISO 3166, ISO 4217, UNECE Rec 20, UNTDID 5305
packages/
  config/specs.json        Spec versions + ruleset hashes
  contracts/               Generated OpenAPI + TS client — committed, drift-checked
scripts/                   CI gates: contract check, KoSIT cross-check
tests/corpus/              The Golden File Corpus
```

### The Golden File Corpus

`tests/corpus/` is **the specification**, not a test suite. Each case is an
invoice plus an `.expected.json` stating precisely which rules must fire.

If a corpus test fails after a change, **the change is wrong**. Editing an
expectation to make a test pass inverts the purpose of the corpus, and
`*.expected.json` files are treated as human-owned for exactly that reason.

Every rule or defect found in real work gets a corpus fixture the same week.

`REACHABILITY.txt` records what the corpus actually exercises — including
which rules have a context that no corpus document selects. A rule that never
ran is reported as *not run*, never folded into a pass.

### Line endings are conformance-critical

`ruleset_hash` is a hash of file *bytes*. A ruleset checked out as CRLF on
Windows and LF on Linux produces two different hashes and two irreproducible
results. `.gitattributes` normalises our files to LF everywhere and marks
vendored `published/` artefacts `-text` so they are never rewritten — their
defensibility rests on being byte-for-byte what the standards body issued.

---

## Where AI is and is not used

AI writes the prose **around** a finding. Schematron **produces** the finding.

| Allowed | Not allowed |
|---|---|
| Report narrative from structured findings (templated; never invents a finding) | Deciding whether an invoice is compliant |
| Suggesting ERP field → business term mappings (human-confirmed before first use) | Interpreting a tax rule — never, not as a fallback |
| Classifying free-text failure reasons, with a confidence floor and an `unclassified` fallback | Producing a readiness or assurance score (deterministic formulas only) |

If you ask why something failed, the answer is a rule ID and an XPath — never
"the model determined".

**This software does not provide tax advice.**

---

## Licensing

Licensed under the **GNU Affero General Public License v3.0**. See
[`LICENSE`](LICENSE).

AGPL-3.0 was chosen deliberately over a permissive licence: §13 extends the
copyleft obligation to **network use**, so operating a modified version as a
hosted service triggers the same obligation to publish corresponding source.

### Third-party components — not covered by the above

Everything under `apps/validator/src/validator/specs/*/published/` is a
third-party conformance artefact, **vendored verbatim and unmodified**, under
its own upstream licence:

| Artefact | Upstream | Licence |
|---|---|---|
| EN 16931 Schematron / XSLT | `ConnectingEurope/eInvoicing-EN16931` | **EUPL-1.2** (`published/LICENSE.txt`) |
| Peppol BIS 3.0 Schematron | `OpenPEPPOL/peppol-bis-invoice-3` | Upstream OpenPEPPOL terms |
| Code lists (ISO 3166, ISO 4217, UNECE Rec 20, UNTDID 5305) | Respective standards bodies | Respective terms |

Provenance — upstream commit, tag and retrieval date for each — is recorded in
`apps/validator/src/validator/specs/PROVENANCE.md`. Where provenance could not
be verified, that is stated rather than assumed.

Contributing a fix means contributing a corpus fixture that fails without it.

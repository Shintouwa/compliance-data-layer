# 🔒 `specs/*/published/` — provenance of the vendored conformance artefacts

CLAUDE.md §4.3 marks this directory HUMAN-OWNED.

Everything under a `published/` sub-directory is a **third-party conformance
artefact, vendored verbatim**. Nothing here was authored by an agent and nothing
here has been edited — byte-for-byte copies of the files named below.

**Nothing under `published/` is wired into `specs/registry/*.json` yet.** The
registry still points at the provisional `CDL-PROV-*` rulesets. See
`ENGINE-SVRL-MIGRATION.md` for why, and what has to happen first. Because the
registry does not declare these files, they do **not** contribute to any
`ruleset_hash`; vendoring them changed no hash and no validation result.

## Why these are in the repo before they are usable

They are the primary sources. Keeping them beside the code they will replace
means the Week-1 integration is reproducible from the repository alone, and a
future reader can diff what we shipped against what the standards body
published. A downloads folder on one laptop is not provenance.

## Sources — verified 2026-07-29

| Profile | Upstream | Commit | Tag / version |
|---|---|---|---|
| `en16931` | `github.com/ConnectingEurope/eInvoicing-EN16931` | `b6c9e06a59812fb1a83585da40923b3678a649ad` (2026-04-14) | **`validation-1.3.16`** |
| `peppol-bis-3.0` | `github.com/OpenPEPPOL/peppol-bis-invoice-3` | `261c458474e27d58a25be629cccac28883171c92` (2026-03-16) | **`v3.0.20`** |
| `pint-ae` | *unknown* | *none* | **⚠️ UNRESOLVED — see below** |
| KoSIT validator | `github.com/itplr-kosit/validator` | `86d9ddfa2b35147888e647382332727069f8d303` (2026-02-17) | `v1.6.2-2-g86d9ddf` → release **1.6.2** |

The `en16931` and `peppol-bis-3.0` versions are corroborated twice: by the git
tag, and by a version comment inside the file itself
(`Schematron version 1.3.16 - Last update: 2026-04-10`;
`Last update: 2025 November release 3.0.20.`).

## ⚠️ PINT AE has no verifiable provenance

The source directory was `pint-ae-resources-dev` in the operator-supplied
staging folder (see *Where the staging folder went* below). It

- is **not a git checkout** — no `.git`, so no commit, no tag, no origin URL;
- carries **no version string** in any `.sch`, and no README, CHANGELOG or
  manifest of any kind;
- is named **`-dev`**, which reads as a development branch rather than a release.

CLAUDE.md §4.7(1) is explicit: a missing external version identifier is a
stop-and-ask, and an invented one is forbidden. So `pint-ae` keeps the
`RESOLVE_IN_WEEK_1` sentinel and stays refused at `/validate`.

This is the profile that matters most — AE is the jurisdiction being sold into —
which is exactly why it must not be the one we guess at. A PINT AE ruleset of
unknown vintage, reported to a client as authoritative, is the company-ending
wrong answer described in CLAUDE.md §4.1.

**To resolve:** obtain the PINT AE package from the OpenPeppol member area or
the UAE Ministry of Finance, with a release identifier attached, and record the
identifier and its retrieval date here.

## Where the staging folder went

The artefacts arrived in a `resources/` folder at the repo root, containing
`eInvoicing-EN16931`, `peppol-bis-invoice-3`, `pint-ae-resources-dev` and the
KoSIT `validator` source tree — 91 MB, untracked.

It was **moved out of the working tree**, not deleted, to
`../cdl-resources-staging` (sibling of the repo root). Two reasons:

- The KoSIT tree ships a bundled Docusaurus UI, ~200 minified `.js` files that
  no `tsconfig` covers. `pnpm eslint . --max-warnings 0` walked into them and
  `make check` went red with 203 parse errors. Adding an ignore rule for a
  folder that is meant to be temporary is the wrong repair.
- Deleting it was the instruction, but the integration it feeds is **not
  finished** — only `en16931` and `peppol-bis-3.0` are resolved, `pint-ae` is
  not, and no ruleset is wired in. Deleting the inputs to an unfinished
  integration destroys the ability to finish it.

Delete it once `pint-ae` provenance is resolved and the SVRL engine has landed,
i.e. when `published/` is actually wired into the registry.

## The two ISO 4217 lists disagree

Vendored `pint-ae/published/codelist/ISO4217.gc` declares `<gc:Version>2015`.
The list embedded in `en16931/published/EN16931-UBL-codes.sch` (release 1.3.16)
is current and includes codes the 2015 file lacks — `SLE`, `XCG`, `ZWG`, `VED`,
`CNH`, `UYW` among them.

Both are normative **for their own profile**. They are not reconcilable into one
global list, and `codelists/` currently holds exactly one list per list-ID,
shared across profiles. Completing them therefore needs the code list store to
become profile-scoped first. Merging the two, or picking the longer, would be a
conformance decision taken for convenience — an AE invoice in `SLE` must fail
under PINT AE 2015 and pass under EN 16931 1.3.16, and only a per-profile list
can express that.

Left as-is and reported rather than guessed.

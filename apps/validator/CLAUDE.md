# `apps/validator` — agent directives

Root `/CLAUDE.md` governs. This file adds what is specific to the sidecar.

## What this deployable is

Deployable 2 of 2. FastAPI + saxonche, on Heroku. **Stateless**: no database, no
filesystem writes outside `/tmp`, horizontally scalable by construction.

It is the only place in the system that ever holds a raw client invoice value,
and the only place that decides whether a document conforms.

## The two rules that matter most here

**1. Schematron decides. Nothing else does.**

CLAUDE.md §4.4 is absolute: no model is in the compliance decision path. That
also binds whoever writes a ruleset — do not encode a tax judgement in a
`.sch` file and call it structural. If a client asks why something failed, the
answer is a rule ID and an XPath.

**2. A raw value never crosses the process boundary.**

`redaction.py` derives `value_shape` before serialisation, and `message` is
templated *from the shape*. The message string is the leak path people forget:
`f"Invalid TRN: {value}"` puts a raw TRN into `client_data.finding.message`, and
from there into the UI and the logs, while `value_shape` still looks perfect.

## 🔒 Human-owned files in this package

| Path | Why |
|---|---|
| `Dockerfile` | saxonche native binaries; exact base image digest |
| `pyproject.toml` — the `saxonche` pin | Same. Exact version. |
| `src/validator/redaction.py` | Produces `value_shape`; the corpus's legal defensibility |
| `src/validator/engine.py` | Schematron execution and rule interpretation |
| `src/validator/specs/**` | Jurisdiction rule interpretation, scenario maps, identifier rules |

Read them freely. To change one: produce a diff, explain why, stop.

## Things about this package that will surprise you

**Every profile is provisional.** Every `version` in `specs/registry/*.json` is
the literal `RESOLVE_IN_WEEK_1` sentinel, and every rule ID is `CDL-PROV-###`.
`/validate` refuses these profiles unless `CDL_ALLOW_PROVISIONAL_RULESET=1`.
Only the corpus runner and the test suite set it. See `src/validator/specs/RULES.md`.

**The engine is an interpreter, not the ISO skeleton pipeline.** It implements a
subset of Schematron and raises `SchematronUnsupportedError` on anything else,
at load time. Dropping a published Schematron in will fail loudly the first time
— that is correct. Extending the engine is the task; making it tolerant is not.

**Saxon has thread affinity.** The GraalVM isolate must be created, used and
finalised on one thread, and violating that aborts the process rather than
raising. `SchematronEngine` owns a dedicated daemon thread for exactly this.
Do not "simplify" it to a `ThreadPoolExecutor` — that was tried, and its
threads are joined before `atexit`, so the isolate is never released properly.

**Only one code list may produce a failure.** `UNTDID5305` is marked
`complete`; everything else is `partial`. A partial list can confirm membership
but cannot deny it, and `codelists/__init__.py` refuses at ruleset-load time to
let a partial list back a fail-severity rule. Do not mark a list complete to
make a rule work.

**CII is a stub that raises.** Deliberate, per Part II · M0. Returning an empty
parse would report every CII document as conformant without examining it.

## Verifying

```bash
make check      # from the repo root: tsc, eslint, mypy --strict, pytest,
                # vitest, GOLDEN CORPUS, contract check
make corpus     # the corpus alone
```

A corpus failure after your change means **your change is wrong**. The corpus is
the specification. Fix the code, not the expectation.

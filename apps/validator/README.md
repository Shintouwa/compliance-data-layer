# `apps/validator` — the validator sidecar

Deployable 2 of 2. FastAPI + saxonche. Stateless: no database, no filesystem
writes outside `/tmp`. Horizontally scalable by construction.

See `architecture.md` Part II · M0 for scope and Part III §5 for the API contract.

## Local setup

```bash
make setup      # venv (Python 3.12) + node deps
make check      # everything CI runs, in CI order
make corpus     # Golden File Corpus only
```

## CLI

```bash
python -m validator.cli.main validate invoice.xml --profile pint-ae --syntax UBL-2.1
python -m validator.cli.corpus_runner ../../tests/corpus
```

## The rule that governs this package

A raw commercial value never crosses the process boundary. `redaction.py`
derives `ValueShape` inside the sidecar, before serialisation, and the finding
`message` is templated from the shape — never from the value.

If a raw value ever appears in a response, a log line, or a corpus payload,
that is a Sev-1: halt the pipeline and fix `redaction.py`. Do not weaken the
assertion that caught it.

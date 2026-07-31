#!/usr/bin/env bash
# architecture.md Part I §3.5 — the third coverage guard.
#
# "Asserts that every member of the `JOB` const has a `QUEUES` entry and a
#  registered handler (except `sinkOnly` queues), and that every `deadLetter`
#  target is itself a registered queue."
#
# The assertion is TypeScript, in apps/web/jobs/registry.test.ts, so it
# typechecks against the registry it checks — a shell script grepping for queue
# names would keep passing after a rename. This runs exactly that file, so the
# CI step and `make check` cannot disagree about what the guard says.
#
# Unlike the other two guards this one needs no database, so it always runs.
set -euo pipefail

pnpm vitest run apps/web/jobs/registry.test.ts

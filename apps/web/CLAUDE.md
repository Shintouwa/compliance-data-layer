# `apps/web` — agent directives

Root `/CLAUDE.md` governs. This file adds what is specific to deployable 1.

## What this deployable is

Deployable 1 of 2. Next.js 15 App Router on Vercel, plus the pg-boss workers.
It holds the database, the queue, the UI, and every business rule that is not a
conformance decision. It never decides whether an invoice conforms — that is
the sidecar's job, and it answers with a rule ID and an XPath.

## The four rules that matter most here

**1. `app/` is routes only.**

Parse params, call ONE module function, render. No business logic, no database
queries, no job enqueues written inline. Every cross-module import goes through
`modules/<name>/index.ts`. `architecture.test.ts` enforces both and carries a
self-test proving it can fail — see below.

**2. Every `client_data` access goes inside `withTenantAccess`.**

There is no second way in. It sets `app.tenant_id` transaction-locally and
writes the access-log row in the same transaction, so a read that produces no
log row is impossible. **Use the `ctx.tx` handle it hands you, never the
imported `db`** — `set_config(…, true)` applies to one connection, and the outer
`db` checks out a different one, where RLS quietly returns zero rows.

**3. Every enqueue happens inside the transaction of its domain write.**

`enqueueInTransaction(ctx, JOB.X, payload)`. That is the single reason pg-boss
was chosen over an external queue. Moving one outside its transaction
reintroduces the orphaned-job bug.

**4. A raw client value never leaves `modules/ingestion`.**

`value_shape` only, everywhere else — logs, errors, messages, corpus, UI.
`crypto.ts` is deliberately absent from the ingestion barrel, so `openBlob` is
unreachable from any other module.

## Things about this package that will surprise you

**The module boundary is a vitest test, not eslint.** `eslint-plugin-boundaries`
at v7.1.0 classified none of this repo's files — a probe importing another
module's private file linted clean under both the legacy and the v7 APIs. The
rule lives in `architecture.test.ts` instead, which self-tests before it
asserts. See the note in `/eslint.config.mjs`.

**Thirteen queues have no handler, on purpose.** Part IV §1 declares queue names
for M1 through M7. `plannedFor` in `jobs/registry.ts` marks the ones not yet
built, and `registry.test.ts` asserts in BOTH directions — a `plannedFor` queue
must have NO handler, so adding one without deleting the marker fails the build.

**`corpus.record` throws rather than degrade a row.** A finding naming a rule
absent from `corpus.rule` raises `SpecCatalogueIncomplete`. That is not an
`UnrecoverableError`: the queue retries infinitely by design, so the payload
waits until the spec catalogue is seeded. `corpus` is append-only — a row
written with `rule_id = NULL` can never be repaired.

**An unknown currency yields null amounts, not a guessed exponent.**
`money.ts` holds the in-scope ISO 4217 minor units and refuses everything else.
The document is still ingested and validated; only the money is withheld, with a
`currency_inconsistent` defect saying so.

**Extractors never infer a scenario from a tax rate.** That is a tax
interpretation (§4.4, absolute). A voucher with no scenario evidence is recorded
as `standard` and raises `tax_category_unmapped`.

**Dates are ISO-only in tabular sources.** `03/04/2026` is 3 April in Dubai and
4 March in New York. Accepting it means choosing, and choosing wrong puts an
invoice in the wrong tax period.

## Verifying

```bash
make check      # from the repo root
pnpm vitest run apps/web    # this package alone
```

Nothing here needs a database, a queue or a network to run its tests. If a new
test does, it is testing the wrong thing.

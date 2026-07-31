# `apps/web` — deployable 1 of 2

Next.js 15 App Router on Vercel, plus the pg-boss job runner. It holds the
database, the queue, the UI, and every business rule that is not a conformance
decision. It never decides whether an invoice conforms — that is the sidecar's
job (`apps/validator`), and it answers with a rule ID and an XPath.

Agent directives for this package are in `CLAUDE.md`. Root `/CLAUDE.md` governs.

## Running it

```bash
docker compose up -d postgres        # from the repo root
make migrate                         # schema + roles + RLS + append-only triggers
pnpm --filter @repo/db seed:rules -- --commit   # spec catalogue; see below
make dev                             # web on 3000, validator sidecar on 8080
```

`.env.example` at the repo root lists every variable with what it is for. Copy
it to `.env` and fill it in. Nothing here reads `process.env` directly —
`lib/env.ts` validates each group lazily, so a missing secret fails with the
name of the variable rather than four frames later.

## Auth — Clerk

`middleware.ts` runs `clerkMiddleware()` and nothing else. It establishes the
session; it does **not** decide what is protected. Middleware protection matches
on paths, and path matching can diverge from how Next actually routes a request.
For a system whose failure mode is a cross-tenant leak, "looks correct" is not a
control.

The real gate is three layers, none of them a path pattern:

1. `requireTenantActor()` (`lib/auth.ts`) — Clerk establishes **who**.
2. `app.membership` — establishes **whether they may act for this tenant**.
3. RLS — makes the database return nothing if the first two were wrong.

A Clerk **organisation is the tenant**. A session with no active org has no
tenant to scope to and is refused.

Two notes that will otherwise cost an afternoon:

- **The file is `middleware.ts`, not `proxy.ts`.** Next 16 renames it; this app
  is on Next 15, where `MIDDLEWARE_FILENAME` is literally `'middleware'` and a
  `proxy.ts` is compiled as an ordinary module and never invoked. On the Next 16
  bump the migration is `git mv middleware.ts proxy.ts`, contents unchanged.
- **`<Show when="signed-in">`, not `<SignedIn>`.** `@clerk/nextjs` v7 removed
  the old control components from its exports; `Show` is an async Server
  Component whose `when` also takes `{ role }`, `{ permission }` and predicates.
  What the header renders is chrome. Hiding a link is not a permission.

## The job runner on Vercel

pg-boss workers want a process that outlives a request. Vercel has none, and
§4.6 rules out the usual escapes — no Redis, no second web deployable. So the
workers are driven by a **Vercel Cron Job**:

```
Vercel Cron  ──every minute──▶  GET /api/cron/work  ──▶  jobs/drain.ts
                                (Authorization: Bearer $CRON_SECRET)
```

`apps/web/vercel.json` declares the schedule and is already committed:

```json
{ "crons": [ { "path": "/api/cron/work", "schedule": "* * * * *" } ] }
```

### Configuring it

1. **Vercel project Root Directory must be `apps/web`.** `vercel.json` is read
   from the deployment root; at the repo root it would be ignored and no cron
   would ever fire.
2. **Set `CRON_SECRET`** in Project Settings → Environment Variables, for every
   environment the cron runs in. Vercel sends it as `Authorization: Bearer …`
   automatically. 32 random bytes:
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.
   With it unset the route answers **503 and drains nothing** — an endpoint that
   defaults open would let anyone who guesses the path run the queue.
3. **Vercel Pro.** Minute-granularity crons are a Pro feature, and `lib/env.ts`
   already refuses to boot in production without `VERCEL_PLAN=pro` (§1.9 — a
   Hobby licence violation on a compliance vendor is a reference-destroying
   event, not an infrastructure incident).
4. Optional: `CRON_WORK_BUDGET_MS` (default `10000`) — how long one invocation
   drains for. Keep it well under the route's `maxDuration` (60s).

Verify by hand:

```bash
curl -i -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/work
# {"status":"ok","fetched":3,"completed":3,"failed":0,"leaseHeld":0,
#  "byQueue":{"ingest.receive":2,"ingest.normalise":1}, … }
```

### What the drain does, and what it costs

`jobs/drain.ts` uses `boss.fetch()` and settles each job explicitly — **not**
`boss.work()`, whose polling loop dies with the response and leaves whatever it
had leased sitting `active` until `expireInSeconds` elapses (up to 30 minutes
for `validate.run`). A slice always ends *between* jobs, with headroom reserved
to settle the one in hand.

The tradeoff, stated plainly: latency is bounded by the cron interval rather
than by polling, so a job enqueued just after a slice waits up to a minute.
That is fine for an audit pipeline measured in minutes, and it is the price of
the second deployable this product refuses to add.

Nothing about retry or lease semantics changes — those are queue configuration
in `jobs/registry.ts`, not properties of the runner. `jobs/boot.ts` still holds
the long-lived-process entrypoint for a host that has one; `make dev` can use it.

Jobs remain rows: `SELECT * FROM pgboss.job WHERE state = 'failed'`.

## Seeding the spec catalogue

`corpus.record` refuses to write a `validation_event` naming a rule absent from
`corpus.rule`, and retries infinitely rather than degrade the row — `corpus` is
append-only, so a row written with `rule_id = NULL` can never be repaired. Until
the catalogue is seeded, corpus writes queue up instead of landing.

```bash
pnpm --filter @repo/db seed:rules              # dry run — prints the plan
pnpm --filter @repo/db seed:rules -- --commit  # writes
```

Dry by default, and idempotent (`ON CONFLICT DO NOTHING`), because a wrong row
here is wrong forever.

It seeds the rulesets each profile's registry entry **declares** — today the
provisional `CDL-PROV-*` ones, which are what the sidecar actually executes and
therefore the only ids it can emit. It does **not** seed
`specs/<profile>/published/`: those are not wired in
(`specs/ENGINE-SVRL-MIGRATION.md`), and they carry no `cdl:failure-class`, which
`corpus.rule.failure_class` requires `NOT NULL`. Supplying one for each of the
1,442 published rules would be tax-rule interpretation, which §4.4 forbids. The
script refuses rather than defaults, and starts seeding the published ids
unchanged once the registry points at them.

Current result: **32 rules** — `en16931` 26, `pint-ae` 6. `peppol-bis-3.0` is
quarantined in its registry entry and skipped; its 3 rules seed themselves when
the quarantine lifts.

## Object storage

`modules/ingestion/storage.ts` writes sealed bytes to Cloudflare R2. **With
`R2_ACCOUNT_ID` unset it writes to `./tmp/storage` instead**, so the whole
pipeline runs locally with no bucket and no cloud credentials. `tmp/` is
gitignored.

That fallback **refuses to engage when `NODE_ENV=production`**. A serverless
filesystem is per-invocation: a run would store its raw documents, report
success, and find them gone, with `raw_document.storage_key` pointing at nothing
and `expires_at` promising a 90-day residency the bytes never had.

Either way the bytes are envelope-encrypted first (`sealBlob`, Part V §1.4) —
the local backend is a different destination, not a weaker one.

## Specification identifiers

`cbc:CustomizationID` and `cbc:ProfileID` are published values, and §4.7(1)
forbids inventing an external identifier. `modules/mapping/spec-identifiers.ts`
resolves them for `pint-ae` by quoting the vendored PINT AE Schematron
(`aligned-ibrp-001-ae`, `aligned-ibrp-002-ae`), and
`spec-identifiers.test.ts` re-reads those bytes so a constant cannot drift from
its source silently.

They are derived **per document**: Peppol models a self-billed invoice as a
different business process, so a batch mixing both must not share one pair.

`en16931` and `peppol-bis-3.0` throw `SpecIdentifiersUnresolved` naming why.
`toUbl` still takes them as required inputs and never defaults.

## Verifying

```bash
make check                  # from the repo root — the only gate that counts
pnpm vitest run apps/web    # this package alone
```

Nothing here needs a database, a queue or a network to run its tests. If a new
test does, it is testing the wrong thing.

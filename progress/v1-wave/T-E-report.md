# T-E Report — Hermes Event-Observation Runtime Trigger (team HERMES-WIRE)

Team: T-E (HERMES-WIRE) of the CoreGrid post-R-wave follow-up wave. Base branch:
`cursor/p08-foundation-loop-classification-fe86` (not switched, per mission law).
Mission: R4's recorded remaining work — "wire the runtime trigger". R4 shipped the
full Hermes event→observation library seam but NOTHING in the runtime invoked it;
this mission makes the flow real at exactly one governed consumption point,
fail-closed, with default behavior unchanged.
Report format: AGENTS.md §42. Every claim below is backed by command output run in
this session. Honesty law respected: no fabricated passes; the one live-backend
action was a READ-ONLY probe (zero rows written, verified).

## Implemented

1. **`runHermesEventObservationStep` — the runtime consumption point
   (`frontend/src/lib/hermes/hermes-observation-trigger.server.ts`, new)** — ONE
   observation-poll/step function that a runtime driver invokes to make Hermes
   event observations actually FLOW:
   - backend selection follows the established env-selector convention:
     `HERMES_OBSERVATION_BACKEND` resolved through R4's
     `resolveHermesObservationBackend` (default and fallback "memory"); an
     injected `deps.backend` override is validated the same way. An UNKNOWN
     backend value is a typed `{ ok: false, consumed: "failed", backend:
     "unresolved" }` failure — observable, never a crash, never a silent
     durability degradation;
   - **backend `db`**: builds `createHermesEventObservationSource` on the
     service-role client (injected `deps.client` for tests; otherwise the same
     dynamic `supabaseAdmin` import as `createHermesObservationPort`) and
     consumes PENDING `cg_event` rows tenant-scoped → map → order → dedupe →
     `cg_hermes_observation` through `HermesObservationPortDb`. `cg_event`
     stays READ-ONLY (the outbox state machine `kernel/outbox.ts` keeps
     delivery-state ownership); explicit-delivery arguments are REJECTED in db
     mode (`HERMES_EVENT_TRIGGER_DELIVERY_REJECTION`) — the substrate is the
     single authoritative event source;
   - **backend `memory` (the DEFAULT)**: a typed no-op-with-reason
     (`HERMES_EVENT_TRIGGER_MEMORY_SKIP_REASON`, `{ ok: true, consumed:
     "skipped" }`) — there is no durable event queue to poll in-process, so
     existing default paths behave EXACTLY as before and nothing is touched
     (proven by test: neither the client nor the recorder is reached). Explicit
     in-process deliveries (`input.deliveries`) may still be consumed through
     the in-memory port via the pure R4 adapter — that is the unchanged
     in-memory path, now reachable through the same step;
   - **exactly-once (§10) preserved**: recording stays behind the observation
     port — replay by deterministic digest identity plus the substrate's
     partial unique `(tenant_id, event_ref)` index. The default memory
     recorder is a process-scoped singleton so repeated in-process steps REPLAY
     instead of double-recording (tests inject their own recorder);
   - **fail-closed everywhere**: invalid input (tenant/hermes/now/limit, Zod),
     missing `cg_event` substrate (`HERMES_EVENT_SUBSTRATE_GAP`), missing
     observation substrate (`HERMES_OBSERVATION_SUBSTRATE_GAP`), unavailable
     service-role client, unknown backend, and any unexpected throw all return
     typed `{ ok: false }` failures with the reason. The step NEVER throws,
     NEVER fakes an observation, NEVER writes on failure;
   - **§27 boundary note (documented in the module header)**: this is a
     server-side library seam, NOT an HTTP surface. Anything exposing it over
     HTTP must wrap it in a §27 server function; tenant/identity context must
     come from the server session, never client input. See Remaining Work 1
     for the precise external wiring change (outside this team's file
     ownership — reported, not made).

## Files Changed

Created (all within the declared file ownership):
- `frontend/src/lib/hermes/hermes-observation-trigger.server.ts` — the runtime trigger step
- `tests/unit/hermes/hermes-observation-trigger.test.ts` — 18 wiring tests
- `progress/v1-wave/T-E-report.md` — this report

Not modified (per mission law): `worker-host.ts`, missions files, `scripts/`,
`database/`, `tests/e2e/`, and all other teams' files. Working-tree
modifications to other teams' files pre-existed this session and were left
untouched (`git status --porcelain` shows my two files as the only `??`
additions in scope:
`?? frontend/src/lib/hermes/hermes-observation-trigger.server.ts`,
`?? tests/unit/hermes/hermes-observation-trigger.test.ts`). No git
commit/push performed. A temporary live-probe script
(`tests/unit/hermes/tmp-live-smoke.trigger.ts`) was created, run, and DELETED.

## Architecture Impact

- **The event→observation flow has a real consumer**: the R4 seam is now a
  callable runtime step instead of dead library wiring. Domain ↓ Application ↓
  Policy ↓ Infrastructure preserved: the step is pure orchestration over the
  R4 contracts; the vendor appears only behind the existing `.server.ts`
  adapters and the dynamic service-role import.
- **Default behavior unchanged**: with the default `HERMES_OBSERVATION_BACKEND`
  unset/memory, the step is a typed no-op — no DB access, no recorder calls,
  no new writes anywhere (tested). The db path activates only on explicit
  configuration (a coordinator decision, R4 Remaining Work 1).
- **Ownership boundaries respected**: no event state mutation (outbox keeps
  `cg_event` delivery state), no taxonomy registration, no cycle-runtime
  change (`hermes-cycle.ts` untouched — its owner's contract and its 19
  `tests/unit/hermes-cycle.test.ts` tests remain exactly as they were).
- **One governed surface, two backends**: the same step contract
  (`backend`/`ok`/`consumed`/`reason`/`ingestion`) reports on both backends,
  so a future server-function/cron driver needs no per-backend branching.

## Tests

`npx vitest run tests/unit/hermes` — real output (70 pre-existing + 18 new):

```
 ✓ tests/unit/hermes/hermes-observation-port.test.ts (19 tests) 19ms
 ✓ tests/unit/hermes/hermes-event-source.test.ts (17 tests) 25ms
 ✓ tests/unit/hermes/hermes-observation-substrate-posture.test.ts (15 tests) 4ms
 ✓ tests/unit/hermes/hermes-observation-trigger.test.ts (18 tests) 23ms
 ✓ tests/unit/hermes-cycle.test.ts (19 tests) 52ms

 Test Files  5 passed (5)
      Tests  88 passed (88)
```

The 70 pre-existing hermes tests are untouched and all still pass.

`tests/unit/hermes/hermes-observation-trigger.test.ts` (18) proves:
- **backend selection respected**: unset env → memory typed no-op (and an
  explicit `HERMES_OBSERVATION_BACKEND=memory` behaves identically); a memory
  skip touches NEITHER the injected client NOR the recorder; `db` (via env)
  consumes PENDING `cg_event` rows end-to-end into a fully §12-stamped
  observation row (`source: "event"`, `event_ref`, `created_by` = the governed
  Hermes id, `generated_by_ai: true`, `verified: false`) while `cg_event` gets
  zero writes; unknown env value and an invalid injected override both fail
  the step closed with the typed "not a registered Hermes observation backend"
  reason, no crash;
- **the wiring records observations from event fixtures**: memory mode with
  explicit in-process deliveries records through the in-memory port with the
  §12 stamps the caller cannot claim; duplicate deliveries inside one step
  collapse (3 → 1 recorded, 2 collapsed); other-tenant/no-tenant deliveries
  are excluded (§13); a recorder failure fails the step closed;
- **fails closed on substrate-missing**: `cg_event` absent → typed failure
  carrying the event-substrate gap, ZERO observations, zero inserts;
  observation substrate absent → typed failure carrying
  `HERMES_OBSERVATION_SUBSTRATE_GAP`, zero inserts;
- **no observation is recorded twice for the same event ref**: memory mode —
  a repeated step over the same fixture replays (`recorded: 0`,
  `replayed: 1`, port size stays 1); db mode — a repeated step over the same
  still-pending `cg_event` row replays through the adapter's existing-row
  check with exactly ONE insert into `cg_hermes_observation` across both
  steps (the substrate's partial unique `(tenant_id, event_ref)` index backs
  this; db-mode explicit deliveries are rejected with
  `HERMES_EVENT_TRIGGER_DELIVERY_REJECTION`);
- **input validation**: missing tenant (§13), missing identity, unparseable
  record instant, out-of-bounds limit — all typed rejections before any
  consumption.

Repo typecheck — real output (no errors, exit 0):

```
npx tsc --noEmit   (no output; TSC_EXIT=0)
```

(One real typecheck error was surfaced and fixed during the loop — a test
narrowing on `reason: string | null`; nothing suppressed.)

Lint on both new files — real output:

```
npx eslint frontend/src/lib/hermes/hermes-observation-trigger.server.ts \
  tests/unit/hermes/hermes-observation-trigger.test.ts   (exit 0, no findings)
```

Live READ-ONLY smoke of the db-mode step against the real backend (probe
script run then deleted; `cg_event` held ZERO pending rows so the step could
write nothing) — real output:

```
{
  "backend": "db",
  "ok": true,
  "consumed": "ingested",
  "reason": null,
  "ingestion": { "considered": 0, "recorded": [], "replayed": [], … }
}
```

followed by a verification probe: `cg_hermes_observation count after probe: 0`,
`cg_event pending count after probe: 0` — the live step consumed nothing and
wrote nothing. Read-only schema probes (information_schema/pg_indexes,
service-role env) confirmed the applied substrate matches the adapters:
`cg_event` carries the columns the source's Zod row schema validates
(`state`, `occurred_at`, `tenant_id`, …), and `cg_hermes_observation` exists
with `cg_hermes_observation_tenant_event_idx` =
`CREATE UNIQUE INDEX … (tenant_id, event_ref) WHERE (event_ref IS NOT NULL)`.

## Security Validation

- **Fail-closed in every direction (tested)**: missing event substrate,
  missing observation substrate, unknown backend, unavailable service-role
  client, invalid input, recorder failure, unexpected throw — all typed
  `{ ok: false }` with the reason; NOTHING is written and NO observation is
  fabricated in any of these paths.
- **§9 canonical truth untouched**: observations are recorded only through
  the R4 port, which hard-stamps `generatedByAi: true` / `verified: false`;
  the db inserts asserted in tests carry those marks, and the substrate CHECKs
  plus the partial unique index enforce them at the database (§28).
- **§13 tenant isolation**: tenant context is a required, Zod-validated input
  of the step (rejected when missing/empty); the db source reads tenant-scoped
  and the ingestion excludes other-tenant/no-tenant deliveries (tested).
- **§27 posture**: the step performs no authentication/authorization of its
  own because it is NOT an HTTP surface — the module header states the law
  that any HTTP exposure must wrap it in a §27 server function with
  session-derived tenant/identity. No route was added (outside ownership).
- **No secrets, no destructive ops**: no credentials introduced or logged;
  the only live-backend action was read-only (SELECTs; zero rows written,
  verified by post-probe counts). No migration applied or modified; no event
  state mutated (`cg_event` received zero writes in every test and the live
  probe).

## Known Risks

1. **The step is wired but not yet SCHEDULED**: nothing in the runtime invokes
   it automatically (by design — the trigger schedule and HTTP surface are
   coordinator/owner decisions). Until Remaining Work 1 lands, the flow runs
   only when a driver calls the step.
2. **Durable flow requires `HERMES_OBSERVATION_BACKEND=db`** (coordinator
   env decision, R4 Remaining Work 1); in the default memory posture the step
   is an intentional no-op.
3. **Repeated db steps re-read still-pending events** (the source never
   mutates `cg_event`); the digest identity makes those replays free at the
   observation layer, but each step still pays the read. A future outbox-owner
   change (acknowledging events Hermes consumed) would remove the read
   amplification — that state machine belongs to the kernel owner, not here.
4. **Hermes event taxonomy coverage** is whatever domains registered;
   unregistered event types are rejected fail-closed (R4 risk 3, unchanged).

## Remaining Work

1. **Server-function surface (OTHER OWNER — precise required change, not made
   per mission law)**: create `frontend/src/lib/hermes.functions.ts` (new
   file; the `lib/*.functions.ts` §27 pattern, e.g.
   `foundation-loop.functions.ts` / `command-centre.functions.ts`):
   `createServerFn` → `requireSupabaseAuth` → resolve the tenant from the
   authenticated session scope (NOT client input) → resolve the governed
   Hermes worker identity server-side from the worker registry (NOT client
   input) → Zod-validate an optional `{ limit }` only → call
   `runHermesEventObservationStep({ tenantId, hermesId, now, limit })` with
   the kernel time-authority instant → return the typed step result (already
   permitted-data-shaped: counts + observation ids, no cross-tenant rows) →
   audit. A command-centre poll/refresh (or a scheduled queue driver owned by
   the coordinator) then provides the cadence.
2. Coordinator: set `HERMES_OBSERVATION_BACKEND=db` where durable observation
   flow is wanted (R4 Remaining Work 1; the substrate is APPLIED — verified
   read-only this session, `cg_hermes_observation` present with the partial
   unique `(tenant_id, event_ref)` index).
3. Optional: invoke the step from the Hermes cycle entry point when the
   cycle-runtime owner wires one (the step is deliberately independent of
   `hermes-cycle.ts` to avoid changing the cycle's dependency contract).
4. Coordinator: full `npm run verify`.
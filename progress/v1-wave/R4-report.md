# R4 Report — Hermes Observation Port (DB-backed) + Event Wiring (team HERMES-PORT)

Team: R4 (HERMES-PORT) of the CoreGrid V1 remediation wave. Base branch:
`cursor/p08-foundation-loop-classification-fe86` (not switched, per mission law).
Closes the two follow-ups recorded by mission V1-002
(`progress/v1-wave/V1-002-report.md` → Remaining Work 1): a DB-backed Hermes
observation port and event-trigger wiring.
Report format: AGENTS.md §42. Every claim below is backed by command output run in
this session (see Tests / Security Validation). Honesty law respected: nothing here
is claimed as applied to any database — the migration is AUTHORED, NOT APPLIED.

## Implemented

1. **Observation substrate migration (`cg_hermes_observation`)** — ONE new migration
   plus its exact-inverse rollback (same basename), styled on the deny-by-default
   exemplars (`20261003000019_coregrid_v1_mission_lease.sql`, `20261002000002`
   cg_ naming):
   - append-only table: one row per observation that arrived at Hermes —
     `source` `'direct'` (server-function call) or `'event'` (the `cg_event`
     substrate), closed `kind` vocabulary, `subject_ref` pointer into the state of
     record, `statement` jsonb, valid time `observed_at` vs record time
     `recorded_at` (database clock, never backdated);
   - §12 provenance in columns: where it came from (`source`, `event_ref`,
     `subject_ref`), who/what created it (`created_by` — the governed Hermes
     identity), when (observed_at/recorded_at), AI flag (`generated_by_ai`), plus
     `trace_id`/`correlation_id`/`declared_origin` envelope refs;
   - §9 canonical-truth law ENFORCED BY DATABASE: CHECK
     `cg_hermes_observation_intelligence_only` requires `generated_by_ai IS TRUE
     AND verified IS FALSE` — an observation row can never claim canonical truth;
     CHECK `cg_hermes_observation_event_source_coherence` requires event-sourced
     rows to cite their event;
   - append-only enforcement by trigger: `BEFORE UPDATE OR DELETE` raises via
     `cg_hermes_observation_append_only()` — observations are never rewritten;
     corrections are new rows;
   - exactly-once event consumption: partial UNIQUE index on
     `(tenant_id, event_ref) WHERE event_ref IS NOT NULL`;
   - deny-by-default posture: RLS ENABLED, ZERO policies, `REVOKE ALL … FROM
     anon, authenticated`, `GRANT ALL … TO service_role` (service-role server
     functions are the only writer);
   - rollback: trigger → table → function dropped inside one transaction, with a
     §38 rollback plan and the pre-migration privilege posture restored.
2. **Pure observation contract + in-memory port (`frontend/src/lib/hermes/hermes-observation.ts`)**
   — the port surface is `recordObservation` + `listObservations` and NOTHING else
   (no update, no delete — append-only by construction). Provenance is NOT caller
   input: the port stamps `recordedBy` / `generatedByAi: true` / `verified: false`
   itself (§12: provenance claimed by the caller is not provenance); §9 marking is
   type-level (`generatedByAi: true`, `verified: false` literals in
   `hermesObservationSchema`). Zod strict schemas at the trust boundary; replay of
   a repeated observation id leaves the original record verbatim (`replayed: true`,
   §10); list is tenant-scoped (§13).
3. **`HermesObservationPortDb` (`frontend/src/lib/hermes/hermes-observation-db.server.ts`)**
   — the DB-backed port over `cg_hermes_observation`, following the
   `worker-registry-db.server.ts` / `memory-db-adapter.server.ts` adapter pattern:
   service-role `SupabaseClient`, tenant-scoped SQL on every query, Zod-validated
   untrusted reads (a row claiming `verified: true` can never re-enter Hermes
   state), idempotent replay (existing-row check + `23505` concurrent-writer race →
   `replayed: true`, nothing rewritten), `recorded_at` left to the database clock.
   **Fail-closed on schema gaps**: until the migration is applied, every operation
   returns the typed `observation_substrate_missing` failure carrying
   `HERMES_OBSERVATION_SUBSTRATE_GAP` and writes NOTHING (the V1-004
   lease-substrate-gap posture).
4. **Env selector** — `HERMES_OBSERVATION_BACKEND` (`"memory" | "db"`; default and
   fallback `"memory"`; unknown value throws rather than silently degrading
   durability), mirroring `MEMORY_TIER_BACKEND`. `createHermesObservationPort()`
   builds the configured backend; the in-memory port stays the default for tests
   and unconfigured environments.
5. **Event→observation wiring (`hermes-event-source.ts` + `hermes-event-source-db.server.ts`)**
   — Hermes observations now arrive from the event substrate, not only direct
   calls:
   - pure mapping `observationFromEvent`: a registered kernel event
     (`kernel/event-semantics.ts` taxonomy — `isKnownEventType`) becomes a
     provenance-stamped `event_observation` with deterministic digest identity
     (`hermes:obs:event:<content+cause digest>`, §10) and
     `declaredOrigin: "hermes.event-source"`;
   - `ingestEventsAsObservations`: deterministic total order (`orderEvents`),
     duplicate-delivery collapse by content+cause digest (`eventDedupDigest`),
     then recording through the port; a recorder failure aborts the ingestion
     closed with `{ ok: false }`;
   - fail-closed consumption: unknown event types, missing temporal coordinates,
     malformed aggregates/payloads are REJECTED; events without tenant context or
     from another tenant are EXCLUDED (§13) — never silently consumed;
   - server source `createHermesEventObservationSource(client)`: reads PENDING
     `cg_event` rows tenant-scoped on the service-role client and ingests them
     through `HermesObservationPortDb` on the same client. READ-ONLY over
     `cg_event` (the outbox state machine `kernel/outbox.ts` keeps event-state
     ownership); fails closed when `cg_event` is absent or unreadable, and
     propagates the observation-substrate gap failure closed. No other team's file
     was touched (`lib/kernel/`, `lib/missions/`, `lib/workforce/`, `lib/memory/`
     are imported, never modified — verified by diff review).

## Files Changed

Created (all within the declared file ownership):
- `database/supabase/migrations/20261003000030_coregrid_hermes_observation_substrate.sql`
- `database/supabase/rollbacks/20261003000030_coregrid_hermes_observation_substrate.sql`
- `frontend/src/lib/hermes/hermes-observation.ts` — pure contract + in-memory port (default)
- `frontend/src/lib/hermes/hermes-observation-db.server.ts` — `HermesObservationPortDb` + env selector
- `frontend/src/lib/hermes/hermes-event-source.ts` — pure event→observation adapter
- `frontend/src/lib/hermes/hermes-event-source-db.server.ts` — `cg_event` → observation server wiring
- `tests/unit/hermes/hermes-observation-port.test.ts` (19 tests)
- `tests/unit/hermes/hermes-event-source.test.ts` (17 tests)
- `tests/unit/hermes/hermes-observation-substrate-posture.test.ts` (15 tests)
- `progress/v1-wave/R4-report.md` (this report)

Not modified (imported only, per mission law): `lib/hermes/hermes-contract.ts`,
`hermes-classifier.ts`, `hermes-cycle.ts`, `hermes-memory.ts` (V1-002 files),
`lib/missions/**`, `lib/workforce/**`, `lib/memory/**`, `lib/kernel/**`,
`scripts/apply-canonical-hardening.mjs` (coordinator-owned), `tests/e2e/`,
`mobile/`. No git commit/push performed; no migration applied; no Supabase backend
touched.

## Architecture Impact

- **One governed observation surface (§9/§12)**: observations arriving by direct
  call AND by event now flow through ONE port into ONE append-only substrate, with
  the §12 provenance chain in every row and the §9 intelligence-only marking
  enforced by database CHECK, not just application code (§28).
- **Append-only at three layers**: no update/delete on the port surface, no
  UPDATE/DELETE in the adapter, and a database trigger raising on UPDATE/DELETE.
  Replays return `replayed: true` and leave the original verbatim (§10).
- **Domain ↓ Application ↓ Policy ↓ Infrastructure respected**: the event source
  and port are pure contracts + adapters; vendors appear only in the two
  `.server.ts` modules (service-role `SupabaseClient`, typed as bare
  `SupabaseClient` because generated types lag the authored migration — same
  posture as the memory/mission adapters).
- **Selection without authority drift**: backend selection is env-driven with the
  in-memory fallback; the DB adapter adds durability, never authorization — the
  substrate grants nothing (zero policies), and tenant scoping is in every SQL
  query.
- **Event ownership untouched**: `cg_event` rows are read (pending, tenant-scoped)
  and never mutated; the outbox state machine remains the kernel's. Consumption
  idempotence comes from the digest identity instead of event-state mutation.
- **V1-002 architecture preserved**: the read-only cycle observation surface
  (`HermesObservationPort` in `hermes-contract.ts`) and the cycle itself are
  unchanged; the new substrate is the durable record of what arrived at Hermes,
  complementary to (never a replacement of) the ports of record.

## Tests

`npx vitest run tests/unit/hermes` — real output:

```
 ✓ tests/unit/hermes/hermes-observation-port.test.ts (19 tests) 16ms
 ✓ tests/unit/hermes/hermes-event-source.test.ts (17 tests) 19ms
 ✓ tests/unit/hermes/hermes-observation-substrate-posture.test.ts (15 tests) 4ms
 ✓ tests/unit/hermes-cycle.test.ts (19 tests) 38ms

 Test Files  4 passed (4)
      Tests  70 passed (70)
   Start at  14:43:44 … Duration  640ms
```

- **`hermes-observation-port.test.ts` (19)** — backend selection (memory default,
  db via `HERMES_OBSERVATION_BACKEND`, unknown throws); adapter contract
  record/list round trip on both backends; §12 stamping proven by the port (caller
  cannot claim provenance); fail-closed Zod boundary (invalid ids/kinds/timestamps,
  event-source without `eventRef`, provenance-as-input rejected); append-only
  surface (no mutating keys on either backend) and verbatim replay (in-memory AND
  db, including the `23505` concurrent-writer race); DB fail-closed on a missing
  substrate (`observation_substrate_missing` + gap text, zero rows written); other
  persistence errors fail closed; malformed read-back rows rejected
  (verified-true row can never re-enter); tenant-scoped reads.
- **`hermes-event-source.test.ts` (17)** — mapping of a registered kernel event to
  a provenance-stamped `event_observation` (digest identity, eventRef, subject,
  significance); exactly-once under duplicate delivery (3 deliveries → 1
  observation, 2 collapsed); same-content/different-cause events never collapse;
  re-ingestion replays with zero new records; fail-closed consumption (unregistered
  type, no temporal coordinate, no/mismatched tenant, malformed payload/aggregate —
  all rejected, nothing recorded); recorder failure aborts closed; DB wiring
  end-to-end (`cg_event` pending → `cg_hermes_observation` stamped row, `cg_event`
  untouched); fail-closed when `cg_event` OR `cg_hermes_observation` is absent
  (zero observations invented); tenant-scoped consumption; malformed `cg_event` row
  fails the batch closed.
- **`hermes-observation-substrate-posture.test.ts` (15)** — text-level posture
  adjudication (the `h3-040` pattern): table + provenance columns present;
  §9 intelligence-only and §12 event-source coherence CHECKs verbatim;
  append-only trigger/function; partial unique `(tenant_id, event_ref)`; no
  UPDATE/DELETE path in the migration; RLS enabled, zero `CREATE POLICY`,
  `REVOKE ALL … anon, authenticated`, `GRANT … service_role`; "AUTHORED, NOT
  APPLIED" declaration; rollback at the SAME basename drops trigger/table/function,
  restores the pre-migration privilege posture, runs in one transaction with a §38
  rollback plan.

Neighbor regressions (one run):

```
npx vitest run tests/unit/hermes tests/unit/hermes-cycle.test.ts \
  tests/unit/memory-db-adapter.test.ts tests/unit/worker-host.test.ts \
  tests/unit/mission-execution.test.ts tests/unit/jarvis-contract.test.ts
→ Test Files 8 passed (8); Tests 153 passed (153)
```

Repo typecheck — real output:

```
npx tsc --noEmit   (no output, exit 0)
```

Lint on all new files (`npx eslint … && npx eslint <same>`) — clean after prettier
auto-fix (exit 0, no findings). The typecheck run initially surfaced 5 real errors
(readonly-array pushes in the ingestion loop, an un-narrowed union in the DB
adapter, and a fixture field not in `KernelEventRecord`) — all fixed; nothing was
suppressed.

## Security Validation

- **Deny-by-default substrate (§17/§31)**: RLS enabled, ZERO policies, all
  anon/authenticated privileges revoked, service_role only — asserted by the
  posture tests; the DB adapter runs on the service-role client and tenant scoping
  is in every SQL query, so application code is never the only (or even a) security
  layer.
- **Fail-closed everywhere**: missing observation substrate → typed
  `observation_substrate_missing`, nothing written (tested); missing event
  substrate → ingestion aborts, nothing recorded (tested); unknown event types and
  malformed events are rejected, never guessed (tested); unknown backend values
  throw rather than degrade silently (tested).
- **§9 canonical truth protected twice**: the port hard-stamps
  `generatedByAi: true, verified: false` and the database CHECK rejects any row
  claiming otherwise; a read-back row with `verified: true` is rejected (tested) —
  AI inference can never overwrite or impersonate canonical truth.
- **Append-only (§12 audit integrity)**: no update/delete surface, no UPDATE/DELETE
  SQL, database trigger rejects rewrites; replays verbatim (tested on both
  backends).
- **Tenant isolation (§13)**: ingestion excludes events without tenant context;
  list/queries are tenant-scoped in SQL; cross-tenant observation bleed tested.
- **No secrets, no destructive ops, no boundary moved**: no policy authored, no
  migration applied, no other team's file modified, no secrets introduced or
  logged.

## Known Risks

1. **The migration is NOT applied** (per mission law — the coordinator registers
   and applies): until then, the DB backend fails closed on every operation; the
   in-memory default keeps the port usable for tests/unconfigured environments but
   is not durable.
2. **`statement` intelligence is stored as opaque jsonb** (object-enforced only).
   Downstream consumers must treat it as untrusted; a follow-up could add
   statement-shape schemas per observation kind if consumers need stricter reads.
3. **Hermes event taxonomy coverage is whatever domains registered** — unregistered
   event types are rejected (correct, but means Hermes observations only flow for
   registered taxonomies); registering a Hermes event vocabulary is a
   domain-owner decision, not taken here.
4. **Event redelivery after substrate rollback** would re-record observations
   (append-only rows are the only record); acceptable — observations are
   intelligence, not truth — but noted for the rollback plan's data note.

## Remaining Work

1. Coordinator: register + apply
   `20261003000030_coregrid_hermes_observation_substrate.sql` (and keep the
   same-basename rollback) under explicit apply authorization; then set
   `HERMES_OBSERVATION_BACKEND=db` in server environments.
2. Wire `createHermesEventObservationSource` into the runtime trigger path (cron /
   queue / server function) and the `hermes-cycle` server entry point — the
   library seam is ready but the trigger schedule is a coordinator decision.
3. Optional follow-up: typed statement schemas per observation kind for stricter
   downstream reads.
4. Coordinator: full `npm run verify`.

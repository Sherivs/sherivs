# MISSION W3-INT — §42 REPORT

**Mission:** W3-INT — integration of V1-003 (workforce host) ↔ V1-004 (mission execution path), Wave 4
**Team:** CTO-INTEGRATION
**Status:** COMPLETE (code + tests landed; item 3 resolved as a FINDING — NO migration authored)
**Branch:** `cursor/p08-foundation-loop-classification-fe86`
**Date:** 2026-10-03

---

## Implemented

The four seam edits V1-003's §42 report flagged against V1-004-owned files, reconciled under
file-ownership law (this mission owns `frontend/src/lib/missions/**`; `lib/workforce/**` untouched).

1. **Per-phase instants in `runLeasedMissionExecution`** (`mission-execution-store.ts`).
   The driver accepts an optional injected `clock?: () => string` (J-023 — the caller owns the
   time authority; no wall-clock sampling). When supplied, the driver samples it at EACH phase
   boundary — lease acquisition and the outcome report — so completion/failure/retry stamps bind
   to the ACT instants instead of the single wake instant. When absent, the one `now` instant
   stamps every phase: the deterministic behavior every existing caller (including the unmodified
   host) keeps. Unparseable clock output is rejected by the store's Zod `timestampSchema` —
   fail closed. The FSM is untouched: no new stage, no new transition; the driver's phase
   sampling composes with the existing lease TTL/liveness gates (a completion act sampled after
   the TTL still denies `lease_expired`, unchanged).
   *Adoption note (workforce-owned, reported not made):* the host already holds the right clock —
   a future workforce mission can thread `clock: deps.now` into the driver call in
   `worker-host.ts` to retire its wake-instant mitigation.

2. **Stale `retryScheduledAt` on the terminal-exhausted write** (`mission-execution-store.ts`,
   `failExecutionSync`). The exhaustion branch now writes `retryScheduledAt: null` on the stored
   execution, matching the already-null return value. The stamp was inert (the acquire gate
   denies `attempts_exhausted` before the backoff check — still asserted by test), but the stored
   record no longer carries a schedule it can never honor.

3. **`cg_execution_record.status` CHECK extension — DECIDED: FINDING, NO MIGRATION.** See the
   decision section below. The authorized corrective migration was NOT authored.

4. **Persisted `lastWorkerId` on execution records** (`mission-lease-db.server.ts`).
   - The enriched projection now sets `lastWorkerId` to the latest persisted lease row's worker —
     the executor of record. Lease rows survive release/recovery (only `state`/`outcome` change),
     so the executor of record remains PERSISTED for post-release audit, exactly the refinement
     V1-004 reported as pending the lease substrate. No lease rows → the record port's own
     projection stands (conservatively `null` on the bare DB record path).
   - `createDbMissionLeasePort` now also exposes the enriched `getExecution` read (return type
     widened to `MissionLeasePort & Pick<MissionRecordPort, "getExecution">`): record-port state
     ⊕ lease truth, including `lastWorkerId`. This is precisely the composite the leased driver
     and the worker host drive; compositions must wire `getExecution` from THIS port, not from
     the bare record port (bare reads stay un-enriched by design — documented on the factory).
   - The in-memory store already persisted `lastWorkerId` through every transition (spreads
     preserve it); asserted by a new driver-level test.

## Item-3 decision: `cg_execution_record.status` CHECK extension — NOT needed (finding)

**Decision: no corrective migration.** Inspected every writer of `cg_execution_record` in the
codebase before deciding:

- `frontend/src/lib/missions/mission-execution-db.server.ts` — the ONLY mission-path writer,
  `assignExecution`: inserts `status: admission.result.status`, i.e. `('admitted'|'denied')`.
  It never UPDATEs the row afterwards (grep over `frontend/src`: the table appears as
  `insert` once and `select` elsewhere).
- `frontend/src/lib/foundation-loop.functions.ts` — the rollback path updates
  `status: 'rolled_back'` (line ~279). This consumes the third and final value of the existing
  CHECK vocabulary.
- **The lease lifecycle never mutates `cg_execution_record.status`.**
  `mission-lease-db.server.ts` writes ONLY `cg_mission_lease` rows (insert on acquire; updates
  flipping `state` to `released`/`recovered` with outcome/retry bookkeeping) plus, through the
  composed record port, `cg_foundation_evidence` rows and `cg_verification_result` reads/writes.
  `cg_execution_record` is neither read-for-status-mutation nor updated by any lease operation.

The stage progression the V1-003 report wanted projected onto the record (`leased/evidenced/
verified/requeued/exhausted`) does not need record-level status vocabulary: that truth already
lives in `cg_mission_lease` (state/outcome/attempt/retry_not_before) and is composed at read
time by the adapter's `enrichedExecution` — the sanctioned composition seam this mission
finished exposing via the enriched `getExecution`. Making the record "self-describing" would
require the record port to UPDATE `cg_execution_record` on every lease transition — rewriting
canonical admission records (AGENTS §28 posture: records are never rewritten by derived
intelligence; canonical truth stays in the transactional record, the lease table is the
lease-state truth). Authoring the CHECK extension would therefore be speculative future
functionality with no present code-path consumer (AGENTS §40) and a corrective migration on an
already-applied migration. The finding stands in lieu of the migration; the ONE authorized
corrective migration `20261003000020_coregrid_v1_execution_status_extension.sql` was NOT
authored, no rollback file was created, and NO manifest entry was added to
`scripts/apply-canonical-hardening.mjs`. The coordinator has nothing to apply for item 3.

## Files Changed

- `frontend/src/lib/missions/mission-execution-store.ts` — per-phase clock seam in the driver;
  terminal-exhausted write nulls `retryScheduledAt`.
- `frontend/src/lib/missions/mission-lease-db.server.ts` — enriched projection carries the
  persisted executor of record (`lastWorkerId`); factory exposes the enriched `getExecution`
  composite read (return type widened); docs updated.
- `tests/unit/mission-execution.test.ts` — +5 driver tests (executor of record; per-phase
  instants on completion and on retry scheduling; single-`now` determinism preserved) and the
  exhaustion test now asserts the STORED `retryScheduledAt` is null.
- `tests/unit/worker-host.test.ts` — the exhaustion NOTE flipped: the stored retry stamp is now
  asserted `null` (the previously-reported stale-stamp behavior is fixed).
- `tests/unit/mission-lease-db.test.ts` — +3 tests: enriched `getExecution` surfacing,
  post-release `lastWorkerId` persistence, handoff keeps the LAST attempt's worker.
- `progress/v1-wave/W3-INT-report.md` — this report.

NOT touched (ownership law): `frontend/src/lib/workforce/**` (worker-host.ts unchanged — the
clock seam is callable from it without modification), `lib/mission/mission-contract.ts`
(canonical 15-state machine un-forked), `database/supabase/**` (no migration, no rollback),
`scripts/apply-canonical-hardening.mjs` (no manifest entry).

## Architecture Impact

- Domain ↓ Application ↓ Policy ↓ Infrastructure unchanged; the driver clock seam adds a
  caller-owned time input (J-023), not a vendor dependency. No new vocabulary: execution-path
  stages still compose with the canonical 15-state machine via
  `EXECUTION_STAGE_TO_MISSION_LIFECYCLE` (RULING-5) — verified by the mission-contract and
  rbac-neutrality regression suites.
- The lease adapter is now the complete composite the host drives
  (`MissionLeasePort & Pick<MissionRecordPort, "getExecution">`), removing the last reason a
  composition would wire the bare, un-enriched record read.
- Executor-of-record refinement is now real on the DB path (persisted, post-release auditable)
  instead of "the current lease's worker" only while active.

## Tests

`npx vitest run tests/unit/mission-execution.test.ts tests/unit/mission-execution-db.test.ts tests/unit/mission-lease-db.test.ts tests/unit/worker-host.test.ts tests/unit/worker-registry-db.test.ts`:

```
 ✓ tests/unit/mission-execution.test.ts (28 tests) 28ms
 ✓ tests/unit/mission-lease-db.test.ts (14 tests) 18ms
 ✓ tests/unit/worker-host.test.ts (16 tests) 35ms
 ✓ tests/unit/mission-execution-db.test.ts (12 tests) 15ms
 ✓ tests/unit/worker-registry-db.test.ts (14 tests) 19ms
 Test Files  5 passed (5)   Tests  84 passed (84)
```

Mission-neighbor regressions (the FSM must not fork — it did not):

```
 ✓ tests/unit/foundation-mission.test.ts (15 tests) 6ms
 ✓ tests/unit/mission-contract.test.ts (20 tests) 25ms
 ✓ tests/unit/rbac-neutrality.test.ts (18 tests) 40ms
 ✓ tests/unit/foundation-loop.test.ts (3 tests) 3ms
 Test Files  4 passed (4)   Tests  56 passed (56)
```

`npm run typecheck` (tsc --noEmit): clean. ESLint on every edited file: clean (one prettier
wrap auto-fixed, then re-verified). Full `npm run verify` intentionally NOT run (coordinator
law). No git commands; no real database touched; no migration applied or authored.

## Security Validation

- Fail-closed preserved: the clock seam's unparseable output is rejected at the store's Zod
  timestamp boundary (`invalid_input`) before any state change; per-phase sampling introduces no
  new bypass — a late completion act still denies `lease_expired` (tested implicitly by the
  handoff suite; the clock tests stay inside the TTL deliberately).
- Tenant boundary, authorization, idempotency and verifier-independence paths are byte-identical
  apart from the instant source; the full V1-004/V1-003 suites (84 tests) pass unchanged in
  their security assertions.
- `lastWorkerId` is audit metadata, not authority: it feeds the executor-of-record identity
  comparison only (`lastWorkerId ?? assignedBy` in verification independence); no permission,
  scope or tenant decision reads it. It is derived from lease rows that were themselves
  authorized at acquire time.
- No RLS, policy, migration or governance rule changed; no secrets.

## Known Risks

- The host (workforce-owned) still passes the single wake instant; until a future workforce
  mission threads `clock: deps.now`, DB-path completion stamps retain the wake-instant
  coarseness V1-003 mitigates with fresh heartbeats (liveness unaffected — the final heartbeat
  gate is untouched).
- The DB-path verification independence check still runs against the record port's own
  (un-enriched) read inside `verifyExecution`, so it conservatively compares against the
  dispatcher (`assignedBy`) rather than the lease-refined executor — pre-existing V1-004 risk
  #2, unchanged here; refining it would require touching the record port's verification act and
  is reported, not decided.
- `getExecution` on the lease adapter is an additive surface: a composition that wires the bare
  record port's `getExecution` keeps un-enriched reads (documented); wiring both is the
  composition's choice, now unambiguous.

## Remaining Work

- Coordinator: run full `npm run verify`. **No migration needs applying** — item 3 resolved as
  a finding; `20261003000019` remains the only pending substrate migration.
- Workforce owner (next mission): optionally thread `clock: deps.now` into the host's
  `runLeasedMissionExecution` call to adopt per-phase instants end-to-end.
- Composition owner (next wave): wire the host's mission ports from `createDbMissionLeasePort`
  (lease port + its enriched `getExecution` + the record port's `verifyExecution`) so DB-path
  reads carry lease truth and the persisted executor of record.

---

*Component: progress/v1-wave/W3-INT-report.md — mission W3-INT (team CTO-INTEGRATION), Wave 4.*
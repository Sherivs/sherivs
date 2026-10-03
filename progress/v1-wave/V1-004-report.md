# V1-004 Report — General Mission Execution Path (team MISSION)

Mission: V1-004 of the CoreGrid V1 program, Wave 2. Branch: `cursor/p08-foundation-loop-classification-fe86`.
Report format: AGENTS.md §42. All evidence produced by commands run in this session (see Tests / Security Validation).

## Implemented

1. **Pure execution-path contract (`frontend/src/lib/missions/mission-execution.ts`)** — generalizes the
   ONE DB-persisted executable mission pattern (the foundation loop) into the general path
   **intent → assignment → lease → execute → evidence → verify**:
   - `EXECUTION_PATH_STAGES` / `TERMINAL_STAGES` / typed transition table (`assigned → leased →
     evidenced → verified`, plus `requeued`, `exhausted`, `denied`), composed with — never forking —
     the canonical 15-state machine (`lib/mission/mission-contract.ts`, RULING-5) via
     `EXECUTION_STAGE_TO_MISSION_LIFECYCLE`.
   - Lease semantics: `MissionLease`, `leaseIsExpired` (heartbeat TTL),
     `leaseRecoveryDecision` (orphan recovery decision), `LeaseGrant` (the worker-facing payload).
   - Retry semantics: `nextRetryAt` — bounded exponential backoff
     (`min(base·2^(attempt−1), max)`), deterministic, config-capped.
   - Reuse, zero re-invention: admission via `admitExecution`
     (`control-plane/foundation-mission.ts`), evidence via `EvidenceRecord`/`evidenceIsUsable`,
     verification via `decideVerification`, verifier independence via
     `checkVerificationIndependence` (`lib/verification.ts`).
   - Zod schemas on EVERY input crossing the trust boundary (intents, assignments, lease
     acquire/heartbeat, completion outcomes — a discriminated union where success REQUIRES evidence —
     verification, recovery), `.strict()`, closed deny-code union (`MissionExecutionDenyCode`).
   - §12 provenance: `buildExecutionEvidence` stamps who (`worker:`) / when (`observed`/`recorded`) /
     source (`source:`) / execution binding (`execution:`) plus a sha256 integrity digest.
   - Verification separation: `decideExecutionVerification` enforces independence FIRST — an
     executor-of-record (or effective-identity alias) verifying its own work is recorded as a FAILED
     verification, never silently retried.
2. **Neutral RBAC contribution (`frontend/src/lib/missions/mission-authorization.ts`)** — the mission
   domain registers into the Wave-1 neutral RBAC core (`rbac/domain-contribution.ts`), following the
   pattern proven by `domain-config/scholar-authorization.ts` (V1-006):
   - Domain `mission_execution`, permission resource `mission` via `domainPermissionResource()`
     (never added to the core union), roles mapped RULING-4 direction only:
     `mission_owner` → ADMINISTRATOR+OWNER (manage/create/read), `mission_operator` →
     OPERATOR+WORKER (execute/read), `mission_verifier` → REVIEWER (verify/read).
   - `authorizeMissionOperation()` resolves every operation through the combined engine
     (`lib/authorization.ts`): neutral lifecycle gate → tenant boundary gate (scope embeds
     `<tenantId>:mission:<missionId>`) → RBAC grants → default DENY. Invariant 12 preserved: agent
     authority flows ONLY through explicit delegation grants.
   - `MissionActorContext` is the server-resolved actor shape (Zod `.strict()`); delegation grants
     cross into the engine as branded `Permission`s at the boundary cast.
3. **Reference execution store (`frontend/src/lib/missions/mission-execution-store.ts`)** — the pure
   in-memory implementation of the FULL path behind two port interfaces (the V1-003 seams):
   - `MissionRecordPort` — `recordIntent` (idempotent per tenant+mission+version), `assignExecution`
     (reuses `admitExecution`; out-of-scope actions persist a `denied` record), `recordEvidence`,
     `recordVerification` (replay-protected), `getExecution` (tenant-scoped),
     `verifyExecution` (the independent verification act).
   - `MissionLeasePort` — `acquireLease` (inline orphan recovery: an expired lease is requeued and
     attempt-counted BEFORE the new grant, atomically; active lease exclusivity; retry backoff;
     attempt budget), `heartbeatLease` (extends the TTL window; expired leases must be recovered),
     `completeExecution` (success → evidence + stage `evidenced`, NEVER verified; reported failure →
     requeue with backoff), `failExecution`, `recoverOrphanedLeases` (sweep).
   - §10 idempotency: intents unique per (tenant, mission, version); assignments arbitrated by an
     idempotency-key map — a duplicate key replays the recorded outcome with NO new external effect
     (exactly-once); verification decisions are canonical truth and replay on re-attempt.
   - Fail-closed tenant signal: unknown and cross-tenant executions return the SAME
     `cross_tenant`/"execution not found in scope" denial — no existence oracle across the tenant
     boundary (AGENTS §31).
   - **Driver seam** `runLeasedMissionExecution(store, {worker, tenantId, executionId, execute, now})`:
     acquires the lease, invokes the executor callback, reports the outcome. V1-003 supplies
     `execute`; the mission path owns authorization, idempotency, lease semantics, evidence and retry
     accounting, and owns NO agent runtime.
4. **DB-backed adapter (`frontend/src/lib/missions/mission-execution-db.server.ts`)** — persists the
   path into the EXISTING `cg_*` mission tables of
   `database/supabase/migrations/20260929000000_coregrid_foundation_mission_001.sql` (no migration
   authored, none required for the record path): `cg_mission_intent` (upsert on
   `tenant_id,mission_id,version`, replay on existing row), `cg_execution_record` +
   `cg_execution_history` (append-only; duplicate-key races replay, never double-execute),
   `cg_foundation_evidence` (§12 provenance), `cg_verification_result` (replay-protected; evidence
   bound to the execution via the provenance column — the table has no execution_id column).
   - **Fail-closed lease-substrate gap** (see Schema Gap below): every `MissionLeasePort` operation
     returns the typed `lease_substrate_missing` result and writes NOTHING.
   - Untrusted reads are Zod-validated (`executionRowSchema` etc. mirrors the migration's own CHECK
     vocabulary); a malformed row throws a typed load failure and never enters contract state.
5. **Schema gap REPORTED (mission law: fail-closed + report, do not author migrations)** —
   `MISSION_LEASE_SUBSTRATE_GAP` (exported, typed, asserted by test):
   the `cg_*` mission tables author NO worker-lease substrate. `cg_execution_record.status` admits
   only `('admitted','denied','rolled_back')` — no leased/evidenced/verified projection — and no
   lease-owner, heartbeat or lease-expiry columns exist on any `cg_*` mission table (the
   worker-definitions substrate deliberately excludes runtime leases; no lease table is authored).
   Faking lease persistence in application code would defeat exactly-once and orphan-recovery
   semantics (§28: records are never rewritten), so the DB adapter fails closed on all lease
   operations. **Closing the gap requires a follow-up migration (e.g. a `cg_mission_lease` table:
   execution_id, lease_id, worker_id, heartbeat_at, lease_expires_at, status) under explicit
   authorization** — the pure store already implements the exact semantics it would persist.
6. **Tests (two new suites, 36 tests)** — see Tests.

## Files Changed

Created (all within the declared file ownership):
- `frontend/src/lib/missions/mission-execution.ts` — pure contract
- `frontend/src/lib/missions/mission-authorization.ts` — neutral RBAC contribution
- `frontend/src/lib/missions/mission-execution-store.ts` — reference store + driver seam
- `frontend/src/lib/missions/mission-execution-db.server.ts` — DB adapter (service-role posture,
  mirroring `kernel-admin-client.ts`; contained untyped surface, Zod-validated reads)
- `tests/unit/mission-execution.test.ts` (24 tests)
- `tests/unit/mission-execution-db.test.ts` (12 tests)
- `progress/v1-wave/V1-004-report.md` (this report)

Not modified: `foundation-loop` and `control-plane` files were imported only — the generalization
required NO touch of them (verified: `git status` shows no modification to
`lib/control-plane/*`, `lib/foundation-loop*`, `lib/mission/*`).

## Architecture Impact

- **Domain ↓ Application ↓ Policy ↓ Infrastructure respected**: the mission path depends on the
  neutral RBAC core and the existing contract/control-plane modules only; the DB adapter is the only
  infrastructure touchpoint and is behind `MissionRecordPort`/`MissionLeasePort` — vendor-agnostic
  (Supabase appears only as an injected `SupabaseClient`).
- **No new vocabulary**: lifecycle states compose with the canonical 15-state machine (RULING-5);
  role vocabulary is exclusively the Wave-1 neutral universal roles (RULING-4 direction; zero
  education terms); evidence/verification reuse the foundation-mission contract.
- **Executor ≠ verifier enforced mechanically**: completion can only reach `evidenced`; `verified`
  is reachable ONLY through `verifyExecution` passing the independence check — a worker's "done"
  can never flip a mission to a verified state (mechanism 09).
- **Seams, not runtime**: no agent-execution runtime was built (V1-003's ownership). The path
  exposes `MissionLeasePort` (lease lifecycle) and `runLeasedMissionExecution`'s `execute` callback
  for the runtime to implement against.

## Tests

- `npx vitest run tests/unit/mission-execution.test.ts tests/unit/mission-execution-db.test.ts`
  — **36 passed**. Coverage:
  - happy path (intent → assignment → lease → heartbeat → execute → evidence with §12 provenance →
    independent verify → replay-protected decision),
  - idempotency: duplicate intent, duplicate assignment by idempotency key, duplicate execution id,
    out-of-scope action denied at admission (all exactly-once),
  - lease expiry recovery: TTL expiry → requeue → re-lease to a NEW worker; active-lease
    exclusivity; heartbeat window extension,
  - retry semantics: bounded exponential backoff from the failure instant; immediate re-lease denied
    `retry_backoff`; attempt budget exhaustion → `exhausted` terminal, leasing denied
    `attempts_exhausted`; worker-reported failure via `completeExecution`,
  - verifier separation: completion ≠ verification; executor self-verification recorded as FAILED
    (`verification_independence_failed`); delegated-alias equivalence rejected; recorded decision
    replays (never re-decided),
  - cross-tenant denial: tenant-B actor against a tenant-A execution gets the SAME signal as an
    unknown execution (code + reason), tenant-scoped reads return null, recovery sweeps stay
    tenant-scoped, intents are tenant-gated,
  - neutral RBAC: role without grants denied (default DENY), suspended lifecycle denied,
    undelegated agent denied (Invariant 12), verifier role cannot execute and operator cannot verify
    (capability separation),
  - trust boundaries: malformed inputs denied `invalid_input` before any state change; invalid store
    config rejected up front; malformed DB rows rejected (Zod, fail closed),
  - driver seam: leases → invokes the executor callback with the grant → evidences success; failed
    callback → requeue with backoff; lease denial surfaced typed,
  - DB adapter: intent upsert/replay, admitted record + append-only history, idempotency-key replay
    with zero writes, mission-not-found fail-closed, out-of-scope denial persisted, evidence
    provenance columns, verification independence failure persisted to `cg_verification_result`,
    independent verification + replay, cross-tenant read null, **lease gap fail-closed with zero
    writes**, malformed-row rejection.
- Mission neighbors (regression): `foundation-loop` (3), `foundation-mission` (15),
  `foundation-persistence` (5), `mission-contract` (20), `rbac-neutrality` (18),
  `memory-db-adapter` (21), `mh-17-verification-independence` (18), `verification-independence` (20)
  — **120 passed, zero regressions**. The new `mission_execution` domain contribution registers
  cleanly under the Wave-1 neutrality suite.
- `npm run typecheck` (`tsc --noEmit`) — clean.
- ESLint on all new/edited files — clean (prettier auto-fix only; no suppressions).
- Full `npm run verify` intentionally NOT run (coordinator-owned per mission law). No git commands,
  no real database, no migrations authored.

## Security Validation

- **Tenant isolation (§31)**: every operation addresses executions by (tenantId, executionId) with
  the actor's SERVER-resolved tenant; unknown and foreign produce one denial signal (no existence
  oracle). DB reads are tenant-scoped SQL; the fake-client test proves foreign reads return null.
- **Authorization (§26/§27)**: Zod validation → neutral RBAC resolution (lifecycle gate → tenant
  boundary → grants → default DENY) → stage/lease/ownership checks → effect, in that order, on
  every operation. Agent authority only via explicit delegation (Invariant 12, tested).
- **Exactly-once (§10)**: duplicate intents/assignments/verifications replay the recorded outcome
  with zero additional external effect (tested, including the DB duplicate-key race path).
- **Provenance (§12)**: every evidence record carries actor, timestamps, source ref, execution
  binding and integrity digest (tested on both memory and DB paths).
- **Executor ≠ verifier (mechanism 09)**: completion reaches `evidenced` only; verification requires
  a distinct identity AND distinct effective identity; independence failures are RECORDED as failed
  verifications, and a recorded decision is canonical truth (tested).
- **Fail-closed gap**: the missing lease substrate produces a typed, reported denial with zero
  writes — no simulated lease state in the DB path (tested).
- **No boundary moved**: no policy, RLS, migration or governance rule changed; no secrets; no real
  database touched.

## Known Risks

1. **Lease persistence is NOT available on the DB path** (the reported schema gap, above): until the
   follow-up lease-substrate migration is authorized and applied, DB-backed deployments must run the
   lease-bearing path through the pure store (with a durable port to be implemented) or treat lease
   state as ephemeral — the DB adapter correctly refuses to fake it. This is the mission's single
   REPORTED gap and the top follow-up item.
2. **DB-path executor of record is the assignment's `actor_id`** (dispatching operator), because no
   lease substrate exists to refine it to the lease-holding worker. The independence check is
   therefore conservative on the DB path: it compares against the dispatcher. Once the lease table
   lands, `lastWorkerId` should become the executor of record (the adapter already prefers it when
   present).
3. **Evidence↔execution binding is via the `provenance` text column** (`cg_foundation_evidence` has
   no execution_id column). The adapter filters tenant-scoped rows by the structured
   `execution:<id>` provenance fragment. A future migration could add a proper foreign key for
   index-grade joins; current scale is fine, correctness is preserved.
4. **Verification replay is decision-once per execution**: a FAILED verification (including an
   independence failure) is final for that execution id; further verification attempts replay the
   recorded decision. If a failed verification should later be re-openable (e.g. by a new independent
   verifier), that requires an explicit design decision (new execution id vs. decision revision) —
   reported, not decided.
5. **The briefing referenced `frontend/src/lib/missions/mission-contract.ts`; discovery found the
   15-state contract at `frontend/src/lib/mission/mission-contract.ts`** (the `missions/` directory
   did not exist). This mission created `lib/missions/` fresh, alongside (never modifying)
   `lib/mission/` and `lib/control-plane/`. Worth a one-line note in the phase docs to prevent path
   confusion.

## Remaining Work

1. **Coordinator decision: authorize the lease-substrate migration** (`cg_mission_lease` with
   execution binding, lease owner, heartbeat and expiry columns, plus a `cg_execution_record.status`
   projection for leased/evidenced/verified). Until then the DB path fails closed on leases (by
   design). This mission owns NO migration.
2. **V1-003 (agent execution runtime)**: implement against the seams below — no mission-path changes
   required.
3. A future mission may wire the DB adapter's record ports into `runLeasedMissionExecution` once the
   lease substrate exists (the ports already compose: the driver takes
   `MissionLeasePort & Pick<MissionRecordPort, "getExecution">`).
4. Coordinator: run full `npm run verify`.

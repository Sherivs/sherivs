# MISSION V1-003 — §42 REPORT

**Mission:** V1-003 — Governed worker execution host (team WORKFORCE, Wave 3)
**Status:** COMPLETE (code + tests landed; migration AUTHORED, NOT APPLIED)
**Branch:** `cursor/p08-foundation-loop-classification-fe86`
**Date:** 2026-10-03

---

## Implemented

The governed worker execution host — WAKE → EXECUTE → PERSIST → VERIFY → SLEEP — as a
LIBRARY (no always-on process, cost discipline §32), closing the lease-substrate gap
that mission V1-004 reported (`MISSION_LEASE_SUBSTRATE_GAP`, fail-closed) and wiring
the `cg_worker_definition/capability/delegation` substrate to real persistence.

1. **Lease substrate authorization (ONE new migration).**
   `database/supabase/migrations/20261003000019_coregrid_v1_mission_lease.sql` creates:
   - `cg_mission_lease` — one row per lease grant on a `cg_execution_record` execution:
     `lease_id` (PK), `execution_id` + `tenant_id` + `mission_id` (same-tenant
     composite FK to `cg_execution_record` via a new `(id, tenant_id, mission_id)`
     unique index — a lease can never point at another tenant's/mission's execution),
     `worker_id`, `acquired_at`, `heartbeat_at`, `expires_at`, `attempt`,
     `state` (`active|released|recovered`), plus completion/retry bookkeeping
     (`outcome`, `completed_at`, `retry_not_before`, `updated_at` for the substrate's
     `touch_updated_at` trigger). A database-enforced state-coherence CHECK makes
     incoherent lease rows unsatisfiable (active ⇔ no outcome; released ⇔ outcome +
     failed-retry-gate / succeeded-no-gate; recovered ⇔ sweep-completed, no outcome).
     `UNIQUE (tenant_id, execution_id, attempt)` = exactly-once leasing per attempt.
   - `cg_worker_delegation_grant` — the LIVE delegation-state surface. The
     append-only `cg_worker_delegation` (MISSION-R-40) authors NO state column, so a
     revocation could never take effect there; this table is the runtime-resolution
     surface (`active|revoked`, revocation coherence CHECK: revoked ⇔ who/when/why).
     The history row is still written for RULING-3 attribution.
   - `cg_worker_quarantine` — the quarantine ledger (`quarantined|released`, release
     coherence CHECK with who/when provenance). While a `quarantined` row exists, the
     host gate no longer leases to that worker.
   - Posture: RLS ENABLED with ZERO policies; all anon/authenticated privileges
     REVOKED (service-role server functions are the only writer — same posture as the
     worker-definitions and foundation-mission substrates). Table COMMENTs state the
     V1 authorization (this mission closing V1-004's reported gap). **NOT applied** —
     the coordinator applies canonically. Rollback (no second file authored, per file
     ownership): `DROP TABLE IF EXISTS public.cg_worker_quarantine;
     DROP TABLE IF EXISTS public.cg_worker_delegation_grant; DROP TABLE IF EXISTS
     public.cg_mission_lease; DROP INDEX IF EXISTS
     public.cg_execution_record_id_tenant_mission_idx;`

2. **`MissionLeasePort` DB adapter** — `frontend/src/lib/missions/mission-lease-db.server.ts`
   (NEW sibling file next to V1-004's `mission-execution-db.server.ts`; **no V1-004 file
   modified**). `createDbMissionLeasePort(client, { records, config?, workerGate? })`
   implements acquire (with inline orphan recovery: an expired unheartbeated lease is
   marked `recovered` and the attempt advances atomically before the new grant),
   heartbeat (extend `heartbeat_at`/`expires_at`; lapsed ⇒ `lease_expired`), complete
   (release + `succeeded` + evidence via the injected `MissionRecordPort`), fail
   (release + `failed` + bounded `retry_not_before` gate), recoverOrphanedLeases
   (sweep), and stage enrichment (record-port state ⊕ lease rows: denied persists,
   `leased`, `evidenced`, `verified` terminal, `requeued`/`exhausted` by attempt).
   Reads are Zod-validated (`leaseRowSchema`); the optional `WorkerLeaseGate`
   (supplied by the workforce registry) denies at acquire with ZERO writes.

3. **Worker identity wiring (§28 separation).**
   - `frontend/src/lib/workforce/worker-registry.ts` (pure contract): Zod-validated
     registration input; `validateWorkerRegistration` delegates the definition law to
     the Wave-2 substrate (`defineWorkerDefinition`, deny-by-default capability set —
     an empty set is valid and carries ZERO authority); `parseWorkerMissionCapability`
     (`mission:<create|execute|verify>:<missionId|*>`); `buildWorkerMissionActor`
     maps ACTIVE delegation grants onto the neutral RBAC core / V1-004's
     `mission-authorization.ts` contribution as tenant-embedded `extraPermissions`
     (`<tenantId>:mission:<missionId>`); AI workers resolve with `isAgent: true` so
     Invariant 12 makes role membership worthless — ALL authority flows through the
     explicit grants; escalation (capability not in the owned set, risk class above
     the ceiling) is DENIED, never clamped; revoked grants contribute nothing (the
     actor still resolves, so the denial is OBSERVABLE at the engine); a suspended/
     archived/deleted definition never resolves; cross-tenant fails closed.
   - `frontend/src/lib/workforce/worker-registry-db.server.ts`: `createWorkerRegistryDb(client)`
     — `registerWorker` (envelope-stamped `cg_worker_definition` via `stampKernelDraft`,
     J-001 anonymous-object gate enforced on every read-back + `cg_worker_capability`
     rows; idempotent replay per §10), `grantDelegation` (live grant row + append-only
     `cg_worker_delegation` history row + `delegation_history_refs` mirror),
     `revokeDelegation` (state → `revoked` with who/when/why; effective at the NEXT
     gate check; idempotent), `quarantineWorker` (ledger row + lifecycle → `suspended`:
     persistent, immediate freeze), `resolveWorkerAuthority` (quarantine gate ∘ grants
     → actor), `workerLeaseGate` (READ-TIME, never cached: registration ∘ lifecycle ∘
     quarantine ∘ active-grant checks at EVERY evaluation).

4. **The host loop** — `frontend/src/lib/workforce/worker-host.ts`:
   `runWorkerHost(deps, input)` drives ONE cycle:
   - **WAKE** — read the claimed execution; resolve the worker's authority through the
     registry (definition lifecycle, quarantine ledger, live grants → actor); fail
     closed if the resolved actor is not the governed worker identity.
   - **EXECUTE** — through V1-004's `runLeasedMissionExecution` (unmodified), with a
     heartbeat handle on the lease; the host re-checks lease liveness AFTER the
     executor returns — a worker that lost its lease mid-run may not report success
     (its `succeeded` is rewritten to `lease_expired_during_execution`); executor
     exceptions become `executor_error` failures (never a crash path).
   - **PERSIST** — the mission path records §12 evidence / the failure record (the
     driver's own completion act; the host observes and reports evidence count).
   - **VERIFY** — evidenced work is handed to an INDEPENDENT verifier identity: a plan
     resolving to the executor's own identity is REFUSED with no verification act at
     all (`verification_independence_refused`); otherwise the record port's
     `verifyExecution` (mechanism 09) decides and records.
   - **SLEEP** — terminal bookkeeping only; the cycle ends (library form — invocable
     from a server fn or a standalone runner). A worker whose `failureCount` crosses
     `quarantineThreshold` is quarantined (recorded; effective at the next gate check).
   `runtimeInstanceId` is carried for observability only — never an authority input.

5. **Unit tests** (mock Supabase / in-memory ports, NO real database):
   `tests/unit/worker-host.test.ts` (16), `tests/unit/mission-lease-db.test.ts` (11),
   `tests/unit/worker-registry-db.test.ts` (14).

## Files Changed

- `database/supabase/migrations/20261003000019_coregrid_v1_mission_lease.sql` (NEW — authored, not applied)
- `frontend/src/lib/missions/mission-lease-db.server.ts` (NEW — the lease-port DB adapter; sibling file, V1-004's files untouched)
- `frontend/src/lib/workforce/worker-registry.ts` (NEW)
- `frontend/src/lib/workforce/worker-registry-db.server.ts` (NEW)
- `frontend/src/lib/workforce/worker-host.ts` (NEW)
- `tests/unit/worker-host.test.ts` (NEW)
- `tests/unit/mission-lease-db.test.ts` (NEW)
- `tests/unit/worker-registry-db.test.ts` (NEW)
- `progress/v1-wave/V1-003-report.md` (NEW — this report)

## Architecture Impact

- The mission execution path's DB leg is no longer structurally dead: leases persist
  in `cg_mission_lease` and the V1-004 ports (`MissionLeasePort`/`MissionRecordPort`)
  are consumed UNMODIFIED — the adapter composes V1-004's record port rather than
  duplicating it.
- The neutral RBAC core is the ONLY authority route for workers: workforce delegation
  grants resolve into `MissionActorContext.extraPermissions`; nothing in the workforce
  module grants authority by itself (AGENTS §34 — the DB rows are data, the engine
  decides).
- Boundary respected: `lib/workforce/**` depends on `lib/missions` PORTS and
  `lib/kernel`/`lib/identity` primitives only — no vendor, no direct SQL outside the
  two server adapters.

## Tests

`npx vitest run tests/unit/worker-host.test.ts tests/unit/mission-lease-db.test.ts tests/unit/worker-registry-db.test.ts`:

```
 ✓ tests/unit/mission-lease-db.test.ts (11 tests) 17ms
 ✓ tests/unit/worker-host.test.ts (16 tests) 33ms
 ✓ tests/unit/worker-registry-db.test.ts (14 tests) 21ms
 Test Files  3 passed (3)   Tests  41 passed (41)
```

Coverage of the mandated scenarios:
- **worker registration** — envelope-stamped definition + capability rows; empty
  capability set valid with ZERO authority; duplicates rejected with zero writes;
  idempotent replay (§10).
- **delegation grant resolution** — active grants → tenant-embedded
  `extraPermissions` under `isAgent: true`; capability and risk-class escalation
  DENIED (never clamped); revoked grants contribute nothing; cross-tenant fails closed.
- **host loop happy path with heartbeat** — WAKE→EXECUTE→PERSIST→VERIFY→SLEEP phases,
  in-TTL heartbeats extend the lease, §12 evidence persisted, independent verifier
  decides `verified`, execution ends terminal.
- **lease handoff on heartbeat expiry** — an unheartbeated executor's success is
  rewritten to `lease_expired_during_execution`; the NEXT worker's own cycle recovers
  the orphan INLINE and takes attempt 2 to `evidenced`/`verified`.
- **retry exhaustion** — bounded attempts end in the `exhausted` terminal; the
  retry-backoff gate holds during the window; a terminal execution is never leased
  again (`attempts_exhausted` fires BEFORE the backoff gate).
- **quarantine** — crossing the failure bound records the ledger row, suspends the
  definition, and denies authority/leasing at the next check.
- **revocation-at-gate** — after `revokeDelegation`, the very next cycle denies
  (`unauthorized` via the gate; observable Invariant-12 denial via authority
  resolution) with zero effective permissions.
- **verifier independence** — a verifier plan resolving to the executor's own identity
  is refused with NO verification act (`verification_independence_refused`).
- DB-adapter level: lease exclusivity, heartbeat extension/denial, orphan recovery +
  sweep, cross-tenant fail-closed (same signal as unknown), malformed-row rejection
  (Zod), gate denial with zero writes, verified-terminal stage projection.

`npm run typecheck` (tsc --noEmit): clean. Targeted ESLint on all new files: clean.
Full `npm run verify` intentionally NOT run (mission law).

## Security Validation

- Fail-closed everywhere: unknown/cross-tenant operations share ONE signal; malformed
  rows throw (never coerce); gate denials write nothing; quarantine/lifecycle/revocation
  are evaluated READ-TIME at every check (no cache, no grace).
- Quarantine law: a worker at its failure bound is recorded and no longer leased to;
  the freeze is persistent (definition lifecycle → `suspended`).
- Verifier independence enforced at the host with a hard identity comparison and NO
  fallback attempt.
- Invariant 12 preserved: AI workers ignore role grants; authority only via explicit
  delegation `extraPermissions`, bounded by declared capability claims and the risk
  ceiling; escalation denied, never clamped.
- Database-enforced integrity: composite same-tenant FK, exactly-once-per-attempt
  uniqueness, state/revocation/release coherence CHECKs, RLS enabled + zero policies +
  anon/authenticated revoked.
- No migration applied; no real database touched; no secrets committed.

## Needed Edits to V1-004 Files (REPORTED, not made — file ownership)

1. **Per-phase instants in `runLeasedMissionExecution`** (mission-execution-store.ts):
   the driver accepts a SINGLE `now` (the wake instant), so completion/retry timestamps
   bind to lease-acquisition time. The host mitigates with fresh-instant heartbeats
   (liveness is the security-critical property), but the driver should thread per-phase
   instants (or a clock) so completion/failure/retry stamps reflect the actual act
   instants.
2. **Terminal-exhaustion retry stamp** (mission-execution-store.ts, in-memory store):
   the exhaustion branch spreads prior state and leaves the LAST `retryScheduledAt`
   stamped on the STORED execution even though it returns `retryScheduledAt: null`.
   Inert today (the `attempts_exhausted` acquire gate fires before the backoff check —
   asserted by test), but the terminal write should null it.
3. **`cg_execution_record.status` CHECK extension** (20260929000000 migration):
   `status` admits only `admitted|denied|rolled_back`; the DB record port therefore
   cannot project the execution-path stage progression (`leased/evidenced/verified/
   requeued/exhausted`) onto the record alone — the lease adapter composes lease rows
   to recover it. A follow-up migration may extend the status vocabulary (with the
   record port writing it) so the record is self-describing.
4. **`lastWorkerId` refinement** (record port): executions surfaced through the lease
   adapter report the CURRENT lease's worker; once the status vocabulary above lands,
   the record port could own a persisted `last_worker_id` for post-release audit.

## Known Risks

- The migration is UNAPPLIED until the coordinator applies it canonically; until then
  the DB lease adapter fails closed exactly as V1-004 reported (by design).
- Zero RLS policies means the tables are writable ONLY through service-role server
  functions; any future policy author MUST provably not widen worker authority
  (per the migration's own comment block).
- The driver's single-instant semantics (above) slightly coarsen completion/retry
  timestamps; security-relevant liveness is unaffected (final heartbeat gate).
- `cg_worker_delegation_grant.delegated_capabilities` is a jsonb array of strings —
  structure inside the array is enforced by the Zod read boundary, not by a CHECK.

## Remaining Work

- Coordinator: apply `20261003000019_coregrid_v1_mission_lease.sql` under explicit
  authorization; run the verification checklist in the migration footer.
- V1-004 file owners: consider the four reported edits above.
- Integration/E2E and RLS-policy authoring for the three new tables (next wave, under
  explicit authorization).

---

*Component: progress/v1-wave/V1-003-report.md — mission V1-003 (team WORKFORCE), Wave 3.*

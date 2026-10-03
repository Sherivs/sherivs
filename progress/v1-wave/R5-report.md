# R5 WORKFORCE-CLOCK — §42 REPORT

**Team:** R5 WORKFORCE-CLOCK (remediation wave, V1-003 follow-up)
**Mission:** Adopt injectable time in the worker host WITHOUT changing default behavior or
denial provenance (coordinator follow-up "workforce clock adoption with test alignment" —
the prior attempt was REVERTED for changing denial provenance).
**Status:** COMPLETE — default path proven byte-identical; adoption seam landed; all
workforce suites green.
**Branch:** `cursor/p08-foundation-loop-classification-fe86` (no branch switch; NO git
commit/push per mission law)
**Date:** 2026-10-03

---

## Implemented

1. **Inspected before modifying (Repository Discovery Law §22).** Read
   `frontend/src/lib/workforce/worker-host.ts`, the workforce tests
   (`tests/unit/worker-host.test.ts` — 16 host tests of the original 41-test trio), the
   V1-003 §42 report and the W3-INT §42 report. Key finding: the host ALREADY holds a
   required injectable clock (`deps.now`, J-023) threaded into heartbeats (lease-expiry
   checks / liveness gating), `verifyExecution` and quarantine; the ONLY un-threaded
   instant was the leased driver's per-phase `clock` seam added by W3-INT
   (`runLeasedMissionExecution` accepts `clock?: () => string`; when absent the driver
   keeps its deterministic single-wake-instant semantics — ONE `now` instant stamps
   acquisition, completion, failure and the bounded-retry gate). That single-instant
   default is exactly the load-bearing provenance the reverted follow-up broke.

2. **Fixture captured BEFORE any edit.** A temporary capture test ran three deterministic
   scenarios against the unmodified host and dumped byte-exact JSON
   (`/tmp/prechange-fixtures.json`, 8105 bytes): (A) happy path with heartbeat, evidence
   and independent verify; (B) failure with bounded-retry backoff; (C) liveness denial
   (success rewritten after the TTL lapses). The capture test was deleted after the
   fixture was pinned.

3. **Optional governed clock adoption in `worker-host.ts`** (the ONLY existing file
   modified — file ownership respected):
   - `WorkerHostDeps.clock?: () => string` (optional). Documented semantics: when
     supplied it SUPERSEDES `now` as the cycle's single time authority and is threaded
     into the leased driver as its per-phase `clock` (lease-acquisition and
     outcome-report stamps bind to the act instants). When absent (the default — every
     existing caller, including all 41 original trio tests' harnesses), the host is
     byte-identical to the pre-adoption behavior.
   - `const now = deps.clock ?? deps.now;` — with `clock` absent this reference IS
     `deps.now`; the whole cycle takes the identical pre-adoption code path.
   - Driver call passes `now: now()` (unchanged) plus `clock: deps.clock` — with
     `deps.clock === undefined` the driver's `input.clock ?? (() => input.now)` falls
     back to the single wake instant, byte-identical by construction.
   - **Truthful persist reporting for denied completions:** under an ADOPTED per-phase
     clock, the outcome-report act is evaluated at the act instant and can land past the
     lease TTL; the store then denies `lease_expired` with ZERO writes (fail-closed) and
     the driver surfaces `outcome: "failed"` + `denyCode`. The host previously would have
     claimed `failure recorded with bounded-retry backoff: …` in that case — factually
     false (nothing was recorded). The host now reports
     `completion denied (<denyCode>): <reason> — nothing persisted; the expired lease
     awaits recovery` and `persist.ok = false`. **Reachability on the default path:** the
     completion act runs at the wake instant, where the just-acquired lease cannot be
     expired (TTL > 0), so the instant-driven branch is unreachable without an adopted
     clock; the byte-identity fixture (below) pins the default output unchanged.

4. **New test file `tests/unit/workforce/worker-host-clock.test.ts`** (7 tests,
   self-contained fixtures mirroring — not modifying — the other team's
   `tests/unit/worker-host.test.ts`), proving:
   - **(a) Default byte-identity:** with no `deps.clock`, the host's full output (cycle
     results + stored execution records) is compared with `JSON.stringify(...)` string
     equality against the pre-adoption fixture pinned VERBATIM in the test file as a
     template literal (prettier-proof, key order included). Also pins the load-bearing
     single-instant provenance explicitly: `retryScheduledAt === "2026-10-01T12:00:01.000Z"`
     (wake + backoff base) even when the clock moved 40s mid-run.
   - **(b) Injection isolation:** with an adopted clock identical to the host clock, a
     happy-path cycle is FULLY identical to the default (deep equality of cycle AND
     stored execution); on a failure path with a mid-run clock advance (7s), the ONLY
     stored differences are the driver's per-phase outcome stamps (`updatedAt` T0→T0+7s,
     `retryScheduledAt` T0+1s→T0+8s) — every other field deep-equal, cycle decisions
     deep-equal.
   - **(c) Liveness-denial provenance under adoption is internally consistent:** the
     host's fail-closed liveness gate still rewrites the executor's past-TTL success; the
     completion act at T0+40s is denied `lease_expired` by the store (fail-closed, zero
     writes); the record keeps the expired-lease truth (stage `leased`, no failure count,
     no retry gate) and the denial instant is after the expiry the gate observed; the
     next acquire recovers the orphaned lease INLINE and advances the attempt
     (`exec-1:lease:2` acquired at T0+40.5s). A failure act INSIDE the TTL records its
     retry gate at the ACT instant (T0+21s), which really gates the adopted timeline
     (re-lease denied `retry_backoff` at T0+20.5s, granted at T0+21.5s, attempt 2).
   - **(d) Fail-closed adoption:** an adopted clock emitting an unparseable instant denies
     at the lease gate (`invalid_input`) with ZERO state change and no executor run.
   - **(e) Supersession:** with both `now` (frozen at T0) and `clock` supplied, heartbeats
     extend the lease on the ADOPTED clock's timeline (`leaseExpiresAt` T0+35s, not the
     stale T0+30s) and the verification act instant comes from the adopted clock.

## Files Changed

- `frontend/src/lib/workforce/worker-host.ts` (MODIFIED — optional `deps.clock` seam,
  supersession resolution, driver `clock` threading, truthful denied-completion persist
  reporting, header/doc comments)
- `tests/unit/workforce/worker-host-clock.test.ts` (NEW — 7 tests + pinned pre-adoption
  fixture)
- `progress/v1-wave/R5-report.md` (NEW — this report)

NOT touched (ownership law): `tests/unit/worker-host.test.ts`,
`tests/unit/mission-lease-db.test.ts`, `tests/unit/worker-registry-db.test.ts` (zero
assertion changes — the original trio passes unmodified), `frontend/src/lib/missions/**`
(the driver's clock seam is consumed, not modified), `frontend/src/lib/hermes/**`,
`frontend/src/lib/workforce/worker-launch.functions.ts`, the worker-missions route
(R7's), `tests/e2e`, `database/`, `scripts/`. A temporary fixture-capture test was
deleted after the fixture was pinned.

## Architecture Impact

- Domain ↓ Application ↓ Policy ↓ Infrastructure unchanged. The adoption is a
  caller-owned time input (J-023) threaded through the existing W3-INT driver seam — no
  vendor dependency, no new stage vocabulary, no FSM fork.
- J-023 closes end-to-end: the host can now hand a governed clock to the mission path so
  completion/failure/retry stamps reflect ACT instants, retiring the wake-instant
  mitigation W3-INT reported — but only for callers that explicitly adopt it.
- The host's persist report is now truthful under denied completions (never claims a
  persistence that did not happen) — an observability/audit honesty improvement that is
  unreachable on the default single-instant path (lease cannot be expired at the instant
  it was acquired; pinned by the byte-identity fixture).

## Tests

Fixture capture (pre-change host, before any edit) — three deterministic scenarios dumped
byte-exact, then pinned; the capture test deleted. Validation runs (real output):

`npx vitest run tests/unit/workforce`:

```
 ✓ tests/unit/workforce-kinds.test.ts (14 tests) 22ms
 ✓ tests/unit/workforce-capability-registry.test.ts (21 tests) 41ms
 ✓ tests/unit/workforce-lifecycle.test.ts (10 tests) 13ms
 ✓ tests/unit/workforce/worker-host-clock.test.ts (7 tests) 34ms
 ✓ tests/unit/workforce-positions.test.ts (8 tests) 6ms
 Test Files  5 passed (5)   Tests  60 passed (60)
```

The original workforce trio with ZERO assertion changes
(`npx vitest run tests/unit/worker-host.test.ts tests/unit/mission-lease-db.test.ts
tests/unit/worker-registry-db.test.ts`):

```
 ✓ tests/unit/worker-host.test.ts (16 tests) 74ms
 ✓ tests/unit/worker-registry-db.test.ts (14 tests) 21ms
 ✓ tests/unit/mission-lease-db.test.ts (14 tests) 31ms
 Test Files  3 passed (3)   Tests  44 passed (44)
```

(16 of these are the host tests; the trio totals 44 since W3-INT grew the lease-adapter
file from 11 to 14 — V1-003's original count was 41. No test in the trio was edited.)

Repo typecheck (`npm run typecheck`, tsc --noEmit): **clean for the entire repo except
three errors in ANOTHER team's untracked, in-progress WIP files**
(`frontend/src/lib/hermes/hermes-observation-db.server.ts`,
`frontend/src/lib/hermes/hermes-event-source.ts` — untracked `??` in git status, actively
edited in parallel; lib/hermes is explicitly outside my ownership). Proof of isolation:
with those WIP files temporarily moved aside, `npm run typecheck` exited 0 (no output)
and the files were restored byte-for-byte afterwards.

ESLint + Prettier on both changed files: clean
(`npx eslint <files>` no findings; `npx prettier --check <files>` "All matched files use
Prettier code style!").

Full unit suite at the end (`npx vitest run tests/unit`):

```
 Test Files  1 failed | 413 passed (414)
      Tests  2 failed | 8612 passed (8614)
```

The ONLY failures are in `tests/unit/hermes/hermes-observation-port.test.ts` (the same
team's untracked in-progress hermes work — not workforce, not touched by this mission).
Every workforce-related suite is green.

## Security Validation

- **Fail-closed preserved everywhere.** The liveness gate still rewrites a lost-lease
  success into a failure; an adopted clock that emits an unparseable instant denies at
  the lease gate (`invalid_input`) with zero writes (tested); a past-TTL completion act
  is denied `lease_expired` by the store with zero writes and the host reports it
  truthfully (tested).
- **No authority, tenant, or authorization semantics changed:** `clock` is a time input,
  never an authority input; `runtimeInstanceId` remains observability-only; WAKE
  authority resolution, verifier independence, quarantine and revocation paths are
  byte-identical on the default path (pinned fixture).
- **Default provenance is load-bearing and pinned:** the deterministic single-wake-instant
  stamps (failure/retry at wake + backoff, even after mid-run clock movement) are
  byte-pinned against the pre-adoption capture — the exact regression the reverted
  follow-up shipped cannot recur silently.
- Invariant 12 posture unchanged: no permission, scope or tenant decision reads the new
  optional clock.
- No secrets, no migration, no database access, no production policy touched.

## Known Risks

- **Adopted-path semantic corner (documented + tested, not a default-path change):** with
  an adopted clock, a completion act that lands past the lease TTL is denied by the store
  (fail-closed, zero writes) and recovery proceeds via the lease substrate's inline
  orphan recovery (attempt advances, no failure record, no backoff gate) — instead of the
  default path's backoff-gated failure record. This is the store's own per-phase
  semantics (W3-INT) applied at the act instant; it is internally consistent but differs
  in form from the default provenance. Operators adopting `clock` should understand that
  past-TTL outcome reports are refused rather than backdated.
- If a completion act were denied on the DEFAULT path for a NON-instant reason (store
  state anomaly), the host's persist detail would now read `completion denied …` instead
  of the old `failure recorded with bounded-retry backoff …` (which was factually false —
  the store wrote nothing). No existing test exercises that corner; the byte-identity
  fixture proves all exercised default scenarios are unchanged.
- The other teams' untracked hermes WIP currently breaks repo-level typecheck (3 errors)
  and 2 of its own unit tests; this is outside my ownership and pre-existing relative to
  this mission — flagged for the coordinator.

## Remaining Work

- Coordinator: full `npm run verify` once the hermes team's WIP lands (their typecheck
  errors and failing port test are the only red in the tree).
- Future operators: adopt `deps.clock` in the composition that wires `runWorkerHost`
  (worker-launch / worker-missions route — R7's files) when governed per-phase instants
  are wanted; adoption is opt-in and byte-identical when omitted.
- Optionally (V1-004 owner): consider surfacing denied completions with a distinct
  denyCode on the DB-path driver result for richer audit routing (reported, not made —
  file ownership).

---

*Component: progress/v1-wave/R5-report.md — team R5 WORKFORCE-CLOCK, remediation wave.*
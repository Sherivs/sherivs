# V1-002 Report — Hermes Executive Orchestrator Core (team HERMES)

Mission: V1-002 of the CoreGrid V1 program, Wave 4. Base branch: `cursor/p08-foundation-loop-classification-fe86`.
Report format: AGENTS.md §42. All evidence produced by commands run in this session (see Tests / Security Validation).
Version-target classification: **V1 organizational capability envelope** (AGENTS §45) — mission orchestration over the V1 mission/workforce/memory/rbac substrates. No V2/V3 scope touched.

## Implemented

Hermes now exists as a **governed coordinator, not a god-object** — a library-form orchestrator
cycle (`runHermesCycle`) over REAL, DB-backed system state, with zero self-owned authority. All new
code is under `frontend/src/lib/hermes/`; every dependency (`lib/missions/`, `lib/workforce/`,
`lib/memory/`, `lib/rbac/`, `lib/jarvis/`) was imported, never modified (verified by diff review).

1. **Pure contract (`hermes-contract.ts`)** — Hermes' governed identity surface and the cycle's
   typed vocabulary, all Zod-validated at the boundary:
   - `HermesObservationPort` (READ-ONLY): `listExecutions` / `listWorkerPostures` /
     `listVerificationRecords` — the server wiring reads `MissionExecutionState` rows (V1-004
     record ports), workforce registry postures (V1-003) and recorded verification decisions.
     Hermes performs no persistence through it (§27: server functions remain the APIs).
   - `HermesClaim<T>` (§9/§12): every claim about system state carries `source`, `sourceRef`
     (e.g. `cg_execution_record:<id>`, `cg_worker_definition:<id>`), `observedAt`, `verified`, and
     `confidence: "canonical" | "uncertain"`. DB-backed claims are canonical; `hermes_memory`
     claims are marked uncertain — **memory is never truth, and uncertain claims are marked,
     never promoted**.
   - Finding kinds (`mission_stuck`, `mission_failed`, `mission_denied`, `evidence_unverified`,
     `worker_quarantined`, `worker_suspended`), action classes, decisions, delegation outcomes,
     approval requests, and the structured `HermesCycleReport`.
2. **Action classifier (`hermes-classifier.ts`)** — the fail-closed gate between assessment and
   act. `classifyHermesAction` returns exactly `ALLOW | REQUIRE_APPROVAL | DENY`, each with a
   reason:
   - encoded, non-liftable deny rules (§45 bounded self-healing): `deploy` → `deploy_forbidden`,
     `delete_data` → `destructive_write_forbidden`, `purge_production_state` →
     `production_state_forbidden`, `modify_governance` → `governance_mutation_forbidden`,
     `grant_authority` → `self_authority_grant_forbidden`, unknown classes →
     `unknown_action_class` (no guessing);
   - critical/high-risk decisions (`execute_critical_action`, and any retry proposal whose
     UNDERLYING mission action matches `CRITICAL_ACTION_PATTERNS` — deploy/delete/payout/prod
     migration/secret rotation) produce a typed `REQUIRE_APPROVAL` routed to `human_operator`;
     the cycle never executes past the gate (§21);
   - the allow-list is the bounded self-healing envelope only: safe retries, repair intents,
     human escalation, provenance-preserving memory writes.
3. **Canonical memory integration (`hermes-memory.ts`)** — NO second memory architecture: all
   Hermes memory runs through the `MemoryTierAdapter` seam of `lib/memory/` (DB-backed at the
   server wiring; the in-memory adapter is the test fallback). One declared scope per tenant
   (`hermes:scope:<tenantId>`, domain `orchestration`, ceiling `internal`, actor scope = the
   governed Hermes worker id; declared with §12 `declaredBy`). Every decision record is stamped
   `provenance: { source: "hermes:orchestrator", generatedByAi: true, verified: false }` —
   AI-generated intelligence, never canonical truth (§9). Idempotent writes (deterministic
   record ids; prior decisions read back through the substrate's authorization-gated retrieval
   for the LEARN step only).
4. **The cycle (`hermes-cycle.ts`) — `runHermesCycle(deps, identity, input)`**, event/queue-
   triggered, WAKE→WORK→SLEEP (the cycle ENDS; there is no always-on Hermes process, §32):
   - **WAKE** — resolves Hermes' governed worker identity (a validated AI `WorkerDefinition` +
     its PRE-RECORDED human delegation grants, supplied by the caller from the DB registry).
     Hermes never mints or widens them (§6/§8). Tenant-scope and identity-kind checks fail closed.
   - **OBSERVE** — reads executions, worker postures and verification records through the
     read-only ports; counts reported in the cycle summary.
   - **ASSESS** — deterministic finding derivation: stuck (`assigned` past the staleness window,
     `leased` with an expired lease, `requeued` with an overdue retry pickup), failed
     (`exhausted` or a recorded FAILED verification), admission-`denied`, `evidenced`-but-
     unverified, quarantined workers, suspended workers. **Hermes-created repair missions
     (`hermes-repair-*`) are excluded from assessment — Hermes never orchestrates its own
     repairs (no recursion).**
   - **PRIORITIZE** — deterministic, explainable ordering: severity rank (critical, warning,
     info), then subject ref as the stable tie-break; every entry carries its rationale.
   - **ACT** — per finding, classifier-first:
     - `ALLOW` + retry/repair → **delegation through the ONLY lawful path**: a repair intent +
       assignment via V1-004's `MissionRecordPort` (`recordIntent` → `assignExecution`), under
       Hermes' OWN identity resolved through the neutral RBAC engine via
       `buildWorkerMissionActor` (workforce registry, V1-003). With zero active grants the
       resolved agent actor carries no `extraPermissions` and the engine DENIES (Invariant 12) —
       the delegation outcome is recorded as a denial with its reason, and the cycle escalates
       rather than acts. The intent's `authorityRef` cites the delegation grant (provenance of
       authority); `nonScope` excludes the destructive classes by construction.
     - `REQUIRE_APPROVAL` → a typed `HermesApprovalRequest` (`routedTo: "human_operator"`) + a
       jarvis-ladder escalation record — NEVER executed by Hermes.
     - `DENY` → recorded with the deny code; nothing is touched.
     - `escalate_to_human` → through the consumed jarvis escalation ladder (`escalateIncident`;
       evidence refs mandatory; records never auto-resolve).
   - **REPORT** — the structured `HermesCycleReport`: what was observed, every finding (with
     claim provenance), the prioritized assessments, every decision (verdict + acted + reason),
     every delegation (with its authority ref or denial reason), approval requests left for
     humans, escalations, memory writes with provenance, and deferred findings above the
     per-cycle bound. The human-facing summary is composed with the consumed jarvis briefing
     composer.
   - **LEARN/SLEEP** — decision provenance written through the canonical memory tier; the cycle
     sleeps. Memory informs the NEXT cycle's LEARN step only — it is never consulted as state of
     record (§9).
5. **`lib/jarvis/` fold classification (§52)** — `escalation.ts` and `briefing.ts` are CONSUMED
   as-is (imported by the cycle); `jarvis-contract.ts` is SUPERSEDED by `hermes-classifier.ts`
   (the enumerated-capability evaluator is replaced by neutral-RBAC authority resolution over
   pre-recorded grants + the fail-closed action classifier) and is retained unmodified, marked
   superseded in the Hermes module headers. Nothing in `lib/jarvis/` was deleted or edited.
6. **Unit tests (`tests/unit/hermes-cycle.test.ts`, 19 tests)** — see Tests.

## Files Changed

Created (all within the declared file ownership):
- `frontend/src/lib/hermes/hermes-contract.ts` — pure contract, claims, ports, Zod schemas
- `frontend/src/lib/hermes/hermes-classifier.ts` — fail-closed DENY/REQUIRE_APPROVAL/ALLOW gate
- `frontend/src/lib/hermes/hermes-memory.ts` — canonical memory tier integration (provenance)
- `frontend/src/lib/hermes/hermes-cycle.ts` — `runHermesCycle` (WAKE→WORK→SLEEP) + assess/
  prioritize pure functions
- `tests/unit/hermes-cycle.test.ts` (19 tests)
- `progress/v1-wave/V1-002-report.md` (this report)

Not modified (imported only, per mission law): `lib/missions/**`, `lib/workforce/**`,
`lib/memory/**`, `lib/rbac/**`, `lib/jarvis/**`. No git commands run; no real database touched.

## Architecture Impact

- **Coordinator, not god-object (§11)**: Hermes holds no state of its own beyond the canonical
  memory tier, performs no direct I/O, and owns no runtime. Every observation is a port read;
  every act is either a delegation through V1-004's ports, an escalation through the jarvis
  ladder, or a provenance-stamped memory write.
- **Domain ↓ Application ↓ Policy ↓ Infrastructure respected**: Hermes depends on pure contracts
  and port interfaces only; vendors appear nowhere (the memory adapter is injected).
- **Authority flows only through the neutral RBAC engine (Invariant 12)**: Hermes' actor context
  is built by `buildWorkerMissionActor` from its definition + pre-recorded grants; role
  membership is worthless for the AI-classified Hermes — no grants, no acts (tested).
- **Verification independence untouched**: Hermes cannot verify (it is neither an executor of
  record nor a `mission_verifier`); unverified evidence is assessed and escalated, never
  self-verified. Hermes-created repair missions are excluded from its own assessments.
- **Canonical truth preserved (§9)**: DB-backed port reads are canonical claims; Hermes
  assessments are derived intelligence, provenance-stamped and confidence-marked; Hermes memory
  is `generatedByAi: true, verified: false` — never truth.
- **jarvis fold**: escalation + briefing contracts reused; the capability-list evaluator
  superseded (documented, retained).

## Tests

- `npx vitest run tests/unit/hermes-cycle.test.ts` — **19 passed**:
  - full cycle over seeded state (stuck/requeued/exhausted/denied/evidenced/failed-verification
    executions + quarantined/suspended workers): all seven phases ok, all finding kinds derived,
    DB-backed claims canonical with source refs, deterministic prioritization, lawful delegation
    recorded with its authority ref, escalations recorded, memory written;
  - blocked-mission detection: staleness-window `assigned`, overdue `requeued` retry,
    `exhausted` and failed-verification as critical, admission `denied`, unverified evidence,
    and zero findings from Hermes' own repair missions (no recursion);
  - delegation through the RBAC engine: a Hermes with NO delegation grants CANNOT act — zero
    successful intents/assignments, typed denial reason, repair execution does not exist;
    with grants, every act is signed by the resolved governed identity (`assignedBy: "hermes-1"`);
  - approval gate: a stuck mission on a critical underlying action (`deploy-*`) yields
    `REQUIRE_APPROVAL` routed to `human_operator` with an escalation record — and NO intent and
    NO repair execution is created;
  - deny rules: all five destructive action classes denied with distinct codes, unknown classes
    denied, and a retry proposal for a critical underlying action elevated to the approval gate
    (class never launders underlying risk);
  - memory provenance: one declared scope with §12 `declaredBy`; every record stamped
    `hermes:orchestrator` / `generatedByAi: true` / `verified: false`; memory-sourced claims
    marked `uncertain`, DB-backed claims `canonical`;
  - idempotency: re-run over unchanged state replays every delegation (§10 exactly-once via the
    deterministic intent key + idempotency key) and writes ZERO new memory records.
- Neighbor regressions: `worker-host` (16), `mission-execution` (28), `memory-db-adapter` (21),
  `jarvis-contract` (18), `rbac-neutrality` (18) — **101 passed, zero regressions** (120 total
  with the new suite).
- `npx tsc --noEmit` (frontend) — clean. ESLint on all new files — clean (prettier auto-fix only).
- Full `npm run verify` intentionally NOT run (per mission law); targeted vitest only.

## Security Validation

- **Fail-closed authority (§5/§8, Invariant 12)**: Hermes' authority is resolved exclusively
  through the neutral RBAC engine from pre-recorded delegation grants; the no-grant case is
  tested end-to-end (zero external effect). The classifier cannot be asked to lift a deny rule —
  no override parameter exists; unknown classes are denied, not guessed (tested).
- **Approval gate (§21)**: critical actions and critical-underlying retries produce typed
  `REQUIRE_APPROVAL` outcomes routed to `human_operator`; the test proves nothing is executed
  past the gate (no intent, no execution row).
- **Destructive-action deny rules (§45)**: deploy / delete / production-state purge /
  governance mutation / self-authority grant are encoded deny rules in code, each tested.
- **Canonical truth (§9/§12)**: every claim carries source + sourceRef + verified/confidence
  markers; Hermes memory is stamped AI-generated and unverified; uncertain claims are marked in
  the type itself. Memory writes pass the canonical substrate's declared-scope J-017 guard —
  no silent expansion possible.
- **Tenant isolation (§13/§31)**: the cycle is tenant-scoped (worker postures of other tenants
  are skipped; WAKE fails closed on a definition/cycle tenant mismatch); memory scope is bound
  to the tenant by the substrate.
- **No secrets, no destructive ops, no boundary moved**: no policy, RLS, migration or governance
  rule changed; no secrets introduced or logged; no real database touched.

## Known Risks

1. **Observation breadth is V1-minimal**: the read-only port exposes executions, worker
   postures and verification records. Deeper platform observability (metrics, incidents,
   payments) is a future extension of the same port — the cycle's ASSESS step is the only place
   that must change.
2. **Critical-action detection is lexical** (`CRITICAL_ACTION_PATTERNS` on the mission action
   string). A future mission should carry machine-readable risk classification on mission
   intents so criticality is structural, not pattern-matched (reported, not decided here).
3. **Repair missions are assigned but not executed by Hermes**: Hermes delegates (intent +
   assignment); actually running a repair execution is the worker-host path's (V1-003) job and
   remains outside this mission's ownership, by design.
4. **Hermes' per-cycle bound** (`maxFindingsPerCycle`, default 20) defers excess findings to the
   next cycle; under sustained alert pressure, deferral starvation is possible — the report
   surfaces deferred findings explicitly for human oversight.

## Remaining Work

1. Server wiring: implement `HermesObservationPort` over the DB adapters
   (`mission-execution-db.server.ts`, `worker-registry-db.server.ts`) and register the cycle on
   an event/queue trigger — the mission-scoped library is wiring-agnostic by design.
2. Grant a Hermes worker definition + delegation grant through the governed registration path
   (control-plane decision; Hermes must never self-register).
3. Follow-up decision: structural risk classification on mission intents (see Known Risks 2).
4. Coordinator: run full `npm run verify`.

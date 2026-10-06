# ARCHITECTURAL RECONNAISSANCE MAP — JARVIS AUTONOMOUS ENTERPRISE DIRECTIVE (WAVE 1)

Document: architecture/jarvis-workforce/ARCHITECTURAL_RECONNAISSANCE_MAP.md
System: CoreGrid Platform
Version: v1.0
Created: 2026-10-06
Creator: credential-integration / jarvis-workforce wave-1 agent (GLM 5.3 Flash), under operator directive 2026-10-06
Authority: operator "COREGRID JARVIS AUTONOMOUS ENTERPRISE AI WORKFORCE COMMAND DIRECTIVE" (2026-10-06); AGENTS.md (CoreGrid ASI Constitution v1.0) §23 workflow, §45 V1 boundary, §59-§61 of the directive itself (reconnaissance → reconciliation → scope lock → build).
Verification: read-only repository reconnaissance by four parallel audits (2026-10-06); every claim below cites an in-repo path; machine-checked by `npm run verify:workforce` (scripts/verification/workforce-role-catalog-validate.mjs).
Version-target classification: **V1 organizational capability envelope only** (AGENTS.md §45; V2 device/IoT and V3 Reality Intelligence untouched — see §5 of this map).

---

## 1. Purpose

The directive's own §59 orders reconnaissance BEFORE implementation, §60 orders reconciliation
(what exists / is correct / partial / duplicated / broken / missing / must change / reusable /
frozen), and §61 orders a V1 workforce scope lock before mass implementation. This map is the
execution of those three steps. It does not implement new architecture beyond the scope lock
itself; it records what the reconnaissance found and what was therefore built (the scope lock
and the first V1 Jarvis planning slice) versus what was deliberately NOT built (duplicates,
frozen scope, un-ratified ownership).

## 2. Phase universe (all 51 canonical phases)

Authority chain: `CONSTITUTION.md` → `REGISTRY.md` → `DEPENDENCY.md` → `BOUNDARIES.md` →
`DECISIONS.md`; machine authority `architecture/registry.json` (51 phases, 50 capabilities,
2 runtimes), enforced by `scripts/verification/registry-validate.mjs` and the drift guard
(`scripts/verify-registry-drift.mjs`, baseline 2026-09-30, shrink-only ratchet).

Status histogram (registry-declared, 2026-10-06): **COMPLETE 15, IMPLEMENTING 18,
ARCHITECTURE_DEFINED 18**; version targets ACTIVE-V1 ×27, MIXED ×10, FUTURE-V3 ×4,
FUTURE-UNASSIGNED ×9. 34 phases carry measured unit tests (5,281 total attributed via
`scripts/verification/registry-test-attribution.mjs`). Phases 34–35 and 37–51 are
documents + kernel contracts only (no measured tests, no implementation).

## 3. Capability reconciliation — directive §58/§60 matrix

The directive lists the infrastructure it wants implemented (§46/§58). The honest finding is
that MOST OF IT ALREADY EXISTS AND IS TESTED. "Exists" claims below are evidence-cited.

| Directive requirement | Status | Existing substrate (no duplication created) |
| --- | --- | --- |
| Mission Engine (§34) | EXISTS-FULL | `frontend/src/lib/mission/mission-contract.ts` (15-state lifecycle, RULING-5), `frontend/src/lib/missions/mission-execution.ts` + `-store.ts` + `-db.server.ts`, `frontend/src/lib/control-plane/foundation-mission.ts`, `frontend/src/lib/foundation-loop.functions.ts`; DB `cg_mission_intent`/`cg_execution_record`/`cg_execution_history`/`cg_foundation_evidence`/`cg_verification_result` (`database/supabase/migrations/20260929000000_coregrid_foundation_mission_001.sql`) |
| Mission states | EXISTS-FULL | Same 15-state machine + execution stage machine + DB CHECK constraints |
| Worker Registry (§4) | EXISTS-FULL | `frontend/src/lib/workforce/worker-registry.ts`, `worker-definition.ts`, `capability-registry.ts`, DB `cg_worker_definition`/`cg_worker_capability`/`cg_worker_delegation` (`20261002000002_coregrid_v1_worker_definitions.sql`) |
| Workforce Runtime (§5 lifecycle) | EXISTS-FULL (library-form) | `frontend/src/lib/workforce/worker-host.ts` (WAKE→EXECUTE→PERSIST→VERIFY→SLEEP), `worker-launch.functions.ts` + `worker-launch-runtime.server.ts` (live, fail-closed `BLOCKED_NO_CREDENTIAL`), persistent definitions survive termination; leases ephemeral |
| Mission leases / heartbeats / stall detection (§52) | EXISTS-FULL | `cg_mission_lease` migration `20261003000019`, `frontend/src/lib/missions/mission-lease-db.server.ts` (acquire/heartbeat/TTL/orphan recovery/bounded retries) |
| Tool authorization firewall (§23) | EXISTS-FULL | `frontend/src/lib/workforce/tool-runtime.ts` (sandbox gate, capability gate, credential-lease handles, redacted invocation records) |
| Secrets boundary (§24) | EXISTS-FULL | `frontend/src/lib/security/credential-broker.ts`, credential registry `frontend/src/lib/providers/provider-credentials.ts` (34 entries, secret-shape hygiene), secret scanners `scripts/verification/secret-scan.mjs`, `scripts/verify-secrets-hygiene.mjs` |
| Context assembly (§17) | EXISTS-FULL | `frontend/src/lib/context-assembly.ts` (first-class exclusion records), `frontend/src/lib/context/switch-safety.ts`, `context/memory-scope-enforcement.ts`, `frontend/src/lib/ai-context.ts` (trust classification, injection defense) |
| Memory (§38) | EXISTS-FULL | `frontend/src/lib/memory/memory-store.ts` (tiers, fail-closed retrieval), `memory-db-adapter.server.ts` (`cg_memory_scope`/`cg_memory_record`/`cg_memory_access_log`), `knowledge-currency.ts` |
| Evidence (§21) | EXISTS-FULL | `frontend/src/lib/evidence/capture.ts` (J-034 classes, no laundering, append-only), `cg_evidence_record` lifecycle migration |
| Verification / four-eyes (§20) | EXISTS-FULL | `frontend/src/lib/verification.ts` (verifier ≠ executor), `frontend/src/lib/assurance/verification-independence.ts`, `decideVerification` in the foundation loop |
| Policy engine / authorization (§19) | EXISTS-FULL | `frontend/src/lib/security-role-gate.ts` (P08 canonical gate), `rbac/role-gate.ts`, `authorization.ts` (RBAC+ABAC+ReBAC+PBAC, five-valued decisions) |
| AI Gateway (§32/§33) | EXISTS-FULL | `frontend/src/lib/ai-gateway.server.ts` (budget, rate limit, metering), `ai-gateway/model-registry.ts` (J-014 routing + fallback chains + health), `reasoning-provenance.ts`, `output-trust-pipeline.ts` (§21 lifecycle), `egress-allowlist.ts`, `runtime-defenses.ts` (prompt-injection §22) |
| Observability (§29) | EXISTS-FULL | `frontend/src/lib/observability/provider-health.server.ts` (13-provider battery), `structured-log.ts` (redaction), `health.json` route |
| Audit (§69-72 invariants) | EXISTS-PARTIAL | Append-only `cg_execution_history` (anti-mutation trigger), webhook audit logs, provenance checker — broad audit registry not unified |
| Deployment / CI/CD (§46) | EXISTS-FULL | `.github/workflows/` (verify, security-batteries, drift-watch, infrastructure-verify, manual-only plan/apply, release with health-gate + auto-rollback + BLK-3 fail-closed), Vercel API provisioning `scripts/provision-vercel-env.mjs` |
| **JARVIS executive runtime (§2/§28)** | **WAS TYPES-ONLY → V1 slice built this wave** | `frontend/src/lib/jarvis/jarvis-contract.ts` (8 capabilities, 9 enforced MUST-NOT deny codes), `briefing.ts`, `escalation.ts` existed tested-but-unwired; **NEW**: `frontend/src/lib/jarvis/executive-loop.ts` — the pure planning cycle (observe → detect → staff → propose → escalate → report) + `frontend/src/lib/workforce/role-catalog.ts` (the staffing source). Live execution remains gated by worker-launch (fail-closed, EXTERNAL REVIEW PENDING) |
| Workforce performance metrics (§40) | ABSENT (honest gap) | No per-worker metrics registry; cost-attribution substrate exists (`cg_*` cost tables + adapters). Future V1 work; NOT built this wave (no owner ratified) |
| Durable workflow-run persistence / scheduler / queue daemon | ABSENT (honest gap) | Workflow engine + outbox are pure/in-memory by design ("requires an approved migration"); no cron/daemon infra. The workforce runs on-demand via server functions, not daemons — consistent with §5 (persistent identity ≠ persistent compute) |
| Organizational memory for Jarvis (§39) | EXISTS-PARTIAL | Governed memory tier exists; Jarvis-specific strategic-memory assembly not wired. Future V1 work behind PLATFORM-003 ratification watch |

## 4. Phase-52 reconciliation (directive §7/§48 — CORRECTED)

The directive assumes Phase 52 is "the workforce capability source corpus" of engineering
roles and disciplines. **Reconnaissance falsifies that assumption, and the honest correction
is recorded (§65: do not fabricate):**

- The Phase-52 corpus (`architecture/phase-52-cross domain and engineering sections`,
  115,807 lines; extracts in `architecture/phase-52-extracts/`, 313 inventoried blocks) is a
  **cross-domain DESIGN corpus** (reality intelligence, physical entity intelligence,
  simulation, CoreObject/Entity/Event contracts) — NOT a role/discipline taxonomy. Corpus
  term frequencies: "role(s)" 347 (generic prose), "discipline" 3, "capability definition" 2.
- Decomposition ALREADY EXISTS machine-readably (directive §48's matrix columns are covered):
  `architecture/COREGRID_PHASE_52_ROUTING_DECOMPOSITION.json` (5,232 records: 466 CONFLICTING,
  4,759 DEFERRED, 2 EXISTING_CANONICAL_OWNER, 5 PROPOSED_UNOWNED),
  `COREGRID_PHASE_52_V1_FUTURE_CLASSIFICATION.json`,
  `COREGRID_PHASE_52_DECOMPOSITION_MAP.json`, plus reconciliation/verification/gap-register
  reports and the Campaign-52 program (WP-01/WP-02 packets + decision ledger).
- The Campaign-52 receiving record in `REGISTRY.md` states `SCOPE_RECORDED_IMPLEMENTATION_DENIED`:
  **registered phase capacity remains 51; Phase 52 is not registered; implementation is denied.**
- **Decision applied (DECISIONS.md #206)**: the V1 workforce capability source is the
  directive's own §§8–15 division/role taxonomy + the existing workforce substrate — NOT the
  Phase-52 corpus. Nothing was deleted, frozen material stays frozen (`architecture/future/
  COREGRID_FUTURE_ARCHITECTURE_REGISTER.json`). No new canonical phase was created (§48:
  do not create a phase to avoid deciding ownership).
- Recorded drift finding (honest, unresolved): every Phase-52 artifact cites source SHA-256
  `A69A3E74…` / 1,844,342 bytes, but the tracked corpus file hashes `7365DA0E…` /
  1,728,535 bytes (same line count). This drift is unacknowledged anywhere in-repo and is
  left for a human-governed Phase-52 decision — this wave does not touch the corpus.

## 5. Freeze reconciliation (§47)

Un-touched frozen scope honored this wave: FUTURE-V2 (device/IoT, phase-15 boundary review),
FUTURE-V3 (phases 37/41/44/46, geospatial/simulation), FUTURE-UNASSIGNED (34/35/38/45/47–51).
Workforce roles adjacent to frozen planes (ml-engineer, sdk-engineer, growth-intelligence) are
classified V2/DEFERRED_BEYOND_V2 and FROZEN in the catalog; reality-architect carries explicit
forbidden operations `v3_reality_intelligence_implementation` and `twin_capability_implementation`.

## 6. What was built this wave (scope-locked, §61)

1. **V1 AI Workforce Scope Lock** — `frontend/src/lib/workforce/role-catalog.ts`: 64 role
   definitions across the directive's 9 divisions (§§8–15), each with division, V5.3
   classification (V1=59, V2=1, DEFERRED_BEYOND_V2=2, REQUIRES_ARCHITECTURAL_DECISION=2),
   §19 authority levels (never collapsed; execute+verify never co-held), risk ceiling,
   capability slugs, substrate refs to EXISTING in-repo modules (validator enforces existence
   on disk — AD-161/164 reuse law becomes a build gate), forbidden operations
   (`state_fabrication` mandatory on all 64), and §5/§16 instantiation policy (exactly one
   persistent control-plane role: Jarvis; all others dynamic_on_mission; all non-V1 frozen).
2. **Jarvis V1 executive loop** — `frontend/src/lib/jarvis/executive-loop.ts`: pure planning
   cycle — evidence-classed observation intake (fail-closed §21 claim classes), §30 condition
   vocabulary with deterministic severity, dynamic staffing against the role catalog with
   executor/verifier independence (§20), mission proposals that always carry
   verification/evidence/rollback plans (§34), honest escalation when staffing is impossible
   (never a fabricated team), and a §55 executive briefing where executed/verified claims
   without evidence refs fail closed. It PLANS and never EXECUTES — the same discipline as
   `mission-runner.ts`; live adoption stays behind worker-launch authorization.
3. **Machine gate** — `scripts/verification/workforce-role-catalog-validate.mjs` wired into
   `npm run verify` as `verify:workforce` (after `verify:registry`).
4. **Tests** — `tests/unit/workforce/role-catalog.test.ts` (22), `tests/unit/jarvis-executive-loop.test.ts` (16).

## 7. Deliberately NOT built (restraint record, §58/§60)

- No workforce-performance metrics registry (no ratified owner; cost-attribution substrate
  exists for it to land on later).
- No scheduler/queue daemon (V1 workforce is on-demand by design; durable workflow
  persistence requires an approved migration per the workflow engine's own contract).
- No Phase-52 re-routing, registration, or implementation (Campaign-52 record denies it).
- No modification of `architecture/registry.json` (drift baseline untouched; this wave adds
  no canonical phase and moves no ownership).
- No Jarvis live-execution wiring (worker-launch live AI execution remains
  EXTERNAL-REVIEW-PENDING / BLOCKED_NO_CREDENTIAL by design).

## 8. Next governed steps (proposal — human ratification decides order)

1. Jarvis organizational-memory assembly (strategic/architectural/operational tiers over the
   existing memory store) — V1, gated on PLATFORM-003 watch.
2. Workforce performance metrics registry over the cost-attribution substrate (§40/§41).
3. Jarvis condition sources: wire provider-health battery output into `ExecutiveObservation`
   intake through an authorized server function (the loop is ready; the adoption boundary is
   the human-governed step).
4. Phase-52 corpus hash-drift acknowledgment decision (human).
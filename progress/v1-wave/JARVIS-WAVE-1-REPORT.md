# JARVIS-WAVE-1 REPORT — V1 workforce scope lock + executive-loop planning slice (2026-10-06)

System: CoreGrid Scholar | Branch: `cursor/p08-foundation-loop-classification-fe86` | PR: #2 (draft)
Governance: AGENTS.md (CoreGrid ASI Constitution v1.0) — §42 report format, §59 first-action reconnaissance, §60 architecture reconciliation, §61 V1 workforce scope lock, §65 absolute prohibitions, §45 V1-only envelope, §22 repository discovery law.
Operator authorization: in-chat directive 2026-10-06 — "JARVIS AUTONOMOUS ENTERPRISE AI WORKFORCE COMMAND DIRECTIVE" (begin with reconnaissance; do not fabricate; do not skip governance; do not implement before V1 workforce scope lock; then build).
Governance record: DECISIONS.md **#206 (PLATFORM-015 — JARVIS V1 workforce scope lock + executive-loop planning slice)**, RATIFIED 2026-10-06.
Version-target classification: **V1 organizational capability envelope only** (§45). Non-V1 workforce capabilities are classified and FROZEN, never deleted (§47).

## Implemented

- **Reconnaissance first (directive §59, no coding before it)**: four parallel evidence-cited inspections covered (1) all 51 canonical phases + `architecture/registry.json` + phase-52 corpus + kernel contracts, (2) mission/worker/orchestration/runtime substrate, (3) intelligence plane (gateway, context assembly, memory, evidence, verification, policy), (4) providers/security/infrastructure/tests/deployment. Findings are recorded in the reconciliation map (`architecture/jarvis-workforce/ARCHITECTURAL_RECONNAISSANCE_MAP.md`).
- **Architectural map + §60 reconciliation** (`architecture/jarvis-workforce/ARCHITECTURAL_RECONNAISSANCE_MAP.md`): directive-requirement ↔ existing-substrate table with EXISTS-FULL / EXISTS-PARTIAL / EXISTS-TYPES-ONLY / ABSENT verdicts and in-repo paths. Key verdicts: mission engine (15-state lifecycle), worker registry, worker host (WAKE→EXECUTE→VERIFY→SLEEP), leases, tool runtime firewall, AI gateway + model routing (J-014), context assembly, memory store, evidence capture, and verification independence already exist — they are consumed, NOT duplicated (§58). Jarvis was EXISTS-TYPES-ONLY (contract + briefing + escalation, tested, unwired) — that was the genuine V1 gap addressed this wave. Deliberately NOT built: workforce performance metrics, scheduler/queue daemon, durable workflow persistence (needs an approved migration), full organizational-memory assembly — each requires its own governed decision.
- **V1 Workforce Scope Lock (directive §61)**: `frontend/src/lib/workforce/role-catalog.ts` — 64 roles across the directive's 9 divisions, every role carrying classification, authority levels (observe/analyze/propose/execute/verify/approve/deploy/emergency — §19 distinction law), max risk class, mission capabilities, in-repo substrate refs, forbidden operations, and instantiation policy. Cross-field laws enforced in-module: V1 requires ≥1 existing substrate ref; non-V1 frozen observe-only; execute+verify never co-held (four-eyes, §20); no approve at critical ceiling; `state_fabrication` forbidden for all. Exactly one persistent control-plane role: **jarvis — planning authority only, no execute/approve/deploy** (directive §3: Jarvis commands the organization; the organization performs the work). Histogram: V1=59, V2=1 (sdk_engineer), DEFERRED_BEYOND_V2=2 (ml_engineer, growth_intelligence_agent), REQUIRES_ARCHITECTURAL_DECISION=2 (knowledge_engineer, memory_systems_engineer — PLATFORM-003 dependency).
- **Executive-loop planning slice (the wired V1 Jarvis gap)**: `frontend/src/lib/jarvis/executive-loop.ts` — `runExecutiveLoop({tenantRef, objectives, observations, now, roles?})` → `{evaluatedAt, acceptedObservations, rejectedObservations, detectedConditions, missionProposals, escalations, briefing}`. Claim classes per §21 (observed/inferred/proposed/executed/verified/unknown): executed/verified claims without `evidenceRef` are rejected as `unverified_claim`; unknown claim class is rejected as state fabrication. Fixed 17-condition detection vocabulary (§30 set: database_degradation … mission_timeout), deterministic severity, capability→role staffing from the locked catalog, mission PROPOSALS always carrying verification/evidence/rollback plans, honest escalation when no V1 role can staff a capability (never a fabricated team). The loop PLANS; execution stays with the existing mission engine and worker host.
- **Machine gate (§31 testing standard)**: `scripts/verification/workforce-role-catalog-validate.mjs` + npm script `verify:workforce` (wired into the `verify` chain after `verify:registry`). Machine-asserts: catalog validates, every V1 substrate ref EXISTS on disk (with path-escape check), exactly one persistent control-plane role (jarvis) holding no execute/approve/deploy authority, non-V1 roles frozen, executive-loop export present. Exit 0/1.
- **Tests**: `tests/unit/workforce/role-catalog.test.ts` (22 tests) + `tests/unit/jarvis-executive-loop.test.ts` (16 tests) — 38/38 passing.
- **DECISIONS.md #206 (PLATFORM-015)** records the scope lock, the executive-loop slice, the Phase-52 reconciliation, and the machine gate.

## Reconciliation (§60 — what was reused, what was built, what was frozen)

- **REUSED (not duplicated)**: `frontend/src/lib/mission/mission-contract.ts` (15-state mission lifecycle), `frontend/src/lib/workforce/worker-registry.ts` + `worker-definition.ts` + `capability-registry.ts`, `frontend/src/lib/workforce/worker-host.ts` (WAKE→EXECUTE→VERIFY→SLEEP), `frontend/src/lib/workforce/tool-runtime.ts` (tool firewall), `frontend/src/lib/missions/mission-lease-db.server.ts` (leases), AI gateway + model registry (J-014 routing), context-assembly, memory store, evidence capture, verification independence, `AGENT_RISK_CLASSIFICATIONS` from `agent-core`.
- **BUILT (new, minimal)**: role catalog (scope lock), executive-loop planning slice, machine gate, recon map — nothing more.
- **FROZEN (classified, preserved)**: V2 (sdk_engineer), DEFERRED-BEYOND-V2 (ml_engineer, growth_intelligence_agent), REQUIRES-ARCHITECTURAL-DECISION (knowledge_engineer, memory_systems_engineer) — all observe-only until a ratified human decision un-freezes them.
- **Phase-52 correction (directive §7 assumption reconciled, not copied)**: the Phase-52 corpus is a 115k-line cross-domain DESIGN corpus, not a workforce role taxonomy; it is already inventoried by `COREGRID_PHASE_52_ROUTING_DECOMPOSITION.json` (466 CONFLICTING / 4,759 DEFERRED), and the Campaign-52 receiving record that DENIES registering/implementing Phase 52 continues to be honored. Workforce capabilities were extracted from EXISTING in-repo substrate instead. No new canonical phase; `architecture/registry.json` untouched (shrink-only ratchet).

## Security Validation

- §19 authority model: eight distinct authority levels per role; no role collapsed to ADMIN=EVERYTHING; jarvis explicitly cannot execute/approve/deploy.
- §20 four-eyes: no role co-holds execute and verify; the machine gate asserts this and the single-control-plane invariant.
- §21 anti-hallucination: unverified executed/verified claims are structurally rejected, not trusted; the briefing integrity check throws on executed/verified claims lacking evidence.
- §45 freeze discipline: non-V1 roles are frozen observe-only; no V2/V3 capability was implemented.
- §30 secret hygiene: no secrets touched; no secret values printed or committed; the gate reads repository files only.
- §65 prohibitions: nothing fabricated (no invented teams — unstaffable capabilities escalate; no invented metrics; no registry.json mutation; Phase-52 hash drift recorded as an open human decision, not silently "fixed").

## Verification

- `npx tsc --noEmit` → exit 0.
- `npx vitest run tests/unit/workforce/role-catalog.test.ts tests/unit/jarvis-executive-loop.test.ts` → 38/38 passed.
- `npm run verify:workforce` → PASS (64 roles validated, substrate refs on disk, single planning-only control-plane role).
- Full `npm run verify` gate run recorded in the commit (typecheck + unit + registry + workforce + drift + neutrality + secrets + build).

## Known Risks

- The executive loop is PLANNING-ONLY: mission proposals are data, not executions. Wiring proposals into the live mission engine requires the existing fail-closed credential gates (BLOCKED_NO_CREDENTIAL) and remains for the next governed window.
- Two roles (knowledge_engineer, memory_systems_engineer) are REQUIRES_ARCHITECTURAL_DECISION pending PLATFORM-003 — they cannot staff capabilities until resolved.
- Open HUMAN-ONLY item carried from reconnaissance: Phase-52 artifact hash drift (cited SHA `A69A3E74…`/1,844,342 B vs actual `7365DA0E…`/1,728,535 B) — an agent must not "repair" this silently.

## Remaining Work

- Next agent window (governed, in directive order): wire `runExecutiveLoop` proposal intake into the mission engine behind existing credential/authorization gates; add workforce performance metrics (mission completion/verification-pass/rework rates — §40) once missions flow.
- Human decisions required: Phase-52 hash-drift adjudication; PLATFORM-003 resolution to unblock the two REQUIRES_ARCHITECTURAL_DECISION roles.
- Explicitly deferred pending approvals: durable workflow persistence (needs an approved migration), scheduler/queue daemon (by design absent).
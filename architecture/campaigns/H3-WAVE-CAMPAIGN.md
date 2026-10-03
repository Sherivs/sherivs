# H3 WAVE — 100 ENGINEERING TEAMS CAMPAIGN (2026-10-03)

Authority: AGENTS.md (CoreGrid ASI Engineering Constitution) §22, §23, §38, §42.
Wave command: H3-000 (Engineering Campaign Coordinator).
Branch: `cursor/p08-foundation-loop-classification-fe86` (PR #1). All work lands here via the coordinator.

## CAMPAIGN LAW (binds every team)

1. **Mission, not tasks.** Each team owns ONE mission outcome end-to-end: design, implement, test, evidence, report.
2. **Role.** Every team operates under a named engineering role and answers for it (Golden Questions: WHO/WHAT/WHERE/WHY/UNDER WHICH POLICY).
3. **Strictly disjoint file ownership.** Touch ONLY the files in your OWNERSHIP. Everything else is read-only. Shared files (`architecture/registry.json`, `package.json`, workflow files, posture JSONs, registry-test-attribution.mjs, the battery script) are owned by exactly one named team or by the coordinator — never two.
4. **No git.** Teams never run git commands. The coordinator stages and commits.
5. **No canonical access.** Teams never touch any database. Migrations are AUTHORED, never applied. The coordinator runs the serialized canonical apply + live battery after the wave.
6. **Secrets.** Never print, log, or write a secret value. Credential-gated code must fail closed to BLOCKED_NO_CREDENTIAL semantics (exit 2 pattern) like the exemplars.
7. **Code quality.** Strict TypeScript, no `any`, no `z.any()`; Zod-validated contracts; no new dependencies (package.json is frozen this wave).
8. **Domain neutrality (J-037, shrink-only).** No education/domain vocabulary in `frontend/src/lib/**` code. New contract modules live in their OWN subdirectory under `frontend/src/lib/<area>/` (root-level `.ts` files and `frontend/src/lib/kernel/phase-contracts/` are neutrality-guard scanned — avoid new files there).
9. **Tests offline.** Run ONLY your own test files (`npx vitest run <files>`). Never run the full `npm run verify` (concurrent teams). Never weaken an existing test to pass.
10. **Honesty.** Never claim applied/proven what was not executed. Report BLOCKED with the reason rather than faking evidence. Report format: Implemented / Files Changed / Tests / Security Validation / Known Risks / Remaining Work.
11. **Report artifact.** Write your §42 report to `progress/h3-wave/<MISSION-ID>.report.md` (your ownership) before returning.

## SQUADS

- **Squad A (A-001..A-008)** — Recovery & Resilience: M-R-101 groundwork.
- **Squad B (B-009..B-023)** — J-gap closures (STREAM J ledger).
- **Squad C (C-024..C-030)** — Threat mitigations: PARTIAL → ENFORCED or evidence-ready.
- **Squad D (D-031..D-040)** — Zero-policy posture adjudication (30 tables, 3 per team).
- **Squad E (E-041..E-045)** — Launch-gate drills (BLK-2/3/4/5, GOV-P63).
- **Squad F (F-046..F-053)** — Observability & operations.
- **Squad G (G-054..G-080)** — Architecture-defined phase activations (phases 34–51).
- **Squad H (H-081..H-090)** — Quality & CI hardening.
- **Squad I (I-091..I-093)** — Payments & economics.
- **Squad J (J-094..J-100)** — Governance & documentation.

## MISSION GRAPH

### Squad A — Recovery & Resilience

- **A-001 Recovery Drill Runner Engineer.** MISSION: build `scripts/verify-recovery-drill.mjs` in the battery exemplar's image — `--rehearse` (offline: validates the drill plan, backup-manifest shapes, target contracts; exit 0/1/2 semantics), live mode strictly credential-gated (BLOCKED_NO_CREDENTIAL, never prints secrets). OWNERSHIP: `scripts/verify-recovery-drill.mjs`, `tests/unit/h3-001-recovery-drill.test.ts`. Acceptance: offline rehearsal PASS with zero network; unit suite green.
- **A-002 Recovery Targets Engineer.** MISSION: Zod contract for RTO/RPO declarations per record family (`frontend/src/lib/reliability/recovery-targets.ts`), fail-closed defaults, tests. OWNERSHIP: that file + `tests/unit/h3-002-recovery-targets.test.ts`.
- **A-003 Backup Manifest Engineer.** MISSION: typed backup-manifest schema (what a valid backup set is: scope, checksums, instant, expiry, tenant coverage) `frontend/src/lib/reliability/backup-manifest.ts` + tests. Consumable by A-001's rehearsal.
- **A-004 DR Runbook Engineer.** MISSION: `docs/runbooks/recovery-drill.md` — operator-grade drill procedure citing the runner, manifests, targets, and the battery's cleanup/verification discipline.
- **A-005 Restore Rehearsal Engineer.** MISSION: `docs/runbooks/restore-rehearsal-checklist.md` — step-by-step restore rehearsal checklist with evidence-recording slots (no live execution).
- **A-006 Backup-Expiry Strategist (J-042).** MISSION: `architecture/adr/ADR-011_BACKUP_EXPIRY_DISCIPLINE.md` — reconcile erasure/retention (ADR-005, tombstone law) with backup lifetime; decision + consequences recorded.
- **A-007 Recovery Chaos Engineer.** MISSION: `tests/failure/h3-007-recovery-chaos.test.ts` — failure-path tests for recovery tooling (corrupt manifest, missing checksum, expired backup set, partial scope).
- **A-008 Recovery CI Integrator.** MISSION: `architecture/campaigns/h3/recovery-ci-wiring.md` — design for extending `.github/workflows/security-batteries.yml` with the recovery drill (do NOT edit the workflow file; coordinator applies).

### Squad B — J-gap closures

- **B-009 (J-007) Credential Broker Engineer.** Extend `frontend/src/lib/security/credential-broker.ts`: per-agent scoping enforcement depth (no universal master credential; least-scope issuance; expiry honored) + `tests/unit/h3-009-credential-broker-depth.test.ts`.
- **B-010 (J-009) Identity Lifecycle Proof Engineer.** `tests/unit/h3-010-identity-lifecycle.test.ts` — exhaustive proof that revoked/suspended/expired identities fail closed through `frontend/src/lib/authorization.ts` (read-only on the engine; if a gap is found, record a FINDING report, do not weaken anything).
- **B-011 (J-010) Lockdown Path Engineer.** Extend `frontend/src/lib/security/lockdown.ts`: emergency revocation/kill-switch semantics depth + `tests/unit/h3-011-lockdown.test.ts`.
- **B-012 (J-011) Context Package Auditor.** `frontend/src/lib/context/package-completeness.ts` — Zod checker proving memory_scope/data_scope/risk_level/trace_id completeness + `tests/unit/h3-012-context-package.test.ts`.
- **B-013 (J-012) Switch-Safety Runtime Engineer.** `frontend/src/lib/context/switch-safety-runtime.ts` — runtime guard for tenant/reality switches (no bleed) + `tests/unit/h3-013-switch-safety.test.ts`.
- **B-014 (J-020) Event Kernel Semantics Engineer.** `tests/unit/h3-014-event-kernel.test.ts` — taxonomy/dedup/ordering/significance semantics proofs against the event contracts (read-only on kernel modules).
- **B-015 (J-026) Mission Gate Engineer.** `frontend/src/lib/mission/gates.ts` — definition/security/verification/closure gate contracts (PASSED/BLOCKED fail-closed) + `tests/unit/h3-015-mission-gates.test.ts`.
- **B-016 (J-027) Worker Substrate Enforcement Engineer.** `tests/unit/h3-016-worker-bounds.test.ts` — authority bounds/delegation depth on the existing worker contracts; posture decision input for `cg_worker_*` tables (write your decision doc to `architecture/campaigns/h3/posture-adjudication/` per Squad D law, tables D-033/D-034 own those docs — you only supply the enforcement tests).
- **B-017 (J-028) Capability Registry Engineer.** `frontend/src/lib/agent-runtime/capability-matching.ts` — delegation-contract matching depth + `tests/unit/h3-017-capability-matching.test.ts`.
- **B-018 (J-029) Memory Scoping Enforcer.** `frontend/src/lib/context/memory-scope-enforcement.ts` — no silent scope expansion + `tests/unit/h3-018-memory-scoping.test.ts`.
- **B-019 (J-031) Quota & Lease Engineer.** `frontend/src/lib/reliability/quotas.ts` — resource-quota contracts layered on the lease contracts + `tests/unit/h3-019-quotas.test.ts`.
- **B-020 (J-032) Approval Chain Engineer.** `frontend/src/lib/approval/chains.ts` — ESCALATE/REQUIRE_APPROVAL resolution-flow contracts (risk-classified routing, human closure) + `tests/unit/h3-020-approval-chains.test.ts`.
- **B-021 (J-035) Independence Enforcer.** `frontend/src/lib/assurance/independence-enforcement.ts` — worker cannot verify own output (typed check + helpers) + `tests/unit/h3-021-independence.test.ts`.
- **B-022 (J-036) Injection Defense Engineer.** `frontend/src/lib/security/injection-defense.ts` — prompt-injection/malicious-artifact defense contracts + `tests/unit/h3-022-injection-defense.test.ts`.
- **B-023 (J-045) Adapter Failure-Semantics Engineer.** `frontend/src/lib/adapters/failure-semantics.ts` — timeouts/containment/degraded-mode contract layered on `AdapterFailurePolicy` + `tests/unit/h3-023-failure-semantics.test.ts`.

### Squad C — Threat mitigations

- **C-024 (L-T-002) CI Battery Integrator.** Extend `.github/workflows/security-batteries.yml` so the RLS battery runs on every merge to the PR (workflow_dispatch + pull_request paths, concurrency lock kept) and document the residual gap honestly. OWNERSHIP: the workflow file + `progress` report only.
- **C-025 (L-T-007) Egress Enforcement Engineer.** `frontend/src/lib/ai-gateway/egress-allowlist.ts` — runtime egress allowlist enforcement at the gateway boundary (provider endpoints only) + `tests/unit/h3-025-egress.test.ts`.
- **C-026 (L-T-009) Webhook Drill Engineer.** `docs/runbooks/webhook-signature-drill.md` + `architecture/campaigns/h3/webhook-drill-evidence-template.md` — the BLK-4 live evidence procedure (gated; no live keys used).
- **C-027 (L-T-011) File Substrate Engineer.** AUTHOR (never apply) `database/supabase/migrations/20261003000016_coregrid_v1_file_substrate.sql` + rollback: `cg_file_object` with FORCE RLS + tenant-scoped policies (neutral primitives only), plus posture entry JSON snippet (in the migration header, NOT in the posture file) + `tests/unit/h3-027-file-substrate.test.ts`.
- **C-028 (L-T-012) Durable Idempotency Engineer.** AUTHOR (never apply) `database/supabase/migrations/20261003000017_coregrid_v1_idempotency_substrate.sql` + rollback + `frontend/src/lib/command/idempotency-store.db.ts` (DB-backed store implementing the existing in-memory interface's contract) + `tests/unit/h3-028-idempotency-store.test.ts`.
- **C-029 (L-T-015) Memory Retrieval Defender.** `tests/unit/h3-029-memory-retrieval-authz.test.ts` — adversarial proof that memory retrieval is authorization-gated (no bypass path).
- **C-030 (L-T-016) Context-Bleed Adversary.** `tests/failure/h3-030-context-bleed.test.ts` — adversarial switch-safety battery on B-013's runtime guard.

### Squad D — Zero-policy posture adjudication (3 tables each)

LAW: you do NOT edit `scripts/verification/rls-table-postures-*.json` (team J-099 merges rationales from your decision docs). For each table: adjudicate zero-policy-by-design (with cited rationale: which server path owns the data, why no client policy is legitimate in V1) or record a PROPOSED policy direction (author nothing applied). Write one decision doc per table under `architecture/campaigns/h3/posture-adjudication/<table>.md` + one unit test `tests/unit/h3-0XX-posture-adjudication.test.ts` asserting your decisions' internal consistency (tables exist in migrations, battery scope contains them as zero-policy).

- **D-031:** `cg_entity`, `cg_relationship`, `cg_event`
- **D-032:** `cg_observation`, `cg_workspace`, `cg_workspace_member`
- **D-033:** `cg_org_unit`, `cg_worker_definition`, `cg_worker_capability`
- **D-034:** `cg_worker_delegation`, `cg_memory_scope`, `cg_memory_record`
- **D-035:** `cg_memory_access_log`, `cg_reconciliation_verdict`, `cg_event_security`
- **D-036:** `cg_event_security_denial`, `cg_event_security_redaction`, `cg_event_route_queue`
- **D-037:** `cg_event_route_cursor`, `cg_event_route_outcome`, `cg_evidence_lifecycle_act`
- **D-038:** `cg_reasoning_provenance_snapshot`, `cg_usage_attribution_rollup`, `cg_knowledge_source`
- **D-039:** `cg_knowledge_freshness_contract`, `cg_knowledge_invalidation`, `cg_knowledge_downgrade`
- **D-040:** `cg_tool_runtime_tool`, `cg_tool_runtime_invocation`, `transport_buses`

### Squad E — Launch-gate drills

- **E-041 (BLK-2) AI Live Drill Engineer.** `scripts/verify-ai-gateway-live.drill.mjs` (credential-gated governed end-to-end inference drill; BLOCKED_NO_CREDENTIAL without keys) + `docs/runbooks/ai-gateway-live-drill.md` + `tests/unit/h3-041-ai-drill.test.ts` (offline gate tests only).
- **E-042 (BLK-3) Deployment Monitor Engineer.** `frontend/src/lib/observability/deployment-gate.ts` (serving-URL monitoring gate contract) + `docs/runbooks/deployment-monitoring-gate.md` + `tests/unit/h3-042-deployment-gate.test.ts`.
- **E-043 (BLK-4) Payment Rail Drill Engineer.** `scripts/verify-payments-live.drill.mjs` (credential-gated TEST-MODE round; refuses live keys by design) + `docs/runbooks/payment-rail-drill.md` + `tests/unit/h3-043-payments-drill.test.ts` (offline gate tests only).
- **E-044 (BLK-5) Communication Probe Engineer.** `scripts/verify-communication-live.drill.mjs` (credential-gated provider probe) + `docs/runbooks/communication-probe.md` + `tests/unit/h3-044-communication-drill.test.ts`.
- **E-045 (GOV-P63) Ratification Engineer.** `architecture/campaigns/h3/gov-p63-ratification-packet.md` — the defer/minimize gate's ratification packet (what is deferred, why, residual risk).

### Squad F — Observability & operations

- **F-046 Metrics Registry Engineer.** `frontend/src/lib/observability/metrics-registry.ts` (typed metric families, no PII in labels) + `tests/unit/h3-046-metrics-registry.test.ts`.
- **F-047 Trace Propagation Engineer.** `frontend/src/lib/observability/trace-context.ts` (trace_id/correlation_id propagation contract) + `tests/unit/h3-047-trace-context.test.ts`.
- **F-048 Audit Query Surface Engineer.** `frontend/src/lib/audit/query-surface.contract.ts` (tenant-scoped, server-only audit read contract) + `tests/unit/h3-048-audit-surface.test.ts`.
- **F-049 Health Map Engineer.** `frontend/src/lib/observability/health-map.ts` (dependency health inventory feeding the existing health endpoint contract) + `tests/unit/h3-049-health-map.test.ts`.
- **F-050 Drill Scheduler.** `docs/runbooks/drill-schedule.md` — the unified drill calendar (recovery, webhook, AI, payments, communication) with cadence + evidence slots.
- **F-051 SLO Card Author.** `architecture/observability/slo-cards.md` — SLO cards per V1 phase area (objective, indicator, target, owner).
- **F-052 Log Redaction Auditor.** `tests/unit/h3-052-log-redaction.test.ts` — sweep proving no password/token/secret logging in server modules (static assertions on cited files).
- **F-053 Telemetry Adoption Engineer.** `tests/unit/h3-053-telemetry-adoption.test.ts` — deepen `mh-27` substrate-telemetry adoption coverage.

### Squad G — Architecture-defined phase activations (phases 34–51)

Contract Architect missions author `frontend/src/lib/<slug>/contracts.ts` (Zod-typed, fail-closed, neutral vocabulary) + `tests/unit/h3-0XX-<slug>.test.ts`. Verifier missions author deeper adversarial suites `tests/unit/h3-0XX-<slug>-verification.test.ts` against a completed contract module (import it read-only; do not modify it — every contract module G-054..G-071 is complete before verifier teams G-072..G-080 launch).

- **G-054** Contract Architect — phase 34 cognitive-architecture (`frontend/src/lib/cognitive-architecture/`)
- **G-055** Contract Architect — phase 35 multi-agent-society (`frontend/src/lib/multi-agent-society/`)
- **G-056** Contract Architect — phase 36 memory-knowledge (`frontend/src/lib/memory-knowledge/`)
- **G-057** Contract Architect — phase 37 simulation-engine (`frontend/src/lib/simulation-engine/`)
- **G-058** Contract Architect — phase 38 evolution-engine (`frontend/src/lib/evolution-engine/`)
- **G-059** Contract Architect — phase 39 governance-alignment (`frontend/src/lib/governance-alignment/`)
- **G-060** Contract Architect — phase 40 universal-runtime-fabric (`frontend/src/lib/universal-runtime-fabric/`)
- **G-061** Contract Architect — phase 41 sandbox-runtime (`frontend/src/lib/sandbox-runtime/`)
- **G-062** Contract Architect — phase 42 zero-trust-defense (`frontend/src/lib/zero-trust-defense/`)
- **G-063** Contract Architect — phase 43 universal-interface (`frontend/src/lib/universal-interface/`)
- **G-064** Contract Architect — phase 44 planetary-infrastructure (`frontend/src/lib/planetary-infrastructure/`)
- **G-065** Contract Architect — phase 45 ai-compute (`frontend/src/lib/ai-compute/`)
- **G-066** Contract Architect — phase 46 twin-civilization (`frontend/src/lib/twin-civilization/`)
- **G-067** Contract Architect — phase 47 self-improvement (`frontend/src/lib/self-improvement/`)
- **G-068** Contract Architect — phase 48 knowledge-graph (`frontend/src/lib/knowledge-graph/`)
- **G-069** Contract Architect — phase 49 autonomous-economy (`frontend/src/lib/autonomous-economy/`)
- **G-070** Contract Architect — phase 50 human-interface (`frontend/src/lib/human-interface/`)
- **G-071** Contract Architect — phase 51 reality-os-kernel (`frontend/src/lib/reality-os-kernel/`)
- **G-072** Verifier — phase 34 cognitive-architecture
- **G-073** Verifier — phase 35 multi-agent-society
- **G-074** Verifier — phase 36 memory-knowledge
- **G-075** Verifier — phase 37 simulation-engine
- **G-076** Verifier — phase 39 governance-alignment
- **G-077** Verifier — phase 40 universal-runtime-fabric
- **G-078** Verifier — phase 42 zero-trust-defense
- **G-079** Verifier — phase 44 planetary-infrastructure
- **G-080** Verifier — phase 46 twin-civilization

### Squad H — Quality & CI hardening

- **H-081 Flake Elimination Engineer.** Deflake `tests/unit/domain-runtime-recertification.test.ts` (spawnSync contention; make it deterministic — timeouts, output capture, retry-with-same-expectations only). OWNERSHIP: that test file only.
- **H-082 Attribution Completion Engineer.** Expand `scripts/verification/registry-test-attribution.mjs` SUBJECT_MAP/PREFIX_MAP to attribute the new h3- test files (convention: `h3-` prefix map). OWNERSHIP: the registry file only.
- **H-083 Strict-TS Sweep Engineer.** `architecture/campaigns/h3/strict-ts-sweep.md` — repo-wide `any`/`z.any()` census with per-file dispositions; fix ONLY files under `frontend/src/lib/reliability/`, `frontend/src/lib/security/`, `frontend/src/lib/observability/` (bounded ownership).
- **H-084 Zod Coverage Engineer.** `architecture/campaigns/h3/zod-coverage-audit.md` — server-function input-validation coverage audit with findings.
- **H-085 Secrets-Hygiene Engineer.** `scripts/verify-secrets-hygiene.mjs` — static scan for committed secret-shaped strings (never real values; test fixtures only) + `tests/unit/h3-085-secrets-hygiene.test.ts`.
- **H-086 Dependency Lockstep Engineer.** `architecture/campaigns/h3/dependency-lockstep-policy.md` — pinning/upgrade policy (package.json frozen; policy doc only).
- **H-087 §27 Expansion Engineer.** `tests/unit/h3-087-invariant-expansion.test.ts` — §27-style checks for the wave's new server-side contract modules (fail-closed auth/tenant/validate/audit posture).
- **H-088 Posture Validation Engineer.** `tests/unit/h3-088-posture-validation.test.ts` — battery posture-parse edge cases (merge order, duplicate rejection, invalid recipes) against the exported pure functions (read-only).
- **H-089 Failure Battery Expansion Engineer.** `tests/failure/h3-089-failure-expansion.test.ts` — quota/lease/approval-chain failure paths.
- **H-090 Verify Budget Engineer.** `architecture/campaigns/h3/verify-budget.md` + `scripts/verify-budget.mjs` — verify-chain runtime census and budget policy.

### Squad I — Payments & economics

- **I-091 (J-044) Legacy Tier Reconciliation Engineer.** `frontend/src/lib/payments/legacy-tier-reconciliation.ts` — implement the legacy subscription-tier → neutral entitlement mapping (pure, typed, fail-closed) + `tests/unit/h3-091-legacy-tiers.test.ts`.
- **I-092 Paystack Hardening Engineer.** `tests/unit/h3-092-paystack-failure-semantics.test.ts` — timeout/degraded-mode/failure semantics for the Paystack adapter (read-only on the adapter).
- **I-093 Metering Reconciliation Engineer.** `tests/unit/h3-093-metering-reconciliation.test.ts` — roll-up conservation depth (J-043): every in-scope record lands in exactly one bucket; defects surface, never absorb.

### Squad J — Governance & documentation

- **J-094 ADR Librarian.** `architecture/adr/INDEX.md` + `architecture/adr/TEMPLATE.md`.
- **J-095 Provenance Auditor.** `scripts/verify-provenance-metadata.mjs` + `tests/unit/h3-095-provenance.test.ts` — machine check that key governance artifacts carry provenance (AGENTS §12).
- **J-096 Twin Governance Engineer.** `tests/unit/h3-096-twin-governance.test.ts` — a Digital Twin is not a permission bypass (assertion suite over the twin contracts).
- **J-097 KG Provenance Engineer.** `tests/unit/h3-097-kg-provenance.test.ts` — knowledge-graph relationship contracts carry provenance/ownership/authorization/confidence.
- **J-098 Operator Decision Packet Engineer.** `architecture/campaigns/h3/operator-decision-packet.md` — COND-003/004/005/006/009 + J-049 mobile membership: each with options, recommendation, decision slot.
- **J-099 Posture Rationale Merger.** Read every `architecture/campaigns/h3/posture-adjudication/*.md` (Squad D) and merge the adjudicated rationale strings into `scripts/verification/rls-table-postures-*.json` (rationale fields only — never posture/policy values). Run `node scripts/verify-rls-isolation-battery.mjs --dry-parse-scope` + the posture unit suite. OWNERSHIP: the two posture JSON files + your report. Runs in the FINAL batch.
- **J-100 Campaign Scribe.** `architecture/campaigns/h3/MISSION-GRAPH.md` — the wave's completion-verification matrix (ID → ownership → acceptance → evidence slot) + §42 report template the coordinator fills.

## COORDINATOR (H3-000) RESERVED OWNERSHIP

`git` operations; canonical/dev database apply + live battery; `architecture/registry.json`; `package.json`; `architecture/phase-completion-status.md`; PR #1; thematic commits. No team may touch these.

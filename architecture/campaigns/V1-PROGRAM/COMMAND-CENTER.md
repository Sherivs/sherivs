# COREGRID V1 COMMAND-CENTER REPORT

Generated: 2026-10-03 | Branch: `cursor/p08-foundation-loop-classification-fe86` | Method: 6 parallel discovery agents, file-grounded evidence only.
Law: nothing below is inferred from prose. Every status is backed by source inspection, migration state, or test output.

---

## 1. ACTUAL STATE INVENTORY

| # | Surface | Status | Evidence |
|---|---------|--------|----------|
| 1 | Repository | Single TanStack Start app (`frontend/`, React 19, Vite 8, nitro, Tailwind v4, Zod 4, Supabase JS, `ai` SDK) named `coregrid-scholar`; `api/`, `backend/`, `mobile/`, `agents/` are README-only stubs. No `npm start`. | discovery scan |
| 2 | Web application | 155 route modules; 74 server functions in 30 `*.functions.ts` (29 JWT-gated via `requireSupabaseAuth`); real auth, real Paystack webhook (HMAC-SHA512), password-reset audit. GAPS: ~20 placeholder zero-state pages; `/command-centre` hardcoded demo substrate; app shell imports Scholar symbols directly (`ALL_NAV_CONTRIBUTIONS`, `scholarCapabilitiesForRole`) — neutrality bypass. | `frontend/src/routes/**`, `**/*.functions.ts` |
| 3 | Mobile (iOS/Android) | ABSENT. README stub; no Expo/RN/Capacitor deps anywhere. | `mobile/`, `package.json` |
| 4 | Backend / runtime | Single-process nitro; NO workers, cron, queue consumers, Redis, or Edge Functions; event-fabric delivery pass manual-only. | scan |
| 5 | Database | 63 migrations / 23 rollbacks; canonical Supabase project `nwrflbpbhyiqdptmlccm`; 14 checksum-verified hardening migrations applied; RLS registry 39 tables (9 policy-backed / 30 zero-policy), live-battery-proven; NO pgvector. | `database/`, RLS battery 39/39 PASS |
| 6 | AI runtime | EXECUTABLE governed gateway (`ai-gateway.server.ts`): fail-closed deny, budgets, rate limits, model registry, egress allowlist. 3 real call sites (Scholar expense/timetable/lesson-plan). No recorded passing live drill in-repo. | `ai-gateway.server.ts` |
| 7 | Workforce | Worker tables exist (`cg_worker_definition/capability/delegation`) but NO code writes them; ToolRuntime executable-as-library with zero production callers; foundation-loop is the only DB-persisted executable mission slice. | scan |
| 8 | Hermes | ABSENT as code. UI label + `lib/jarvis/` pure contracts only. No orchestrator loop, no delegation, no monitoring. | scan |
| 9 | Onboarding | Scholar-specific only: `createSchoolWithAdmin`, env-gated `provisionDemoEnterprise` with fixed demo creds in `DEMO_CREDENTIALS` constant. No platform-level dynamic org provisioning. | scan |
| 10 | Public website | Per-tenant Scholar site only (education sections). NO platform marketing site, no pricing, no dynamic organization-website engine. | scan |
| 11 | Dynamic workspace | Workspace routes exist and are DB-backed for Scholar; not generated from neutral runtime configuration. | scan |
| 12 | Communication | Email contracts + NOT_FOR_LIVE_USE stub; NO Resend; NO Vapi; one real Twilio voice call site; real VAPID web push. | `push.server.ts`, digital-twin.functions.ts |
| 13 | PWA | Dynamic manifest + icons + push-only SW. **BUG: `frontend/public/sw.js` + `robots.txt` not copied to build** (publicDir mismatch: vite uses `/workspace/public`, files live in `frontend/public/`); no offline shell. | `vite.config.ts`, `frontend/public/` |
| 14 | iOS | ABSENT (no Xcode/EAS artifacts). | scan |
| 15 | Android | ABSENT (no Gradle/AAB artifacts). | scan |
| 16 | Deployment | Dockerfile (healthcheck `/health.json`) + `release.yml` fail-closed on missing BLK-3 SSH secrets; Terraform authored-NOT-applied; no pushed image evidence. | `Dockerfile`, `.github/workflows/` |

## 2. CAPABILITY CLASSIFICATION COUNTS

Derived from Phases 01–51 registry + Phase 52 corpus (313 blocks → 413 blueprints, 348 UNSCOPED) + discovery gaps, reconciled into the V1 capability matrix (see `V1-CAPABILITY-MATRIX.md`):

- **V1: 41** — 18 implemented · 10 partial · 13 absent (must be built)
- **V2: 24**
- **DEFERRED-BEYOND-V2: 17** (each carries an explicit dependency/regulatory/maturity reason)

Existing V1 artifacts confirmed and adopted as inputs: `COREGRID_V1_SCOPE_LOCK.json`, `COREGRID_V1_LAUNCH_CRITERIA.json` (18 criteria), `COREGRID_V1_CAPABILITY_CATALOG.json` (32 capabilities), `COREGRID_V1_BLOCKERS.json` (16), 93 V1CAP IDs, 14 COND conditions.

## 3. CRITICAL CONTAMINATION FINDING

- Restaurant: properly isolated as a declared fixture (`lib/domain-config/restaurant.ts`, namespace-clean) — TEST FIXTURE ONLY, retained.
- Education: CONTAMINATES platform layer. `authorization.ts` (17 hits, `COREGRID_ROLES` hardcodes school_admin/teacher/student), `security-role-gate.ts` (31 hits), `identity.ts` (`RelationshipType` enrolled_in/parent_of/teaches), 10+ `education-*`/`academic-*` modules at `lib/` root, plus ~30 single-hit legacy files. → V1-006 neutralization mission.

## 4. BLOCKERS (EXTERNAL, HONEST)

| ID | Blocker | State |
|----|---------|-------|
| BLK-3 | Deploy SSH / Terraform credentials absent | release.yml fail-closed (correct); in-VM Docker build+healthcheck used as substitute evidence |
| BLK-4 | Paystack live keys absent | webhook tested with real HMAC path, no live charge |
| BLK-5 | Resend / Vapi credentials absent | adapters implement fail-closed exit-2 no-credential semantics |
| — | Apple / Google store credentials absent | mobile artifacts generated; store submission reported as EXTERNAL REVIEW PENDING |
| — | AI_API_KEY unconfigured in VM | gateway fail-closed deny is correct behavior, not a defect |

## 5. PROPOSED TEAMS → WAVE 1 MISSIONS

Ownership boundaries are disjoint; every mission reads AGENTS.md, reports per §42 to `progress/v1-wave/`, writes only its own files + its own vitest files.

| Mission | Objective | Owner (team) |
|---------|-----------|--------------|
| V1-001 | PWA build fix: publicDir correction, sw.js/robots.txt ship, favicon, offline shell | PLATFORM |
| V1-002 | Hermes executive orchestrator core over existing `cg_*` tables; memory via canonical adapter boundary | HERMES |
| V1-003 | Workforce execution host: DB wiring for `cg_worker_*`, WAKE→EXECUTE→PERSIST→VERIFY→SLEEP | WORKFORCE |
| V1-004 | Mission execution path: generalize foundation-loop (intent→assign→lease→execute→evidence→verify), DB-backed | MISSION |
| V1-005 | Memory DB adapter (`cg_memory_*`) per memory-store.ts:227 documented future adapter | MEMORY |
| V1-006 | Platform RBAC neutralization (neutral core + Scholar adapter) — HIGHEST RISK, 8,364 tests must stay green | SECURITY |
| V1-007 | Platform public site + pricing (visitor→signup path) | WEB |
| V1-008 | Onboarding engine: platform-level org provisioning from neutral `DomainDefinition` | ONBOARDING |
| V1-009 | Communication adapters: Resend email, provider abstraction; fail-closed no-credential semantics | COMMS |
| V1-010 | Mobile foundation: Expo scaffold in `mobile/`, shared contracts, auth+missions+workspace, `eas.json` | MOBILE |
| V1-011 | Placeholder page disposition: V1-or-V2 per page, DB-backed or honestly classified | WEB |
| V1-012 | Command-centre DB backing (replace hardcoded demo with reality queries) | WEB |
| F-13 | E2E vertical slice: Playwright journey visitor→signup→org→onboarding→mission→evidence | QA |
| F-14 | Deployment verification: Docker build + run + healthcheck in-VM, evidence captured | INFRA |

## 6. DEPENDENCY GRAPH (CRITICAL PATH)

```
V1-006 (RBAC neutral) ─┬─> V1-008 (onboarding) ─┬─> V1-004 (missions DB) ──> V1-003 (workers) ──> V1-002 (Hermes)
                        └─> V1-007/V1-011/V1-012 │
V1-001 (PWA fix, independent)                    │
V1-005 (memory adapter) ─────────────────────────┘─> V1-002
V1-009 (comms, independent until Hermes notify)  │
V1-010 (mobile, depends on V1-004 contracts)     │
F-13 (vertical slice) <── all of the above
F-14 (deploy evidence, independent)
```

Parallelizable immediately: V1-001, V1-005, V1-006, V1-007, V1-009, V1-010 (scaffold), F-14.

## 7. EXECUTION DECLARATION

COREGRID V1 ARCHITECTURE SCOPE IS NOW LOCKED FOR WAVE 1 per §9: the 41 V1 capabilities above constitute the locked set; any new mandatory capability discovered during execution is added to V1 architecture and built (§8), not deferred by default.

Proceeding into Phase F: parallel engineering.

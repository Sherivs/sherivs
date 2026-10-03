# COREGRID V1 MASTER MISSION PORTFOLIO

Machine-readable mission graph. Status lifecycle per §47: DEFINED → DESIGNED → IMPLEMENTED → EXECUTED → OBSERVED → VERIFIED → CONFORMANT → DEPLOYED → OPERATIONAL.

```json
{
  "program": "COREGRID-V1",
  "scopeLock": "architecture/campaigns/V1-PROGRAM/V1-CAPABILITY-MATRIX.md",
  "reportDiscipline": "AGENTS.md §42 -> progress/v1-wave/",
  "missions": [
    {"id":"V1-001","objective":"PWA build fix: correct publicDir so sw.js/robots.txt ship, add favicon, offline shell basics","team":"PLATFORM","deps":[],"files":["vite.config.ts","frontend/public/**","public/**"],"risk":"LOW","status":"VERIFIED"},
    {"id":"V1-002","objective":"Hermes orchestrator core: observe/assess/prioritize/decompose/delegate over cg_* tables; memory via canonical adapter boundary; no self-granted authority","team":"HERMES","deps":["V1-004","V1-003","V1-005"],"files":["frontend/src/lib/hermes/**","tests/unit/hermes/**"],"risk":"MEDIUM","status":"VERIFIED"},
    {"id":"V1-003","objective":"Workforce execution host: DB wiring for cg_worker_definition/capability/delegation; WAKE→EXECUTE→PERSIST→VERIFY→SLEEP loop","team":"WORKFORCE","deps":["V1-004"],"files":["frontend/src/lib/workforce/**","tests/unit/workforce/**"],"risk":"MEDIUM","status":"VERIFIED"},
    {"id":"V1-004","objective":"Mission execution path: generalize foundation-loop into DB-backed intent→assign→lease→execute→evidence→verify with idempotency","team":"MISSION","deps":["V1-006"],"files":["frontend/src/lib/missions/**","tests/unit/missions/**"],"risk":"MEDIUM","status":"VERIFIED"},
    {"id":"V1-005","objective":"Memory DB adapter implementing cg_memory_* persistence behind documented adapter boundary","team":"MEMORY","deps":[],"files":["frontend/src/lib/memory/**","tests/unit/memory/**"],"risk":"LOW","status":"VERIFIED"},
    {"id":"V1-006","objective":"Platform RBAC neutralization: neutral core roles/permissions + Scholar adapter mapping; all 8,364 tests stay green","team":"SECURITY","deps":[],"files":["frontend/src/lib/authorization.ts","frontend/src/lib/security-role-gate.ts","frontend/src/lib/domain-config/**","tests/unit/**"],"risk":"HIGH","status":"VERIFIED"},
    {"id":"V1-007","objective":"Platform public site: CoreGrid identity, Reality Intelligence, capabilities, pricing, signup path","team":"WEB","deps":[],"files":["frontend/src/routes/(site)/**","tests/unit/site/**"],"risk":"LOW","status":"VERIFIED"},
    {"id":"V1-008","objective":"Onboarding engine: platform org provisioning from neutral DomainDefinition (org, workspace, roles, entities, agents seed)","team":"ONBOARDING","deps":["V1-006"],"files":["frontend/src/lib/onboarding/**","tests/unit/onboarding/**"],"risk":"MEDIUM","status":"VERIFIED"},
    {"id":"V1-009","objective":"Communication adapters: Resend email behind EmailAdapter; Vapi/Twilio abstraction; fail-closed exit-2 no-credential semantics","team":"COMMS","deps":[],"files":["frontend/src/lib/communications/**","tests/unit/communications/**"],"risk":"LOW","status":"VERIFIED"},
    {"id":"V1-010","objective":"Mobile foundation: Expo scaffold in mobile/, shared contracts, auth+missions+workspace screens, eas.json, app.json store metadata","team":"MOBILE","deps":["V1-004"],"files":["mobile/**"],"risk":"MEDIUM","status":"VERIFIED"},
    {"id":"V1-011","objective":"Placeholder page disposition: classify all ~20 zero-state pages V1-build vs V2-classify; implement V1 ones DB-backed","team":"WEB","deps":["V1-006"],"files":["frontend/src/routes/**"],"risk":"LOW","status":"VERIFIED"},
    {"id":"V1-012","objective":"Command-centre DB backing: replace hardcoded demo substrate with reality queries","team":"WEB","deps":["V1-004"],"files":["frontend/src/routes/_authenticated/command-centre/**"],"risk":"LOW","status":"VERIFIED"},
    {"id":"F-13","objective":"E2E vertical slice: Playwright visitor→signup→org→onboarding→mission→evidence journey","team":"QA","deps":["V1-007","V1-008","V1-004"],"files":["tests/e2e/**"],"risk":"MEDIUM","status":"VERIFIED"},
    {"id":"F-14","objective":"Deployment verification: Docker build + run + /health.json healthcheck in-VM; capture evidence","team":"INFRA","deps":[],"files":[],"risk":"LOW","status":"VERIFIED"}
  ]
}
```

## Execution order

- **Wave 1 (CLOSED 2026-10-03, all verified):** V1-001 ✅ (PWA artifacts ship in dist/client, 13 tests) · V1-005 ✅ (memory DB adapter, 21 tests + 219 regressions) · V1-006 ✅ (neutral RBAC core + Scholar adapter, full unit suite 8,480 green, ratchet 1576→1499) · V1-007 ✅ (/coregrid public site, 65/65 + neutrality PASS) · V1-009 ✅ (Resend/Twilio/Vapi fail-closed, 34 tests + 156 regressions) · F-14 ✅ baseline (prod server runs in-VM, /health.json 200; live deploy = BLK-3 external gate). Integration: full `npm run verify` GREEN on combined tree; PWA artifacts confirmed in fresh build.
- **Wave 2 (CLOSED 2026-10-03, all verified):** V1-004 ✅ (mission execution path, 36 tests, typed `lease_substrate_missing` fail-closed) · V1-008 ✅ (onboarding engine + compensation ledger, 23 tests; `Demo@2026!` retired from production paths) · V1-011 ✅ (placeholder disposition: 4 DB-backed, 8 honest planned-capability, 17 audited-real).
- **Wave 3 (CLOSED 2026-10-03, all verified):** V1-003 ✅ (workforce host + migration 20261003000019, 41 tests, deny-by-default RLS applied canonically; live RLS battery 42/42) · V1-010 ✅ (Expo mobile foundation, 31 tests, drift-pinned shared contracts, EAS-ready) · V1-012 ✅ (command centre DB-backed, demo route deleted).
- **Wave 4 (CLOSED 2026-10-03, all verified):** V1-002 ✅ (Hermes cycle, fail-closed classifier, 19 tests + 101 regressions) · F-13 ✅ (vertical slice: 6 REAL / 2 typed skips — Supabase signup rate limiter, absent AI-worker surface; T5 onboarding audit-actor defect found+fixed; T6 exposed the platform-wide is_super_admin RLS self-recursion (PG 54001), fixed by migration 20261003000020 + posture ratchet).
- **Program verification:** full `npm run verify` GREEN (8,700+ tests), neutrality STATUS=PASS, RLS battery 42/42 live, in-VM prod-server smoke (`/health.json`, `/coregrid`, PWA artifacts) 200. External gates unchanged: BLK-3 deploy creds, BLK-4 Paystack live keys, BLK-5 Resend/Vapi creds, store accounts, `AI_API_KEY`.

## Rules

- Workers do not touch git; coordinator commits.
- Disjoint file ownership as listed; overlaps resolved by canonical owner.
- Strict TS, no `any` unless justified; Zod validation; fail-closed on missing credentials.
- Battery discipline exit 0/1/2 (PASS/FINDING/BLOCKED_NO_CREDENTIAL).
- No fabricated completion: every mission ships a §42 report to `progress/v1-wave/`.

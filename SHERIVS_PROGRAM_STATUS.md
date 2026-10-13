# Sherivs Program Status

Version target: **ACTIVE-V1**
Date: 2026-10-13
Branch: `cursor/sherivs-category-formation-cf32`
Base: `coregrid-scholar-migration`

Claim classification used below: **OBSERVED** | **INFERRED** | **PROPOSED** | **EXECUTED** | **VERIFIED** | **UNKNOWN**

AGENTS.md §45 remains binding: V2 (device/IoT) and V3 (Reality Intelligence) are **FROZEN**. Phase 52 is not a canonical phase.

## 1. Executive summary

Sherivs is locked as the public company/platform brand. Experience planes A–D are classified for every file route. Login no longer implies Scholar: `resolveIdentityGateway` requires identity, membership, and `runtime:scholar` before a Scholar workspace. Plane A `/` is the Sherivs public home, not Command Centre.

This is **not** a completed category-formation program. Milestones 0–4 are EXECUTED (verification in this PR’s unit tests). Milestones 5–20 remain DEFINED / PARTIAL / FROZEN as listed.

## 2. Category definition

**OBSERVED (copy + constants):** Institutional Intelligence Infrastructure.

Working definition in `frontend/src/lib/platform.ts`: a persistent machine-readable organizational reality model that coordinates humans and AI workers under authority, evidence, and verification.

Sherivs Scholar is installed as `runtime:scholar` — the first domain runtime, not the platform.

## 3. Experience boundary

**EXECUTED.** Lock file: `SHERIVS_EXPERIENCE_BOUNDARY.md`

| Plane | Surfaces (file routes) | State |
|-------|------------------------|-------|
| A public_sherivs | 15 | LOCKED |
| B public_organization | 7 | LOCKED (still Scholar-shaped CMS) |
| C organization_workspace | 113 | CLASSIFIED; Scholar paths still top-level |
| D sherivs_internal | 24 | CLASSIFIED; same app, RoleGuard |
| DOCUMENT_SHELL | 1 | LOCKED |

Executable lock: `frontend/src/lib/experience/experience-planes.ts`.

## 4. Route architecture

**PARTIAL.** Closest-safe V1 in one TanStack Start app:

| Intent | Current | Target | Status |
|--------|---------|--------|--------|
| Public company | `/` | sherivs.com/ | IMPLEMENTED |
| Sign-in | `/auth`, `/login`, `/signin` | /signin | IMPLEMENTED |
| Org public | tenant host or `?school=` | `{org}.sherivs.com` | PARTIAL (query + subdomain exist; DNS BLOCKED_EXTERNAL) |
| Org workspace | `/admin`, `/teacher`, … | `app.sherivs.com/o/{org}` | DEFINED, not implemented |
| Scholar runtime | same top-level role paths | `/o/{org}/scholar` | DEFINED, not implemented |
| Internal | `/super-admin`, `/command-centre` | internal.sherivs.com | PARTIAL (authz exists; host split later) |

## 5. Brand migration status

**PARTIAL.** Inventory: `SHERIVS_BRAND_MIGRATION.md`

Customer-facing route/UI strings in `frontend/src/routes` were migrated. Technical identifiers, packages, database objects, architecture corpus, and mobile bundle IDs remain LEGACY by design.

## 6. Identity architecture

**EXECUTED (gateway).** `frontend/src/lib/identity/identity-gateway.ts`

Flow: authenticate → membership → authority → organization (via existing `users.school_id`) → runtime (`INSTALLED_RUNTIME_ID`) → plane → destination.

| Outcome | Destination | Status |
|---------|-------------|--------|
| Unsigned platform | Plane A, stay | IMPLEMENTED |
| Unsigned tenant | Plane B, stay | IMPLEMENTED |
| Super-admin | `/super-admin/dashboard` Plane D | IMPLEMENTED |
| Unlinked identity | `/auth` | IMPLEMENTED |
| Scholar member + scholar runtime | `scholarWorkspaceHome(role)` | IMPLEMENTED |
| Other runtime | `/runtime` | IMPLEMENTED (only scholar is installed today) |

**NOT done:** replacing `public.users.school_id` with a domain-neutral membership table. LEGACY live path. Rewrite is a data-architecture mission with migration risk.

## 7. Organization architecture

**PARTIAL.** Live tenant model is still `public.schools`. Organization classes exist in Command Centre provisioning data. Universal onboarding (non-school questions) is **DEFINED**, not implemented as the default signup path.

## 8. Runtime architecture

**OBSERVED.** Only `runtime:scholar` is installed (`INSTALLED_RUNTIME_ID`). Restaurant config is TEST_FIXTURE. Future healthcare/agriculture runtimes are not implemented (correct).

## 9. Reality architecture

**OBSERVED / FROZEN-adjacent.** Reality-model code exists from prior phases. V3 Reality Intelligence remains frozen. This program did not extend it.

## 10. Mission architecture

**OBSERVED.** Mission engine, leases, evidence paths exist from prior Jarvis work on ancestor commits. This program did not change them.

## 11. Workforce architecture

**OBSERVED.** Standing fleet claimed as identities (ancestor commit `d4e3fcc`). Workers are not standing OS processes. V2/V3 workers remain frozen.

## 12. Jarvis architecture

**OBSERVED.** Jarvis is executive intelligence with bounded authority (ancestor commits). Not omnipotent. Plane D surfaces exist. This program did not expand Jarvis.

## 13. AI gateway

**OBSERVED / PARTIAL.** Prior centralized gateway code exists. This program did not rebuild it. Scattered provider calls may still exist — UNKNOWN without a dedicated audit mission.

## 14. Security posture

**OBSERVED.** RLS, RoleGuard, super-admin gate, tenant slug checks on auth remain. Identity gateway is client-side routing on top of existing session — **not** a replacement for server authorization. Frontend routing is not security (Constitution §34).

## 15. Evidence posture

**PARTIAL.** This PR produces: lock documents, unit tests, git commits. No production deployment evidence in this program slice.

## 16. Verification posture

See §21. Unit tests for gateway + public site are the verification for M0–M4.

## 17. Communication integrations

**UNCHANGED.** Resend / Twilio / Vapi adapters remain from prior work. Not re-verified here.

## 18. Infrastructure

**UNCHANGED.** Vercel / Cloudflare / Supabase / Redis topology preferred. No new infrastructure introduced.

## 19. Web/PWA

**PARTIAL.** Public home rebuilt. PWA description now says Sherivs. Manifest debug headers still `x-coregrid-*`. OG image still universalschoolos.com.

## 20. Mobile

**PARTIAL.** Display name Sherivs. Bundle id / scheme LEGACY. Store rename is BLOCKED_EXTERNAL_ACTION.

## 21. Testing

| Suite | Status |
|-------|--------|
| `tests/unit/identity-gateway.test.ts` | ADDED — run in this PR |
| `tests/unit/identity-gateway-invariants.test.ts` | ADDED — run in this PR |
| `tests/unit/site-marketing.test.ts` | UPDATED — run in this PR |
| E2E login → workspace | NOT RUN this slice |
| RLS / tenant isolation | UNCHANGED prior suite |

## 22. Performance

**UNKNOWN** this slice. No load test.

## 23. Deployment

**NOT DEPLOYED** by this agent. Production DNS for sherivs.com is BLOCKED_EXTERNAL_ACTION.

## 24. V1 status

V1 envelope for **experience boundary + identity gateway + public brand** is EXECUTED.

V1 still missing for a coherent launch (not claimed done):

- Domain-neutral org membership (not `schools`)
- `/o/{org}` workspace shell
- Scholar rebind under org
- Organization onboarding without school-first questions
- Dedicated internal host
- Package/DB identifier rename (optional if LEGACY is sealed)

## 25. V2 status

**FROZEN.** Device/IoT. No implementation this program.

## 26. Deferred status

| Item | Horizon | Reason |
|------|---------|--------|
| `app.sherivs.com/o/{org}/scholar` | V1 later milestone | Routing rewrite, high blast radius |
| Host split internal.sherivs.com | V1 later | DNS + authz |
| Package `@sherivs/contracts` | V1 later | Import graph |
| Mobile bundle id | Store submission | BLOCKED_EXTERNAL |
| Phase 52 full corpus | Neutral extract only | Not a canonical phase |
| V3 Reality Intelligence | Frozen | AGENTS.md §45 |

## 27. Known risks

1. Identity gateway runs in the browser after session load. A crafted URL to `/teacher/dashboard` still depends on `_authenticated` + RoleGuard + RLS — correct, but deep links can flash unauthorized chrome.
2. `INSTALLED_RUNTIME_ID` is a compile-time constant, not per-organization runtime binding.
3. Plane C still assumes Scholar role names (`teacher`, `parent`, …) in the URL.
4. Remaining CoreGrid in architecture docs can leak into agent-generated customer copy if agents treat those docs as product copy.

## 28. Known blockers

| ID | Item | Owner |
|----|------|-------|
| BLOCKED_EXTERNAL_ACTION | DNS/WAF for sherivs.com, app., internal. | Human / infra |
| BLOCKED_EXTERNAL_ACTION | Host OG image on sherivs.com | Human |
| BLOCKED_EXTERNAL_ACTION | Apple/Google bundle + scheme migration | Human |
| BLOCKED_EXTERNAL_ACTION | Provider billing activations | Human |

## 29. Technical debt

- `(site)` layout still links to `/coregrid#…`
- Live login path is `public.users` / `public.schools`
- Command Centre component exists but is unmounted from `/` (orphan UI, Plane D only if routed)
- README body mixed brand

## 30. Evidence links/locations

- `SHERIVS_EXPERIENCE_BOUNDARY.md`
- `SHERIVS_BRAND_MIGRATION.md`
- `frontend/src/lib/identity/identity-gateway.ts`
- `frontend/src/lib/experience/experience-planes.ts`
- `frontend/src/lib/platform.ts`
- `frontend/src/components/public/sherivs-public-home.tsx`
- `frontend/src/routes/index.tsx`, `auth.tsx`, `signin.tsx`
- `tests/unit/identity-gateway.test.ts`
- `tests/unit/identity-gateway-invariants.test.ts`

## 31. Git commits

Recorded after commit on this branch. Ancestor already contains Jarvis standing-fleet + Phase 52 V1 engines (`d4e3fcc`, `19ea488`, `5f02e31`).

## 32. Deployment identifiers

None for this slice.

## 33. Outstanding human actions

1. Point production DNS at Sherivs hosts.
2. Host OG/favicon assets on sherivs.com.
3. Decide store-id migration window for mobile.
4. Authorize later milestones (org path rebind, membership schema) before agents implement them.
5. Constitution/AGENTS.md human revision if CoreGrid must leave governance documents.

## Milestone board

| Milestone | Name | Status |
|-----------|------|--------|
| 0 | Reconnaissance | EXECUTED |
| 1 | Experience boundary lock | EXECUTED |
| 2 | Brand & identity refoundation | PARTIAL (customer-facing routes done; technical LEGACY kept) |
| 3 | Routing & identity gateway | EXECUTED (in-app); host model PARTIAL |
| 4 | Public Sherivs experience | EXECUTED (no large visual system rewrite) |
| 5 | Organization public experience | OBSERVED / PARTIAL (still school CMS) |
| 6 | Organization workspace shell | DEFINED |
| 7 | Scholar runtime rebind | DEFINED |
| 8 | Sherivs internal OS | PARTIAL (super-admin + command-centre) |
| 9–12 | Intelligence / missions / Jarvis / gateway | OBSERVED from prior work; not expanded here |
| 13–19 | Comms, security, ops, API, mobile, perf, deploy | UNCHANGED / PARTIAL |
| 20 | Category conformance | NOT PASSED — platform still behaves like Scholar modules behind a new public home |

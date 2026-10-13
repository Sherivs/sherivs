# Sherivs Program Status

Version target: **ACTIVE-V1**
Date: 2026-10-13
Branch: `cursor/sherivs-category-formation-cf32`
Base: `coregrid-scholar-migration`

Claim classification used below: **OBSERVED** | **INFERRED** | **PROPOSED** | **EXECUTED** | **VERIFIED** | **UNKNOWN**

AGENTS.md §45 remains binding: V2 (device/IoT) and V3 (Reality Intelligence) are **FROZEN**. Phase 52 is not a canonical phase.

## 1. Executive summary

Sherivs is locked as the public company/platform brand. Experience planes A–D are classified for every file route. Login no longer implies Scholar: `resolveIdentityGateway` requires identity, membership, and `runtime:scholar` before a Scholar workspace. Plane A `/` is the Sherivs public home, not Command Centre.

This is **not** a completed category-formation program. Milestones 0–4 plus in-app M6/M7 (org path + Scholar rebind) and organization-first onboarding are EXECUTED. Live membership remains `public.schools` (facade only). DNS / store publish remain BLOCKED_EXTERNAL_ACTION.

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
| C organization_workspace | 118 | Canonical `/o/{org}` + `/o/{org}/scholar`; LEGACY role paths redirect |
| D sherivs_internal | 24 | CLASSIFIED; same app, RoleGuard |
| DOCUMENT_SHELL | 1 | LOCKED |

Executable lock: `frontend/src/lib/experience/experience-planes.ts`.

## 4. Route architecture

**PARTIAL.** Closest-safe V1 in one TanStack Start app:

| Intent | Current | Target | Status |
|--------|---------|--------|--------|
| Public company | `/` | sherivs.com/ | IMPLEMENTED |
| Sign-in | `/auth`, `/login`, `/signin` | /signin | IMPLEMENTED |
| Org public | tenant host or `?organization=` (`?school=` LEGACY) | `{org}.sherivs.com` | PARTIAL (query + subdomain exist; DNS BLOCKED_EXTERNAL) |
| Org workspace | `/o/{org}` | `app.sherivs.com/o/{org}` | IMPLEMENTED in-app; host DNS BLOCKED_EXTERNAL |
| Scholar runtime | `/o/{org}/scholar{leaf}` | `/o/{org}/scholar` | IMPLEMENTED (splat + LEGACY redirect) |
| Internal | `/super-admin`, `/command-centre` | console.sherivs.com | IMPLEMENTED in-app (`internal.sherivs.com` LEGACY exact-match); production deploy BLOCKED until merge |

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
| Unlinked identity | `/onboarding` | IMPLEMENTED |
| Scholar member + scholar runtime | `/o/{slug}/scholar{home}` (LEGACY leaf if no slug) | IMPLEMENTED |
| Other runtime | `/o/{slug}` or `/runtime` | IMPLEMENTED (only scholar is installed today) |
| Unsigned app host | `/auth` | IMPLEMENTED |
| Unsigned / non-operator internal host | `/auth` | IMPLEMENTED |

**NOT done:** replacing `public.users.school_id` / `public.schools` with applied `cg_org_*` tables. Facade: `organization-membership.ts` (`legacy_schools_table`). Rewrite is a data-architecture mission with migration risk. Do not apply unapplied `20261001000000_coregrid_v1_org_model.sql` from this program.

## 7. Organization architecture

**PARTIAL.** Live tenant model is still `public.schools`. A domain-neutral facade (`organizationFromSchoolRow` / `membershipFromLegacyProfile`) is what Plane C and the gateway consume. Organization-first onboarding is **IMPLEMENTED** as `/onboarding`; creating a live tenant still requires authorized `provisionOrganization`.

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

**PARTIAL.** Public home rebuilt. Same-origin `/og-image.png` is shipped and referenced. Sitemap/robots point at sherivs.com. Manifest adds `x-sherivs-*` headers and keeps LEGACY `x-coregrid-*`. Hosting those URLs on production DNS remains BLOCKED_EXTERNAL.

## 20. Mobile

**PARTIAL.** Display name Sherivs. In-repo `scheme` is `sherivs`. iOS/Android bundle ids remain `com.coregrid.app` (LEGACY). Store listing / bundle-id cutover is BLOCKED_EXTERNAL_ACTION.

## 21. Testing

**VERIFIED** (vitest, this slice):

| Suite | Result |
|-------|--------|
| `tests/unit/identity-gateway.test.ts` | extended this slice (bound `/o/{org}/scholar`, `/onboarding`, hosts) |
| `tests/unit/identity-gateway-invariants.test.ts` | extended this slice |
| `tests/unit/sherivs-organization-workspace.test.ts` | added this slice |
| `tests/unit/site-marketing.test.ts` | 16 passed |
| `tests/unit/platform-neutrality.test.ts` | 49 passed (after gateway comment rewrite so it does not narrate Scholar as the platform) |
| `tests/unit/roles.test.ts` | 12 passed |
| `tests/unit/pwa-offline-shell.test.ts` | 13 passed |
| `tests/unit/scholar-runtime-waves.test.ts` | 15 passed |
| `tests/unit/scholar-vertical-bindings.test.ts` | 19 passed |
| `tests/unit/command-centre-contract-governance.test.ts` | 10 passed |
| `tests/unit/marketplace-surface.test.ts` | 9 passed |

E2E login → workspace: **NOT RUN** this slice (no production/demo credentials in this environment).
RLS / tenant isolation: unchanged prior suite.

## 22. Performance

**UNKNOWN** this slice. No load test.

## 23. Deployment

**NOT DEPLOYED** by this agent. Production DNS for sherivs.com is BLOCKED_EXTERNAL_ACTION.

## 24. V1 status

V1 envelope for **experience boundary + identity gateway + public brand + org-prefixed Plane C** is EXECUTED in-app.

V1 still missing for a coherent launch (not claimed done):

- Applied domain-neutral org membership tables (live path is still `public.schools` + facade)
- Production hosts (sherivs.com / www. / app. / console.) — DNS OBSERVED; application dispatch not on production branch until merge
- Package/DB identifier rename (optional if LEGACY is sealed)

## 25. V2 status

**FROZEN.** Device/IoT. No implementation this program.

## 26. Deferred status

| Item | Horizon | Reason |
|------|---------|--------|
| Production `app.sherivs.com` dispatch | Human / merge | Host exists; feature branch not production |
| Host split `console.sherivs.com` | Human / merge | Canonical console host; do not add internal.sherivs.com |
| Package `@sherivs/contracts` | V1 later | Import graph |
| Mobile bundle id | Store submission | BLOCKED_EXTERNAL |
| Phase 52 full corpus | Neutral extract only | Not a canonical phase |
| V3 Reality Intelligence | Frozen | AGENTS.md §45 |

## 27. Known risks

1. Identity gateway runs in the browser after session load. A crafted URL to `/teacher/dashboard` still depends on `_authenticated` + RoleGuard + RLS — correct, but deep links can flash unauthorized chrome.
2. `INSTALLED_RUNTIME_ID` is a compile-time constant, not per-organization runtime binding.
3. Plane C canonical URLs are org-prefixed; Scholar role names remain in the *leaf* (`/scholar/teacher/…`). LEGACY top-level role URLs still exist as aliases.
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
- `frontend/src/lib/identity/organization-membership.ts`
- `frontend/src/lib/experience/experience-planes.ts`
- `frontend/src/lib/experience/organization-routes.ts`
- `frontend/src/lib/experience/experience-host.ts`
- `frontend/src/lib/platform.ts`
- `frontend/src/components/public/sherivs-public-home.tsx`
- `frontend/src/routes/index.tsx`, `auth.tsx`, `signin.tsx`, `onboarding.tsx`
- `frontend/src/routes/_authenticated/o.$organization/**`
- `tests/unit/identity-gateway.test.ts`
- `tests/unit/identity-gateway-invariants.test.ts`
- `tests/unit/sherivs-organization-workspace.test.ts`

## 31. Git commits

- `77fd5e0` Lock Sherivs experience planes and stop Scholar-first login.
- Follow-up commit(s) on this branch for neutrality fix + verification notes.
- Ancestors: Jarvis standing-fleet + Phase 52 V1 engines (`d4e3fcc`, `19ea488`, `5f02e31`).

## 32. Deployment identifiers

None for this slice.

## 33. Outstanding human actions

1. Point production DNS at Sherivs hosts.
2. Host OG/favicon assets on sherivs.com.
3. Decide store-id migration window for mobile.
4. Authorize applying `cg_org_unit` / `cg_org_membership` (unapplied migration) before treating those tables as the live login path.
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
| 6 | Organization workspace shell | EXECUTED (in-app `/o/{org}`) |
| 7 | Scholar runtime rebind | EXECUTED (in-app `/o/{org}/scholar` + LEGACY redirect) |
| 8 | Sherivs internal OS | PARTIAL (super-admin + command-centre) |
| 9–12 | Intelligence / missions / Jarvis / gateway | OBSERVED from prior work; not expanded here |
| 13–19 | Comms, security, ops, API, mobile, perf, deploy | UNCHANGED / PARTIAL |
| 20 | Category conformance | PARTIAL — Plane C is org-prefixed; live membership is still `public.schools`; Plane B is still education CMS; production DNS BLOCKED_EXTERNAL |

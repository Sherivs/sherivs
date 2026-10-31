# SHERIVS EXPERIENCE BOUNDARY LOCK

Program deliverable — Milestone 1 (Category Formation Program).
Governing law: AGENTS.md §13–§16, §24, §45 (V1 envelope). Evidence class: repository inspection 2026-10-08, branch `cursor/sherivs-refoundation-2507`.

Canonical planes:

| Plane | Name | Audience | Authority |
|---|---|---|---|
| A | Sherivs Public Experience | prospective organizations, visitors | public, no auth |
| B | Organization Public Experience | organization's public visitors | public or organization-scoped |
| C | Organization Internal Workspace | customer organization members | authenticated + membership |
| D | Sherivs Internal Workspace | Sherivs workforce | authenticated + internal status |

## Plane A — Sherivs Public Experience

| Route | Purpose | Audience | Plane | Public/Private | Current state | Target state | Migration action | Status |
|---|---|---|---|---|---|---|---|---|
| `/` | Company homepage (hero, category, CTAs) | visitors | A | Public | Sherivs-branded, SSR-rendered | Sherivs-branded | none | VERIFIED (production) |
| `/about` | Company information | visitors | A | Public | Sherivs-branded | keep | none | VERIFIED |
| `/contact` | Contact paths | visitors | A | Public | Sherivs-branded | keep | none | VERIFIED |
| `/request-demo` | Demo intake | visitors | A | Public | Sherivs-branded | keep | none | VERIFIED |
| `/privacy-policy` | Privacy terms | visitors | A | Public | Sherivs-branded | keep | none | VERIFIED |
| `/terms` | Terms | visitors | A | Public | Sherivs-branded | keep | none | VERIFIED |
| `/auth` | Sign in (Sherivs Identity) | visitors | A | Public | No demo credentials | keep | none | VERIFIED |
| `/reset-password` | Account recovery | visitors | A | Public | keep | keep | none | VERIFIED |
| `/coregrid` | Legacy path → platform detail page | visitors | A | Public | Compatibility alias, Sherivs content | redirect or retire after link hygiene | document removal criteria | PARTIAL |
| `/robots.txt`, `/sitemap.xml`, `/manifest.webmanifest`, `/health.json` | Infrastructure metadata | crawlers | A | Public | sherivs.com identity | keep | none | VERIFIED |
| `/marketplace` | Feature catalog prototype | visitors | A | removed | hardcoded UI deleted | do not restore prototype | REMOVED |
| `/reality/$class` | Generated-environment explainer | visitors | A | removed | hardcoded UI deleted | do not restore prototype | REMOVED |
| `/blog`, `/blog/$slug`, `/news/$id`, `/events/$id` | Leftover tenant content shells | B | removed | hardcoded UI deleted | tenant sites use the website engine | REMOVED |
| `/privacy` | Duplicate of `/privacy-policy` | visitors | A | removed | leftover path deleted; canonical is `/privacy-policy` | do not restore | REMOVED |
| `/login` | Legacy auth entry | visitors | A | Public | redirects (beforeLoad) | verify target is `/auth` | none | VERIFIED |

## Internal/engineering surfaces (not customer product)

| Route | Purpose | Plane | Public/Private | Current state | Migration action | Status |
|---|---|---|---|---|---|---|
| `/platform`, `/platform/org` | Engineering phase/control view | D | removed | hardcoded UI deleted | do not restore prototype | REMOVED |
| `/foundation-loop`, `/scholar-foundation-loop`, `/rules` | Internal engineering walkthroughs | D | removed | hardcoded UI deleted | do not restore prototype | REMOVED |

## Plane C — Organization Internal Workspace (Scholar runtime)

Hardcoded Scholar portal routes, portal chrome, and the previous application shells have been **removed**. Identity/domain modules remain. `app.sherivs.com` serves splash / invite-only sign-in, then the governed `/home` shell. The shell renders capability-filtered widgets and nav from `workspace_manifest` / the Scholar nav catalog — it does not restore `_authenticated` or `portal-shell`.

| Route | Purpose | Plane | Authority | Current state | Target state | Status |
|---|---|---|---|---|---|---|
| `/admin/*`, `/teacher/*`, `/parent/*`, `/student/*`, `/bursar/*`, `/driver/*`, `/hq/*` | Role workspaces | C | tenant membership + role | hardcoded UI deleted | future governed workspace | REMOVED |
| `/organizations`, `/welcome`, `/runtime`, `/messages`, `/notifications`, `/settings` | Shell capabilities | C | authenticated | hardcoded UI deleted | future governed workspace | REMOVED |
| `/super-admin/*`, `/internal`, `/command-centre/*` | Platform / HQ ops | D | internal workforce | hardcoded UI deleted | future governed console | REMOVED |
| `app.sherivs.com` `/`, `/onboarding` | Application splash, invite-only sign-in, team onboarding | C | host routing + invitation credentials | splash then Sign in; Google for invited accounts; no self-signup | keep | IMPLEMENTED |
| `/home`, `/home/s/$section`, `/home/ai`, `/home/notifications` | Governed organization workspace shell | C | authenticated + membership | capability-dynamic home, 75% glass drawer, role bottom slots, VAPID device push | keep | IMPLEMENTED |
| `console.sherivs.com` `/console` | Sherivs Internal Console | D | authenticated + internal staff | governed operations center | keep | IMPLEMENTED |
| gov/head/group hosts | Former console shells | D | host routing | retired unavailable surface | do not SSR public homepage | REMOVED |

## Boundary rules locked

1. No public route may render Command Centre, phase machinery, kernel contracts, or internal registries (§9 of refoundation directive). Evidence: `tests/unit/sherivs-refoundation.test.ts`.
2. Login resolves identity → membership → runtime → workspace; it never hard-routes to Scholar (`frontend/src/lib/identity/identity.ts`).
3. Demo provisioning is environment-gated; production auth exposes no credentials (`tests/unit/sherivs-refoundation.test.ts`).
4. Universal platform vocabulary must not assume school context; Scholar lives behind the domain-runtime boundary (`frontend/src/lib/runtime/`, ADR-013 domain-neutrality gate `scripts/verify-domain-neutrality.mjs` — STATUS=PASS).
5. Tenant isolation is RLS-enforced (`organization_memberships` migration 20261008000050, policies verified live 2026-10-08).

## Known open items

- `/coregrid` compatibility path: retire after external link hygiene; cannot break until tracked.
- Plane D Internal Console is `/console` on `console.sherivs.com`. Deleted prototypes (`/internal`, `/super-admin`, `/command-centre`) stay removed. Plane C remains the governed `/home` shell.

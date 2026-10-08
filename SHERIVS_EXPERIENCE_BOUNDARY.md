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
| `/marketplace` | Feature catalog published from organization reality | visitors | A | Public | Metadata rebranded to Sherivs | classify: keep public or gate behind org reality | none required | VERIFIED |
| `/reality/$class` | Generated-environment explainer | visitors | A | Public | Metadata rebranded to Sherivs | review whether internal concept belongs public | propose gate or noindex if not customer-narrative | PARTIAL |
| `/blog`, `/blog/$slug`, `/news/$id`, `/events/$id` | Organization-generated content (tenant-driven) | visitors | B | Public | tenant content surfaces | belongs to Plane B narrative | classify during Plane B work | PARTIAL |
| `/privacy` | Duplicate of `/privacy-policy` | visitors | A | Public | legacy path | redirect to canonical | add redirect or retire | PARTIAL |
| `/login` | Legacy auth entry | visitors | A | Public | redirects (beforeLoad) | verify target is `/auth` | none | VERIFIED |

## Internal/engineering surfaces (not customer product)

| Route | Purpose | Plane | Public/Private | Current state | Migration action | Status |
|---|---|---|---|---|---|---|
| `/platform` | Engineering phase/control view | D | Session-gated, noindex | gated via `beforeLoad` | keep internal | VERIFIED |
| `/platform/org` | Organization-scope platform view | D | Session-gated, noindex | gated | keep internal | VERIFIED |
| `/foundation-loop`, `/scholar-foundation-loop`, `/rules` | Internal engineering walkthroughs | D | Authenticated | inspect gating | verify no public links | PARTIAL |

## Plane C — Organization Internal Workspace (Scholar runtime)

| Route | Purpose | Plane | Authority | Current state | Target state | Status |
|---|---|---|---|---|---|---|
| `/admin/*` (60 routes) | School-admin operations | C | tenant membership + role | Scholar runtime screens | Scholar runtime behind universal shell | VERIFIED (runtime isolation pending full shell rollout) |
| `/teacher/*`, `/parent/*`, `/student/*`, `/bursar/*`, `/driver/*`, `/hq/*` | Role workspaces | C | role guard | Scholar roles | Scholar roles (correct — education runtime) | VERIFIED |
| `/organizations` | Organization selector | C | memberships | multi-membership selector | keep | VERIFIED |
| `/welcome` | Unlinked-account landing | C | authenticated | keep | keep | VERIFIED |
| `/runtime` | Runtime workspace projection | C | authenticated | rebranded to Sherivs | keep | VERIFIED |
| `/messages`, `/notifications`, `/settings`, `/admin/*` cross-cuts | Universal shell capabilities | C | authenticated | shared | universal shell candidate | PARTIAL |
| `/super-admin/*` (21 routes) | Platform operations | D | super-admin | rebranded titles | Sherivs internal ops | VERIFIED |
| `/internal` | Sherivs HQ (identity destination) | D | internal workforce | implemented | expand | VERIFIED |

## Boundary rules locked

1. No public route may render Command Centre, phase machinery, kernel contracts, or internal registries (§9 of refoundation directive). Evidence: `tests/unit/sherivs-refoundation.test.ts`.
2. Login resolves identity → membership → runtime → workspace; it never hard-routes to Scholar (`frontend/src/lib/identity/identity.ts`).
3. Demo provisioning is environment-gated; production auth exposes no credentials (`tests/unit/sherivs-refoundation.test.ts`).
4. Universal platform vocabulary must not assume school context; Scholar lives behind the domain-runtime boundary (`frontend/src/lib/runtime/`, ADR-013 domain-neutrality gate `scripts/verify-domain-neutrality.mjs` — STATUS=PASS).
5. Tenant isolation is RLS-enforced (`organization_memberships` migration 20261008000050, policies verified live 2026-10-08).

## Known open items

- `/coregrid` compatibility path: retire after external link hygiene; cannot break until tracked.
- `/reality/$class` and `/marketplace` expose internal-category narratives publicly without noindex; propose noindex or fold into the public product narrative.
- `/privacy` duplicates the canonical policy page; needs a redirect.
- Universal shell (Plane C) still renders Scholar-native navigation for scholar organizations; runtime-aware shell composition is the next structural milestone.

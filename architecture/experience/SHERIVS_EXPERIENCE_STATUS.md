# Sherivs Experience Status

Snapshot: 2026-10-08  
Classification: ACTIVE-V1 architecture/reconnaissance deliverable  
Overall: **ARCHITECTURE DEFINED; IMPLEMENTATION NOT STARTED BY THIS PROGRAM**

## Evidence-based baseline

| Inventory | Observed |
| --- | ---: |
| Route files | 161 |
| Authenticated route files | 133 |
| Shared component files | 113 |
| Public API route files | 2 |
| Database files | 103 |
| Files under `tests/` | 440 |
| Vitest test suites discovered | 428 |
| PWA/public assets | favicon, 3 icons, service worker, robots |

The repository already has TanStack Start, React 19, Tailwind 4, Radix/shadcn primitives, Lucide,
TanStack Query/Router/Table, Supabase, Zod, PWA manifest/service worker, capability-resolved
navigation, mobile bottom navigation, offline banner, command palette, notification/profile shell,
theme support, organization-public rendering, extensive Scholar role surfaces, and platform
operator surfaces.

## Current surface inventory

| Surface | Route/evidence | Components/contracts | Owner | Mission | Status | Test | A11y | Perf | Security |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Platform public | `/coregrid`, `/platform` | `(site)`, typed static content | P23/P24 | SX-03 | partial, old brand | unit/build partial | partial | unmeasured | public |
| Root resolver | `/` | `CommandCentre`, `PublicSchoolSite` | P23/P06 | SX-02 | overloaded | existing unit partial | partial | unmeasured | review needed |
| Organization public | tenant host `/` | `components/public/*` | P24 + Scholar | SX-04 | Scholar-specific partial | unit partial | partial | unmeasured | publication/RLS partial |
| Authentication | `/auth`, `/login`, `/reset-password` | Supabase auth + audit endpoint | P02/P08 | SX-06 | partial | auth tests | partial | unmeasured | tenant check; gaps documented |
| Universal shell | `/_authenticated` | sidebar/header/command/mobile/offline | P06/P24 | SX-05 | strong partial | shell/workspace tests | partial | unmeasured | route + backend mix |
| Organization workspace | role route groups | runtime nav registry | P06 + Scholar | SX-05 | role-prefixed migration debt | broad unit coverage | partial | unmeasured | capability + role gates |
| Account/settings | `/settings`, role settings | profile menu/routes | P02/P08 | SX-06 | thin | partial | unknown | unmeasured | sensitive-flow gaps |
| Notifications | `/notifications` | notification bell | P10 | SX-07 | partial | partial | partial | unmeasured | tenant viewer supplied |
| Search/command | command palette | `command-center/*` | P05/P06 | SX-07 | partial | command tests | partial | unmeasured | execution must re-authorize |
| Calendar/time | role calendars | calendar components, date-fns | P12/P30 | SX-07 | duplicated by role | time/calendar tests | partial | unmeasured | permissions vary |
| AI experience | role assistants | `components/ai/*`, gateway | P26 + Scholar | SX-08 | generic chat pattern partial | AI tests | partial | unmeasured | gateway exists |
| Missions/workers | super-admin worker missions | mission/worker contracts | P07 | SX-08 | bounded partial | unit/failure tests | unknown | unmeasured | V1 boundary required |
| Evidence/verification | contracts and operator pages | evidence/verification libs | P05/P08 | SX-08 | backend-oriented partial | unit tests | UI gap | unmeasured | governed |
| Internal workspace | `/platform/org`, `/super-admin/*` | platform workspace engine | P06/P08 | SX-09 | boundary not fully separated | partial | partial | unmeasured | critical gap |
| Developer/API | `/admin/api-keys`, two API routes | dev/API contracts | P28/P08 | SX-10 | partial | contract/security tests | unknown | unmeasured | credential review needed |
| Content/resources | `/blog`, `/blog/:slug`, CMS | static/tenant content | P23/P24 | SX-03/04 | incomplete taxonomy | partial | partial | unmeasured | publication model gap |
| PWA/mobile | manifest, SW, icons | bottom nav, offline banner | P22/P23 | SX-11 | partial | offline/mobile tests | partial | unmeasured | offline replay review |
| SEO | sitemap, robots, route metadata | root/tenant metadata | P23 | SX-03 | wrong legacy domain/brand | no complete audit | semantic partial | unmeasured | public |
| Design system | `styles.css`, `components/ui` | tokens + 50+ primitives | P24 | SX-02 | duplicated/inconsistent | component tests partial | contracts > evidence | blur/motion risk | neutral |

Statuses are not claims of production conformance. “Partial” means source evidence exists but one or
more required gates lack proof.

## Boundary lock

### ACTIVE-V1

Brand migration, public/organization shells, identity/context, capability-driven workspace,
account/settings, communication, calendar/time, search/command, notifications, practical AI
gateway UX, bounded missions/workers, evidence, files, payments, integrations, developer surface,
PWA/offline, design system, accessibility, performance, SEO, and content architecture.

### FROZEN

- V2 device/IoT implementation, including telemetry-led experiences.
- V3 universal Reality Intelligence implementation.
- FUTURE-UNASSIGNED autonomous civilization, universal cognition/memory, self-improvement, and
  related surfaces.

Frozen routes currently present (for example `digital-twin`, `reality`, geofence, biometric, bus
tracking, worker/agent governance) require classification before visual redesign. Existing code is
preserved; this program does not expand it or claim it as V1 progress.

## Mission contract

Every mission record must contain `MISSION_ID`, `NAME`, `OBJECTIVE`, `TEAM`, `OWNER`, `SCOPE`,
`NON_SCOPE`, `DEPENDENCIES`, `INPUTS`, `OUTPUTS`, `CONTRACTS`, `DESIGN_REQUIREMENTS`,
`ENGINEERING_REQUIREMENTS`, `ACCEPTANCE_CRITERIA`, `TEST_PLAN`, `ACCESSIBILITY_PLAN`,
`PERFORMANCE_PLAN`, `SECURITY_PLAN`, `EVIDENCE_PLAN`, `ROLLBACK_PLAN`, and `STATUS`.

## Mission portfolio

Specialists are assigned to real workstreams; they are not independent architecture owners.

| Mission | Objective | Teams | Dependencies | Output | Status |
| --- | --- | --- | --- | --- | --- |
| SX-01 Boundary and evidence | lock V1/frozen scope and claims | 01 Experience Architecture, 02 Product Architecture, 05 UX Research, 40 Architecture Conformance | governance | boundary register, research plan | architecture complete |
| SX-02 Experience foundation | consolidate tokens, components, visual/spatial language | 03 Brand, 07 Visual, 08 Design Systems, 09 Motion, 10 Accessibility, 31 Frontend Architecture | SX-01 | token package, component docs/tests | planned |
| SX-03 Sherivs public | build evidence-backed public/content/SEO experience | 04 Information Architecture, 06 Interaction, 11 Content, 12 Public Web, 35 SEO, 36 Analytics | SX-02 | public shell and approved routes | planned |
| SX-04 Organization public | generalize tenant public engine | 13 Organization Public, 32 Backend Contracts, 34 Data, 33 Security | SX-01/02 | governed content projection and shell | planned |
| SX-05 Universal/workspace shell | separate platform shell from runtime and role portals | 14 Application Shell, 15 Organization Workspace, 19 Navigation, 31 Frontend, 33 Security | SX-01/02 | `/app` shell and migration redirects | planned |
| SX-06 Identity/account/settings | resolve real context and sensitive flows | 17 Authentication, 18 Identity, 24 Account/Settings, 33 Security | SX-05 | auth context, account, settings | planned |
| SX-07 Platform utilities | unify search, calendar/time, notifications | 20 Search, 25 Calendar/Time, 26 Notifications, 32 Backend Contracts | SX-05/06 | governed utility services/surfaces | planned |
| SX-08 Intelligence trust | make bounded AI/missions/workers/evidence legible | 21 AI Experience, 22 Mission, 23 Workforce, 33 Security, 34 Data | SX-01/05 | typed trust anatomy; no frozen expansion | planned |
| SX-09 Internal boundary | isolate Sherivs company workspace | 16 Sherivs Workspace, 18 Identity, 33 Security, 40 Conformance | SX-06 | separate internal shell/grants | planned |
| SX-10 Developer experience | document and govern APIs, keys, webhooks | 27 API/Developer Experience, 32 Backend Contracts, 33 Security, 39 Release | SX-06 | developer shell/contracts | planned |
| SX-11 Mobile/PWA | task-first mobile, offline/install/push | 28 Mobile, 29 PWA, 30 Performance, 38 E2E | SX-02/05 | mobile shell and offline evidence | planned |
| SX-12 Release conformance | prove quality and operational readiness | 30 Performance, 33 Security, 35 SEO, 36 Analytics, 37 QA, 38 E2E, 39 Release, 40 Conformance | all | gate evidence and rollout/rollback | planned |

## Gate status

| Gate | State | Evidence/gap |
| --- | --- | --- |
| Information architecture | defined | this document set |
| Interaction architecture | target defined | prototypes/usability evidence absent |
| Visual architecture | principles defined | implemented Sherivs visuals absent |
| Responsive architecture | target defined | viewport evidence absent |
| Accessibility | target defined | comprehensive axe/manual evidence absent |
| Performance | baseline unmeasured | no route budgets/Web Vitals report |
| Security | boundaries defined | migration threat model and route review pending |
| Implementation | not started | documentation only |
| Automated testing | existing platform tests only | Sherivs-specific tests absent |
| Human visual review | not started | no implemented surface |
| Architecture conformance | docs reviewed against V1 boundary | implementation review pending |

## Risks

1. Public root combines three responsibilities and may leak the wrong experience context.
2. Role-prefixed Scholar routes conflict with the target capability-driven IA.
3. Platform-internal surfaces share normal application conventions and need a stronger boundary.
4. Customer branding is mixed with technical/historical CoreGrid identity.
5. Current CSS overuses glass/cards and lacks a global reduced-motion baseline.
6. “Complete” architecture registry labels do not prove live, production-connected UX.
7. Several current routes touch frozen or mixed-version capabilities.
8. Public capability and pricing copy require claim-by-claim product/legal verification.
9. Neutral organization/tenant migrations are authored but not applied; existing live flows still
   rely heavily on Scholar `school_id` vocabulary and helpers.
10. Service-role writes bypass RLS by design, so every corresponding server function must retain
    complete authentication, tenant resolution, authorization, validation, and audit gates.
11. The legacy `universalschoolos.com` host remains in canonical, OpenGraph, sitemap, and tenant
    resolution paths; the referenced public OpenGraph image is not present in repository assets.
12. The public legal surface lacks a complete terms route and some organization footer policy
    labels are not links.

## Remaining work

No production deployment was attempted. Next authorized work is SX-02 foundation plus SX-03 public
content/claim validation, after owners approve the brand assets and customer-facing claims.

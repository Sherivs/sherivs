# Sherivs Experience Status

Status date: 2026-10-08  
Program state: `RECONNAISSANCE COMPLETE / BOUNDARY PROPOSED / IMPLEMENTATION NOT STARTED`  
Version target: `ACTIVE-V1`; frozen scope is inventory-only.

## Actual state

No Sherivs customer-facing implementation existed at reconnaissance time. The repository presents CoreGrid as platform, Scholar as runtime, and retains visible Vibeora/Universal School OS debt. This change set establishes program architecture; it does not claim a redesigned platform, production deployment, accessibility conformance, or performance conformance.

## Repository inventory

| Area                             |       Observed |
| -------------------------------- | -------------: |
| Repository files                 |          2,924 |
| Web route modules                |           ~162 |
| Unique web URL paths             |            156 |
| Mobile route modules             |             10 |
| Frontend TSX files               |            268 |
| Component files                  |            113 |
| shadcn/Radix primitives          |             48 |
| Files using PortalPage/GlassCard |            131 |
| Lucide consumers                 |            ~95 |
| Recharts usage routes            | 3 plus wrapper |
| Playwright specs                 |              7 |
| Automated axe tooling            |              0 |
| React component test framework   |              0 |

Evidence sources: `COREGRID_REPOSITORY_INVENTORY.json`, `routeTree.gen.ts`, `components.json`, `package.json`, and repository search on 2026-10-08.

## Surface implementation inventory

Status vocabulary: `EXISTS`, `PARTIAL`, `PROPOSED`, `FROZEN`, `ABSENT`, `UNVERIFIED`.

| Surface                | Route/current source                  | Components                  | Owner / mission       | Status                   | Test             | A11y                  | Performance  | Security                           |
| ---------------------- | ------------------------------------- | --------------------------- | --------------------- | ------------------------ | ---------------- | --------------------- | ------------ | ---------------------------------- |
| Sherivs public         | current `/coregrid`, `/platform`, `/` | `(site)/*`, public sections | Public Web / SX-07    | PROPOSED                 | not run          | not audited           | not measured | public claims review pending       |
| Organization public    | `/`, blog/news/events/admissions      | `components/public/*`       | Org Public / SX-08    | PARTIAL, Scholar-coupled | limited          | partial               | not measured | publication boundary review        |
| Authentication         | `/auth`, `/login`, reset/bootstrap    | route-local UI              | Identity / SX-09      | EXISTS, legacy copy      | unit/e2e present | partial               | not measured | tenant/context risks recorded      |
| Universal shell        | `/_authenticated`                     | sidebar/header/command      | App Shell / SX-04     | PARTIAL; registry gap    | e2e partial      | partial               | not measured | UI guards not security             |
| Organization workspace | role route families                   | portal patterns             | Workspace / SX-05     | EXISTS, Scholar ontology | broad unit tests | not audited           | not measured | RLS/app gates vary                 |
| Sherivs internal       | `/super-admin/*`, `/command-centre`   | command centre, portal      | Internal / SX-06      | PARTIAL boundary         | unit partial     | not audited           | not measured | separate platform identity pending |
| Scholar runtime        | role portals                          | runtime nav catalog         | Runtime / SX-11       | EXISTS                   | broad unit/e2e   | partial               | not measured | runtime/platform coupling          |
| Account/settings       | `/settings`, admin settings           | profile/menu/forms          | Account / SX-10       | PARTIAL                  | unit partial     | not audited           | not measured | sensitive reauth incomplete        |
| Search/commands        | command palette                       | command components          | Navigation / SX-12    | PARTIAL                  | unit partial     | keyboard partial      | not measured | action reauthorization required    |
| Notifications          | `/notifications`, shell bell          | notification components     | Notifications / SX-13 | PARTIAL                  | unit partial     | live behavior partial | not measured | tenant/recipient review            |
| Calendar/time          | role calendars                        | calendar/timetable          | Time / SX-14          | PARTIAL                  | unit partial     | not audited           | not measured | permission review                  |
| AI practical           | role assistants                       | `components/ai/*`           | AI Experience / SX-15 | PARTIAL                  | gateway tests    | not audited           | not measured | gateway/minimization required      |
| Missions/workers       | mobile + super-admin                  | mission/worker surfaces     | Mission / SX-16       | PARTIAL                  | unit partial     | not audited           | not measured | authority/evidence required        |
| Mobile                 | Expo routes                           | mobile UI primitives        | Mobile / SX-17        | FOUNDATION               | tests limited    | partial               | not measured | secure context review              |
| PWA                    | manifest + service worker             | manifest engine             | PWA / SX-18           | PARTIAL                  | unit partial     | not audited           | not measured | offline/notification review        |
| Developer/API          | server fns/docs only                  | none unified                | Developer / SX-19     | ABSENT as experience     | n/a              | n/a                   | n/a          | key/scope design required          |
| Device/IoT/transport   | driver/bus/geofence/biometric         | route-local                 | Frozen                | FROZEN V2                | no new work      | n/a                   | n/a          | unapplied RLS work noted           |
| Physical/reality twins | reality/twin previews                 | generated surfaces          | Frozen                | FROZEN/MIXED             | no new work      | n/a                   | n/a          | no implementation authorized       |

## Mission portfolio

Every mission uses the required mission model: ID, objective, team, owner, scope/non-scope, dependencies, inputs/outputs/contracts, design/engineering requirements, acceptance, test/accessibility/performance/security/evidence/rollback plans, and status.

| Mission | Team                    | Objective                            | Dependencies                      | Output                             | Status               |
| ------- | ----------------------- | ------------------------------------ | --------------------------------- | ---------------------------------- | -------------------- |
| SX-01   | Experience Architecture | lock planes, boundaries, contracts   | governance                        | architecture suite                 | COMPLETE-DRAFT       |
| SX-02   | Brand Architecture      | classify Sherivs migration           | SX-01                             | migration plan                     | COMPLETE-DRAFT       |
| SX-03   | Design Systems          | consolidate tokens/components        | SX-01                             | canonical token source             | PROPOSED             |
| SX-04   | Application Shell       | capability-driven universal shell    | registry gap decision, tenancy    | shell contracts and implementation | BLOCKED-ARCHITECTURE |
| SX-05   | Organization Workspace  | neutralize Scholar shell ontology    | SX-04, role mapping               | organization workspace             | PROPOSED             |
| SX-06   | Sherivs Workspace       | isolate internal platform operations | identity authority                | internal shell                     | BLOCKED-SECURITY     |
| SX-07   | Public Web              | build evidenced Sherivs narrative    | SX-02, content approvals          | public site                        | PROPOSED             |
| SX-08   | Organization Public     | generalize publication engine        | content schema, runtime contracts | generic public engine              | PROPOSED             |
| SX-09   | Authentication/Identity | resolve actual post-auth context     | tenancy/role reconciliation       | auth flows                         | PROPOSED             |
| SX-10   | Account/Settings        | hierarchical verified settings       | SX-09                             | account/settings                   | PROPOSED             |
| SX-11   | Runtime Projection      | map Scholar without contamination    | role vocabulary                   | runtime adapter                    | PROPOSED             |
| SX-12   | Navigation/Search       | unify authorized discovery           | experience contract               | nav/search/commands                | PROPOSED             |
| SX-13   | Notifications           | tenant-safe inbox/preferences        | identity, delivery                | notification center                | PROPOSED             |
| SX-14   | Calendar/Time           | universal temporal primitives        | timezone contracts                | calendar/time system               | PROPOSED             |
| SX-15   | AI Experience           | expose trust and approval states     | AI gateway, policy                | AI patterns                        | PROPOSED             |
| SX-16   | Mission/Workforce       | governed object experiences          | actor/delegation model            | mission/worker UX                  | PROPOSED             |
| SX-17   | Mobile                  | compose mobile IA and shared tokens  | SX-03, SX-04                      | mobile experience                  | PROPOSED             |
| SX-18   | PWA                     | offline/install/push behavior        | security and cache policy         | PWA hardening                      | PROPOSED             |
| SX-19   | Developer               | document only real APIs              | stable contracts                  | developer surface                  | BLOCKED-CAPABILITY   |
| SX-20   | Quality/Release         | automate a11y, visual, perf, E2E     | implemented surfaces              | conformance evidence               | PROPOSED             |

## Required mission packet fields

Each mission file must include:

```text
MISSION_ID, NAME, OBJECTIVE, TEAM, OWNER, SCOPE, NON_SCOPE,
DEPENDENCIES, INPUTS, OUTPUTS, CONTRACTS, DESIGN_REQUIREMENTS,
ENGINEERING_REQUIREMENTS, ACCEPTANCE_CRITERIA, TEST_PLAN,
ACCESSIBILITY_PLAN, PERFORMANCE_PLAN, SECURITY_PLAN, EVIDENCE_PLAN,
ROLLBACK_PLAN, STATUS, VERSION_TARGET
```

## Design review gate status

| Gate                     | State                                               |
| ------------------------ | --------------------------------------------------- |
| Information architecture | draft produced                                      |
| Interaction architecture | not reviewed                                        |
| Visual architecture      | not started                                         |
| Responsive architecture  | draft produced                                      |
| Accessibility            | baseline and target produced; audit not run         |
| Performance              | requirements only; measurements absent              |
| Security                 | risks inventoried; shell/internal decisions pending |
| Implementation           | not started                                         |
| Automated testing        | architecture validation passed; UI suites deferred  |
| Human visual review      | not applicable yet                                  |
| Architecture conformance | draft pending authority review                      |

## Known risks

1. Dual tenancy models and an incomplete organization switch flow.
2. Client role guards can be mistaken for authorization.
3. Internal platform surfaces are not cleanly isolated from customer shell architecture.
4. CoreGrid/Scholar assumptions permeate routes and runtime navigation.
5. Three experience/token namespaces and separate mobile tokens create drift.
6. Legacy domain metadata and visible Vibeora strings remain.
7. Reduced motion is detected but not consistently enforced.
8. No automated accessibility or visual regression pipeline.
9. Several routes correspond to frozen device/reality scope.
10. Canonical “system overview” documentation is stale relative to mobile and marketplace code.

## Remaining work

Obtain architecture decisions for the global shell and internal identity boundary; approve brand/domain migration; convert each proposed mission into a complete packet; execute V1 missions in dependency order; measure and verify before changing status. Deployment and production verification have not occurred.

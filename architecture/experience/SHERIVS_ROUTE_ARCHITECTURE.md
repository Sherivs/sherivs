# Sherivs Route Architecture

Status: Current inventory + governed target; route creation is not implied  
Version target: ACTIVE-V1 unless marked frozen

## Routing laws

TanStack Start file routes under `frontend/src/routes/` are canonical; `routeTree.gen.ts` is
generated. Public, customer-authenticated, platform-internal, runtime, and API routes use explicit
layouts and security boundaries. A hidden navigation item is not authorization.

## Current inventory

The repository currently contains **161 route files**: 154 TSX surfaces/layouts, two public API
handlers, generated manifest/sitemap/health handlers, and support files. **133** files are under the
authenticated route group.

### Public and platform routes

`/`, `/admissions`, `/auth`, `/blog`, `/blog/:slug`, `/coregrid`, `/events/:id`,
`/foundation-loop`, `/health.json`, `/login`, `/manifest.webmanifest`, `/marketplace`,
`/news/:id`, `/platform`, `/platform/org`, `/privacy`, `/reality/:class`, `/reset-password`,
`/rules`, `/scholar-foundation-loop`, `/sitemap.xml`, `/super-admin-bootstrap`.

Findings: `/` multiplexes tenant public site and platform command centre; `/coregrid` is the current
marketing page; several operational/bootstrap routes are publicly addressable and require a
separate security review before migration. `/login` and `/auth` overlap.

### Shared authenticated routes

`/runtime`, `/messages`, `/notifications`, `/settings`, `/command-centre`.

### Scholar admin routes

`/admin/{dashboard,admissions,ai-assistant,analytics,api-keys,attendance,audit,audit-logs,broadcast,
bus-management,buses,calendar,classes,cms,digital-twin,discipline,education-reality,
enterprise-checklist,examinations,expenses,extracurricular,facilities,features,fees,
fees-defaulters,financial-reports,geofence-settings,grades,health,health-certificate,hostel,hr,
identities,intelligence,intelligence-ai,intelligence-operations,intelligence-parents,
intelligence-students,intelligence-teachers,inventory,lesson-plans,library,locked-accounts,news,
operations,payroll,report-cards,school-profile,settings,staff-accounts,student-intelligence,
students,support,teacher-intelligence,teachers,timetable,visitors}`.

### Other Scholar role routes

- Teacher: `/teacher/{dashboard,ai-assistant,attendance,attendance-week,biometric-enrollment,
  calendar,class-intelligence,gradebook,grades,lesson-plans,news,sign-in,timetable}`.
- Parent: `/parent/{dashboard,ai-assistant,attendance,bus-tracking,calendar,children,fees,grades,
  news,report-cards}`.
- Student: `/student/{dashboard,ai-tutor,attendance,calendar,fees,grades,news,report-card,timetable}`.
- Bursar: `/bursar/{dashboard,fee-plans,financial-intelligence,receipts,reconciliation,reports}`.
- Driver: `/driver/{dashboard,students}`.
- HQ: `/hq/{dashboard,finance,reports}`.

These role-prefixed routes are migration debt relative to capability-driven workspace composition.
They remain supported until equivalent governed routes exist and deep links are redirected.

### Platform operator routes

`/super-admin/{dashboard,academic-intelligence,agent-governance,billing,communication-steward,
financial-operations,logs,platform-config,runtime-contracts,scheduling-intelligence,schools,
settings,support,tenants,tiers,trust-fabric,worker-missions,workspace-projection}`.

The target Sherivs internal workspace requires a distinct platform-workforce grant; the existing
`super-admin` label and normal authenticated shell are insufficient evidence of that separation.

### API routes

- `POST /api/public/audit/password-reset`
- `POST /api/public/webhooks/paystack`

Both are public entry points and must retain validation, rate/replay controls, provider signature
checks where applicable, minimal logging, and immutable audit evidence.

## Target route namespaces

| Namespace | Shell | Rule |
| --- | --- | --- |
| `/` and public paths | Sherivs public | only evidence-backed pages ship |
| `/org/:orgSlug/*` or verified custom domain | organization public | approved tenant content |
| `/auth/*` | auth shell | context resolution after auth |
| `/app/*` | universal application | organization/workspace selected |
| `/app/account/*` | account | identity-scoped |
| `/app/settings/*` | hierarchical settings | personal/org scopes explicit |
| `/app/w/:workspaceId/*` | workspace | capability-derived navigation |
| `/app/runtime/:runtimeId/*` | runtime | registered contribution only |
| `/internal/*` | Sherivs internal | separate workforce authorization |
| `/developers/*` | developer public/private | claims and credentials scoped |
| `/api/v1/*` | API | versioned typed contracts |

## Public target catalog

Candidate routes from the program brief are accepted only after content/capability evidence:

- Platform: `/platform`, `/platform/{memory,ai-workforce,missions,intelligence,governance,
  integrations}`. `/platform/reality` is V3-frozen unless reframed strictly around ACTIVE-V1
  organizational records.
- Solutions: `/solutions/{organizations,enterprise,education,operations,ai-workforce}`.
- Trust/commercial: `/security`, `/enterprise`, `/pricing`.
- Resources: `/resources`, `/resources/{blog,docs,guides,case-studies,changelog}` plus `/:slug`.
- Company: `/about`, `/company`, `/careers`, `/contact`, `/request-demo`.
- Legal/operations: `/legal/{privacy,terms,cookies,accessibility}`, `/status`.

No route should exist merely to satisfy the catalog. Missing real content remains a documented gap.

## Authentication target

`/auth/sign-in`, `/auth/sign-up`, `/auth/magic-link`, `/auth/mfa`, `/auth/sso`,
`/auth/invitation`, `/auth/verify-email`, `/auth/forgot-password`, `/auth/reset-password`,
`/auth/recovery`, `/auth/context`, `/auth/expired`, `/auth/suspicious`, `/auth/logout`.
Implement only provider-supported methods. Passkey, SSO, and magic link remain hidden until backend
contracts exist.

## Transition plan

1. Introduce Sherivs public shell without changing technical identifiers.
2. Split `/` platform and organization behavior into explicit host/context resolution.
3. Add context-resolving auth and preserve legacy redirects.
4. Mount the universal shell at `/app`.
5. Map legacy role routes to capability destinations; record redirects and analytics.
6. Move operator surfaces behind `/internal` only after separate authorization is proven.
7. Remove legacy routes only after usage, deep-link, SEO, and rollback evidence.

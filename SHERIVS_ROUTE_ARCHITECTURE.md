# Sherivs Route Architecture

Status: `OBSERVED BASELINE / PROPOSED TARGET`  
Version target: `ACTIVE-V1` unless marked frozen.  
Canonical machine source: `frontend/src/routeTree.gen.ts`

## Current web route inventory

The generated tree contains 156 unique URL paths. Route groups do not add URL segments.

### Public, authentication, and infrastructure

`/`, `/admissions`, `/auth`, `/blog`, `/blog/$slug`, `/events/$id`, `/foundation-loop`, `/health.json`, `/login`, `/manifest.webmanifest`, `/marketplace`, `/news/$id`, `/platform`, `/platform/org`, `/privacy`, `/reality/$class`, `/reset-password`, `/rules`, `/scholar-foundation-loop`, `/sitemap.xml`, `/super-admin-bootstrap`, `/coregrid`, `/api/public/audit/password-reset`, `/api/public/webhooks/paystack`

Notes:

- `/login` redirects to `/auth`.
- `/` is overloaded between platform command centre, tenant public site, and authenticated redirect.
- `/platform/org` and `/reality/$class` are public previews and require disposition.
- API path rendering is governed by TanStack route IDs; generated tree is authoritative.

### Shared authenticated

`/messages`, `/notifications`, `/settings`, `/runtime`, `/command-centre/`

All require a session. Resource authorization remains the server/RLS responsibility.

### Organization administration (57)

`/admin/` plus:

`admissions`, `ai-assistant`, `analytics`, `api-keys`, `attendance`, `audit`, `audit-logs`, `broadcast`, `bus-management`, `buses`, `calendar`, `classes`, `cms`, `dashboard`, `digital-twin`, `discipline`, `education-reality`, `enterprise-checklist`, `examinations`, `expenses`, `extracurricular`, `facilities`, `features`, `fees`, `fees-defaulters`, `financial-reports`, `geofence-settings`, `grades`, `health`, `health-certificate`, `hostel`, `hr`, `identities`, `intelligence`, `intelligence-ai`, `intelligence-operations`, `intelligence-parents`, `intelligence-students`, `intelligence-teachers`, `inventory`, `lesson-plans`, `library`, `locked-accounts`, `news`, `operations`, `payroll`, `report-cards`, `school-profile`, `settings`, `staff-accounts`, `student-intelligence`, `students`, `support`, `teacher-intelligence`, `teachers`, `timetable`, `visitors`.

Frozen/device-adjacent: `bus-management`, `buses`, `geofence-settings`; frozen or mixed physical/reality portions: `digital-twin`, `education-reality`. “Intelligence” names do not by themselves prove frozen behavior and require contract-level classification.

### Super administration/control plane (18)

`/super-admin/` plus:

`academic-intelligence`, `agent-governance`, `billing`, `communication-steward`, `dashboard`, `financial-operations`, `logs`, `platform-config`, `runtime-contracts`, `scheduling-intelligence`, `schools`, `settings`, `support`, `tenants`, `tiers`, `trust-fabric`, `worker-missions`, `workspace-projection`.

These must move behind the Sherivs internal boundary only after platform-identity authorization is proven.

### Teacher (14)

`/teacher/` plus:

`ai-assistant`, `attendance`, `attendance-week`, `biometric-enrollment`, `calendar`, `class-intelligence`, `dashboard`, `gradebook`, `grades`, `lesson-plans`, `news`, `sign-in`, `timetable`.

`biometric-enrollment` is frozen V2/device scope.

### Parent (11)

`/parent/` plus:

`ai-assistant`, `attendance`, `bus-tracking`, `calendar`, `children`, `dashboard`, `fees`, `grades`, `news`, `report-cards`.

`bus-tracking` is frozen V2/device scope.

### Student (10)

`/student/` plus:

`ai-tutor`, `attendance`, `calendar`, `dashboard`, `fees`, `grades`, `news`, `report-card`, `timetable`.

### Bursar (6)

`/bursar/` plus:

`dashboard`, `fee-plans`, `financial-intelligence`, `receipts`, `reconciliation`, `reports`.

### HQ (3)

`/hq/` plus `dashboard`, `finance`, `reports`.

### Driver (2)

`/driver/` plus `dashboard`, `students`. This route family is frozen V2/device/transport scope.

## Current mobile route inventory

`/`, `/sign-in`, `/(app)`, `/(app)/organization`, `/(app)/missions`, `/(app)/missions/[id]`, `/(app)/agents`, `/(app)/evidence`, `/(app)/settings`.

## Current shell ownership

| Group               | Current shell                                     | Risk                                          |
| ------------------- | ------------------------------------------------- | --------------------------------------------- |
| Document            | `routes/__root.tsx`                               | Shared metadata still legacy-domain dependent |
| Public marketing    | `routes/(site)/route.tsx`                         | Only `/coregrid` participates                 |
| Organization public | `routes/index.tsx` + `components/public/site.tsx` | Root route overload; Scholar assumptions      |
| Authentication      | `routes/auth.tsx`                                 | Scholar runtime copy                          |
| Authenticated       | `routes/_authenticated/route.tsx`                 | Session gate plus client role guards          |
| Role portals        | each `route.tsx`                                  | Domain-specific route ontology                |
| Internal            | super-admin/command-centre                        | Not yet a clean separate platform boundary    |

## Target route policy

Target namespaces are reserved only after capability and content exist:

- Public Sherivs: `/`, `/platform/*`, `/solutions/*`, `/security`, `/enterprise`, `/resources/*`, `/company/*`, `/legal/*`, `/status`.
- Organization public: host-based organization route with published content projection.
- Authentication: `/auth/*`.
- Account: `/account/*`.
- Organization workspace: `/o/:organizationSlug/w/:workspaceSlug/*`.
- Sherivs internal: separate internal host or `/internal/*` with platform authorization.
- Developer: `/developers/*` only when API contracts, keys, and documentation are real.

No empty target page is created merely to satisfy the sitemap.

## Redirect and compatibility rules

1. Customer-facing `/coregrid` becomes a Sherivs route only after metadata, copy, canonical URL, and redirects are approved together.
2. Existing role URLs remain compatibility routes during workspace migration.
3. Technical API, runtime, package, database, and migration identifiers do not follow marketing redirects.
4. Redirects preserve query parameters only when safe and never carry tenant hints across unauthorized contexts.
5. Every route declares audience, shell, capability, policy action, data owner, loading/error states, SEO visibility, and version target.

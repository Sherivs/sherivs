# SHERIVS Route Architecture

**Status:** CURRENT INVENTORY RATIFIED · TARGET MAP PROPOSED · **Version-target:** V1
161 route modules inventoried (TanStack Start, file-based, `frontend/src/routeTree.gen.ts`).

---

## 1. Current inventory (verified 2026-10-08)

### 1.1 Public plane (no auth)

| Route | Purpose | Brand state |
|-------|---------|-------------|
| `/` | tenant-resolved: org site / command centre / role redirect | Sherivs meta (Phase 1) |
| `/(site)/coregrid` | Sherivs public landing (path preserved for compatibility) | Sherivs (Phase 1) |
| `/platform` | kernel capability browser (50 capabilities, snapshot-bound) | Sherivs chrome (Phase 1) |
| `/platform.org` | internal operating workspace surface (operator-only) | technical — no migration |
| `/blog`, `/blog.$slug` | publishing | extend under content architecture |
| `/news.$id`, `/events.$id` | org public content | org brand |
| `/admissions` | public admissions entry | org brand |
| `/marketplace` | entitlement-gated catalog from org reality | Sherivs chrome (Phase 2) |
| `/reality.$class` | generated digital environment | generated per org |
| `/auth`, `/login`, `/reset-password` | authentication | Sherivs (Phase 1, `/auth`) |
| `/privacy`, `/rules` | policy surfaces | extend to full legal set |
| `/foundation-loop`, `/scholar-foundation-loop` | runtime loops | runtime scope |
| `/super-admin-bootstrap` | operator bootstrap | technical |
| `/health.json`, `/sitemap.xml`, `/manifest.webmanifest` | system endpoints | technical/generated |
| `/api/public/*` | password-reset audit, paystack webhook | technical |

### 1.2 Authenticated plane (universal shell at `_authenticated/route.tsx`)

Role workspaces (projection-driven, Scholar runtime bindings):

- `admin/*` — 50 routes: dashboard, students, teachers, classes, attendance,
  grades, examinations, timetable, lesson-plans, fees, payroll, expenses,
  financial-reports, hr, hostel, library, health, discipline, visitors, buses,
  facilities, inventory, news, broadcast, calendar, cms, school-profile,
  settings, staff-accounts, locked-accounts, identities, api-keys,
  audit/audit-logs, support, analytics, operations, intelligence* (7),
  ai-assistant, digital-twin, education-reality, enterprise-checklist,
  features, report-cards, admissions, bursar-adjacent fees views.
- `teacher/*` — 14 routes, `student/*` — 10, `parent/*` — 11, `bursar/*` — 7,
  `driver/*` — 3, `hq/*` — 4, `super-admin/*` — 17 (internal boundary P5),
  `command-centre/*` — operations projection (internal boundary P5).
- Shared: `messages`, `notifications`, `settings`, `runtime`.

### 1.3 Layouts and guards

`__root.tsx` (document head, error/404, toast, progress) → `(site)` layout →
`_authenticated` shell (sidebar, switcher, command mount, bottom nav, offline
banner) → role `route.tsx` guards → pages. `role-guard` + server authorization
behind every shell; RLS behind every query.

---

## 2. Target map (V1 — proposed, phased)

Public additions land ONLY where capability exists (no fabricated claims):

| Phase | Routes | Depends on |
|-------|--------|------------|
| T1 (done) | brand-correct `/`, `/coregrid`, `/platform`, `/auth`, shell fallback | — |
| T2 | `/security`, `/enterprise`, `/pricing` (from typed tier catalog), `/status`, `/about`, `/contact`, `/request-demo` | content architecture mission |
| T3 | `/platform/*` capability narratives (reality, memory, ai-workforce, missions, intelligence, governance, integrations) rendered FROM the kernel registries, never hand-written | registry projection contract |
| T4 | `/solutions/*`, `/resources/*` (blog/guides/case-studies/changelog/docs + slugs), `/legal/*`, `/developers/*` | content + developer missions |
| T5 | org-site engine parity (`about, programs, locations, people, events, resources, policies, contact`) driven by org reality | org-site mission |
| T6 | account system (`/account/*`), org settings IA, onboarding flows, notification center, command palette authority audit | shell missions |

Scholar deep routes stay under role workspaces via the runtime nav registry —
never as top-level platform routes (neutrality LAW 3/LAW 5). Internal routes
(`super-admin`, `command-centre`, `platform.org`, bootstrap) never gain public
links, sitemap entries or customer search indexing.

---

## 3. Rules

1. New public pages require a capability owner + real content + tests.
2. Route paths are compatibility surface: renames need redirects + registry note.
3. Every route declares document head (title, description, OG, canonical).
4. Authenticated routes resolve tenant → authorize → validate → execute → audit.
5. `routeTree.gen.ts` is generated; missions assert its entries in tests.

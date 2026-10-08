# SHERIVS Experience Architecture

Version: V1 foundation (2026-10-08) · Classification: **V1**
Status: active implementation · Owner: Experience Architecture

This document is the explicit experience architecture for Sherivs. It defines
the planes, shells, routes, navigation, and boundaries every surface must obey.
Companion law: `SHERIVS_EXPERIENCE_CONSTITUTION.md`. Current truth:
`SHERIVS_EXPERIENCE_STATUS.md`.

## 1. Experience planes

| Plane | Audience | Shell | Entry |
|---|---|---|---|
| Public (Sherivs) | Visitors, evaluators | `SherivsPublicShell` | `/`, `/sherivs` |
| Public (organization) | Public of one tenant | `PublicSchoolSite` / generated-site engine | tenant host or `?school=` |
| Application (universal) | Signed-in members | `SherivsAppShell` | `/_authenticated/*` |
| Organization workspace | Members of one org | `SherivsAppShell` + capability nav | role home |
| Internal (Sherivs company) | Staff only, separate boundary | `SherivsAppShell` + staff guard | planned (see §9) |
| Domain runtime | Sector users (e.g. Scholar) | workspace shells + runtime contributions | role home |
| Developer/API | Builders | docs surfaces (planned) | `/resources` → API docs when published |
| System/operational | Operators (gated) | Command Centre | gated `_authenticated/command-centre` |

The application shell is the universal experience layer shared by
authenticated applications — it is not an organization.

## 2. Shells

- **Public shell** (`frontend/src/components/sherivs/public-shell.tsx`):
  brand header, primary nav from `public-registry.ts`, mobile menu,
  enterprise footer (real links only, no fabricated socials).
- **Universal app shell** (`sherivs-shell.tsx`): global header (org/workspace
  context, search, command palette, Jarvis, notifications, profile),
  capability-driven sidebar (collapsible, drawer on mobile), breadcrumb
  content area, slots for notification center and AI panel.
- **Organization public shell**: existing `PublicSchoolSite` + generated-site
  engine — tenant brand layer, unchanged by this program except Sherivs
  chrome attribution.
- **Runtime shells**: Scholar role workspaces under `_authenticated/*` —
  preserved; runtime-specific sections load only when the runtime is active.

## 3. Routes (V1)

Public Sherivs: `/`, `/sherivs`, `/platform`, `/solutions/education`,
`/security`, `/enterprise`, `/pricing`, `/resources`, `/about`, `/contact`,
`/request-demo`, `/legal/privacy`, `/legal/terms`, `/legal/cookies`,
`/legal/accessibility`, `/status`, `/blog`, `/auth` (operator Command Centre stays gated; V1-012 forbids a public route).
Full inventory with owners: `SHERIVS_ROUTE_ARCHITECTURE.md`.

## 4. Navigation principles

1. Capability-driven: role + permissions + installed runtimes project nav.
   Nothing renders for an unauthorized capability.
2. Command-first: every authorized action discoverable via command palette;
   the palette never bypasses policy.
3. Tenant-scoped: every authenticated route resolves tenant before content.
4. No dead ends: every CTA targets a real route; no fabricated destinations.

## 5. Cross-cutting systems

- **Authentication**: `/auth` single surface (sign in/up, verification,
  recovery, invitation, org selection). Never `LOGIN → SCHOLAR` by default —
  post-auth routing resolves actual context (tenant, role, runtime).
- **Account/settings**: hierarchical (personal → organization → platform),
  security-sensitive ops re-verified. Canonical component: app shell slots.
- **Search**: universal index (people, orgs, missions, knowledge, settings,
  help) with permission-ranked results, keyboard access, empty/no-result states.
- **Notifications**: inbox with priority/category/org scoping, preferences per
  channel; realtime delivery respects tenant authorization.
- **AI interface**: contextual + Jarvis; responses distinguish observation /
  inference / recommendation / action / evidence / verification
  (`evidence.tsx`). Reasoning animations represent real backend state only.
- **Time**: platform primitive — user/org/UTC, locale formats, business hours;
  never one hardcoded zone.
- **Offline**: queued mutations where permitted, visible offline states,
  no silent loss.

## 6. Theming and branding

- Light / dark / system via existing theme bootstrap; Sherivs tokens additive.
- Organization brand layer is a controlled token override
  (`--tenant-primary/--tenant-secondary`) that must not destroy usability.
- High contrast honored via `prefers-contrast`; motion via
  `prefers-reduced-motion`.

## 7. State management and data

- Server state: TanStack Query; URL state for pagination/filters; local UI
  state colocated. Governed experience contracts (organization reality +
  runtime + capabilities + role + permissions + context + theme + content =
  experience configuration) are consumed from validated schemas only —
  arbitrary database data never becomes UI without authorization + validation.

## 8. Error handling contract

Every consequential surface implements: default, hover, focus, active,
disabled, loading, success, error, warning, empty, partial, offline,
unauthorized, forbidden, expired, stale. Shared primitives:
`sherivs/system-states.tsx`.

## 9. Explicit non-scope (frozen)

- Internal Sherivs company workspace: specified, not yet built — separate
  security boundary, never exposed via customer navigation.
- Developer portal / API reference: specified, published only with real
  endpoints and examples.
- V2 (device/IoT) and V3 (Reality Intelligence) surfaces: **frozen** per the
  V1 execution boundary. Analyzed and proposed only; never implemented or
  migrated toward without human authorization.

## 10. Security boundaries

Public ⇄ tenant-public ⇄ authenticated ⇄ staff-internal are distinct
boundaries. Client tenant IDs, roles and hidden fields are never trusted;
RLS + server authorization decide. Realtime, payments (signature,
idempotency, replay protection) and AI egress follow the same rule.

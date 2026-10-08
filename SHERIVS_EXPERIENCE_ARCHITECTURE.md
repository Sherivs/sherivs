# SHERIVS Experience Architecture

**Status:** RATIFIED for V1 execution · **Version-target:** V1 (organizational capability envelope)
**V1 execution boundary:** V2 (device/IoT), V3 (Reality Intelligence) and FUTURE-UNASSIGNED
capabilities are FROZEN — this document may name them as frozen scope only.
**Supersedes nothing.** Complements `AGENTS.md`, `ARCHITECTURE.md`, `BOUNDARIES.md`.

---

## 1. Purpose

This document defines the complete Sherivs Experience System: the planes, shells,
routes, navigation, information architecture and system behaviors shared by every
authenticated and public Sherivs surface. It is the decision parent for:

- `SHERIVS_ROUTE_ARCHITECTURE.md` (route inventory + target map)
- `SHERIVS_DESIGN_SYSTEM.md` (tokens, typography, motion, theming)
- `SHERIVS_BRAND_MIGRATION.md` (CoreGrid → Sherivs classification)
- `SHERIVS_EXPERIENCE_STATUS.md` (surface inventory with conformance status)

Follow-ups with their own charters (constitution, component catalog, IA, content,
motion, accessibility, responsive) are tracked in `SHERIVS_EXPERIENCE_STATUS.md`
and land as separate missions. Nothing here is implemented by assertion: a surface
is complete only when its row in the status inventory reads PASS with evidence.

---

## 2. Experience planes

| # | Plane | Audience | Shell | Brand |
|---|-------|----------|-------|-------|
| P1 | Sherivs Public Experience | visitors, buyers | public shell (`(site)` group) | Sherivs |
| P2 | Organization Public Experience | org visitors (parents, public) | organization site engine (`PublicSchoolSite`, generated-site renderer) | org brand, "powered by Sherivs" |
| P3 | Universal Application Shell | signed-in users | authenticated shell (`_authenticated/route.tsx`: header, sidebar, switcher, command, notifications) | Sherivs |
| P4 | Organization Workspace | org members | workspace projection (role × capabilities) | Sherivs + org identity |
| P5 | Sherivs Internal Workspace | Sherivs staff only | separate security boundary (super-admin / command-centre) | Sherivs internal |
| P6 | Domain Runtime Experience | role users (Scholar today) | runtime nav registry + Scholar bindings | Sherivs Scholar |
| P7 | Mobile Experience | all, small viewports | responsive shells + bottom nav + sheets | Sherivs |
| P8 | PWA / Offline Experience | installed users | manifest + offline banner + cached reads | org or Sherivs brand |
| P9 | AI / Conversational Experience | role users | assistant shells + `AiStateMark` states | Sherivs / Jarvis |
| P10 | Developer / API Experience | integrators | API keys, webhooks, docs surfaces | Sherivs |
| P11 | System / Operational Experience | operators | health, status, audit, incidents | technical (CoreGrid kernel vocabulary preserved) |

P11 is TECHNICAL scope: kernel vocabulary is the preserved master architecture
(V5.1/V5.2) and is never rebranded. All other planes render the Sherivs brand
through `@/lib/brand/sherivs` — never through `@/lib/platform` directly.

---

## 3. Shell architecture

```
SHERIVS
  │
  ├─ PUBLIC SHELL ............ (site) group: header / main / footer
  │     ├─ Sherivs website .... /coregrid (route path preserved), /platform
  │     └─ Org public engine .. tenant-resolved PublicSchoolSite / generated-site
  │
  ├─ APPLICATION SHELL ....... _authenticated route (universal, all signed-in users)
  │     ├─ header ............ brand mark · workspace switcher · search/command ·
  │     │                       notifications · profile · shell actions
  │     ├─ sidebar ........... workspace-dynamic (PortalSidebar, capability-driven)
  │     ├─ content ........... breadcrumbs · title · actions · page · secondary panel
  │     └─ global systems .... command palette · notification center · AI ·
  │                             help · shortcuts · theme · account · settings
  │
  ├─ WORKSPACE SHELL ......... role-projected navigation (nav-registry, no fixed portal)
  ├─ INTERNAL SHELL .......... super-admin + command-centre (separate boundary)
  └─ RUNTIME SHELL ........... Scholar bindings (one consumer of the workspace engine)
```

Laws:

1. **One universal shell.** The authenticated shell is shared infrastructure, not
   another organization. Role and capability projection decide what renders.
2. **Capability-driven navigation.** No fixed portal lists. `workspace-projection`
   derives navigation from authorized capability refs; backend authorization always
   governs (AGENTS §34 — the UI filter is cosmetic).
3. **Internal boundary.** P5 surfaces never leak into customer navigation, search
   results, sitemaps or command-palette actions for non-staff identities.
4. **No default runtime.** Auth resolves actual context; LOGIN → SCHOLAR by default
   is prohibited. Runtime selection follows tenancy, role and entitlement.

---

## 4. Information architecture (summary)

Top-level customer mental model:

```
Discover (public) → Authenticate (auth) → Orient (home/projection) →
Work (missions · people · knowledge · calendar · files) →
Govern (approvals · evidence · audit) → Administer (settings · members · billing)
```

Public narrative order (never generic hero→cards→testimonials): brand introduction →
category explanation → organizational reality → intelligence layer → AI workforce →
mission system → adaptive experiences → domain runtimes → governance → enterprise
architecture → future vision → CTA. `SherivsNarrativeSection` (numbered chapters)
enforces this order in code.

Full IA tree, content types and URL taxonomy: follow-up mission
(`SHERIVS_INFORMATION_ARCHITECTURE.md`), tracked in the status inventory.

---

## 5. Cross-cutting systems

| System | Contract | Current foundation |
|--------|----------|--------------------|
| Authentication | sign in/up, passkey/SSO-ready, MFA, recovery, invite acceptance, session states | `/auth`, server functions |
| Account | profile, preferences, locale, appearance, a11y, notifications, security, sessions, devices, export, deletion | settings surfaces (extend per §12 of program) |
| Organization settings | general → members/teams/roles → policies/security → brand/domains → integrations/AI → billing/usage → data/audit/API | admin settings (extend per §13) |
| Onboarding | account → organization → workspace, progressive disclosure | `lib/onboarding`, demo provisioning |
| Calendar/Time | month/week/day/agenda, timezone-first, UTC + org + user tz, locale formats | calendar components + routes (extend) |
| Search | people, orgs, missions, docs, knowledge, settings, help; keyboard-first, permission-filtered | command palette + command-centre |
| Command interface | discover authorized actions; MUST obey authorization, never bypass policy | `command-palette`, `lib/command` |
| Notifications | inbox, priority, category, approvals, preferences, push/email controls | notification bell + center (extend) |
| AI experience | contextual AI, Jarvis, mission assistance; visual states: observation / inference / recommendation / action / evidence / verification | assistant shells + `AiStateMark` |
| Mission experience | list → detail → plan → assign → execute → evidence → verify → approve → outcome → history | `lib/mission(s)`, command-centre (extend UX) |
| Workforce experience | overview, worker profile, authority, workload, cost, health, leases, audit | `lib/workforce` (extend UX) |
| Evidence & verification | source, confidence, timestamp, actor, model, outcome — trust made visible | `EvidenceTag` + `lib/evidence` |
| Theming | light / dark / system + controlled org brand-token layer (never breaks usability) | `light` class, tenant tokens |
| Localization | locale, timezone, currency, regional settings (extend) | partial — status inventory |
| Errors/loading/empty | default/hover/focus/active/disabled/loading/success/error/warning/empty/offline/unauthorized/forbidden/expired/stale per component | `planned-capability-state`, skeletons (extend) |
| Offline/PWA | installable manifest, offline banner, degraded reads | manifest route, `offline-banner` (extend) |
| SEO/social | canonical URLs, sitemap, robots, OG cards, structured data, real content only | sitemap route, per-tenant meta (extend) |
| Analytics | usage, performance (LCP/INP/CLS), experiments under policy | partial — status inventory |

---

## 6. Non-goals and prohibitions (V1)

- No V2/V3 implementation (device/IoT twins, Reality Intelligence) beyond frozen
  naming. Scholar's existing education-twin surfaces stay as-is; they are V1
  Scholar runtime scope, not V2 device scope.
- No fabricated claims: pages render only where capability exists
  (`planned-capability-state` where it does not).
- No generic design: gradient heroes, glass-everywhere, orb/particle decoration,
  fake metrics, fake social proof and testimonial carousels are prohibited unless
  architecturally justified (see design system doc).
- No frontend-only security: every shell/command action is backed by server
  authorization; RLS remains the tenant boundary.

---

## 7. Conformance

Every experience mission passes the program's review gates (IA → interaction →
visual → responsive → a11y → performance → security → implementation → tests →
visual review → architecture conformance) and records STATUS / TEST / A11Y / PERF /
SECURITY in `SHERIVS_EXPERIENCE_STATUS.md`. A claim without a version-target
classification is unverified.

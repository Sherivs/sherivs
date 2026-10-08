# SHERIVS Route Architecture

Version: V1 foundation (2026-10-08) · Classification: **V1**
Router: TanStack file routes (`frontend/src/routes`), generated
`routeTree.gen.ts`. Rule: a route ships only for an existing capability.

## 1. Public Sherivs (new/changed in V1 foundation)

| Route | Surface | Owner | Status |
|---|---|---|---|
| `/` | Sherivs narrative home (visitors); tenant site when tenant context; dashboard redirect when signed in | Experience | SHIPPED |
| `/sherivs` | Canonical overview (same narrative) | Experience | SHIPPED |
| `/platform` | Kernel detail (capabilities, runtimes, contracts) | Platform | RE-SKINNED (Sherivs chrome + `#capabilities`/`#runtimes` anchors) |
| `/solutions/education` | Installed education runtime | Runtime | SHIPPED (facts from runtime registry) |
| `/security` | Security & governance | Security | SHIPPED |
| `/enterprise` | Enterprise value | Experience | SHIPPED |
| `/pricing` | Tiers (mirrors commercial catalog) | Growth | SHIPPED (no entitlement logic) |
| `/resources` | Index of published surfaces only | Experience | SHIPPED |
| `/about` | What Sherivs is / is not | Experience | SHIPPED |
| `/contact` | Real contact paths (no invented inboxes) | Experience | SHIPPED |
| `/request-demo` | Evaluation path (links to real routes) | Growth | SHIPPED |
| `/legal/privacy|terms|cookies|accessibility` | Notices (behavior-honest, dated) | Legal/Experience | SHIPPED |
| `/status` | Live health from `/health.json` | Platform | SHIPPED |
| Operator Command Centre | Gated `_authenticated/command-centre` (super_admin) | Platform | KEPT (V1-012: no public route) |
| `/blog`, `/blog/$slug` | Writing (existing) | Experience | KEPT |
| `/coregrid` | Legacy platform page (compat) | Experience | KEPT, P1 to canonical-redirect to `/sherivs` |
| `/auth` | Single auth surface | Identity | KEPT (Sherivs chrome via brand constants) |
| `/health.json`, `/manifest.webmanifest`, `/sitemap.xml` | Machine surfaces | Platform | KEPT |

## 2. Preserved surfaces (untouched)

- Tenant organization sites (`PublicSchoolSite`, generated-site engine,
  `?school=` / subdomain resolution) — behavior identical.
- Authenticated workspaces (`_authenticated/*`: admin, bursar, teacher,
  parent, student, driver, hq, command-centre, super-admin, settings,
  messages, notifications, runtime) — `SherivsAppShell` is the adoption
  target (P1 rollout mission), not a flag-day rewrite.
- Scholar runtime bindings stay in the runtime layer; Scholar-specific
  public sections render only with the runtime active.

## 3. Conventions

- Public pages: `SherivsPublicShell` + `DocPage`/narrative sections,
  canonical `https://sherivs.com` + OG + JSON-LD where entities exist.
- Authenticated pages: `PortalPage`/shell components; app-shell adoption
  per workspace mission with capability-projected nav.
- Anchors referenced anywhere must exist (`/platform#capabilities`,
  `/platform#runtimes` verified).
- Frozen scope (V2 device/IoT, V3 Reality Intelligence) gets no routes.

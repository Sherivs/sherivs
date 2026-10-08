# Sherivs Route Architecture

Framework: TanStack Router + Start. File routes in `frontend/src/routes`.

## Public (selected)

| Path | Source | Notes |
|---|---|---|
| `/` | `index.tsx` | Resolver: org public / workspace / Sherivs home |
| `/coregrid` | `(site)/coregrid.tsx` | Compatibility → same home |
| `/platform` | `platform.tsx` | Kernel capability catalog |
| `/platform/$slug` | `(site)/platform.$slug.tsx` | reality, memory, ai-workforce, missions, intelligence, governance, integrations |
| `/platform/org` | `platform.org.tsx` | Generated internal org view (catalog, not live ops) |
| `/solutions`, `/solutions/$slug` | `(site)` | Honest V1 solution pages |
| `/security` `/enterprise` `/pricing` | `(site)` | Live content |
| `/resources` `/resources/$slug` | `(site)` | Docs live; blog/guides/case-studies empty |
| `/about` `/company` `/careers` `/contact` `/request-demo` | `(site)` | Careers empty |
| `/legal/$slug` | `(site)` | privacy, terms, cookies, accessibility |
| `/status` | `(site)/status.tsx` | `/health.json` |
| `/provision` | `(site)/provision.tsx` | Org onboarding Command Centre |
| `/auth` `/reset-password` | root | Real auth |

## Authenticated

`/_authenticated` pathless layout. Role trees: `/admin`, `/teacher`, `/parent`, `/student`, `/bursar`, `/hq`, `/driver`, `/super-admin`, `/command-centre`. Shared: `/settings`, `/notifications`, `/messages`, `/runtime`.

Internal Sherivs = `/super-admin/*` + `/command-centre/` (super_admin).

## Inventory

Canonical typed inventory: `frontend/src/lib/experience/public-catalog.ts`  
Generated tree: `frontend/src/routeTree.gen.ts`

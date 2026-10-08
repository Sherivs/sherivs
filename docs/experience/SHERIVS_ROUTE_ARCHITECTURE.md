# Sherivs Route Architecture

Version target: **V1**.

Router: TanStack Router file routes under `frontend/src/routes`. The generated tree is `frontend/src/routeTree.gen.ts`.

## Public (Sherivs)

| Path | Module | Notes |
| --- | --- | --- |
| `/` | `routes/index.tsx` | Tenant site, else signed-in redirect, else Sherivs home |
| `/platform` | `routes/platform.tsx` | Kernel capability registry |
| `/platform/reality` | `platform.reality.tsx` | Canonical truth |
| `/platform/memory` | `platform.memory.tsx` | Scoped memory contract |
| `/platform/ai-workforce` | `platform.ai-workforce.tsx` | Governed workers |
| `/platform/missions` | `platform.missions.tsx` | Execution stages |
| `/platform/intelligence` | `platform.intelligence.tsx` | Output classes |
| `/platform/governance` | `platform.governance.tsx` | Authorization |
| `/platform/integrations` | `platform.integrations.tsx` | Adapters and Paystack webhook |
| `/solutions` and children | `solutions*.tsx` | Organizations, education, enterprise, operations, workforce |
| `/security` | `security.tsx` | Guarantee catalog |
| `/enterprise` | `enterprise.tsx` | Architecture boundary |
| `/pricing` | `pricing.tsx` | Commercial tiers in naira |
| `/resources` | `resources.tsx` | Points only at published surfaces |
| `/about` `/contact` `/status` `/developers` | matching files | No invented inbox, uptime, or SDK |
| `/legal/privacy` `/legal/terms` `/legal/cookies` `/legal/accessibility` | `legal.*.tsx` | Product disclosures, not counsel |
| `/coregrid` | `(site)/coregrid.tsx` | Earlier marketing page, kept, brand updated |
| `/auth` `/login` `/reset-password` | existing | Account |
| `/sitemap.xml` `/robots` via `public/robots.txt` | existing | Canonical origin `https://sherivs.com` |

Not created: `/careers`, `/company`, `/resources/blog`, `/resources/guides`, `/resources/case-studies`, `/resources/changelog`, `/resources/docs`, `/request-demo`. A demo request that does not persist would be a fake form. Evaluation is account creation.

## Organization public

`/`, `/admissions`, `/blog`, `/blog/$slug`, `/news/$id`, `/events/$id`, `/privacy`, `/rules` when a tenant is in scope. These are the organization's pages, not Sherivs marketing.

## Application

Authenticated tree: admin, teacher, parent, student, bursar, hq, driver, super-admin, messages, notifications, settings, runtime, command-centre. Role layouts are guards. Navigation is the installed runtime's contribution catalog filtered by capability.

## Internal

`/operate` — provisioning console, `noindex`, not in the public nav.
`/command-centre` — super admin.
`/super-admin/*` — control plane.
`/platform/org` — generated department catalog, `noindex`, not in the public nav.

## Mobile

Expo routes: sign-in, organization, missions, mission detail, agents, evidence, settings. Not a collapsed desktop sidebar.

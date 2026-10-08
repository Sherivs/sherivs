# Sherivs Route Architecture

**Version-target:** ACTIVE-V1  
**Router:** TanStack Router file routes under `frontend/src/routes`

## Public (Sherivs)

| Path | Module | Notes |
|---|---|---|
| `/` | `routes/index.tsx` | Tenant site if resolved; else signed-in workspace redirect; else Sherivs homepage |
| `/coregrid` | `(site)/coregrid.tsx` | Alias → `/` |
| `/platform` | `platform.tsx` | Kernel capability browser in public shell |
| `/platform/{reality,memory,ai-workforce,missions,intelligence,governance,integrations}` | `(site)/platform.*.tsx` | Capability narratives |
| `/platform/org` | `platform.org.tsx` | Internal org projection (not marketing) |
| `/solutions` and children | `(site)/solutions*.tsx` | Organizations, enterprise, education, operations, AI workforce |
| `/security` `/enterprise` `/pricing` | `(site)/` | Disclosure + commercial catalog |
| `/resources` and children | `(site)/resources*.tsx` | Docs real; guides/blog/case-studies honest empty |
| `/about` `/company` `/contact` `/request-demo` | `(site)/` | Company |
| `/legal/{privacy,terms,cookies,accessibility}` | `(site)/legal.*.tsx` | Product disclosures |
| `/status` | `(site)/status.tsx` | Reads `/health.json` |
| `/blog` `/admissions` `/privacy` `/rules` | existing | Organization/tenant surfaces |
| `/careers` | — | Deferred |

## Auth

`/auth`, `/reset-password`, `/login` → `/auth`, `/super-admin-bootstrap`

## Authenticated

`/_authenticated` shell: `/messages`, `/notifications`, `/settings`, `/runtime`, plus role trees `/admin/*`, `/teacher/*`, `/parent/*`, `/student/*`, `/bursar/*`, `/hq/*`, `/driver/*`, `/super-admin/*`, `/command-centre/`.

## Mobile (Expo)

`/sign-in`, `/(app)/`, organization, missions, agents, evidence, settings.

## Compatibility

Existing Scholar URLs are preserved. New Sherivs public URLs are additive except `/` on the platform host, which is now the marketing homepage instead of the public Command Centre. Command Centre remains at `/command-centre` (authenticated) and `/platform/org`.

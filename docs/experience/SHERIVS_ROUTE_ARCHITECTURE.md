# Sherivs Route Architecture

Router: TanStack file routes. Generated tree: `frontend/src/routeTree.gen.ts`.

## Public

| Path | Module | Notes |
| --- | --- | --- |
| `/` | `routes/index.tsx` | Narrative when no tenant. Tenant public site when a school resolves. Signed-in platform users redirect to their workspace home |
| `/coregrid` | `(site)/coregrid.tsx` | Capability proof page. Anchors preserved for the existing contract |
| `/platform` | `routes/platform.tsx` | Kernel registry. Counts come from the kernel snapshot |
| `/platform/reality` and sibling platform essays | `routes/platform.*.tsx` | Editorial pages |
| `/platform/org` | `routes/platform.org.tsx` | Internal projection. `noindex`. Not in public nav |
| `/solutions` and children | `(site)/solutions*.tsx` | |
| `/security`, `/enterprise`, `/pricing` | `(site)` | Pricing reads `MARKETING_TIERS` |
| `/resources` and shelves | `(site)/resources*.tsx` | Essays, guides, case studies, changelog are empty |
| `/resources/docs` and `/resources/docs/$slug` | `(site)` | Unknown slugs 404 |
| `/about`, `/company` | `(site)` | `/company` redirects to `/about` |
| `/careers`, `/contact`, `/request-demo` | `(site)` | No form, no invented inbox |
| `/legal/privacy`, `/terms`, `/cookies`, `/accessibility` | `(site)` | Notices, not instruments |
| `/status` | `(site)/status.tsx` | Reads `/health.json` |
| `/auth`, `/login`, `/reset-password` | existing | |
| `/sitemap.xml`, `/robots.txt`, `/health.json`, `/manifest.webmanifest` | existing | Sitemap origin is `https://sherivs.com` and includes the public paths |

## Authenticated

Existing role portals are unchanged. Added:

| Path | Guard | Purpose |
| --- | --- | --- |
| `/command-centre/provision` | super admin, via the command-centre layout | Organization provisioning, removed from `/` |
| `/settings` | any signed-in actor | Account map plus existing profile, privacy, and password |

## Not created

Careers listings, blog posts, case studies, changelog entries, and counsel-authored legal text. Routes exist only as honest empty or notice states.

## Organization public

Tenant sites stay on `/` when a tenant slug resolves, plus existing `/admissions`, `/blog`, `/news`, `/events`, `/rules`, `/privacy`. Academics and admissions navigation items are filtered off when `runtime:scholar` is not installed.

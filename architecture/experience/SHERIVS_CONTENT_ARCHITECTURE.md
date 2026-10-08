# Sherivs Content Architecture

## Types

| Type | Where | Status |
|---|---|---|
| Public pages | `(site)` + catalog | Live, typed |
| Platform editorial (blog/guides/case studies) | `/resources/*` | Empty catalogs |
| Tenant blog/news/events | `/blog`, `/news/$id`, `/events/$id` | DB-backed on org sites |
| Legal | `/legal/*` | Conservative notices matching shipped behavior |
| Tenant policies | `/privacy`, `/rules` | Organization-authored |
| Kernel docs | `/platform` | Generated from capability registry |
| Help | `/resources/docs` | Points at live surfaces, not internal ADRs |

## Fields (target)

slug, title, description, body, status, published/updated, SEO, canonical, tags, access level. Localization is `en` only in V1 UI.

## Rules

- Never invent posts to fill a grid.  
- Tenant content is not Sherivs thought leadership.  
- OpenGraph uses real titles/descriptions; no missing hosted og-image is claimed.

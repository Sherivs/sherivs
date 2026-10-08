# Sherivs Content Architecture

**Version-target:** ACTIVE-V1

## Types

| Type | Where | Status |
|---|---|---|
| Public pages | Typed modules under `(site)/-content` | Implemented |
| Platform blog | `/resources/blog` | Empty until authored |
| Tenant blog | `/blog`, `/blog/$slug` | Existing, tenant-scoped |
| Guides / case studies | `/resources/guides`, `/resources/case-studies` | Honest empty indexes |
| Docs | `/resources/docs` + `/platform` | Points at real kernel/security surfaces |
| Organization policies | `/privacy`, `/rules` | Tenant fields |
| Legal disclosures | `/legal/*` | Product behavior, not invented counsel letterhead |
| Changelog | — | Not a public index yet (no fabricated entries) |

## Required fields for future publications

slug, title, description, body, author, status, published/updated, SEO, social image, canonical URL, tags, categories, localization, access level.

## Rules

Do not invent authors, dates, or customers. RSS and OpenGraph are added when there is a real document to describe. Sitemap lists published public paths plus tenant `/?school=` sites.

# Sherivs Content Architecture

Status: Target contracts; no CMS implementation is claimed  
Version target: ACTIVE-V1

## Content domains

| Domain | Types |
| --- | --- |
| Sherivs public | page, article, blog post, resource, guide, case study, announcement, changelog, documentation, FAQ, glossary |
| Organization public | page, announcement, event, program/service, resource, policy, form, media |
| Platform | help article, release note, system message, incident/status update, API documentation |

## Canonical content record

Every record includes ID, tenant/owner, type, schema version, locale, slug, title, description,
structured body, author identity, provenance, lifecycle status, access level, publish/schedule
time, updated time, canonical URL, tags/categories, SEO fields, approved social image, review
history, and runtime/capability conditions.

Lifecycle: `draft → in_review → approved → scheduled/published → archived`. Rejection returns to
draft with attributable feedback. AI-generated proposals are labelled and require human approval
before publication.

## Access and tenancy

Public content is an explicit publication state, not “a readable database row.” Organization
content is tenant scoped. Private, member, relationship, and role-limited levels are enforced by
API authorization and RLS. Preview tokens are short-lived, scoped, non-indexable, and auditable.

## Structured body

Content uses a versioned allowlist of blocks such as prose, heading, media, callout, quote, code,
table, steps, references, and approved product embeds. Blocks are Zod validated. Content may not
name arbitrary React components, execute scripts, inject raw HTML, or select privileged data
queries.

## Publishing experiences

Collections support server-side search, category/tag filtering, pagination, empty/no-result states,
and stable canonical URLs. Detail pages include author/provenance where appropriate, updated date,
reading time derived from actual body, related content based on approved metadata, accessible
sharing links, and breadcrumb structure.

Routes are introduced only when records exist:

- `/resources/blog/:slug`
- `/resources/guides/:slug`
- `/resources/case-studies/:slug`
- `/resources/changelog/:slug`
- `/resources/docs/:slug`

## SEO and sharing

Each public page has one canonical URL, unique title/description, semantic heading outline,
OpenGraph/Twitter metadata, real image dimensions/alt text, and schema.org data matching visible
content. Sitemaps include only canonical indexable published URLs. Robots excludes previews,
authenticated routes, internal routes, and sensitive query variants. RSS is appropriate for blog
and changelog only after those feeds have real entries.

No social profile, customer, case study, quote, metric, award, compliance certification, or uptime
claim is published without evidence and owner approval.

## Localization

Translation is per content version and locale; fallback is explicit and exposed to editors.
Slugs may be localized with canonical/hreflang mapping. Dates, numbers, currency, and timezones are
formatted at render time. Source language and translation provenance are retained.

## Organization public engine

The engine receives an authorized, published content projection plus organization identity,
runtime contributions, theme tokens, locale, and navigation. Scholar sections load only from the
Scholar runtime catalog. Generic organization pages never assume school, student, parent, teacher,
admissions, curriculum, campus, or academic year.

## System messages

Operational messages declare severity, audience, affected capability, start/end, dismissibility,
action, source, and status. Security messages cannot be suppressed by organization branding.
Errors avoid blame, preserve user input, and state recovery or support paths without exposing
internal details.

## Current findings

The repository has `/blog`, `/blog/:slug`, `/privacy`, sitemap, robots, tenant news/events, a
Scholar public CMS, and static platform marketing content. It lacks the complete governed content
schema, resource hierarchy, legal set, docs/guides/case studies/changelog publishing workflow, and
claim-evidence registry described here.

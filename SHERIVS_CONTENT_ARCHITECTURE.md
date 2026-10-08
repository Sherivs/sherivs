# Sherivs Content Architecture

Status: `PROPOSED`  
Version target: `ACTIVE-V1`

## Content domains

| Domain | Types | Publication boundary |
|---|---|---|
| Sherivs public | page, article, guide, changelog, documentation, FAQ, glossary | Sherivs publisher approval |
| Organization public | page, announcement, event, program, resource, policy, form, media | Organization publication policy |
| Platform help | help article, release note, system message | Platform operations approval |
| Runtime | runtime help and terminology | Runtime owner, capability gated |

## Canonical schema

```ts
type PublishedContent = {
  id: string
  organizationId: string | null
  locale: string
  type: string
  slug: string
  title: string
  description: string
  body: unknown
  author: { id: string; displayName: string }
  status: "draft" | "review" | "scheduled" | "published" | "archived"
  publishedAt: string | null
  updatedAt: string
  canonicalUrl: string | null
  seo: { title?: string; description?: string; image?: string }
  taxonomy: { tags: string[]; categories: string[] }
  access: "public" | "authenticated" | "restricted"
  provenance: { source: string; aiGenerated: boolean; verifiedAt?: string }
}
```

Schema validation, publication authorization, tenant scoping, and HTML sanitization are mandatory.

## Editorial rules

- Claims describe evidenced current capability or are explicitly labeled vision.
- No fake customers, logos, social proof, statistics, uptime, certifications, pricing, accounts, or case studies.
- AI-assisted content records provenance and receives human publication approval.
- Headings form a logical outline; links describe their destination.
- Images require purpose, dimensions, responsive variants, and alternative text where informative.

## Public narrative

The homepage sequence is category → organizational problem → represented organizational state → context/intelligence → governed workers and missions → adaptive runtime experience → Scholar example → governance/evidence → architecture → vision → next action. Each section must be backed by current V1 capability or labeled future direction.

## Resource behavior

Blog, guides, case studies, changelog, and docs support detail routes only when entries exist. Lists support category/tag filters, accessible pagination, related content, author, dates, reading time, canonical metadata, OpenGraph, and structured data. RSS is added only when a maintained public feed exists.

## SEO contract

Every indexable page declares canonical URL, title, description, robots policy, OpenGraph, semantic heading, breadcrumb where applicable, and structured data backed by page truth. Tenant public content must never canonicalize to another tenant.

## Localization

Content separates locale from organization and supports translation status, source locale, fallback policy, direction, regional formats, and localized slug/canonical mapping. Machine translations are labeled and reviewed before publication.

## Lifecycle

Draft → review → approved/scheduled → published → corrected → archived. Corrections preserve audit history. Deleting public content requires redirect/tombstone policy and cannot erase required records.

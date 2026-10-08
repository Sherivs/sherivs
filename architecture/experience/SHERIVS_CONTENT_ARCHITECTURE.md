# Sherivs Content Architecture

Implementation: `frontend/src/lib/experience-system/content.ts`.

## Model

`contentItemSchema` (zod): `kind`, `slug` (kebab-case), `title`, `description`, `body[]` (paragraph strings rendered as text, never HTML), `author`, `status` (`draft | in_review | published | archived`), `publishedAt`, `updatedAt`, `tags`, `categories`, `locale`, `accessLevel` (`public | authenticated | organization | internal`), `seo` overrides, `related[]`.

Kinds (`PUBLIC_CONTENT_KINDS`): blog, guides, case-studies, changelog, docs (labels in `CONTENT_KIND_LABELS`).

## Visibility rule

An item is publicly visible only if `status === "published"`, `accessLevel === "public"` and `publishedAt <= now`. Draft, future-dated, internal or invalid items never resolve by list, slug, related-content, sitemap or RSS (tests: `sherivs-content.test.ts`).

## Honesty

`PUBLISHED_CONTENT` is `[]`. There is no sample copy, no fabricated case study, no fake changelog. The resources section renders honest empty states, is `noindex`, and `/resources` is omitted from the sitemap until the first public item exists. Publishing = adding a validated item to the registry (or later, a governed CMS adapter).

## SEO and structured data

* `publicHead()` emits title, description, canonical (on `https://sherivs.com`), Open Graph and Twitter tags, optional `noindex`.
* JSON-LD: Organization, WebSite, BreadcrumbList, Article. Serialization escapes `<` so content cannot close the script tag.
* RSS 2.0 at `/resources/rss.xml` lists public items only, XML-escaped.
* `sitemap.xml` is generated from LIVE routes plus public content.

## Provenance (AGENTS.md §12)

Each item carries author, dates and status; AI-generated content must be flagged and reviewed before `published`. No AI-written content is published by this change.

## Not covered

Docs site, developer portal and changelog tooling are not built; they require real content and an owner.

# Sherivs Content Architecture

## Types

Public content is a typed page:

- `id`, `path`, `title`, `description`, `kicker`, `lede`
- `kind`: article, empty, notice, pricing, docs-index, doc, status
- `sections` with stable ids
- canonical URL derived from `https://sherivs.com` plus the path

Documents are the same shape with kind `doc`. Slugs are the path segment under `/resources/docs/`.

There is no CMS table for the Sherivs website. Organization public content continues to come from the tenant record and its related tables.

## Published documents

| Slug | Subject |
| --- | --- |
| `reality-and-intelligence` | Records versus interpretation |
| `authorization` | Decision inputs and outcomes |
| `runtimes` | How an installed runtime relates to Sherivs |

## Shelves with no entries

Essays, guides, case studies, changelog, careers. The pages exist so the absence is visible. They do not contain sample posts.

## SEO

Homepage head includes a `WebSite` JSON-LD object, title, description, and canonical URL. Editorial routes set title, description, Open Graph fields, and canonical URL. Unknown document slugs 404. `/platform/org` is `noindex`.

No Open Graph image is declared. The previous image URL pointed at a file that is not in this repository.

The sitemap lists public paths plus active tenant sites when the database is reachable. It does not fail closed into an error page if the database is not.

## Social

No profile URLs are published. Sharing a public URL uses the page's own title and description.

## Localization

The public site is English. Locale and time zone are fields on the experience configuration. A translation catalog is not included.

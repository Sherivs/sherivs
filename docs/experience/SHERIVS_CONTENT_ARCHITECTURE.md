# Sherivs Content Architecture

Version target: **V1**.

## Types that exist

| Type | Source | Access |
| --- | --- | --- |
| Public page | `PUBLIC_PAGES` | Anonymous |
| Platform capability | `SITE_CAPABILITIES` | Anonymous |
| Security guarantee | `SECURITY_GUARANTEES` | Anonymous |
| Commercial tier | `MARKETING_TIERS` | Anonymous. Does not grant access |
| Runtime proof | `INSTALLED_RUNTIME_PROOFS` | Anonymous |
| Organization page, news, article, event | Tenant CMS tables, existing routes | That tenant's public flags |
| Kernel capability row | `KERNEL_CAPABILITIES` | Anonymous on `/platform` |

Each public page has `id`, `path`, `title`, `description`, `kicker`, blocks, and an `evidence` string. Blocks are prose, definitions, process steps, or links. There is no author, hero image, or tag system because there is no publishing desk.

## Types that do not exist yet

Platform blog posts, guides, case studies, changelog entries, docs articles, FAQs, and glossary terms. Routes for them were not created. An organization's blog remains `/blog` on that organization's site.

## Legal content

Privacy, terms, cookies, and accessibility pages describe implemented behavior: row-level isolation, audit minimization, theme storage, session cookies, the health endpoint, and the absence of an advertising network. They state that they are product disclosures, not a counsel-drafted policy and not a registered address.

## SEO

Title, description, canonical, and Open Graph title/description are set per public page. WebSite JSON-LD is on the homepage. Sitemap and robots point at `https://sherivs.com`. No social profile URLs are emitted.

## Localization

Copy is English. The account settings surface is where language, timezone, and format preferences belong. They are not hardcoded to one region. Prices in the commercial catalog are naira because that is the catalog's currency, not because the platform has a single timezone.

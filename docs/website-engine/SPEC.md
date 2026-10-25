# Sherivs Website Engine: spec (SHERIVS-100)

Status: draft, delivered in three stacked draft PRs. Owner: Muhammad (founder). Phases: P1 engine (data + generator), P2 public renderer (replaces the prototype), P3 admin builder + onboarding hook.

## 1. Problem
The public school site was a Lovable prototype: one hard-coded page (`components/public/site.tsx` + 1,551-line `sections.tsx`) with fixed sections toggled by `schools.section_*_enabled`. Schools without, say, transport or testimonials showed empty or fake sections; schools that offer more (several campuses, boarding, faculties, alumni, donations) had nowhere to put it.

## 2. Goals / non-goals
Goals
- G1 No hard-coded layout. Every page, section and block on a school site comes from that organization's document, which is generated from its reality and then edited by the school.
- G2 Never an empty placeholder. A block bound to data that is empty is not rendered; a page whose blocks are all hidden leaves the navigation.
- G3 Works for nursery to university, polytechnic, school groups and government landing pages, without any per-organization branch in the renderer.
- G4 Draft / publish / versioned rollback; tenant isolation; public reads are anonymous, cached and cheap.
- G5 Low-bandwidth: system fonts only, no client-only rendering of content, lazy images, no third-party embeds by default.
Non-goals (this mission): drag-and-drop canvas editing, custom HTML/JS blocks (deliberately not supported: XSS), per-block A/B testing, image upload pipeline (existing storage is reused through URLs).

## 3. Model
`site > pages > sections > blocks`, stored as one JSON document per version.

```
SiteDocument { schema: 1, locales: Locale[] (en|ha|yo|ig|pcm, first = default), theme: Theme,
               pages: Page[] (1..60, exactly one slug "home") }
Page    { id, slug (^[a-z0-9-]{1,60}$), title: L, description?: L (SEO), nav: boolean, sections: Section[] (<=40) }
Section { id, background: default|muted|brand, layout: stack|split, blocks: Block[] (<=20) }
Block   { id, type: BlockType, variant?: string, hidden?: boolean, props: Record<string, unknown> }
L       = { en?: string, ha?: string, yo?: string, ig?: string, pcm?: string }   // localized text, falls back to default locale then en
Theme   { primary: #rrggbb, secondary: #rrggbb, font: system|serif|rounded, radius: square|soft|round, logo?: url }
```
Why a document, not rows: a site is read as a whole on every public request (one indexed row read), published atomically, and versioned by snapshot; page builders converge on this model. Integrity is enforced by `_website_validate` in SQL (shape, limits, block types from the catalog, variants, unique ids/slugs, no `javascript:`/`data:`/`vbscript:` URLs) and mirrored in TypeScript for editor feedback.

Tables (migration 20261024001000, rollback included):
- `website_block_types` catalog (key, category, data_source, variants): readable by anyone; the validator only accepts active keys.
- `websites` (one per school): `draft`, `draft_rev` (optimistic concurrency), `published_version`.
- `website_versions`: immutable snapshots (`publish`, `rollback`, `generate`), unique (school, version). Update/delete blocked by trigger.
- `website_audit`: append-only.
- Permission `website.manage` (module communication, internal) granted to head of institution, proprietor and ICT head (optional, on by default; mandatory grants cannot be rolled back by design). The legacy bridge already gives admin/principal everything.

RPCs (SECURITY DEFINER, `search_path=''`, school always from the argument checked by `scholar_can(school,'website.manage')`):
`website_get`, `website_save_draft(school, doc, expected_rev)`, `website_publish(school, note)`, `website_rollback(school, version)`, `website_facts(school)` (generator input incl. onboarding answers), and the anonymous `website_public(host, slug)`.

## 4. Public read path
`website_public(p_host, p_slug)` resolves the tenant from a *verified* `school_domains` hostname (SHERIVS-029) or, only on platform hosts, from the slug (`<slug>.sherivs.com` or `?school=`). It returns: school identity + brand, the **published** document (never the draft), its version (cache key), canonical host, and a data bundle built only for the block types the document uses. The bundle contains only public columns: published programmes, facilities, news, upcoming events, public calendar entries, gallery, testimonials, FAQs, staff (only when the opt-in staff block is on the site), aggregated hostel capacity (no room names), aggregated alumni counts (no names), open donation campaigns (no donors), transport when enabled, admissions (requirements/deadline/timeline), campus list with addresses, and section kinds. If a school has not published yet, the bundle is returned with `document = null` and the renderer composes a site in memory with the same generator, so every active school always has a truthful site.
Rendering is SSR; responses carry `Cache-Control: public, s-maxage=60, stale-while-revalidate=600`, and the server keeps a 60 s in-memory cache keyed by host, slug and version.

## 5. Blocks (catalog v1)
Each block: schema (fields + types + localized flag), variants, data source, and a `hasContent(props, data)` guard. Data-bound blocks render live Sherivs data; content blocks render what the school typed. See `frontend/src/lib/website/catalog.ts` (single source; the SQL catalog seed is generated from the same list and checked by a unit test).

| Block | Data source | Variants | Hidden when |
|---|---|---|---|
| hero | school brand + props | centered, split, minimal | never (name always exists) |
| about | school.about/mission/vision/motto + props | prose, pillars | no text at all |
| leadership | props.people | grid, list | no people |
| stats | school + counts | band | fewer than 2 non-zero stats |
| sections_offered | school_sections (+ campus) | cards, list | no sections |
| programmes | academic_programs | cards, list, table | none published |
| departments | props.groups (faculties/schools/departments) | grouped, list | no groups |
| admissions | school.admission_* + apply route | panel, banner | no requirements, deadline or timeline |
| fees_summary | props.items (school-published figures only) | table | no items |
| facilities | school_facilities | grid, list | none published |
| boarding | sections residency + hostel aggregates + props | panel | not a boarding school |
| transport | school_transport | panel | transport disabled |
| news | news | cards, list | no published news |
| events | events + public calendar | list, cards | nothing upcoming |
| gallery | school_gallery | grid, strip | no images |
| staff_directory (opt-in) | school_staff | grid, list | none published |
| results_checker | result PINs exist | panel | school has never issued PINs |
| alumni | alumni_profiles aggregates + props | panel | no verified alumni and no text |
| donations | donation_campaigns open | cards | no open campaign |
| campuses | campuses | list, cards | fewer than 1 campus with a name |
| contact | school contact + socials + office hours | panel, split | no phone, email or address |
| map | per-campus address / school map coordinates | links | no address/coordinates |
| faqs | faqs | accordion | none published |
| testimonials | testimonials | quotes, cards | none published |
| accreditation | props.badges | badges | no badges |
| rich_text | props.body (safe rich text: paragraphs, lists, bold, links) | prose, callout | empty body |
| cta | props | banner | no label/link |
| links | props.items (downloads, portals) | list, buttons | no items |
| agencies (gov) | props.items | cards | no items |
| video | props.url (YouTube/Vimeo only, click-to-load) | lite | no url |

Rich text never accepts HTML; it is parsed into paragraphs, bullet lists, bold and links whose URLs pass `safeUrl` (https, relative, mailto, tel).

## 6. Generator
`generateSite(facts) -> SiteDocument` is a pure function. Input: the organization kind (`nursery_primary`, `secondary`, `k12`, `polytechnic`, `university`, `group`, `government`, `other`, derived from `institution_category`, section kinds and campus count, or onboarding answers), onboarding answers, and counts/flags from live data. Rules:
1. A block is emitted only if its guard would render with the facts at generation time; pages with no blocks are not emitted.
2. Vocabulary follows the kind (Classes vs Programmes vs Faculties; Pupils vs Students; Our schools for groups; Agencies/Services for government).
3. Facts become factual text only (e.g. "Day and boarding · Boys and girls · 3 campuses"); no lorem ipsum, no invented claims.
4. Brand → theme (logo, primary/secondary with AA contrast correction, system font).
5. Locales: from onboarding (`languages`) or the state default (Hausa for northern states, Yoruba for south-west, Igbo for south-east) + English; untranslated text falls back to English.
6. Deterministic: same facts, same document (stable ids), so re-generation diffs are reviewable.
After onboarding is applied the builder generates and publishes the first version automatically when the school has no site yet; later regenerations go to the draft only.

## 7. Builder (/admin/website)
Pages list (add, rename, reorder, toggle in-nav, delete except home), sections (add, reorder, background/layout), blocks (add from catalog filtered by relevance, reorder, hide/show, variant, generic schema form, locale switcher), live preview with mobile/desktop width using the same renderer and live data, guard badges ("hidden: no published news yet"), publish with note, version history with one-click rollback, regenerate-from-reality into the draft. Concurrent edits are detected via `draft_rev`.

## 8. Theme & tokens
Website tokens `--sw-*` mirror Track D's SDS v1 values (system font stack, 48 px touch targets, 8/12/16 radii, AA colours) and are overridden per organization from the theme. Track D's SDS lives on an unpushed branch, so these are a minimal, separate layer that D can restyle without touching block code.

## 9. SEO & i18n
Per page `<title>`, description, canonical (primary verified public domain, else `<slug>.sherivs.com`), Open Graph, JSON-LD `EducationalOrganization` (or `GovernmentOrganization`), hreflang alternates for enabled locales, tenant sitemap of published pages, `<html lang>`. UI chrome strings exist for en/ha/yo/ig/pcm (marked for native-speaker review).

## 10. Security & tenant isolation
- Anonymous callers get only published documents and the public bundle; drafts, versions and audit are behind `website.manage`.
- The tenant is resolved only from a verified domain or a slug on platform hosts; an unverified or removed domain resolves to nothing.
- Writes are RPC-only; RLS has no write policies. The document validator rejects script URLs, oversized docs, unknown blocks.
- Rendering escapes everything (React), URLs pass `safeUrl`, embeds are allow-listed and click-to-load.

## 11. Removal of the prototype
Deleted: `components/public/site.tsx`, `components/public/sections.tsx`, the prototype atoms in `components/public/_shared.tsx` (only `Initial` remains, used by /organizations), the section toggles in settings. `schools.section_*_enabled` columns stay (no destructive migration); they are no longer read. The CMS keeps managing content tables, which are now the data sources of blocks.

## 12. Verification
Unit: catalog/SQL parity, validator, generator per org kind (no empty blocks, deterministic), guards, theme contrast, safe URLs/rich text, i18n completeness. Sim: RLS + RPC scenarios incl. cross-tenant draft/publish denial, unverified-domain non-resolution, published-only reads, opt-in staff, rollback, concurrency conflict. k6: 1,000 VUs of anonymous `website_public` across 1,000 schools with cross-tenant probes. Migration rollback twice + re-apply. Screenshots of three generated sites via headless Chromium.

## 13. Delivery (3 phases) and measured results
| Phase | Branch | Contents |
|---|---|---|
| 1 | `sherivs/website-engine-1` | Migration `20261025100240_sherivs_100_website_engine` + rollback, catalog/generator/validator/theme/i18n libs, 17 unit tests, sim (9 scenarios), k6 data path, neutrality baseline entries (W9/029 precedent) |
| 2 | `sherivs/website-engine-2` | SSR renderer (30 block components), host-based tenant loader with edge caching, `/` + `/pages/$slug`, per-host sitemap, SEO/JSON-LD/hreflang, prototype deleted, 16 renderer tests |
| 3 | `sherivs/website-engine-3` | `/admin/website` builder, pure editor ops (7 tests), onboarding bootstrap, nav entry, demo seed, SSR k6 |

Measured on the local sim (Postgres 17 + PostgREST, app built with `vite build`, served by Node 22 as in the Dockerfile):
- Data path (`website_public` via PostgREST), 1,000 VUs over 1,000 schools: 0 % errors, p95 896 ms, 1,790 req/s, 0 cross-tenant leaks, 0 cross-tenant writes.
- SSR origin (one Node process, no CDN), 1,000 VUs for 60 s across 3 tenants by Host header: 0 server errors, 0 cross-tenant leaks, 203 req/s, median 1.17 s, p95 2.74 s; 3.8 % client-side timeouts at saturation. Production relies on the `s-maxage=60, stale-while-revalidate=600` edge cache plus horizontal instances, so the origin sees roughly one render per URL per minute per edge.
- Headless Chromium against the running app: 3 generated sites (custom domain, subdomain, custom domain + Hausa inner page), 3 mobile views; no page errors, no horizontal overflow. `www.littlepearls.sch.ng/?school=fu-arewa` renders Little Pearls byte-for-byte: a query parameter can never switch tenant on a tenant host.

Known limits / follow-ups:
- `public/robots.txt` (static) shadows the dynamic robots route, so tenant hosts advertise the platform sitemap. Each tenant host does serve its own `/sitemap.xml`. Removing the static file is a platform decision (left untouched).
- The root layout still loads Google Fonts for the app shell; site pages use system font stacks and add no font downloads.
- Hausa/Yorùbá/Igbo/Naijá UI strings need native-speaker review; school-entered text is never machine-copied into other locales.
- Website tokens mirror SDS v1; Track D can restyle `website.css` without touching block code.
- `schools.section_*_enabled` and the hero columns are kept (no destructive migration) but no longer read.
- The builder was verified by unit tests and the RPC sim; it was not screenshotted, because the sim has no auth server for an admin session.

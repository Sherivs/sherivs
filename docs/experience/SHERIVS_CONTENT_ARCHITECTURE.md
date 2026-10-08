# SHERIVS Content Architecture

Version: V1 foundation (2026-10-08) · Classification: **V1**

## 1. Content types

PUBLIC: page · article · guide (when published) · announcement · changelog
(when published) · documentation (when published) · FAQ · glossary term.
ORGANIZATION: page · announcement · event · program · resource · policy ·
form · media. PLATFORM: help article · release note · system message.

Every type carries: slug, title, description, body, author, status
(draft/review/published), publish + updated dates, SEO (canonical, OG,
structured data), tags/categories, locale, access level.

## 2. Honesty rules (enforced in review)

1. No page for a nonexistent capability — `/resources` lists published
   surfaces only; guides/case-studies/changelog/API docs appear when real.
2. No invented customers, metrics, testimonials, logos, social accounts,
   or "live" activity. The kernel capability count on the homepage is read
   from the platform registry — the only number on the site.
3. Legal pages describe actual behavior (RLS isolation, first-party
   analytics, administrator-managed deletion) and carry review dates.
4. Contact/demo pages link to real routes; no form posts into a void.
5. AI-labeled content always declares its kind (observation / inference /
   recommendation) with provenance.

## 3. Publishing lifecycle

Draft → review (accuracy + architecture + legal where applicable) →
publish (dated) → scheduled re-review. Stale content is re-dated or
removed — never silently left. Organization content follows the same
lifecycle under tenant policy.

## 4. SEO contract

Canonical URLs (`https://sherivs.com`), unique titles/descriptions, semantic
headings, breadcrumbs, internal linking, OG + JSON-LD entities, sitemap +
robots, optimized responsive assets. Performance budgets gate publishing
(LCP/INP/CLS per `SHERIVS_DESIGN_SYSTEM.md` §8 via app measurement).

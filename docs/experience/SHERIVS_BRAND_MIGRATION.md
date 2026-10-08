# SHERIVS Brand Migration (CoreGrid → Sherivs)

Version: V1 foundation (2026-10-08) · Classification: **V1**
Rule: customer-facing CoreGrid references become Sherivs; technical
identifiers are preserved. No blind global replacement — ever.

## 1. Classification

| Class | Examples | Action |
|---|---|---|
| CUSTOMER_FACING | marketing pages, workspace chrome, emails to users, titles/meta/OG, auth screens, PWA app title | Render Sherivs (`SHERIVS_*` / `PLATFORM_NAME`) |
| TECHNICAL | migrations, RLS policies, DB roles/identifiers, package names, import paths, audit event sources, architecture records, env/secret names | Preserve unchanged |

Full rule table: `SHERIVS_BRAND_REFERENCE_RULES` in
`frontend/src/lib/sherivs-brand.ts`.

## 2. V1 migration log (this increment)

MIGRATED (customer-facing):
- `lib/platform.ts` — `PLATFORM_NAME`/`TAGLINE`/`PAGE_*` now Sherivs;
  `PLATFORM_KERNEL_NAME = "CoreGrid"` retains the technical identifier.
- `/` + `/sherivs` narrative home, `(site)` layout nav/footer, `/platform`
  chrome, `/auth` demo copy, root PWA title — all Sherivs.
- New public pages (`/security`, `/enterprise`, `/pricing`,
  `/solutions/education`, `/resources`, `/about`, `/contact`,
  `/request-demo`, `/legal/*`, `/status`) born Sherivs.
- Canonical origin for new pages: `https://sherivs.com`
  (`SHERIVS_PUBLIC_ORIGIN`).

PRESERVED (technical, intentionally untouched):
- Database identifiers, migrations, RLS, storage keys, package names
  (`@coregrid/contracts`, `coregrid-scholar`), import paths, audit
  sources, `architecture/*` records, scripts, tests referencing kernel
  names, existing canonical URLs on legacy pages (cutover pending, §3).
- `platform-neutrality` + `verify-domain-neutrality` guards keep passing:
  platform identity module names no runtime; lib-root carries no domain
  vocabulary.

## 3. Remaining (P1, tracked in STATUS)

- Legacy canonical URLs (`universalschoolos.com`) → `sherivs.com` cutover
  with redirects (needs DNS + hosting confirmation; do not flip blindly).
- `/coregrid` compat route → canonical redirect to `/sherivs`.
- OG images + favicon set from the Sherivs mark (asset pipeline mission).
- In-product workspace chrome adoption via `SherivsAppShell` rollout.
- Tenant-site "Built on ___" attribution → Sherivs (template change with
  tenant-brand review).
- Any customer-facing "CoreGrid" string found later: classify first per §1,
  then migrate; technical hits stay.

## 4. Guardrails

- Never `s/CoreGrid/Sherivs/g`. Each hit is classified before change.
- A migration that breaks neutrality, identity or verification tests is
  reverted, not forced.
- Every future claim states its version target; unclassified claims are
  unverified.

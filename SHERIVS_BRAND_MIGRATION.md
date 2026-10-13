# Sherivs Brand Migration

Version target: **ACTIVE-V1**
Method: classified inventory. **No blind global replace.**
Canonical public brand: **Sherivs** (`sherivs.com`)
LEGACY internal identifier: **CoreGrid** (`LEGACY_PLATFORM_IDENTIFIER`)

## Policy

| Class | Action |
|-------|--------|
| CUSTOMER_FACING, PUBLIC_METADATA, ROUTE (new), UI_COMPONENT, PRODUCT_COPY | Must become Sherivs |
| DOCUMENTATION (canonical/public) | Sherivs; Scholar is the first runtime |
| INTERNAL_PRODUCT (Sherivs Control, Jarvis) | Sherivs Control / Jarvis — not CoreGrid |
| ARCHITECTURAL_IDENTIFIER, DATABASE_IDENTIFIER, MIGRATION_IDENTIFIER, API_IDENTIFIER, PACKAGE_IDENTIFIER, ENVIRONMENT_VARIABLE | LEGACY keep until a dedicated rename mission with rollback |
| TEST_FIXTURE | Update when the product string it asserts moved; keep when it asserts a legacy id |
| HISTORICAL_REFERENCE, COMPATIBILITY_ALIAS | Keep, mark LEGACY, no new usage |
| UNKNOWN | Do not delete |

New CoreGrid-branded customer-facing routes, UI, metadata, emails, titles, or onboarding are **forbidden**.

## Occurrence counts (ripgrep `-i coregrid --count-matches`)

| Scope | Matches | Reading |
|-------|---------|---------|
| `architecture/` | ~43,491 | Historical architecture corpus. HISTORICAL_REFERENCE. Do not rewrite. |
| `frontend/src` | ~1,000 | Mix of file-header identifiers + remaining technical types. Customer-facing strings in `routes/` and visible UI were migrated this mission. |
| `tests/` | ~1,015 | Mostly file-header comments and fixtures. TEST_FIXTURE / HISTORICAL_REFERENCE. |
| `database/` | 173 | DATABASE_IDENTIFIER / MIGRATION_IDENTIFIER. LEGACY keep. |
| `package.json` files | 8 | PACKAGE_IDENTIFIER. LEGACY keep (`coregrid-scholar`, `@coregrid/contracts`). |
| `supabase/` | 0 | No matches at repo-root supabase dir. |

## Executable brand constants

| File | Symbol | Status |
|------|--------|--------|
| `frontend/src/lib/platform.ts` | `PLATFORM_NAME = "Sherivs"` | IMPLEMENTED |
| same | `PLATFORM_TAGLINE`, `PLATFORM_CATEGORY`, `PLATFORM_PAGE_TITLE`, `PLATFORM_PAGE_DESCRIPTION` | IMPLEMENTED |
| same | `LEGACY_PLATFORM_IDENTIFIER = "CoreGrid"` | LEGACY keep. Removal criteria: no remaining DB, package, or migration objects require the string. |
| `frontend/src/lib/tenant.ts` | `sherivs.com`, `www`, `app`, `internal` platform hosts | IMPLEMENTED. LEGACY `universalschoolos.com` hosts retained. |
| `frontend/src/routes/__root.tsx` | `apple-mobile-web-app-title` = Sherivs | IMPLEMENTED |
| `mobile/app.json` | display `name`: Sherivs; `scheme`: sherivs | IMPLEMENTED in-repo. iOS/Android bundle ids remain `com.coregrid.app` — store cutover BLOCKED_EXTERNAL_ACTION. |

## Migrated this mission (customer-facing)

| File | Classification | Target | Action | Risk | Owner | Status |
|------|----------------|--------|--------|------|-------|--------|
| `frontend/src/lib/platform.ts` | PUBLIC_METADATA | Sherivs | SSOT constants | Low | TEAM 03 | IMPLEMENTED |
| `frontend/src/routes/index.tsx` | PUBLIC_METADATA | Sherivs | Home uses `PLATFORM_PAGE_*` | Low | TEAM 04 | IMPLEMENTED |
| `frontend/src/components/public/sherivs-public-home.tsx` | UI_COMPONENT | Sherivs | New Plane A home | Low | TEAM 04 | IMPLEMENTED |
| `frontend/src/routes/(site)/coregrid.tsx` | ROUTE / COMPATIBILITY_ALIAS | Keep URL; Sherivs UI | LEGACY alias | Low | TEAM 03 | LEGACY |
| `frontend/src/routes/(site)/-content/pricing-tiers.ts` | PRODUCT_COPY | Sherivs | Starter summary | Low | TEAM 03 | IMPLEMENTED |
| `frontend/src/routes/(site)/-content/site-content.ts` | DOCUMENTATION (in-code) | Sherivs | Comments | Low | TEAM 03 | IMPLEMENTED |
| `frontend/src/routes/auth.tsx` | PRODUCT_COPY | Sherivs Intelligence | Demo copy | Low | TEAM 03 | IMPLEMENTED |
| `frontend/src/routes/platform.tsx` | CUSTOMER_FACING | Sherivs | Titles, body, footer; Home not Command Centre | Low | TEAM 03 | IMPLEMENTED |
| `frontend/src/routes/platform.org.tsx` | INTERNAL_PRODUCT | Sherivs | Titles + chrome | Low | TEAM 07 | IMPLEMENTED |
| `frontend/src/routes/marketplace.tsx` | PUBLIC_METADATA | Sherivs | Title + description | Low | TEAM 03 | IMPLEMENTED |
| `frontend/src/routes/reality.$class.tsx` | PUBLIC_METADATA | Sherivs | Title + description | Low | TEAM 03 | IMPLEMENTED |
| `frontend/src/routes/_authenticated/runtime.tsx` | UI_COMPONENT | Sherivs | Title + department copy | Low | TEAM 06 | IMPLEMENTED |
| `frontend/src/routes/_authenticated/route.tsx` | PRODUCT_COPY | Sherivs | Unlinked-account copy | Low | TEAM 08 | IMPLEMENTED |
| `frontend/src/routes/_authenticated/command-centre/index.tsx` | PUBLIC_METADATA | Sherivs Control | Title | Low | TEAM 07 | IMPLEMENTED |
| `frontend/src/routes/_authenticated/super-admin/*.tsx` | PUBLIC_METADATA | Sherivs | Page titles | Low | TEAM 07 | IMPLEMENTED |
| `frontend/src/routes/_authenticated/admin/support.tsx` | PRODUCT_COPY | Sherivs | Support chrome | Low | TEAM 03 | IMPLEMENTED |
| `frontend/src/routes/_authenticated/admin/intelligence.tsx` | PRODUCT_COPY | Sherivs Intelligence | Feature name | Low | TEAM 03 | IMPLEMENTED |
| `frontend/src/routes/_authenticated/admin/school-profile.tsx` | PRODUCT_COPY | Sherivs Scholar | Domain-runtime wording | Low | TEAM 03 | IMPLEMENTED |
| `frontend/src/routes/_authenticated/admin/facilities.tsx` | PRODUCT_COPY | Sherivs | Twin wording | Low | TEAM 03 | IMPLEMENTED |
| `frontend/src/routes/_authenticated/admin/enterprise-checklist.tsx` | UI_COMPONENT | Sherivs Intelligence | Label | Low | TEAM 03 | IMPLEMENTED |
| `frontend/src/lib/runtime/scholar-nav-catalog.ts` | UI_COMPONENT | Sherivs Intelligence | Nav **label** only; capability key kept | Medium (key is API_IDENTIFIER) | TEAM 03 | IMPLEMENTED |
| `frontend/src/components/command-centre/command-centre.tsx` | UI_COMPONENT | Sherivs / Sherivs Control | Visible strings | Low | TEAM 07 | IMPLEMENTED |
| `frontend/src/lib/scholar/pwa/manifest-engine.ts` | PRODUCT_COPY | Sherivs | Generated PWA description | Low | TEAM 32 | IMPLEMENTED |
| `mobile/app.json` `name` | PUBLIC_METADATA | Sherivs | Display name | Medium (store listing later) | TEAM 33 | IMPLEMENTED |
| `README.md` (opening identity) | DOCUMENTATION | Sherivs | Header + diagram | Low | TEAM 47 | PARTIAL (body still mixed) |

## Intentionally LEGACY (do not leak into customer UI)

| Identifier | Classification | Why it remains | Compatibility | Removal criteria | Owner | Status |
|------------|----------------|----------------|---------------|------------------|-------|--------|
| Route `/coregrid` | COMPATIBILITY_ALIAS | Bookmarks + `(site)` group | Renders SherivsPublicHome | Zero inbound links + analytics window | TEAM 03 | LEGACY |
| `LEGACY_PLATFORM_IDENTIFIER` | COMPATIBILITY_ALIAS | Single documented leftover token | Tests assert it | No DB/package/migration consumers | TEAM 03 | LEGACY |
| `package.json` `name: coregrid-scholar` | PACKAGE_IDENTIFIER | npm/workspace identity | `@coregrid/contracts` file: dep | Dedicated package-rename mission | TEAM 48 | LEGACY |
| `@coregrid/contracts` | PACKAGE_IDENTIFIER | Published-scope risk | Import graph | Same | TEAM 31 | LEGACY |
| Capability `r001:org_admin.coregrid_intelligence` | API_IDENTIFIER | Nav/feature key; renaming breaks assignments | Label is Sherivs Intelligence | Capability alias table | TEAM 03 | LEGACY |
| `tenant:coregrid-demo` | TEST_FIXTURE | Command Centre demo tenant id | Local demo only | Demo tenant re-seed | TEAM 07 | LEGACY |
| `compatibleCoreGridVersion` | API_IDENTIFIER | Dev platform manifest field | Existing manifests | Schema version bump | TEAM 48 | LEGACY |
| `x-coregrid-manifest` headers | API_IDENTIFIER | PWA debug headers | Clients may ignore | Header alias `x-sherivs-*` | TEAM 32 | LEGACY |
| `mobile` bundle `com.coregrid.app` (scheme now `sherivs` in source) | PUBLIC_METADATA | Store + installed clients still on LEGACY bundle | Deep links | Apple/Google listing + bundle migration | TEAM 33 | BLOCKED_EXTERNAL_ACTION |
| `COREGRID_*` env vars / secret URIs | ENVIRONMENT_VARIABLE | Runtime config | Deployed envs | Env alias + cutover | TEAM 23 | LEGACY |
| Database types `coregrid-scholar.ts` | DATABASE_IDENTIFIER | Generated/shared table aliases | App types | Schema rename + migration | TEAM 28 | LEGACY |
| Branch `coregrid-scholar-migration` | MIGRATION_IDENTIFIER | Current default branch name | Git | After production cutover | TEAM 49 | LEGACY |
| `architecture/` corpus | HISTORICAL_REFERENCE | Phase 01–52 source of record | Read-only | Never blindly rewrite | TEAM 50 | LEGACY |
| `AGENTS.md` CoreGrid constitution | ARCHITECTURAL_IDENTIFIER | Governance text still uses historical name | Binding | Human constitution revision | ARCHITECTURE | LEGACY |
| File-header `* CoreGrid —` in `frontend/src/lib/**` | ARCHITECTURAL_IDENTIFIER | Not customer-visible | n/a | Optional comment pass | TEAM 03 | LEGACY |
| `universalschoolos.com` hosts | COMPATIBILITY_ALIAS | Prior public domain | DNS | Retire after sherivs.com cutover | TEAM 04 | LEGACY |

## Restaurant contamination

| File | Classification | Action |
|------|----------------|--------|
| `frontend/src/lib/domain-config/restaurant.ts` | TEST_FIXTURE | Keep isolated. Not a platform primitive. |
| `frontend/src/lib/kernel/object-type-registry.ts` `fixture:restaurant` | TEST_FIXTURE | Keep. |
| Scholar role `Chef` → `catering_officer` | DOMAIN RUNTIME (Scholar) | Keep under Scholar. Not a universal primitive. |
| `frontend/src/lib/reliability/leases.ts` `waiter` | ARCHITECTURAL_IDENTIFIER | FIFO queue vocabulary. **Not** restaurant. Do not delete. |

## Remaining customer-facing risk

1. `README.md` body still contains historical CoreGrid narrative below the new header — PARTIAL.
2. Canonical docs (`ARCHITECTURE.md`, `CONSTITUTION.md`, `REGISTRY.md`) remain CoreGrid-named — HISTORICAL_REFERENCE; rewrite is a documentation mission, not this lock.
3. `__root.tsx` `og:image` is same-origin `/og-image.png`. Production `https://sherivs.com/og-image.png` still needs DNS — BLOCKED_EXTERNAL_ACTION.
4. Scholar workspace copy still says “school” in many Plane C pages — expected for the education runtime. Not a CoreGrid brand leak.

## Tests that govern this migration

- `tests/unit/identity-gateway.test.ts` — `PLATFORM_NAME === "Sherivs"`, CoreGrid is LEGACY
- `tests/unit/identity-gateway-invariants.test.ts` — four-eyes: public home is not Command Centre
- `tests/unit/site-marketing.test.ts` — public site CTAs are real `/auth` links; runtime is not narrated as the platform
- `tests/unit/sherivs-organization-workspace.test.ts` — `/o/{org}/scholar` path contract + membership facade

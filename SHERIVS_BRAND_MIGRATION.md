# SHERIVS BRAND MIGRATION LEDGER

Program deliverable — Milestone 2. Law: AGENTS.md §30 (secrets), refoundation directive §25–§26 (brand vs technical identifier separation).
Evidence: `rg -i coregrid` full-repository scan, 2026-10-08, branch `cursor/sherivs-refoundation-2507`.

Inventory scale: 1,880 files contain "coregrid". The overwhelming majority are HISTORICAL/architectural (architecture/, progress/, phase-52 corpus) and are intentionally preserved — the repository's own engineering history is canonical evidence and must not be falsified retroactively.

## Migration executed this pass (customer-facing strings → Sherivs)

| # | Location | Classification | Old | New | Status |
|---|---|---|---|---|---|
| 1 | `frontend/src/routes/marketplace.tsx` | PUBLIC_METADATA | "…— CoreGrid" title; "CoreGrid publishes…" description | "— Sherivs" / "Sherivs publishes" | VERIFIED |
| 2 | `frontend/src/routes/reality.$class.tsx` | PUBLIC_METADATA | title + description + dynamic title "— CoreGrid" | "— Sherivs" | VERIFIED |
| 3 | `frontend/src/routes/(site)/-content/pricing-tiers.ts` | PRODUCT_COPY | "run on CoreGrid" | "run on Sherivs" | VERIFIED |
| 4 | `frontend/src/routes/_authenticated/super-admin/*.tsx` (10 files) | UI metadata | "X — CoreGrid" page titles | "X — Sherivs" | VERIFIED |
| 5 | `frontend/src/routes/_authenticated/super-admin/worker-missions.tsx` | UI metadata | "CoreGrid — Worker mission launch" | "Sherivs — Worker mission launch" | VERIFIED |
| 6 | `frontend/src/routes/_authenticated/super-admin/communication-steward.tsx` | UI copy | "subscribed to CoreGrid communication" | "subscribed to Sherivs communication" | VERIFIED |
| 7 | `frontend/src/routes/_authenticated/command-centre/index.tsx` | UI metadata | "CoreGrid — Command centre operations projection" | "Sherivs Control — Operations projection" | VERIFIED |
| 8 | `frontend/src/routes/_authenticated/admin/facilities.tsx` | UI copy | "bound to a CoreGrid twin kind" | "bound to a Sherivs twin kind" | VERIFIED |
| 9 | `frontend/src/routes/_authenticated/admin/support.tsx` | UI copy | "Contact the CoreGrid team"; "View CoreGrid response" | Sherivs | VERIFIED |
| 10 | `frontend/src/routes/_authenticated/admin/intelligence.tsx` | UI copy | "CoreGrid Intelligence" ×3 | "Sherivs Intelligence" | VERIFIED |
| 11 | `frontend/src/routes/_authenticated/admin/enterprise-checklist.tsx` | UI copy | label "CoreGrid Intelligence" | "Sherivs Intelligence" | VERIFIED |
| 12 | `frontend/src/routes/_authenticated/admin/school-profile.tsx` | UI copy | "Tell CoreGrid…", "CoreGrid adapts to you", "CoreGrid still supports" | Sherivs | VERIFIED |
| 13 | `frontend/src/routes/_authenticated/runtime.tsx` | UI copy + metadata | "Generated runtime — CoreGrid"; "CoreGrid departments you staff"; "CoreGrid internal workspace" | Sherivs | VERIFIED |
| 14 | `public/sw.js` | CUSTOMER_FACING | push fallback title "CoreGrid Scholar"; offline message; header comment | "Sherivs" | VERIFIED |
| 15 | `frontend/src/lib/workforce/worker-launch-runtime.server.ts` | AI prompt | "governed CoreGrid worker mission" | "governed Sherivs worker mission" | VERIFIED |
| 16 | `frontend/src/lib/surfaces/marketplace-view.ts` | PRODUCT_COPY | `DEFAULT_RUNTIME_VENDOR = "coregrid-verified"` | `"sherivs-verified"` | VERIFIED |
| 17 | `frontend/src/lib/domain-config/restaurant.ts` | FIXTURE copy | "universal CoreGrid substrate" | "universal Sherivs substrate" | VERIFIED |
| 18 | `frontend/src/lib/dev-core.ts` | USER-FACING error | "must declare CoreGrid compatibility" | "must declare Sherivs compatibility" | VERIFIED |
| 19 | `frontend/src/lib/communication-providers.ts` | PRODUCT_COPY | displayName "CoreGrid platform presence" | "Sherivs platform presence" | VERIFIED |
| 20 | `frontend/src/lib/financial-intelligence-report.ts` | PRODUCT_COPY | "CoreGrid's own revenue…" | "Sherivs' own revenue…" | VERIFIED |
| 21 | `frontend/src/lib/integration-transform.ts` | USER-FACING error | "external and CoreGrid fields" | "external and Sherivs fields" | VERIFIED |
| 22 | `frontend/src/routes/(site)/coregrid.tsx` | COMPATIBILITY_ALIAS | already Sherivs content; legacy path retained | keep until link hygiene | PARTIAL |

Already migrated in prior passes (evidence: `tests/unit/sherivs-refoundation.test.ts`): homepage, site layout, auth surface, platform pages, command-centre heading, favicon/manifest/sitemap/robots identity.

## Intentionally LEGACY (governed, with removal criteria)

| Identifier | Location | Classification | Why retained | Removal criteria |
|---|---|---|---|---|
| `@coregrid/contracts` package | `packages/contracts/package.json`, root `package.json` | PACKAGE_IDENTIFIER | internal-only; rename churns every import + lockfile with zero customer value | rename during a dedicated dependency-migration mission with full CI |
| root package name `coregrid-scholar` | `package.json` | PACKAGE_IDENTIFIER | internal | same as above |
| `CoreGridTenant`, `CoreGridIdentity`, `CoreGridWorker` TypeScript types | `frontend/src/lib/tenant-*.ts`, `lib/authorization.ts`, workforce libs | CODE_IDENTIFIER | compile-time only; wide import graph | type-rename mission; mechanical, verify with typecheck |
| `"internal_coregrid"` staff/tenant kind | `frontend/src/lib/tenant-core.ts`, `dev-core.ts` | API_IDENTIFIER | may be persisted in rows/policies; renaming needs a data audit first | confirm zero persisted occurrences, then alias + migrate |
| `"coregrid_managed"` BYOC union literals | `frontend/src/lib/cloud-byoc.ts` | API_IDENTIFIER | contract literals | same discipline as above |
| `FILE_BUCKET = "coregrid-files"` | `frontend/src/lib/files/storage-adapter.server.ts` | DATABASE_IDENTIFIER | Supabase storage bucket name; renaming requires bucket migration | storage migration runbook execution |
| `APP_SHELL_CACHE = "coregrid-app-shell-v1"` | `public/sw.js` | CACHE identifier | pinned by `tests/unit/pwa-offline-shell.test.ts` | rename cache + test together (harmless cache invalidation) |
| `coregrid.yaml` dev manifest filename | `frontend/src/lib/dev-build.ts` | CONFIG identifier | developer convention | DX mission |
| `org-coregrid` fixture party IDs, `github.com/coregrid/coregrid` | `frontend/src/lib/trust-fabric-report.ts` | TEST_FIXTURE | synthetic trust-fabric data | none (isolated) |
| `tenant:coregrid-demo` | `frontend/src/components/command-centre/command-centre.tsx` | TEST_FIXTURE | internal demo tenant ID | none (internal-only surface) |
| `x-coregrid-manifest` header keys | `frontend/src/routes/manifest[.]webmanifest.ts` | TECHNICAL | generated manifest headers, not user-visible | optional cleanup |
| migration filenames `*_coregrid_*.sql` (39) | `database/supabase/migrations`, `rollbacks/` | MIGRATION_IDENTIFIER | migrations are immutable history (§26 data safety) | never rename |
| `@coregrid/contracts` type re-exports, `frontend/src/types/coregrid-scholar.ts` | frontend types | CODE_IDENTIFIER | internal | type-rename mission |
| architecture/, progress/, phase-52 corpus, CONSTITUTION/BOUNDARIES/REGISTRY etc. (≈1,760 files) | repository docs | HISTORICAL_REFERENCE | engineering history is canonical; §39 no destructive refactoring | never |
| `"vibeora-notification"` push tag, `vibeora_intelligence` key | `public/sw.js`, enterprise-checklist | CODE_IDENTIFIER | internal keys, not brand-visible | optional |
| `/coregrid` route path | `frontend/src/routes/(site)/coregrid.tsx` | COMPATIBILITY_ALIAS | external links may exist | retire after analytics show zero hits |

## Leak prevention

- `tests/unit/sherivs-refoundation.test.ts` fails if public surfaces render "CoreGrid", "Command Centre", internal phase machinery, or demo credentials.
- `scripts/verify-domain-neutrality.mjs` (STATUS=PASS) quarantines legacy-store vocabulary.
- New customer-facing code must consume `frontend/src/lib/platform.ts` (`PLATFORM_NAME`) — never a literal brand string.

# SHERIVS Brand Migration — CoreGrid Reference Audit

**Status:** PHASE 1 EXECUTED (customer-facing public + shell surfaces) · **Version-target:** V1
**Law:** classify before changing. No destructive blind global replacement.
Machine-readable guard: `frontend/src/lib/brand/brand-classification.ts`
(tested by `tests/unit/sherivs-brand.test.ts`).

---

## 1. Canonical brand

| Item | Value |
|------|-------|
| Brand | SHERIVS |
| Domain | sherivs.com |
| Category | INSTITUTIONAL INTELLIGENCE INFRASTRUCTURE |
| Education runtime | SHERIVS SCHOLAR |
| Executive intelligence | JARVIS |
| AI workforce | SHERIVS AI WORKFORCE |

Customer-facing brand source: `frontend/src/lib/brand/sherivs.ts`.
Technical platform identity stays in `frontend/src/lib/platform.ts` (CoreGrid kernel)
until a human authorizes a platform rename.

---

## 2. Classification rule

- **CUSTOMER_FACING** — rendered for visitors/customers → migrate to Sherivs.
- **TECHNICAL** — database, migrations, RLS, packages, kernel vocabulary, code
  identifiers, audit history, internal operator copy → PRESERVE. Renaming breaks
  compatibility, replay, audit continuity or the preserved V5.1/V5.2 corpus.

`isMigrationAuthorized()` denies unknown families (closed world).
`isTechnicalIdentifier()` guards `cg_*`, `@coregrid/*`, `coregrid-scholar`,
`types/coregrid-*`, `database/`, `migrations/`, `registry.json`.

---

## 3. Phase 1 — executed (this change)

| Family | Files | Change |
|--------|-------|--------|
| `public-site-copy` | `(site)/route.tsx`, `(site)/coregrid.tsx` | header wordmark → `SherivsWordmark`; footer/tagline/meta → Sherivs constants; hero copy → Sherivs. Route paths and anchors preserved. |
| `platform-public-page` | `routes/platform.tsx` | header wordmark + document meta → Sherivs; kernel capability bindings untouched. |
| `document-head` | `routes/__root.tsx` | `apple-mobile-web-app-title` → Sherivs. |
| `auth-surface` | `routes/auth.tsx` | portal-access line + intelligence copy → Sherivs brand resolver. |
| app shell fallback | `_authenticated/route.tsx` | no-tenant brand fallback → `Sherivs · Scholar`. |
| index meta | `routes/index.tsx` | command-centre meta → Sherivs (also drops a stale "51-phase" claim). |

Preserved deliberately: route path `/coregrid` (compatibility), component name
`CoreGridSitePage` (code identifier), `lib/platform.ts` values, all kernel copy.

---

## 4. Remaining families (scheduled, not claimed)

| Family | Disposition |
|--------|-------------|
| Org public engine (`components/public/*`, generated-site) | Phase 2: "powered by Sherivs" lockup; org brand stays primary |
| Authenticated workspace copy (role dashboards, page tips) | Phase 2: systematic pass via brand resolver |
| Support/contact surfaces | Phase 2 with P9 AI assistant |
| Notifications (email/push templates) | Phase 3 with notification center |
| Internal workspace | NEVER customer-migrated (operator kernel vocabulary) |
| Database / migrations / RLS / packages / kernel / audit | NEVER (compatibility + canonical truth) |

---

## 5. Verification

- `tests/unit/sherivs-brand.test.ts` — brand constants, resolver, classification guards.
- Existing gates stay green: `site-marketing`, `platform-neutrality`,
  `kernel-contract-coverage`, `surface-renderers`, `onboarding-credential-isolation`
  (all assert structure/neutrality, not vendor strings — confirmed by inspection).
- `npm run typecheck` + full unit suite before merge.

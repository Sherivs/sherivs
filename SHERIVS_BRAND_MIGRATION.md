# SHERIVS BRAND MIGRATION SPECIFICATION (SBM-v1.0)
**System:** Governed Transition from Legacy Working Names to Sherivs Brand  
**Canonical Brand:** Sherivs  
**Canonical Domain:** `sherivs.com`  
**Product Category:** Institutional Intelligence Infrastructure  
**Status:** Canonical Brand Governance & Migration Register  

---

## 1. Brand Hierarchy & Architectural Mapping

| Concept / Layer | Legacy / Development Term | Customer-Facing Brand (Canonical) | Architectural Role |
|---|---|---|---|
| **Platform** | CoreGrid / UniversalSchoolOS | **Sherivs** | The overarching AI-native institutional operating system |
| **Product Category** | School Management / Cloud OS | **Institutional Intelligence Infrastructure** | The new technology category |
| **Public Domain** | coregrid.com / universalschoolos.com | **`sherivs.com`** | Primary public entry point and marketing portal |
| **Education Runtime** | Scholar / CoreGrid Scholar | **Sherivs Scholar** | Governed education vertical installed on Sherivs |
| **Executive Intelligence**| Command Centre AI / CoreGrid AI | **Jarvis** | Sovereign executive orchestration and reasoning layer |
| **Autonomous Workforce** | Agent Network / Workers | **Sherivs AI Workforce** | Governed, lease-bound AI workers operating missions |
| **Kernel Substrate** | `cg_` SQL tables / `coregrid-` pkgs | Unchanged internal technical identifiers | Preserved for database & migration compatibility |

---

## 2. Classification of "CoreGrid" References

In strict compliance with **Section 1 of the Program Directive**, blind global find-and-replace is prohibited. References are classified into three strict categories:

### Category A: Customer-Facing & Presentation (MIGRATED TO SHERIVS)
*Rule: Any string seen by end-users, prospective customers, press, or public visitors MUST be branded as Sherivs.*
- Webpage `<title>` and `<meta>` tags.
- OpenGraph and Twitter card metadata.
- Public navigation headers, logos, and footers.
- Marketing copy, feature cards, and tier names.
- Application shell header branding and greeting text.
- Public emails, system notification headers, and onboarding flows.

### Category B: Platform Neutral Architecture (UNIFIED UNDER PLATFORM CONTRACTS)
*Rule: Neutral modules that speak of "the platform" continue using constants from `@/lib/platform`.*
- `PLATFORM_NAME` is updated to `"Sherivs"`.
- `PLATFORM_TAGLINE` is updated to `"Institutional Intelligence Infrastructure"`.
- `PLATFORM_DOMAIN` is defined as `"sherivs.com"`.
- `EXECUTIVE_INTELLIGENCE_NAME` is defined as `"Jarvis"`.
- `AI_WORKFORCE_NAME` is defined as `"Sherivs AI Workforce"`.
- `EDUCATION_RUNTIME_NAME` is defined as `"Sherivs Scholar"`.

### Category C: Internal Substrate & Database Compatibility (PRESERVED)
*Rule: Database table names, migration files, SQL function names, and package scopes remain intact to prevent data loss and broken schema migrations.*
- SQL table prefixes (`cg_entity`, `cg_relationship`, `cg_worker_definition`, etc.).
- Internal npm packages (`@coregrid/contracts`).
- Historical ADR documents in `architecture/`.
- Git branch naming conventions.
- Domain-neutrality test baselines.

---

## 3. Migration Verification Matrix

| Surface | File Location | Legacy Reference | Canonical Sherivs State | Verification Status |
|---|---|---|---|---|
| Platform Identity | `frontend/src/lib/platform.ts` | `"CoreGrid"` | `"Sherivs"` | Verified |
| Public Shell Header | `frontend/src/routes/(site)/route.tsx` | Platform Name | `{PLATFORM_NAME}` (Sherivs) | Verified |
| Public Landing Page | `frontend/src/routes/(site)/coregrid.tsx` | CoreGrid Marketing | Sherivs Infrastructure Narrative | Verified |
| Public Platform Detail | `frontend/src/routes/platform.tsx` | Hardcoded CoreGrid | Dynamic Sherivs Platform Hub | Verified |
| Auth Portal Header | `frontend/src/routes/auth.tsx` | CoreGrid portal | Sherivs Institutional Portal | Verified |
| Application Shell | `frontend/src/routes/_authenticated/route.tsx`| CoreGrid Shell | Sherivs Universal Shell | Verified |
| Web App Manifest | `frontend/src/routes/manifest[.]webmanifest.ts`| CoreGrid Manifest | Sherivs Institutional PWA | Verified |
| Public Footer | `frontend/src/components/public/sections/site-footer.tsx`| CoreGrid Footer | Sherivs Sovereign Ecosystem | Verified |
| Authenticated page titles | `frontend/src/routes/_authenticated/**` | `— CoreGrid` document titles | `{PLATFORM_NAME}` | Verified |
| Admin copy | school profile, facilities, support | Hardcoded CoreGrid sentences | `{PLATFORM_NAME}` | Verified |
| Command centre | `frontend/src/components/command-centre/command-centre.tsx` | CoreGrid Command Centre / CG mark | `{PLATFORM_NAME}` + Sherivs symbol | Verified |
| Mobile screens | `mobile/app/**`, `mobile/src/ui`, `mobile/src/api/errors.ts` | CoreGrid sign-in and errors | Sherivs | Verified |
| Push notification fallback | `public/sw.js` | CoreGrid Scholar | Sherivs Scholar | Verified |
| Mobile display name | `mobile/app.json` `expo.name` | CoreGrid | Sherivs | Verified |
| Pricing, tips, nav labels, role labels | see §4 | Customer-facing CoreGrid phrases | Sherivs | Verified |

---

## 4. Intentional remainder register

Blind replacement is still prohibited. A repository search for `CoreGrid`, `coregrid`, or `COREGRID` will continue to match the identifiers below. They are retained on purpose.

| Remainder | Why it stays |
|---|---|
| `AGENTS.md` engineering constitution | Governance document. Renaming it is a constitution amendment, not a brand edit. |
| `architecture/**`, `COREGRID.md`, phase proofs, campaign ledgers | Historical architecture records and acceptance evidence. |
| Root `README.md` and other pre-migration engineering narratives | Historical platform narrative. Customer surfaces do not read them. |
| Package scope `@coregrid/contracts` and package names `coregrid-scholar`, `coregrid-mobile` | Import and lockfile compatibility. |
| SQL prefixes `cg_`, migration filenames, and `COREGRID_*` environment variables (`COREGRID_DB_CA_CERT`, `EXPO_PUBLIC_COREGRID_WEB_BASE_URL`) | Deployed schema and runtime configuration. |
| Type and field names such as `CoreGridDatabase`, `compatibleCoreGridVersion`, `coregridField` | Generated contracts and persisted API fields. |
| Capability and role keys `COREGRID_INTERNAL`, `r001.org_admin.coregrid_intelligence` | Authorization identifiers. Display labels now say Sherivs. |
| Public compatibility route `/coregrid` and anchor id `coregrid-hero` | Stable URL exercised by `tests/e2e/v1-vertical-slice.spec.ts` and `tests/unit/site-marketing.test.ts`. Copy on the page uses `PLATFORM_NAME`. |
| Service-worker cache name `coregrid-app-shell-v1` | Cache key. The notification title is Sherivs Scholar. |
| Credential references such as `secret://coregrid/...` and `internal://coregrid/presence` | Secret locators. The presence provider display name is Sherivs. |
| Mobile bundle id `com.coregrid.app`, URL scheme `coregrid`, slug `coregrid-mobile` | Store identity. The on-device name is Sherivs. |
| Domain-neutrality baselines under `architecture/coregrid-mvp-architecture/` | Guard baselines named by path. |
| Negative test patterns that look for the legacy phrase `CoreGrid Scholar` | They fail the build if that phrase returns to the public site. |
| Module file banners under `frontend/src/lib/**` (`CoreGrid —`, `CoreGrid Scholar —`) | Historical module frames. Kernel neutrality forbids relocating runtime vocabulary into the kernel; these comments are not customer copy. `tests/unit/sherivs-brand-surface.test.ts` locks the surfaces a person can read. |

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

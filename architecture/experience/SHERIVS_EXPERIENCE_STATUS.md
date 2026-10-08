# Sherivs Experience Status

Version target for every claim below: **V1** (organizational capability envelope). V2 (device/IoT), V3 (Reality Intelligence) and FUTURE-UNASSIGNED scope are frozen and untouched; the public copy is tested not to describe them (`sherivs-public-routes.test.ts`).

Status vocabulary: `LIVE` (built, with a test or artifact), `PARTIAL`, `CONTRACT_ONLY` (typed, tested contract; no UI wiring), `LEGACY` (pre-existing, not restyled), `DEFERRED` (intentionally not built, reason recorded), `NOT_STARTED`, `NOT_MEASURED`.

This file states what exists. It is not a completion claim: large parts of the program are not done.

## 1. Implementation inventory

TEST = automated tests. A11Y = accessibility evidence. PERF = performance evidence. SEC = security status.

| SURFACE | ROUTE | COMPONENTS | OWNER | MISSION | STATUS | TEST STATUS | A11Y STATUS | PERF STATUS | SEC STATUS |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Public home | `/` | `HomePage`, `PublicShell`, diagrams | Experience | EXP-03 | LIVE | e2e + unit | axe 0 / 90 runs | NOT_MEASURED | Anonymous; tenant hosts still resolved client-side (see risks) |
| Platform pages (8) | `/platform`, `/platform/$slug` | `DefinitionRows`, diagrams, `PageTitle` | Experience | EXP-03 | LIVE | e2e + unit | axe 0 | NOT_MEASURED | Anonymous, static content |
| Solutions (3) | `/solutions`, `/solutions/organizations`, `/solutions/education` | same | Experience | EXP-03 | LIVE | e2e + unit | axe 0 | NOT_MEASURED | Anonymous, static |
| Security | `/security` | same | Experience | EXP-03 | LIVE | e2e + unit | axe 0 | NOT_MEASURED | States what is NOT claimed (no certifications, no disclosure channel) |
| Pricing | `/pricing` | tier list | Experience | EXP-03 | LIVE (tiers mirror existing commercial catalog; not independently verified) | e2e | axe 0 | NOT_MEASURED | Anonymous |
| Status | `/status` | `SystemState` | Experience | EXP-03 | LIVE | e2e | axe 0 | NOT_MEASURED | Reads existing health endpoint |
| Accessibility statement | `/legal/accessibility` | `ProseBlock` | Experience | EXP-03 | LIVE | e2e | axe 0 | NOT_MEASURED | n/a |
| Resources/content | `/resources/**`, `rss.xml` | content registry | Experience | EXP-06 | LIVE shell, empty by design | unit + e2e | axe 0 | NOT_MEASURED | Public visibility rules tested |
| Legacy redirect | `/coregrid` | n/a | Experience | EXP-08 | LIVE (301) | e2e | n/a | n/a | n/a |
| Deferred public pages | about, company, careers, contact, request-demo, enterprise, legal privacy/terms/cookies, solutions enterprise/operations/ai-workforce | none | n/a | EXP-03 | DEFERRED | asserted 404 | n/a | n/a | n/a |
| Design tokens + CSS | `design/*` | n/a | Experience | EXP-02 | LIVE | unit (sync + contrast, 4 variants) | contrast tested | NOT_MEASURED | n/a |
| Brand system | n/a | `Sherivs*` lockups, assets | Experience | EXP-02, EXP-08 | LIVE | unit | n/a | NOT_MEASURED | n/a |
| Evidence/AI statement UX | n/a | `StatementBadge`, `ConfidenceMeter`, `VerificationState`, `ProvenanceTrace`, `AiStatement` | Experience | EXP-05 | LIVE components; not placed in any product screen | unit | unit (roles/labels) | NOT_MEASURED | Render only supplied data |
| System states | n/a | `SystemState` (13 kinds) | Experience | EXP-02 | LIVE components; not adopted by legacy screens | unit | role/live semantics tested | NOT_MEASURED | n/a |
| Org brand layer | n/a | `org-brand.ts` | Experience | EXP-04 | LIVE logic; not yet applied to the organization public site/workspace | unit (adversarial colors) | AA guaranteed | n/a | Validated hex only |
| Experience Contract | n/a | `experience-contract.ts` | Experience | EXP-04 | CONTRACT_ONLY (not wired into the shell) | unit | n/a | n/a | Only removes options; DENY/REQUIRE_APPROVAL tested |
| Organization public site | `/` on tenant host or `?school=` | pre-existing `components/public/*` | Legacy | n/a | LEGACY | pre-existing | not audited | NOT_MEASURED | Pre-existing |
| Organization workspace | `/_authenticated/*` portals | pre-existing | Legacy | EXP-04 | LEGACY (not restyled; no unified universal shell) | pre-existing | not audited | NOT_MEASURED | Server/RLS enforced as before |
| Provisioning wizard | `/command-centre/provision` | `CommandCentre` | Legacy | EXP-07 | MOVED off public root | e2e (v1 slice updated) | not audited | NOT_MEASURED | Authenticated |
| Sherivs internal workspace | `/super-admin/architecture`, `/super-admin/organization` | pre-existing operator views | Platform | EXP-07 | MOVED + gated | unit (kept out of public tree) + e2e | not audited | NOT_MEASURED | `super_admin`, robots Disallow, not in customer nav |
| Command palette / global search | n/a | legacy `command-palette.tsx` | Legacy | EXP-09 | NOT_STARTED (contract defines commands) | none new | not audited | NOT_MEASURED | Contract: commands obey capabilities |
| Calendar/time, notifications center | `/notifications` pre-existing | legacy | Legacy | EXP-09 | NOT_STARTED | none new | not audited | NOT_MEASURED | n/a |
| Mission/AI workforce screens, Jarvis | none | none | n/a | EXP-05 | NOT_STARTED (public explanation only) | n/a | n/a | n/a | n/a |
| Account/settings/onboarding/auth | `/auth`, `/login`, `/settings` | legacy | Legacy | EXP-09 | LEGACY | pre-existing | not audited | NOT_MEASURED | n/a |
| Mobile/PWA | `manifest.webmanifest`, `sw.js`, `mobile/` | icons | Experience | EXP-08 | PARTIAL (icons, theme color, copy; service worker cache key unchanged; native screens not redesigned) | none new | not audited | NOT_MEASURED | n/a |
| Developer portal / docs site | none | none | n/a | EXP-06 | NOT_STARTED | n/a | n/a | n/a | n/a |
| Experience API (server) | none | contract is client-library only | n/a | EXP-04 | CONTRACT_ONLY | unit | n/a | n/a | No server enforcement endpoint yet |

## 2. Mission portfolio

Fields: ID, TITLE, OBJECTIVE, OWNER, VERSION, AUTHORITY, DEPENDENCIES, DELIVERABLES, ACCEPTANCE, EVIDENCE, VERIFICATION, RISKS, STATUS, NEXT, BLOCKERS.

| ID | TITLE | OBJECTIVE | OWNER | VERSION | AUTHORITY | DEPENDENCIES | DELIVERABLES | ACCEPTANCE | EVIDENCE | VERIFICATION | RISKS | STATUS | NEXT | BLOCKERS |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| EXP-01 | Reconnaissance | Inventory real experience state | Experience | V1 | Read-only | none | `SHERIVS_EXPERIENCE_INVENTORY.json`, generator | Deterministic, `--check` passes | Inventory file | `inventory-experience.mjs --check` | Count drift | DONE | Re-run on change | none |
| EXP-02 | Design system | Tokens, CSS, typography, components, states | Experience | V1 | Code in `frontend/src` | EXP-01 | tokens, CSS, 8 component modules | Contrast + sync tests pass | unit tests | vitest | Legacy styles coexist | DONE for new surfaces | Adopt in portals | Product decision on legacy restyle |
| EXP-03 | Public site | Registry-driven honest public site | Experience | V1 | Public content only | EXP-02 | 17 LIVE routes (+ resources subtree) | 1 h1/page, no overflow, axe 0, deferred = 404 | e2e + axe logs | Playwright, axe | Pricing mirror, SSR loading at `/` | DONE | Add approved content, intake, legal | Copy and counsel input |
| EXP-04 | Org brand + Experience Contract | Controlled org brand and server-driven nav/commands | Experience | V1 | Contract only | EXP-02 | `org-brand.ts`, `experience-contract.ts` | AA guaranteed; contract only removes options | unit tests | vitest | Not wired to UI/server | PARTIAL | Wire to authenticated shell via server function with audit | Architecture decision on shell |
| EXP-05 | AI/evidence UX | Truthful AI statements, evidence, verification | Experience | V1 | UI components | EXP-02 | evidence components + model | Labels/roles/truthful live state tested | unit tests | vitest | Not used in a product screen | PARTIAL | Place in mission views when backed by real data | Mission/workforce backend surfaces |
| EXP-06 | Content system | Typed content, SEO, JSON-LD, RSS, sitemap | Experience | V1 | Public content | EXP-03 | `content.ts`, `seo.ts`, feeds | Visibility rules, injection-safe | unit tests | vitest | Registry empty | DONE (infrastructure) | Publish approved items | Authors/approvals |
| EXP-07 | Boundary separation | Operator surfaces out of public tree | Experience + Platform | V1 | Route moves | EXP-03 | `/super-admin/*`, `/command-centre/provision` | Operator paths not public | unit + e2e | Playwright | Bookmarks to old paths | DONE | Server-side audit review | none |
| EXP-08 | Brand migration | Classified CoreGrid -> Sherivs | Experience | V1 | Customer-facing lines only | EXP-01 | migration scripts, 84 lines, assets | No CUSTOMER_FACING line remains | unit test + inventory | vitest | Technical names remain CoreGrid by design | DONE | Separate ADR for identifier renames | Governance decision |
| EXP-09 | Universal workspace, command, search, calendar, notifications | Unified shell and tools | Experience | V1 | n/a | EXP-04 | none | n/a | none | n/a | Largest remaining scope | NOT_STARTED | Wire contract; restyle shell; command palette on contract | Capacity; decision on legacy portals |
| EXP-10 | Hardening | Perf, a11y manual, mobile PWA | Experience | V1 | n/a | EXP-03 | none | n/a | none | n/a | Unmeasured performance | NOT_STARTED | Lighthouse/Web Vitals, screen reader pass, reduced-motion test | Tooling and test devices |

## 3. Design review gates

| # | Gate | Result | Evidence / gap |
| --- | --- | --- | --- |
| 1 | Inventory before change | PASS | Inventory JSON, `--check` |
| 2 | Architecture documented | PASS | These 12 documents |
| 3 | Honesty (no fabricated claims) | PASS for public site | Registry, empty content, honesty scan |
| 4 | Identity and brand | PASS (customer-facing) | Brand migration test |
| 5 | Design system fidelity | PASS for new surfaces | Token sync + contrast tests |
| 6 | Authorization and boundary | PASS for what exists | Internal gated, contract tested; server enforcement unchanged (contract not wired) |
| 7 | Accessibility | PARTIAL | axe 0 / 90 runs, e2e; no manual/AT audit; portals not audited |
| 8 | Responsive | PARTIAL | 320–1440 verified on public pages; tablet/ultra-wide not reviewed |
| 9 | Motion | PARTIAL | Reduced-motion CSS present; not runtime-tested |
| 10 | Performance | NOT MEASURED | No Lighthouse/Web Vitals run |
| 11 | Test evidence | PASS for new code | See section 5 |

## 4. Known risks and limitations

1. **SSR at `/`**: tenant resolution is client-side, so the server-rendered root is a loading state until hydration. Crawlers may not see the Sherivs home. Fix needs server-side host -> tenant resolution.
2. **Pricing**: tier highlights mirror the existing commercial catalog and are not independently verified commercial offers.
3. **No intake / legal / company content**: contact, demo, privacy, terms, cookies, about, careers are deferred; no channel exists to receive submissions.
4. **Two visual systems coexist**: Sherivs tokens on new surfaces, legacy tokens in portals and the organization site.
5. **Contract not enforced server-side**: `experience-contract.ts` is a verified library; no server function consumes it yet. The UI is not security (AGENTS.md §34).
6. **Domain**: `sherivs.com` is the canonical origin in code; DNS/hosting not verified here.
7. **Service worker cache key** still `coregrid-app-shell-v1`.
8. **Screenshot/axe tooling** lives outside the repo (`/tmp`); e2e specs are in the repo.
9. **Pre-existing**: 4 mobile test files fail because `expo/tsconfig.base` is missing; unrelated to this change.

## 5. Verification record

Run on branch `cursor/sherivs-experience-architecture-3ca7`:

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | clean |
| `npx vitest run` | 430 files / 9011 tests passed; 4 files fail, all pre-existing (`mobile-*`, missing `expo/tsconfig.base`) |
| `npm run verify:neutrality` | PASS (baseline warnings only) |
| `npm run verify:secrets` | PASS |
| `npm run verify:registry`, `verify:drift` | PASS |
| `inventory-experience.mjs --check` | current |
| `npm run build` | succeeds |
| Playwright `sherivs-public.spec.ts` (desktop + Pixel 5) | 67 passed, 1 skipped |
| axe-core sweep | 18 routes x 5 configs = 90 runs, 0 violations, 0 overflow |

Logs: `/opt/cursor/artifacts/logs/` (`axe-sweep.log`, `e2e-sherivs-public.log`, `verify-scripts.log`, `vite-build.log`). Performance (Web Vitals, bundle budgets) was not measured.

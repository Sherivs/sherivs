# SHERIVS Experience Status

Version: V1 foundation (2026-10-08) · Classification: **V1**
This file is the honest state of the program. Anything not listed as
SHIPPED is not done.

## 1. Shipped (V1 foundation increment)

- Experience architecture, constitution, design system, component catalog,
  route architecture, IA, content architecture, motion, accessibility,
  responsive, brand migration docs (this directory).
- Brand system: `sherivs-brand.ts`, `platform.ts` adapter, logo, icons,
  public registry (verified destinations only).
- Public experience: `/`, `/sherivs`, `/platform` (re-skinned + anchors),
  `/solutions/education`, `/security`, `/enterprise`, `/pricing`,
  `/resources`, `/about`, `/contact`, `/request-demo`, `/legal/*`,
  `/status` (live health). The operator Command Centre remains gated under
  `_authenticated/command-centre` (V1-012: no public route).
- Application foundation: `SherivsAppShell`, evidence/verification
  primitives, full system-state set, additive `--sherivs-*` token layer
  (light/dark/contrast/reduced-motion).
- Operator surface stays permission-gated: V1-012 forbids a public
  `/command-centre` route; `/` serves the Sherivs narrative instead.
- Tests: `tests/unit/sherivs-brand.test.ts` green; typecheck,
  domain-neutrality and platform-neutrality gates green.

## 2. Surface inventory extract

| Surface | Route | Components | Status | A11y | Perf | Security |
|---|---|---|---|---|---|---|
| Public home | `/`, `/sherivs` | PublicShell, SherivsHome | SHIPPED | gate checklist P1 | budgets P1 | public, no PII |
| Kernel detail | `/platform` | existing + Sherivs chrome | SHIPPED | checklist P1 | budgets P1 | public |
| Solutions/Security/Enterprise/Pricing/Resources/Company/Legal/Status | see routes | PublicShell, DocPage, states | SHIPPED | checklist P1 | budgets P1 | public |
| Tenant public sites | tenant hosts | PublicSchoolSite (kept) | KEPT | as before | as before | RLS enforced |
| Authenticated workspaces | `_authenticated/*` | existing shells (kept) | KEPT; app-shell rollout P1 | as before | as before | authZ enforced |
| Internal Sherivs workspace | — | — | SPECIFIED, NOT BUILT | — | — | separate boundary required |
| Developer portal/API docs | — | — | SPECIFIED, NOT BUILT | — | — | publish with real endpoints only |
| V2 (device/IoT) / V3 (Reality Intelligence) | — | — | FROZEN (proposal only) | — | — | — |

## 3. Mission portfolio (P1 next)

M-V1-E01 app-shell workspace rollout (capability-projected nav per role) ·
M-V1-E02 product/data/form/calendar component families · M-V1-E03 account +
organization settings IA build · M-V1-E04 onboarding framework · M-V1-E05
notification center + command palette policy wiring · M-V1-E06 Jarvis/AI
panels on real gateway state · M-V1-E07 mission + workforce detail UX ·
M-V1-E08 PWA install/offline hardening + Sherivs icon set · M-V1-E09
canonical cutover + `/coregrid` redirect + OG assets · M-V1-E10 E2E +
a11y + performance evidence per surface. Each mission carries acceptance,
test, accessibility, performance, security, evidence and rollback plans.

## 4. Known risks

- New public IA links assume `sherivs.com` canonical before DNS cutover is
  confirmed — legacy origin still serves; cutover mission must add redirects.
- App shell is adopted by zero workspaces yet; existing shells remain the
  enforced surfaces until rollout lands.
- Content depth (guides, changelog, API docs) intentionally absent until real.

## 5. Test status

Unit green (incl. new brand/registry tests) · typecheck green ·
`verify:neutrality` green · platform-neutrality green · build green.
E2E journeys and per-surface a11y/perf evidence are P1 (M-V1-E10).

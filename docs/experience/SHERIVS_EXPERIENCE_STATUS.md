# Sherivs Experience Status

Version target: **V1 organizational capability envelope**.
Date: 2026-10-08.

This is the actual state after the experience-architecture pass. A row marked partial is not complete. A row marked specified is not built.

## Implemented

- Customer brand constant Sherivs, kernel name CoreGrid preserved, with a classification function and tests.
- Public narrative homepage at `/` for the platform host. Tenant sites and signed-in redirects still behave as before.
- Operator console moved to `/operate` and marked `noindex`.
- Public pages for platform, solutions, security, enterprise, pricing, resources, about, contact, status, developers, and legal disclosures. Each page has an evidence note. Unpublished formats were not given routes.
- Experience configuration that withholds education sections without `runtime:scholar` and withholds workspace items without capability.
- Command admission that denies privileged and signed-out actions.
- Design tokens for light and dark, wired through existing CSS variables. Contrast pairs tested at WCAG AA for body and signal.
- Reduced motion, public type scale, public frame, sitemap entries, canonical origin `https://sherivs.com`.
- Production build and `tsc --noEmit` succeeded. Unit tests: `tests/unit/sherivs-experience.test.ts` plus existing marketing and neutrality suites.

## Not implemented

- Rewriting every Scholar portal screen into the new visual language.
- Replacing every remaining customer-visible "CoreGrid" string in authenticated pages.
- MFA, passkeys, session inventory, devices, login history, data export, account deletion pages.
- A platform blog, guides, case studies, changelog, or docs CMS.
- A contact or demo form. There is no persistence for one.
- A public SDK, sandbox, or API reference beyond the developer page's honest list.
- High-contrast user toggle on the public site.
- Wiring `admitCommands` into the existing role-based command palette. The palette still filters by application role. The new function is the rule; it is not yet the palette's source.
- Social accounts, testimonials, customer logos, live metrics.
- V2 device surfaces and V3 reality-intelligence surfaces. Frozen.

## Surface inventory

| Surface | Route | Owner | Status | Test | Accessibility | Performance | Security |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Public home | `/` | Experience | live | structural + unit | landmarks, contrast, reduced motion | shared editorial chunk; no new font | no tenant data |
| Platform kernel | `/platform` | Kernel | live, brand updated | existing page | table semantics already present | unchanged | public registry |
| Platform chapters | `/platform/*` | Experience | live | page registry test | editorial headings | shared chunk | public contracts only |
| Solutions | `/solutions/*` | Experience | live | page registry test | editorial headings | shared chunk | no tenant data |
| Security | `/security` | Experience | live | renders guarantee catalog | definition list | shared chunk | describes controls, grants none |
| Pricing | `/pricing` | Commercial catalog | live | existing tier tests | labelled sections | shared chunk | does not grant features |
| Resources | `/resources` | Experience | live | registry | links | shared chunk | no fake content |
| Legal | `/legal/*` | Experience | live as disclosure | registry | prose | shared chunk | not a counsel policy |
| Status | `/status` | Observability | live | registry | link to health | shared chunk | health payload stays leak-free |
| Developers | `/developers` | Platform | live | registry | definitions | shared chunk | no key minting |
| Auth | `/auth` | Identity | live, copy updated | existing auth tests not re-run as e2e | form | unchanged | session unchanged |
| Operator console | `/operate` | Control plane | moved, live | structural test | existing console | existing bundle | noindex; still unauthenticated provisioning |
| Internal org catalog | `/platform/org` | Control plane | live, unlinked, noindex | not newly tested | existing | existing | generated roles, not tenant data |
| App shell | authenticated layout | Shell | unchanged structure | existing shell tests | existing | existing | role guard is cosmetic; RLS remains the boundary |
| Organization public | tenant `/` | Experience engine | unchanged | existing | existing | existing | tenant scoped |
| Mobile | Expo routes | Mobile | unchanged | not run | not re-audited | n/a | existing session |
| Command palette | authenticated | Shell | partial | new admit function only | existing keyboard | existing | new commands cannot bypass capability check in the contract; palette not yet switched over |

## Verification evidence

- `npx vitest run tests/unit/sherivs-experience.test.ts tests/unit/site-marketing.test.ts tests/unit/platform-neutrality.test.ts` — 76 passed.
- `npx tsc --noEmit` — exit 0.
- `npx vite build` — exit 0. Client CSS about 185 kB (29 kB gzip). Public editorial server chunk about 31 kB (9 kB gzip).

## Known risks

- `/operate` can still provision from an unauthenticated browser. It was already the homepage behavior. Moving it off `/` reduces accidental exposure. It is not an authorization boundary.
- Remaining "CoreGrid" strings in authenticated titles are customer-facing debt.
- Organization brand colors can still defeat contrast if a tenant chooses poorly.
- Canonical host is sherivs.com even if a deployment still answers on an older domain. Cutover is an operations step, not something this change can prove.

# SHERIVS Design System

Version: V1 foundation (2026-10-08) · Classification: **V1**
Implementation: `frontend/src/styles.css` (Sherivs token layer, additive),
`frontend/src/components/sherivs/*`, existing `components/ui/*` (shadcn/Radix).

## 1. Visual language

INTELLIGENCE · PRECISION · TRUST · DEPTH · INFRASTRUCTURE · CALM · FUTURE ·
AUTHORITY · HUMANITY. Deep neutral foundations, one luminous intelligent
accent (`--sherivs-accent`, tenant-tunable), high-contrast semantic colors,
precision borders, controlled translucency. Glass is hierarchy, not brand:
headers, overlays and panels only — never whole-page frosted cards, never
rainbow gradients, never glow for its own sake.

## 2. Tokens (`--sherivs-*`)

| Family | Tokens |
|---|---|
| Color | `--sherivs-ink`, `--sherivs-paper`, `--sherivs-accent`, `--sherivs-accent-2` (+ semantic red/amber/green/sky/violet/teal in components) |
| Spacing | 1/2/3/4/6/8/12/20 (0.25–5rem, 4px base) |
| Radius | sm 6 · md 10 · lg 14 · xl 20 px |
| Shadow | sm / md / lg (disabled under `prefers-contrast: more`) |
| Blur | header 16px/sat150 · panel 20px/sat160 |
| Z-index | header 40 · sidebar 50 · overlay 60 · dialog 70 · toast 80 · skip 100 |
| Motion | 80 / 150 / 240 / 400 ms · ease-out `(0.22,1,0.36,1)` · ease-in-out `(0.4,0,0.2,1)` |
| Breakpoints | 768 tablet · 1024 laptop · 1440 desktop (+ 360/390/430/1920/2560 behaviors) |

Organization brand layer: `--tenant-primary / --tenant-secondary` feed
`--sherivs-accent*` and are the only brand override point.

## 3. Typography

Display: Plus Jakarta Sans (hero/H1–H4, tight tracking). Body/UI/data:
Inter (tabular numerals for metrics). Scale: hero → H1 → H2 → H3 → H4 →
body → small → caption → label; code/mono for identifiers; metric style for
KPIs. One scale across marketing, application, tables, mobile, docs and AI.

## 4. Iconography

`components/sherivs/sherivs-icons.ts` — lucide only, 1.5px stroke,
size-driven, optical alignment inherited. Brand mark: `sherivs-logo.tsx`
(registration-ring sigil + uppercase wordmark + lockups). No mixed libraries.

## 5. Surfaces and states

Public: `SherivsPublicShell` + `DocPage` + hero/movement primitives.
Application: `SherivsAppShell` (header/sidebar/content/slots).
Trust: `evidence.tsx` (observation/inference/recommendation/action/evidence/
verification badges, provenance, confidence meter, verification state).
States: `system-states.tsx` (loading skeleton, empty, error+retry, offline,
forbidden, not-found, reasoning-phase). Full state matrix per surface:
default/hover/focus/active/disabled/loading/success/error/warning/empty/
partial/offline/unauthorized/forbidden/expired/stale.

## 6. Data visualization language

Charts answer questions or do not ship: metric + trend + distribution +
timeline + relationship + status/confidence/evidence primitives. No
decorative charts, no invented numbers. (Recharts remains the chart
primitive; Sherivs chart styling is a P1 mission.)

## 7. Theming

Light / dark / system via existing bootstrap + `color-scheme`; organization
brand layer constrained to accent tokens; `prefers-contrast: more` strips
shadow/atmosphere. Focus ring is always visible and brand-tinted.

## 8. Internal reference

Per-component purpose/anatomy/variants/states/responsive/accessibility/
motion/anti-patterns live with the component source plus
`SHERIVS_COMPONENT_CATALOG.md`. This file plus the catalog constitute the
Sherivs Experience Constitution's design half.

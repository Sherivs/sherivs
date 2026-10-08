# Sherivs Design System

Status: `PROPOSED — TOKEN CONSOLIDATION REQUIRED`  
Version target: `ACTIVE-V1`

## Observed implementation

- Runtime styling: `frontend/src/styles.css` (Tailwind v4, shadcn variables, UOS utilities).
- Primitives: 48 components in `frontend/src/components/ui/` using Radix and Lucide.
- Application patterns: `frontend/src/components/portal-shell.tsx`.
- Theme behavior: `frontend/src/lib/theme.ts`; tenant colors in `frontend/src/contexts/app-context.tsx`.
- Mobile tokens: `mobile/src/ui/theme.ts`, currently separate.
- Governance libraries: `experience-core.ts`, `experience-accessibility.ts`, and `experience/experience-platform.ts`, not consumed consistently by React.

The immediate design-system task is consolidation, not a fourth token layer.

## Token model

Tokens are organized as:

1. **Primitive:** neutral ramps, spacing, type scale, radii, durations.
2. **Semantic:** canvas, surface, text, border, action, danger, warning, success, information, focus.
3. **Component:** control height, panel spacing, navigation dimensions.
4. **Brand:** Sherivs accent and approved organization overrides.

Required canonical token groups:

| Group       | Required tokens                                                                             |
| ----------- | ------------------------------------------------------------------------------------------- |
| Color       | canvas, surface-1..4, text-primary/secondary/muted/inverse, border, action, semantic states |
| Type        | display, hero, h1–h4, body, small, caption, label, code, data, metric                       |
| Space       | 0, 1–12 with documented density mapping                                                     |
| Shape       | control, panel, dialog, pill; avoid indiscriminate rounding                                 |
| Elevation   | inset, raised, overlay, modal                                                               |
| Motion      | instant, fast, standard, deliberate; enter/exit/emphasize easings                           |
| Layout      | content measure, page gutters, sidebar, secondary panel, reading width                      |
| Focus       | color, width, offset, high-contrast variant                                                 |
| Breakpoints | 360, 390, 430, 768, 1024, 1280, 1440, 1600, 1920, 2560                                      |
| Density     | comfortable, compact, data-dense                                                            |
| Z-index     | base, sticky, navigation, popover, overlay, modal, toast                                    |

No component may accept arbitrary organization CSS. Branding is limited to validated accent, logo, imagery, and selected typography roles.

## Visual language

- Deep neutral foundations convey infrastructure without forcing dark mode.
- Luminous accents identify active intelligence or focus, not decoration.
- Borders organize dense information; shadow is reserved for elevation.
- Translucency indicates spatial overlay, never every container.
- Negative space creates focal zones; dense operational regions use rows, tables, timelines, and split views.

## Typography

- Display/hero: category and narrative moments only.
- H1–H4: strict document hierarchy.
- Body/small/caption/label: readable at 200% zoom.
- Code/data/metric: tabular numerals where alignment matters.
- Fonts must be self-hosted or loaded without render-blocking regressions before production acceptance.

## Iconography

Lucide is canonical. Standard sizes are 16, 20, and 24 px with consistent stroke and optical alignment. Icons supplement labels unless the action is universally understood and has an accessible name.

## Surfaces

Use:

- list for comparable records;
- table for multi-attribute scanning;
- timeline for temporal causality;
- panel for persistent context;
- split view for selection plus detail;
- canvas for relationships;
- drawer for temporary secondary work;
- modal for focused interruption;
- card for a bounded object with independent action.

## Theming

Supported modes: light, dark, system, and controlled high contrast. Organization brand is a layer over semantic tokens. Changing semantic danger/success/focus tokens through organization branding is prohibited.

## Data visualization

Charts require a question, real data, accessible summary, units, time range, source, and no color-only encoding. Confidence and forecast must be visually distinct from observed values. Decorative or fabricated charts are prohibited.

## Adoption plan

1. Reconcile the three experience namespaces and name one owner.
2. Map existing CSS variables into the token model without changing appearance.
3. Export platform-neutral tokens for web and mobile.
4. Consolidate duplicate skeleton/card/state patterns.
5. Add component examples and automated accessibility checks.
6. Migrate surfaces incrementally behind visual and performance evidence.

# Sherivs Design System

Status: Target token and pattern specification; current CSS is only partially conformant  
Version target: ACTIVE-V1

## Foundations

The visual language communicates intelligence, precision, trust, depth, infrastructure, calm,
authority, and humanity. It uses restrained neutral foundations, one luminous interaction accent,
semantic colors, precision borders, and deliberate depth. Glass is reserved for transient overlays
and context-preserving layers.

## Canonical tokens

Token names are semantic. Components consume semantic aliases, never raw palette values.

| Family | Required scale |
| --- | --- |
| Color | canvas, surface-1..4, text-primary/secondary/muted/inverse, accent, border, focus, info, success, warning, danger |
| Spacing | 0, 1, 2, 3, 4, 6, 8, 10, 12, 16, 20, 24 on a 4px base |
| Type | hero, display, h1–h4, body-lg, body, small, caption, label, code, data, metric |
| Radius | 0, xs, sm, md, lg, full; radius follows object scale and interaction |
| Border | subtle, default, strong, interactive, semantic |
| Shadow | inset, low, medium, high, overlay; dark/light variants |
| Blur | none, contextual, overlay; never applied to every surface |
| Opacity | disabled, muted, secondary, strong |
| Z-index | base, sticky, navigation, popover, drawer, modal, toast, critical |
| Motion | instant, fast, normal, deliberate; standard, enter, exit, emphasized easing |
| Layout | content-sm/md/lg/xl, rail, panel, gutter, readable-line |
| Density | compact, comfortable |
| Breakpoint | 360, 390, 430, 768, 1024, 1280, 1440, 1600, 1920, 2560 |

Existing `frontend/src/styles.css` contains useful semantic foundations but duplicates radius,
shadow, animation, glass, and type values and defaults too many surfaces to frosted cards. Migration
must consolidate without a blind rewrite.

## Typography

| Role | Use |
| --- | --- |
| Hero | one public narrative statement |
| Display | major editorial or product introduction |
| H1–H4 | semantic page hierarchy, never selected by appearance alone |
| Body / body-lg | reading and explanatory content |
| Small / caption | supporting information; never critical state alone |
| Label | controls and compact metadata |
| Code | identifiers, commands, schemas |
| Data | tabular values with tabular numerals |
| Metric | a measured value paired with unit, timeframe, and source |

Line length targets 45–75 characters for prose. Tables and dense operational surfaces use compact
type without dropping below readable zoomed equivalents.

## Surface model

- **Canvas:** application or public background.
- **Inline region:** related content separated by rhythm or border.
- **Panel:** persistent secondary context.
- **Card:** one bounded, portable object with its own action or metadata.
- **Table/list:** comparable or sequential records.
- **Canvas/graph:** spatial relationships.
- **Drawer/sheet:** temporary supporting work.
- **Modal:** focused interruption requiring completion or dismissal.
- **Command interface:** fast authorized discovery and execution.

## Color and theming

Light, dark, system, and high-contrast themes use equivalent semantic roles. Organization branding
may set `brand-accent`, `brand-on-accent`, logo, and approved editorial imagery after automated
contrast validation. It cannot override focus, destructive/warning/success meanings, control
states, typography scale, or spacing.

## Iconography

Use Lucide as the single operational icon library. Default stroke is consistent within a surface;
sizes are 16, 20, and 24px with optical alignment. Icons supplement labels for unfamiliar actions.
Proprietary motifs may represent the four planes—Reality, Intelligence, Action, Evidence—but may
not imply activity absent backend state.

## Data visualization

Charts exist only when a question benefits from shape or comparison. Every visualization includes
title/question, timeframe, units, source/freshness, accessible summary, keyboard-readable detail
where interactive, and a table alternative for critical values. Color is redundant with shape,
label, or pattern. No fake values.

## Focus and interaction

Visible focus has at least 3:1 contrast against adjacent colors and is never clipped. Disabled
controls explain why when the reason is safe to reveal. Destructive actions state the affected
resource, consequence, and recovery semantics.

## Migration gates

1. Inventory raw and duplicated values.
2. Introduce canonical semantic aliases.
3. Map existing shadcn/Radix tokens.
4. Migrate shared primitives before routes.
5. Verify both themes, high contrast, 200% zoom, and reduced motion.
6. Remove aliases only after zero-use evidence.

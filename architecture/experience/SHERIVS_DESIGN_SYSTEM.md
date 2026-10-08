# Sherivs Design System

Version: tokens `1.0.0`. Target: V1.

## Source of truth and pipeline

```
frontend/src/design/sherivs.tokens.json            (edit this)
        |  node scripts/experience/generate-design-tokens.mjs
        v
frontend/src/design/sherivs-tokens.css             (generated; do not edit)
frontend/src/design/sherivs.css                    (component + motion CSS using tokens)
frontend/src/lib/experience-system/design-tokens.ts  (typed access for TS and tests)
```

`tests/unit/sherivs-design-tokens.test.ts` fails if the generated CSS is out of sync with the JSON and checks WCAG contrast for the declared pairs in four variants: light/dark x standard/high contrast.

All custom properties use the `--sv-` prefix, so they coexist with the legacy token layer (`styles.css`) without collision.

## Color

* **Ink** ramp (neutral, blue-tinted) and **Lumen** ramp (teal accent).
* Semantic theme tokens: `canvas`, `surface-1/2/3/sunken`, `text`, `text-muted`, `text-subtle`, `border`, `border-strong`, `accent`, `accent-hover`, `accent-fg`, `accent-text`, `accent-wash`, `focus`, status (`success`, `warning`, `danger`, `info` + washes).
* **Plane colors**: `plane-reality`, `plane-intelligence`, `plane-action`, `plane-evidence` — used for the four-plane model only, never decoratively.
* Status is never conveyed by color alone; components pair color with label/icon.

## Typography

Geist Variable (sans) and Geist Mono Variable via `@fontsource-variable/*` (already dependencies). Fluid scale: `display`, `hero`, `h1`–`h4`, body and small sizes via `clamp()`. Reading measure `68ch`. Utility classes: `sv-display`, `sv-hero`, `sv-h1`… in `sherivs.css`.

## Spacing, radius, layout

* 4px base space scale (`--sv-space-*`).
* Radius: `none, xs 2, sm 4, md 8, lg 12, pill`. Restrained; no oversized pill cards.
* Layout widths: reading `68ch`, content `75rem`, wide `90rem`, ultra `110rem`; fluid gutter; header `3.5rem`.
* Z-index variables (`--sv-z-dropdown`, `--sv-z-overlay`, …) are consumed by `ui/popover.tsx` and `ui/sheet.tsx` with fallbacks to the legacy value, so existing screens are unchanged.

## Elevation

`shadow-sm/md/lg/overlay`, theme-specific. Borders are preferred to shadows for structure.

## Iconography

`lucide-react` only (AGENTS.md §33). The Sherivs symbol is the custom `Stratum` mark (four offset bars). Brand assets are generated reproducibly by `scripts/experience/generate-brand-assets.mjs` (favicon SVG, OG image, 192/512/maskable PNG).

## Motion

See `SHERIVS_MOTION_SYSTEM.md`.

## Themes and contrast

Light, dark, standard and high contrast. Each theme's declared pairs meet AA (normal text 4.5:1, non-text 3:1); the test suite fails on regression. A prior `border-strong` value measured 2.85:1 and was corrected to meet 3:1.

## Organization brand layer

`org-brand.ts` accepts one hex accent and validates it. Output variables: `--sv-org-accent`, `--sv-org-accent-fg`, `--sv-org-accent-text-light`, `--sv-org-accent-text-dark`. Foreground color is chosen for the best contrast (black fallback when white fails), and text variants are adjusted until AA holds against the light and dark canvas. Invalid or missing input yields `null` and the Sherivs accent is used.

## Anti-patterns (rejected)

Gradient hero, random glassmorphism, card grids as default layout, glowing orbs, stock illustrations, decorative status colors.

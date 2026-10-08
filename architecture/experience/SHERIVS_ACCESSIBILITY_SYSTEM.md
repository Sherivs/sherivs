# Sherivs Accessibility System

Target: WCAG 2.2 AA for the new Sherivs surfaces. This is a target and a measured result for the public site only; it is **not** a certification or an audit claim, and the public `/legal/accessibility` page says so.

## Built-in properties

* Skip link first in tab order, targeting `<main id>`; landmarks: header, `nav aria-label="Primary"`, main, footer navs with labels.
* One `h1` per page, ordered headings (two violations found by axe on `/platform` and `/solutions` were fixed by adding real `h2` sections).
* `:focus-visible` ring from the `--sv-focus` token (contrast-tested against both canvases).
* 44px minimum touch targets on interactive controls (`sv-touch`).
* Platform menu is keyboard operable (opens from keyboard, closes with Escape; asserted by e2e) via Radix Popover; mobile navigation is a Radix Sheet with focus trap.
* Status never conveyed by color alone: `SystemState`, `VerificationState`, `StatementBadge` always include text; `role="alert"` for errors, `role="status"` for non-blocking states; live regions only for genuinely live states.
* Text is rendered as text (no `dangerouslySetInnerHTML` for content); JSON-LD escapes `<`.
* Reduced motion honored (see motion doc).
* Themes: light, dark, and high-contrast variants; pairs tested.

## Contrast

`SHERIVS_CONTRAST_PAIRS` in tokens JSON, validated for light/dark x standard/high in `sherivs-design-tokens.test.ts`. Org accent derivations (`org-brand.ts`) guarantee AA for foreground and text-on-canvas variants; verified by `sherivs-org-brand.test.ts` including adversarial inputs (e.g. mid-gray `#777777`, which exposed a 4.48:1 foreground and led to a black fallback).

## Evidence (this change)

| Check | Scope | Result | Artifact |
| --- | --- | --- | --- |
| axe-core (wcag2a, 2aa, 21a, 21aa, 22aa, best-practice) | 18 public routes x light/dark 1440, light/dark 390, light 320 = 90 page runs | 0 violations, 0 horizontal overflow | `/opt/cursor/artifacts/logs/axe-sweep.log` |
| Playwright (desktop + Pixel 5) | every LIVE route: one h1, no overflow, no console errors; skip link; menu keyboard/Escape | 67 passed, 1 skipped (desktop-only menu test on mobile) | `/opt/cursor/artifacts/logs/e2e-sherivs-public.log` |
| Unit: tokens, org brand | contrast | pass | vitest |

axe is run from `/tmp/axe` (not a repository dependency). Automated tools find a subset of issues.

## Not verified

* No screen-reader (NVDA/JAWS/VoiceOver) pass; no manual keyboard audit beyond the e2e checks.
* No forced-colors / 200% zoom / text-spacing automated check.
* No reduced-motion runtime test.
* Authenticated portals, command palette, mobile app screens and the organization public site were **not** audited and are not claimed.

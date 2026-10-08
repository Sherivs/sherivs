# Sherivs Accessibility System

Version target: **V1**. Target: WCAG 2.2 AA where the control is implemented. This is not a completed external audit.

## Implemented on the new public surfaces

- One `h1` per page. Chapters use `h2` and are labelled by `aria-labelledby`.
- Skip link in the document shell targets `#main-content`. The public frame's main uses that id.
- Focus visible uses the signal color, offset 2px.
- Primary actions and the sign-in link are at least 44px tall.
- Body and signal contrast pairs are tested at ≥ 4.5:1.
- `prefers-reduced-motion` is honored globally.
- Links are real anchors. There is no click-only div navigation.
- Pricing tiers are `section` elements with labelled headings.
- The mark's text is exposed to assistive tech through the wordmark, not only the SVG.

## Already present in the application

- Semantic form controls on auth.
- Dialog, menu, and tooltip primitives from Radix.
- Tables on the kernel page.
- Offline and error boundaries.

## Not claimed

- A high-contrast theme toggle on the public site.
- A full screen-reader pass of every Scholar portal.
- Text spacing at 200% verified in a browser for every authenticated page.
- Automated axe results. None were run in this change.

## Rule

A new interactive control ships with a name, a keyboard path, a visible focus state, and a contrast pair. If it cannot, it does not ship.

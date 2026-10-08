# Sherivs Accessibility System

Target: WCAG 2.2 AA where the control is practical. This is not a conformance certificate. The public notice says that.

## Implemented on the public experience

- Skip link to `#main-content` in the document shell
- One `main` landmark per public view
- Header, footer, and named navigation (`Site`, `Account`, `On this page`, footer columns)
- Heading order: one `h1`, then `h2` sections, then `h3` inside a sequence
- Visible focus using the brass outline
- Mobile navigation is a `details`/`summary` control with a 44px target
- Primary links use a 44px minimum height
- Status and empty results use `role="status"` or `role="alert"`
- The mission sequence and the health status expose text, not color alone
- `prefers-reduced-motion` is honored globally
- Documentation search has a visible label
- The public shell does not use raster images, so it does not ship unlabeled images

## Existing application behavior

The authenticated shell already had a skip target, focus rings, sidebar labels, and keyboard command palette behavior. This program did not re-audit every legacy screen.

## Not done

A high-contrast theme, a text-spacing preference beyond browser zoom, and a formal screen-reader pass of the education portals. Those remain open.

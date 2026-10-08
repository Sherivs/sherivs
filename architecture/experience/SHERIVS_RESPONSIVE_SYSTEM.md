# Sherivs Responsive System

## Targets

Breakpoint tokens (`SHERIVS_BREAKPOINTS`): 360, 390, 430, 768, 1024, 1280, 1440, 1600, plus an ultra layout width (`110rem`). Test expectation: the smallest declared target is 360; 320 is additionally exercised in the axe sweep.

## Layout rules

* Fluid gutter `clamp(1rem, 0.5rem + 2.2vw, 2.5rem)`; `Container` widths: reading `68ch`, content `75rem`, wide `90rem`, ultra `110rem`. Header and footer use the content width so they align with page content; only dedicated wide sections opt in to `wide`.
* Type is fluid via `clamp()`; `h1` uses `sv-hero text-balance` so long titles wrap without overflow.
* Navigation: full header nav from `lg`; below that, a Sheet with registry-derived links. The Sheet and Popover use token z-index variables so they always sit above the sticky header.
* Tables/definition content uses `DefinitionRows` (stacked on narrow viewports) instead of wide tables.
* The `body` element is the scroll container in this app (pre-existing); scripts and tests scroll `document.body`.

## Evidence

* 90 axe page runs including 390px and 320px: 0 horizontal overflow (see `/opt/cursor/artifacts/logs/axe-sweep.log`).
* Playwright runs every LIVE route in desktop and Pixel 5 profiles asserting no horizontal overflow.
* Screenshots: `/opt/cursor/artifacts/screenshots/` (1440 and 390, light/dark).

## Not covered

Tablet (768/1024) visual review, landscape phones, ultra-wide (>1600) review, and the authenticated portals, which retain their pre-existing responsive behavior. Native mobile (`mobile/`) screens were inventoried (11) but not redesigned.

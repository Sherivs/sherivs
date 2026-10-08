# SHERIVS Responsive System

Version: V1 foundation (2026-10-08) · Classification: **V1**

## 1. Breakpoints (designed, not just scaled)

360 · 390 · 430 (phones) · 768 (tablet) · 1024 (laptop) · 1280 / 1440
(desktop) · 1600 / 1920 (large) · 2560+ (ultrawide, max-measure contained).

## 2. Shell behaviors

| Viewport | Public shell | App shell |
|---|---|---|
| ≤430 | hamburger → full menu; stacked CTAs; footer single column | bottom nav for top destinations; sidebar becomes drawer + scrim; tables → responsive cards/lists |
| 768 | condensed nav; 2-col grids | drawer sidebar; collapsible off; secondary panels become sheets |
| 1024+ | full primary nav | docked collapsible sidebar; secondary panels dock right |
| 1440+ | max-6xl measure | max-6xl content measure, panels overlay |
| 2560+ | centered, contained | centered, contained — never full-bleed text |

## 3. Rules

- Mobile is its own IA: bottom navigation, command access, sheets, mobile
  drawers, compact cards, mobile search, push + offline + install states.
- Tables never squeeze: horizontal scroll with sticky first column, or
  card transformation — decided per view, tested at 360px.
- Touch targets ≥ 44px; hover-only information is a defect (must have
  tap/focus equivalents).
- Responsive assets: images sized per viewport, fonts subset, routes
  code-split, prefetch on intent.

# Sherivs Design System

**Version-target:** ACTIVE-V1  
**Implementation:** `frontend/src/styles.css`, `frontend/src/lib/experience/sherivs-tokens.ts`, shadcn/ui + Radix + Lucide

## Intent

Communicate intelligence, precision, trust, depth, infrastructure, calm, future, authority, and humanity. Not luxury decoration. Not navy-glass fashion.

## Foundations

| Token | Role |
|---|---|
| `--sv-foundation` | Graphite plane |
| `--sv-surface` / `--sv-surface-raised` | Working planes |
| `--sv-ink` | Warm primary text |
| `--sv-signal` | Interactive intelligence accent (sparse) |
| `--sv-evidence` | Provenance |
| `--sv-verification` | Approved / verified |

Light and dark are first-class. Organization brand injects `--tenant-primary` / `--tenant-secondary` and must not replace semantic danger/success/focus.

## Typography

Roles: display, hero, h1–h4, body, small, caption, label, code, data, metric.  
Families: Plus Jakarta Sans (display), Inter (body), ui-monospace (code/data).

## Iconography

Lucide only in product UI. Sizes 14 / 16 / 20. Semantic color from tokens, not per-icon fashion.

## Motion

Durations: instant 50ms, fast 120ms, normal 200ms, slow 320ms. Easing `cubic-bezier(0.16, 1, 0.3, 1)`. Reduced motion is global.

## Components

Product primitives remain shadcn/ui. Public/experience primitives live under `frontend/src/components/sherivs-public/` (brand, shell, interior, empty). Application chrome lives under `frontend/src/components/shell/`.

Glass utilities (`uos-glass`) are reserved for overlays; `uos-card` is a raised solid plane.

## Anti-patterns

Generic gradient heroes, rainbow glows, fake statistics, testimonial carousels, endless card grids, AI orbs, invented social proof.

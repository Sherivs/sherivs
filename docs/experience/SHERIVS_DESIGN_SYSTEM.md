# Sherivs Design System

Version target: **V1**.

## Intent

The visual language should read as an instrument for an institution: warm paper, warm ink, a single verdigris signal, brass only as a secondary mark. Depth comes from rules, measure, and sequence — reality, then intelligence, then action, then evidence — not from stacked translucent cards.

## Tokens

Typed contract: `frontend/src/lib/experience/sherivs-tokens.ts`.
CSS variables: `frontend/src/styles.css`.

| Token | Light | Dark |
| --- | --- | --- |
| Background | `#f3efe6` | `#121410` |
| Surface | `#fbf9f4` | `#1a1d18` |
| Ink | `#1a1814` | `#f3efe6` |
| Signal | `#1a4f45` | `#9dcec2` |
| Signal ink | `#f7f4ee` | `#10211c` |
| Brass | `#8c6b3e` | `#d7b98a` |

Organization brand still overrides `--tenant-primary` and `--tenant-secondary` at runtime. The platform defaults above apply when an organization has not set a color. Organization color must not remove focus visibility or body contrast; that remains an open enforcement gap if a tenant picks a low-contrast pair.

## Type

| Role | Size |
| --- | --- |
| Display | `clamp(3.25rem, 11vw, 7.25rem)` |
| Hero / article title | `clamp(2rem, 4vw, 3.25rem)` |
| Body | 1.0625rem, measure under 62ch |
| Label | 0.72rem monospace, tracked uppercase |

Display and UI faces are Plus Jakarta Sans and Inter, already loaded. A new webfont was not added.

## Theme

`light`, `dark`, and `system` already exist (`frontend/src/lib/theme.ts`). The document root defaults to light. Dark keeps the ink surfaces. High-contrast mode exists as a token function in the older experience platform module and is not yet a user-facing control on the public site.

## Motion

Durations: 120ms, 200ms, 360ms. Easing is a calm ease-out, not a spring bounce on the public site. `prefers-reduced-motion: reduce` collapses animation and transition duration.

## When not to use a card

Use a definition list for capabilities. Use a numbered process for mission stages. Use a full page for a policy. Use the command palette for an action. Use a table when the kernel page is comparing many phase rows — that page already does.

# Sherivs Design System

**Code source of truth:** `frontend/src/styles.css` plus `frontend/src/lib/experience/experience-platform.ts`.

## Intent

Intelligence, precision, trust, depth, infrastructure, calm, authority, humanity. Not luxury decoration. Not glassmorphism-as-brand. Not a card grid.

## Tokens

| Token | Role |
|---|---|
| `--sherivs-ink` | Authority / primary on public |
| `--sherivs-paper` | Public paper ground |
| `--sherivs-fog` | Recessed plane |
| `--sherivs-signal` | Intelligence accent |
| `--sherivs-evidence` | Verification |
| `--font-serif` | Source Serif 4 — public display |
| `--font-display` | Plus Jakarta Sans — titles |
| `--font-sans` | Inter — UI |
| `--font-mono` | IBM Plex Mono — data, provenance |
| `--ring` | Focus (Sherivs signal, not tenant teal) |

Public plane (`.sherivs-public`) uses ink/paper and does not inherit tenant fashion colors.

Application plane keeps light/dark/system (`@/lib/theme`) with tenant primary as identity overlay.

## Type roles

Display/Hero (serif on public), H1–H4 (display), Body, Small, Caption, Label, Code, Data, Metric.

## Spatial contract

Reality → Intelligence → Action → Evidence. Prefer lists, tables, planes, and process strips over equal card grids.

## Iconography

Lucide only in product UI. Stroke and size follow existing shadcn/new-york. Brand mark is the three-plane `SherivsMark`.

## Theming

Light / dark / system. High contrast and compact density via `html` data attributes. Organization brand tokens must not replace focus or destructive/success semantics.

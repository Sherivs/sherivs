# SHERIVS Design System v1.0

**Status:** FOUNDATION RATIFIED · **Version-target:** V1
Implementation: `frontend/src/styles.css` (structural tokens + `SHERIVS EXPERIENCE
TOKENS` block), `frontend/src/components/sherivs/*`, `frontend/src/lib/experience/*`
(typed semantic contracts). Full component catalog with per-component anatomy is a
scheduled follow-up (`SHERIVS_COMPONENT_CATALOG.md`).

---

## 1. Design intent

Visual language: INTELLIGENCE · PRECISION · TRUST · DEPTH · INFRASTRUCTURE ·
CALM · FUTURE · AUTHORITY · HUMANITY. Deep neutral foundations with restrained
luminous accents (`--sherivs-accent #38e1c6` / deep `#0d9488`), subtle atmospheric
gradients, precision borders, controlled translucency.

**Glass is a spatial tool, not the brand.** Translucency applies ONLY to overlay /
navigation layers (shell header via `.sherivs-overlay-glass`, drawers, command
palette, sheets). Content cards are solid surfaces. Rainbow gradients, glow
excess, orb/particle decoration and glass-everywhere are prohibited.

---

## 2. Tokens (canonical, in `styles.css`)

| Family | Tokens | Notes |
|--------|--------|-------|
| Brand | `--sherivs-accent`, `--sherivs-accent-deep`, `--sherivs-gold`, `--sherivs-depth-0/1/2` | accents never carry body text |
| Intelligence states | `--sherivs-observation/inference/recommendation/action/evidence/verified/unverified/denied` | AI-output trust made visible; see §5 |
| Narrative | `--sherivs-narrative-gap`, `--sherivs-measure: 68ch`, `--sherivs-eyebrow-tracking` | public reading rhythm |
| Motion | `--sherivs-duration-instant/fast/rise`, `--sherivs-ease-rise/settle` | calm physics only |
| Inherited | radius scale, spacing scale, status colors, elevation, type scale, tenant `--tenant-primary/secondary` | structural block above; never overridden by brand |

No one-off values without justification. Org brand arrives only through the
controlled `--tenant-*` layer and must never destroy contrast or usability.

---

## 3. Typography

Display/hero/H1–H4: `Plus Jakarta Sans`, `-0.02em` tracking. Body/small/caption/
label/code/data/metric: `Inter` with `cv02–cv04`. Fluid display scale
(`--text-display` clamp) + mobile clamp-down for H1–H3. Tables keep tabular
reading; 16px minimum inputs on mobile (no iOS zoom).

## 4. Spatial system

Planes: depth-0 page → depth-1 surface → depth-2 elevated → overlay glass →
command/AI layer. Information flows REALITY → INTELLIGENCE → ACTION → EVIDENCE
down the page; negative space and density transitions (not card grids) create
hierarchy. Layout is chosen by IA: card / list / table / timeline / panel /
split / full-page / drawer / command — never cards-by-default.

## 5. Intelligence states (mandatory in AI surfaces)

`observation` (sky) · `inference` (violet) · `recommendation` (amber) ·
`action` (teal) · `evidence`/`verified` (green) · `unverified` (amber) ·
`denied` (red). Rendered via `.sherivs-ai-mark[data-kind]` and `AiStateMark`;
evidence via `.sherivs-evidence-tag` / `EvidenceTag` with `verified/unverified/
denied` states. Animations represent real backend state; never imply reasoning
that is not processing.

## 6. Motion

Page/section arrival: `sherivs-rise` (420ms, expo-out). Hover/focus/press:
150–200ms settles. Live worker/mission state: `sherivs-live-pulse` (2.4s) —
reserved for LIVE state only. `prefers-reduced-motion` collapses all
intelligence motion to instant state. No bounce, no particles, no parallax,
no slow transitions.

## 7. Responsive

Breakpoints 360 / 390 / 430 / 768 / 1024 / 1280 / 1440 / 1600 / 1920 / 2560+.
Mobile is its own IA (bottom nav, sheets, thumb targets ≥44px, responsive
tables via `.uos-scroll-x`, scrollable tab strips) — never a shrunk desktop.

## 8. Accessibility (target WCAG 2.2 AA)

Keyboard-first command/search, visible focus (`:focus-visible` tenant-teal),
semantic landmarks + labelled headings (public site tests enforce), skip links,
screen-reader announcements for errors/async state, contrast-checked tokens
(`lib/experience` carries WCAG contrast math + high-contrast overrides),
reduced-motion support, text-scaling-safe layouts. Full system doc
(`SHERIVS_ACCESSIBILITY_SYSTEM.md`) is scheduled; gates apply now.

## 9. Theming

`dark` (default, deep navy) · `light` (off-white structural override) ·
`system` · org brand-token layer. High-contrast overrides built into the
experience contracts.

## 10. System states

Every component specifies: default, hover, focus, active, disabled, loading
(skeleton/shimmer), success, error, warning, empty (`uos-empty`,
`planned-capability-state`), partial, offline, unauthorized, forbidden,
expired, stale. Happy-path-only design is incomplete by definition.

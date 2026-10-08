# SHERIVS DESIGN SYSTEM
## Foundations, Design Tokens, Spatial Math & Visual Language
**Document Identifier:** SDS-2026-V1  
**Product Category:** Institutional Intelligence Infrastructure  
**Aesthetic Core:** Deep Neutrality · Luminous Precision · Layered Spatiality  

---

## 1. Proprietary Visual Language

Sherivs is visually defined by a disciplined, architectural aesthetic engineered for high-density cognitive work.

### Core Visual Principles
- **Deep Neutral Foundations:** Dark mode uses obsidian, slate-navy, and cold steel hues (`#050811`, `#090e1a`, `#0f172a`), avoiding muddy grays or harsh pitch black. Light mode uses crystalline zinc and platinum (`#f8fafc`, `#ffffff`, `#f1f5f9`).
- **Luminous Intelligent Accents:** Strategic use of cyan-emerald (`#06b6d4`, `#10b981`), cobalt blue (`#2563eb`, `#3b82f6`), and amber/violet warning indicators (`#f59e0b`, `#8b5cf6`).
- **Precision Borders:** 1px hairline borders (`rgba(255, 255, 255, 0.08)` in dark, `rgba(15, 23, 42, 0.08)` in light) define boundaries with absolute crispness.
- **Controlled Translucency:** Translucency is used functionally on elevated header bars, command palettes, and floating action sheets with heavy backdrop saturation (`saturate(180%) blur(20px)`).

---

## 2. Canonical Design Tokens

### Color Palette & Semantic Assignment
```css
/* Surface Tokens */
--sherivs-surface-base:       #050811;  /* Level 0: Global bedrock */
--sherivs-surface-subtle:     #090e1a;  /* Level 1: Sidebar, page backgrounds */
--sherivs-surface-card:       #0d1527;  /* Level 2: Workspaces, cards, tables */
--sherivs-surface-overlay:    #131e36;  /* Level 3: Dropdowns, dialogs, popovers */
--sherivs-surface-elevated:   #1a2848;  /* Level 4: Tooltips, active highlights */

/* Border & Hairline Tokens */
--sherivs-border-subtle:      rgba(255, 255, 255, 0.06);
--sherivs-border-default:     rgba(255, 255, 255, 0.12);
--sherivs-border-strong:      rgba(255, 255, 255, 0.20);
--sherivs-border-active:      rgba(56, 189, 248, 0.50);

/* Brand & Intelligence Tokens */
--sherivs-brand-cyan:         #06b6d4;  /* Primary intelligence signal */
--sherivs-brand-blue:         #2563eb;  /* Structural platform blue */
--sherivs-brand-emerald:      #10b981;  /* Verified evidence & success */
--sherivs-brand-amber:        #f59e0b;  /* Governance warning & pending human check */
--sherivs-brand-rose:         #f43f5e;  /* Critical violation, breach, security deny */
--sherivs-brand-violet:       #8b5cf6;  /* Autonomous worker mission marker */

/* Typography Tokens */
--sherivs-text-primary:       rgba(255, 255, 255, 0.95);
--sherivs-text-secondary:     rgba(255, 255, 255, 0.70);
--sherivs-text-tertiary:      rgba(255, 255, 255, 0.45);
--sherivs-text-muted:         rgba(255, 255, 255, 0.30);
```

### Radius Tokens
- `--radius-xs`: `0.25rem` (4px) — Status tags, badges, keyboard shortcut chips (`kbd`).
- `--radius-sm`: `0.375rem` (6px) — Inputs, select triggers, table row action buttons.
- `--radius-md`: `0.5rem` (8px) — Buttons, navigation items, tooltips.
- `--radius-lg`: `0.75rem` (12px) — Cards, dropdown menus, sheets, popovers.
- `--radius-xl`: `1rem` (16px) — Modals, major workspace containers, command center.
- `--radius-full`: `9999px` — Avatars, pill badges, indicators.

### Shadow & Elevation Tokens
- `--shadow-flat`: `none`
- `--shadow-sm`: `0 1px 2px 0 rgba(0, 0, 0, 0.35)`
- `--shadow-md`: `0 4px 12px -2px rgba(0, 0, 0, 0.5), 0 2px 6px -1px rgba(0, 0, 0, 0.4)`
- `--shadow-lg`: `0 12px 32px -4px rgba(0, 0, 0, 0.65), 0 4px 12px -2px rgba(0, 0, 0, 0.45)`
- `--shadow-command`: `0 24px 64px -12px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(255, 255, 255, 0.12)`
- `--shadow-glow-cyan`: `0 0 20px -4px rgba(6, 182, 212, 0.35)`

---

## 3. Typography Scale & Families

### Font Families
- **Display & Section Headers:** `"Plus Jakarta Sans"`, system-ui, -apple-system, sans-serif.  
  *Characteristics:* Clean geometric construction, tall x-height, authoritative presence.
- **Interface & Body Typography:** `"Inter"`, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif.  
  *Characteristics:* Optical legibility, tabular numerals (`tnum`), zero letter collisions.
- **Code, Evidence & Telemetry:** `"JetBrains Mono"`, "Fira Code", monospace.  
  *Characteristics:* Distinct punctuation, slashed zeros, tabular alignment for hash comparisons.

### Type Scale
| Level | Font Size | Line Height | Tracking | Weight | Usage |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Display Hero** | `3.75rem` (60px) | `1.1` | `-0.035em` | 800 | Public homepage hero |
| **Hero 2** | `3.00rem` (48px) | `1.15` | `-0.03em` | 700 | Solution/Platform page hero |
| **Heading 1** | `2.25rem` (36px) | `1.2` | `-0.025em` | 700 | Workspace titles, major section headers |
| **Heading 2** | `1.50rem` (24px) | `1.3` | `-0.02em` | 600 | Panel titles, mission titles |
| **Heading 3** | `1.25rem` (20px) | `1.4` | `-0.015em` | 600 | Card titles, group headings |
| **Heading 4** | `1.00rem` (16px) | `1.4` | `-0.01em` | 600 | Subsection headers, table column groups |
| **Body Large** | `1.125rem` (18px) | `1.55`| `-0.01em` | 400 | Editorial leads, mission descriptions |
| **Body Default**| `0.875rem` (14px) | `1.5` | `normal` | 400 | Standard UI text, descriptions, table cells |
| **Body Small**  | `0.8125rem` (13px)| `1.45`| `normal` | 400 | Secondary metadata, timestamps, hints |
| **Caption**     | `0.75rem` (12px) | `1.4` | `+0.01em`| 500 | Labels, status badges, breadcrumbs |
| **Micro/Data**  | `0.6875rem` (11px)| `1.3` | `+0.03em`| 600 | Metric uppercase tags, hash tokens |
| **Monospace**   | `0.8125rem` (13px)| `1.4` | `normal` | 500 | Code snippets, cryptographic evidence |

---

## 4. Spacing, Rhythm & Layout Grid

### Spatial Scale (8-Point Grid with 4-Point Subdivisions)
- `space-1`: `0.25rem` (4px) — Tight icon/text gap, status dot margin.
- `space-2`: `0.5rem` (8px) — Button padding-y, form field vertical spacing.
- `space-3`: `0.75rem` (12px) — Card internal padding (compact), list row gap.
- `space-4`: `1.0rem` (16px) — Standard component padding, gutter spacing.
- `space-6`: `1.5rem` (24px) — Card padding (standard), workspace section margins.
- `space-8`: `2.0rem` (32px) — Large grid gap, panel separation.
- `space-12`: `3.0rem` (48px) — Major workspace section margins.
- `space-16`: `4.0rem` (64px) — Marketing section vertical rhythm.
- `space-24`: `6.0rem` (96px) — Public page hero spacing.

### Responsive Breakpoints
- `mobile`: `360px` – `430px` (Single column, bottom navigation, drawer sheets)
- `tablet`: `768px` – `1023px` (Collapsible sidebar, 2-column grids)
- `desktop`: `1024px` – `1439px` (Permanent sidebar, master-detail inspect panes)
- `wide`: `1440px` – `1919px` (Expanded canvas, 4-column metric distribution)
- `ultrawide`: `1920px`+ (Max-width bounded containers `1600px` with peripheral telemetry)

---

## 5. Controlled Theming System

### Multi-Theme Architecture
Sherivs natively supports three system themes:
1. **Dark (Default/Canonical):** Deep navy-obsidian background optimized for reduced eye fatigue during extended mission command.
2. **Light:** Ultra-crisp architectural slate and white for high-ambient daylight operations.
3. **High-Contrast Accessibility Mode:** Pure black/white borders with minimum 7:1 contrast ratios.

### Tenant Brand Injection Token Rules
When an organization configures primary/secondary brand colors:
- Brand colors are applied strictly to **accent indicators**, **primary CTA actions**, and **active tab underlines**.
- Tenant colors may **never** overwrite structural background contrasts, body text legibility, or error/warning semantic cues.

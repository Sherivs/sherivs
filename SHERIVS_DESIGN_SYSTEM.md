# SHERIVS DESIGN SYSTEM SPECIFICATION (SDS-v1.0)
**System:** Sherivs Design Tokens, Primitives, and Theme System  
**Framework Target:** Tailwind CSS v4 / Radix UI / React 19  
**Status:** Canonical Reference Specification  

---

## 1. Token Taxonomy

The Sherivs Design System is organized into four distinct token tiers:
1. **Global Constants:** Raw color values, scale coordinates, and mathematical intervals.
2. **Semantic Primitives:** Meaning-bound tokens mapped to UI intent (e.g., `--color-primary`, `--surface-base`).
3. **Component Tokens:** Specific parameters governing discrete controls (e.g., `--btn-height-md`, `--card-elevation-l2`).
4. **Tenant Accent Layer:** Dynamic variables injected onto `:root` (`--tenant-primary`, `--tenant-secondary`) that allow institutional personalization without compromising contrast or system stability.

---

## 2. Color Palette & Spatial Scales

### Neutral Foundation (Dark Mode Default)
```css
:root {
  /* Depth Spectrum */
  --sherivs-black: #030508;       /* Deepest data well */
  --surface-0: #05070c;           /* L-1: Terminal wells */
  --surface-1: #07090e;           /* L0: Root viewport canvas */
  --surface-2: #0c1019;           /* L1: Application shell headers, sidebars */
  --surface-3: #111726;           /* L2: Primary content cards, data tables */
  --surface-4: #182033;           /* L3: Drawers, sheets, modals, popovers */
  --surface-5: #1f2a42;           /* L4: Hover overlays, floating tooltips */

  /* Text & Telemetry Contrast */
  --text-primary: rgba(255, 255, 255, 0.96);
  --text-secondary: rgba(255, 255, 255, 0.68);
  --text-muted: rgba(255, 255, 255, 0.42);
  --text-disabled: rgba(255, 255, 255, 0.24);

  /* Precision Borders */
  --border-subtle: rgba(255, 255, 255, 0.06);
  --border-medium: rgba(255, 255, 255, 0.12);
  --border-strong: rgba(255, 255, 255, 0.20);
  --border-accent: rgba(0, 240, 255, 0.35);
}
```

### Semantic Accents & Status
```css
:root {
  /* Platform Intelligence (Sherivs Cyan) */
  --sherivs-cyan-500: #00f0ff;
  --sherivs-cyan-600: #0284c7;
  --sherivs-cyan-glow: rgba(0, 240, 255, 0.15);

  /* Cognitive Architecture (Violet) */
  --sherivs-violet-500: #8b5cf6;
  --sherivs-violet-600: #7c3aed;
  --sherivs-violet-glow: rgba(139, 92, 246, 0.15);

  /* Verification & Trust (Emerald) */
  --sherivs-emerald-500: #10b981;
  --sherivs-emerald-600: #059669;
  --sherivs-emerald-glow: rgba(16, 185, 129, 0.15);

  /* Escalation & Risk (Amber) */
  --sherivs-amber-500: #f59e0b;
  --sherivs-amber-600: #d97706;
  --sherivs-amber-glow: rgba(245, 158, 11, 0.15);

  /* Policy Breach & Danger (Rose) */
  --sherivs-rose-500: #f43f5e;
  --sherivs-rose-600: #e11d48;
  --sherivs-rose-glow: rgba(244, 63, 94, 0.15);
}
```

### Light Mode Adaptation (Architectural Off-White)
```css
.light {
  --surface-0: #ecece8;
  --surface-1: #f5f5f2;
  --surface-2: #ffffff;
  --surface-3: #fcfcfb;
  --surface-4: #f0f0eb;
  --surface-5: #e4e4dd;

  --text-primary: rgba(10, 15, 26, 0.95);
  --text-secondary: rgba(10, 15, 26, 0.65);
  --text-muted: rgba(10, 15, 26, 0.45);
  --text-disabled: rgba(10, 15, 26, 0.25);

  --border-subtle: rgba(10, 15, 26, 0.08);
  --border-medium: rgba(10, 15, 26, 0.16);
  --border-strong: rgba(10, 15, 26, 0.24);
}
```

---

## 3. Typography Hierarchy

| Level | Size | Line Height | Tracking | Weight | Target Usage |
|---|---|---|---|---|---|
| **Display** | 3.5rem (56px) | 1.1 | -0.04em | 700 / 800 | Public homepage hero, primary statements |
| **H1** | 2.5rem (40px) | 1.15 | -0.03em | 700 | Main workspace dashboards, major section titles |
| **H2** | 1.75rem (28px) | 1.25 | -0.02em | 600 | Page titles, drawer headers, card group titles |
| **H3** | 1.25rem (20px) | 1.4 | -0.01em | 600 | Sub-panel titles, modal headers, metric headers |
| **H4** | 1.0rem (16px) | 1.5 | 0.0 | 600 | Form field group headers, list section headers |
| **Body Large** | 1.0rem (16px) | 1.6 | 0.0 | 400 | Editorial leads, overview summaries |
| **Body Base** | 0.875rem (14px) | 1.5 | 0.0 | 400 / 500 | Default UI text, table cells, form labels |
| **Small / Caption**| 0.75rem (12px) | 1.4 | +0.02em | 400 / 500 | Secondary descriptions, timestamps, metadata |
| **Micro / Eyebrow**| 0.6875rem (11px)| 1.3 | +0.08em | 600 | Status pills, table headers, uppercase eyebrows |
| **Mono / Code** | 0.8125rem (13px)| 1.4 | 0.0 | 400 / 500 | Hashes, IDs, JSON payloads, metrics |

---

## 4. Spacing & Radius Rhythm

- **Spacing Grid:** 4px base step (`4px`, `8px`, `12px`, `16px`, `24px`, `32px`, `48px`, `64px`, `96px`).
- **Corner Radii:**
  - Micro badges / tags: `4px`
  - Form inputs & buttons: `8px` (`0.5rem`)
  - Sub-cards & dropdowns: `12px` (`0.75rem`)
  - Elevated content cards: `16px` (`1.0rem`)
  - Modal sheets / drawers: `20px` (`1.25rem`)
  - Full-screen dialogue containers: `24px` (`1.5rem`)

---

## 5. Interaction States & Transitions

Every interactive primitive in Sherivs implements 8 explicit interaction states:
1. **Default:** Stable elevation, neutral border.
2. **Hover:** Elevation rise (+1 tier), subtle border brightness increase, zero jumpy scale changes.
3. **Focus-Visible:** 2px solid `--sherivs-cyan-500` ring with a 2px offset; never hidden on keyboard interaction.
4. **Active / Pressed:** 1px downward translation or background tint deepening.
5. **Disabled:** 40% opacity, pointer-events none, `aria-disabled="true"`.
6. **Loading:** Skeletal shimmer or deterministic progress track; interactive controls show embedded micro-spinners without shifting width.
7. **Success / Verified:** Immediate emerald perimeter pulse and checkmark indicator.
8. **Error / Rejected:** Rose border flash and localized error description linked via `aria-describedby`.

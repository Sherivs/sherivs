/**
 * Sherivs design token contracts (Phase 24 / Experience Architecture).
 *
 * Typed token catalog consumed by tests and documentation. Runtime CSS lives
 * in `frontend/src/styles.css`. Values here must stay aligned with that file.
 *
 * Domain-neutral: no runtime, tenant, or role vocabulary.
 */
export type SherivsTokenCategory =
  | "color"
  | "typography"
  | "spacing"
  | "radius"
  | "shadow"
  | "blur"
  | "opacity"
  | "z-index"
  | "motion"
  | "breakpoint"
  | "density"
  | "layout"
  | "surface"
  | "border"
  | "focus";

export interface SherivsToken {
  readonly id: string;
  readonly category: SherivsTokenCategory;
  readonly cssVar: string;
  readonly value: string;
  readonly purpose: string;
}

export const SHERIVS_COLOR_TOKENS: readonly SherivsToken[] = [
  {
    id: "foundation",
    category: "color",
    cssVar: "--sv-foundation",
    value: "#08090c",
    purpose: "Deep neutral foundation — institutional depth, not navy-glass fashion",
  },
  {
    id: "surface",
    category: "surface",
    cssVar: "--sv-surface",
    value: "#101218",
    purpose: "Primary working plane",
  },
  {
    id: "surface-raised",
    category: "surface",
    cssVar: "--sv-surface-raised",
    value: "#161922",
    purpose: "Raised plane for focal content",
  },
  {
    id: "ink",
    category: "color",
    cssVar: "--sv-ink",
    value: "#eceae4",
    purpose: "Warm primary ink — humanity against infrastructure",
  },
  {
    id: "signal",
    category: "color",
    cssVar: "--sv-signal",
    value: "#8eb4c9",
    purpose: "Luminous intelligent accent — interactive signal, used sparingly",
  },
  {
    id: "evidence",
    category: "color",
    cssVar: "--sv-evidence",
    value: "#c4a574",
    purpose: "Evidence / provenance accent",
  },
  {
    id: "verification",
    category: "color",
    cssVar: "--sv-verification",
    value: "#7d9a78",
    purpose: "Verification / approved-state accent",
  },
  {
    id: "danger",
    category: "color",
    cssVar: "--sv-danger",
    value: "#d46a6a",
    purpose: "High-contrast semantic danger",
  },
] as const;

export const SHERIVS_TYPE_ROLES = [
  "display",
  "hero",
  "h1",
  "h2",
  "h3",
  "h4",
  "body",
  "small",
  "caption",
  "label",
  "code",
  "data",
  "metric",
] as const;

export type SherivsTypeRole = (typeof SHERIVS_TYPE_ROLES)[number];

export const SHERIVS_BREAKPOINTS = {
  mobileSm: 360,
  mobile: 390,
  mobileLg: 430,
  tablet: 768,
  laptop: 1024,
  desktop: 1280,
  desktopLg: 1440,
  desktopXl: 1600,
  wide: 1920,
  ultrawide: 2560,
} as const;

export const SHERIVS_MOTION = {
  instant: "50ms",
  fast: "120ms",
  normal: "200ms",
  slow: "320ms",
  easing: "cubic-bezier(0.16, 1, 0.3, 1)",
} as const;

export const SHERIVS_COMPONENT_STATES = [
  "default",
  "hover",
  "focus",
  "active",
  "disabled",
  "loading",
  "success",
  "error",
  "warning",
  "empty",
  "partial",
  "offline",
  "unauthorized",
  "forbidden",
  "expired",
  "stale",
] as const;

export type SherivsComponentState = (typeof SHERIVS_COMPONENT_STATES)[number];

export const SHERIVS_LAYOUT_MODES = [
  "card",
  "list",
  "table",
  "timeline",
  "panel",
  "canvas",
  "drawer",
  "modal",
  "full-page",
  "split",
  "command",
] as const;

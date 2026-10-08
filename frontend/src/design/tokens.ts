/**
 * Sherivs design tokens — canonical source of truth.
 *
 * `frontend/src/styles.css` mirrors these values as `--sx-*` custom properties; the
 * conformance test (tests/unit/sherivs-design-tokens.test.ts) fails when the two drift
 * or when a declared text/surface pair falls below WCAG 2.2 AA contrast.
 *
 * Naming: `--sx-<family>-<name>`. Components consume semantic tokens (surface, text,
 * line, signal, intelligence kinds), never the raw ramps.
 */

/** Raw ramps. Only semantic tokens below may reference these. */
export const SX_RAMPS = {
  ink: {
    950: "#07090c",
    900: "#0c1016",
    850: "#11161e",
    800: "#171d27",
    700: "#232b38",
    600: "#343e4e",
    500: "#4b5668",
    400: "#6b7686",
    300: "#9aa3b0",
    200: "#c5cbd3",
    100: "#e4e7eb",
    50: "#f3f4f6",
  },
  paper: { 0: "#fafaf8", 1: "#ffffff", 2: "#f2f2ee" },
  lumen: { 300: "#8fd3ff", 400: "#5cbfff", 500: "#2ea8f5", 600: "#1286d6", 700: "#0b5f9c" },
} as const;

export type SxThemeName = "light" | "dark";

/** Semantic color tokens per theme. Keys become `--sx-<key>`. */
export const SX_COLOR_TOKENS: Record<SxThemeName, Record<string, string>> = {
  light: {
    "surface-0": SX_RAMPS.paper[0],
    "surface-1": SX_RAMPS.paper[1],
    "surface-2": SX_RAMPS.paper[2],
    "surface-inverse": SX_RAMPS.ink[900],
    "text-strong": SX_RAMPS.ink[950],
    "text-default": SX_RAMPS.ink[800],
    "text-muted": SX_RAMPS.ink[500],
    "text-inverse": SX_RAMPS.ink[50],
    "line-subtle": "#e3e3de",
    "line-strong": "#c9c9c2",
    "signal": SX_RAMPS.lumen[700],
    "signal-strong": "#084a7a",
    "signal-contrast": "#ffffff",
    "focus": SX_RAMPS.lumen[600],
    "observation": "#4b5668",
    "inference": "#5b3fc4",
    "recommendation": "#0b5f9c",
    "action": "#8a4b00",
    "evidence": "#0b6b62",
    "verification": "#16703a",
    "danger": "#b42323",
  },
  dark: {
    "surface-0": SX_RAMPS.ink[950],
    "surface-1": SX_RAMPS.ink[900],
    "surface-2": SX_RAMPS.ink[850],
    "surface-inverse": SX_RAMPS.paper[0],
    "text-strong": "#f5f6f8",
    "text-default": SX_RAMPS.ink[100],
    "text-muted": SX_RAMPS.ink[300],
    "text-inverse": SX_RAMPS.ink[950],
    "line-subtle": "#1d2430",
    "line-strong": "#2c3543",
    "signal": SX_RAMPS.lumen[400],
    "signal-strong": SX_RAMPS.lumen[300],
    "signal-contrast": SX_RAMPS.ink[950],
    "focus": SX_RAMPS.lumen[400],
    "observation": SX_RAMPS.ink[300],
    "inference": "#b9a3ff",
    "recommendation": SX_RAMPS.lumen[400],
    "action": "#f2b65a",
    "evidence": "#4fd1c0",
    "verification": "#5ad08b",
    "danger": "#ff7a7a",
  },
};

/**
 * Text/surface pairs that must meet WCAG 2.2 AA. `minimum` is 4.5 for body text and 3
 * for large text and non-text UI (focus rings, icons, borders that convey state).
 */
export const SX_CONTRAST_PAIRS: readonly {
  foreground: string;
  background: string;
  minimum: 3 | 4.5;
}[] = [
  { foreground: "text-strong", background: "surface-0", minimum: 4.5 },
  { foreground: "text-default", background: "surface-0", minimum: 4.5 },
  { foreground: "text-default", background: "surface-1", minimum: 4.5 },
  { foreground: "text-default", background: "surface-2", minimum: 4.5 },
  { foreground: "text-muted", background: "surface-0", minimum: 4.5 },
  { foreground: "text-muted", background: "surface-1", minimum: 4.5 },
  { foreground: "text-muted", background: "surface-2", minimum: 4.5 },
  { foreground: "signal", background: "surface-0", minimum: 4.5 },
  { foreground: "signal", background: "surface-1", minimum: 4.5 },
  { foreground: "signal-contrast", background: "signal", minimum: 4.5 },
  { foreground: "focus", background: "surface-0", minimum: 3 },
  { foreground: "observation", background: "surface-1", minimum: 4.5 },
  { foreground: "inference", background: "surface-1", minimum: 4.5 },
  { foreground: "recommendation", background: "surface-1", minimum: 4.5 },
  { foreground: "action", background: "surface-1", minimum: 4.5 },
  { foreground: "evidence", background: "surface-1", minimum: 4.5 },
  { foreground: "verification", background: "surface-1", minimum: 4.5 },
  { foreground: "danger", background: "surface-1", minimum: 4.5 },
];

/** Type scale. Fluid sizes clamp between 360px and 1440px viewports. */
export const SX_TYPE_SCALE = {
  display: { size: "clamp(2.75rem, 1.6rem + 5.2vw, 6rem)", leading: "0.98", tracking: "-0.04em", weight: "600" },
  hero: { size: "clamp(2.25rem, 1.5rem + 3.4vw, 4.5rem)", leading: "1.02", tracking: "-0.035em", weight: "600" },
  h1: { size: "clamp(2rem, 1.5rem + 2.2vw, 3.25rem)", leading: "1.06", tracking: "-0.03em", weight: "600" },
  h2: { size: "clamp(1.625rem, 1.3rem + 1.4vw, 2.5rem)", leading: "1.1", tracking: "-0.025em", weight: "600" },
  h3: { size: "clamp(1.25rem, 1.1rem + 0.6vw, 1.625rem)", leading: "1.2", tracking: "-0.015em", weight: "600" },
  h4: { size: "1.125rem", leading: "1.3", tracking: "-0.01em", weight: "600" },
  "body-lg": { size: "1.1875rem", leading: "1.6", tracking: "-0.005em", weight: "400" },
  body: { size: "1rem", leading: "1.6", tracking: "0", weight: "400" },
  small: { size: "0.875rem", leading: "1.55", tracking: "0", weight: "400" },
  caption: { size: "0.8125rem", leading: "1.45", tracking: "0.005em", weight: "400" },
  label: { size: "0.75rem", leading: "1.3", tracking: "0.08em", weight: "500" },
  code: { size: "0.8125rem", leading: "1.6", tracking: "0", weight: "400" },
  data: { size: "0.875rem", leading: "1.4", tracking: "0", weight: "500" },
  metric: { size: "clamp(1.75rem, 1.4rem + 1.4vw, 2.75rem)", leading: "1", tracking: "-0.03em", weight: "500" },
} as const;

export const SX_FONT_FAMILIES = {
  display: '"Inter Tight", "Inter", ui-sans-serif, system-ui, sans-serif',
  text: '"Inter", ui-sans-serif, system-ui, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
} as const;

/** 4px base spacing scale. */
export const SX_SPACE = {
  0: "0",
  1: "0.25rem",
  2: "0.5rem",
  3: "0.75rem",
  4: "1rem",
  5: "1.25rem",
  6: "1.5rem",
  8: "2rem",
  10: "2.5rem",
  12: "3rem",
  16: "4rem",
  20: "5rem",
  24: "6rem",
  32: "8rem",
} as const;

/** Radii are deliberately small: precision over pillowy cards. */
export const SX_RADIUS = { none: "0", xs: "2px", sm: "4px", md: "6px", lg: "10px", pill: "999px" } as const;

export const SX_MOTION = {
  duration: { instant: "80ms", quick: "140ms", base: "200ms", deliberate: "320ms", narrative: "560ms" },
  easing: {
    standard: "cubic-bezier(0.2, 0, 0, 1)",
    enter: "cubic-bezier(0, 0, 0, 1)",
    exit: "cubic-bezier(0.3, 0, 1, 1)",
  },
} as const;

export const SX_Z_INDEX = {
  base: 0,
  raised: 10,
  sticky: 30,
  header: 40,
  overlay: 90,
  dialog: 100,
  toast: 110,
} as const;

export const SX_BREAKPOINTS = {
  "phone-s": 360,
  phone: 390,
  "phone-l": 430,
  tablet: 768,
  laptop: 1024,
  desktop: 1280,
  "desktop-l": 1440,
  wide: 1600,
  "full-hd": 1920,
  ultrawide: 2560,
} as const;

export const SX_LAYOUT = {
  /** Reading measure for long-form text. */
  measure: "68ch",
  /** Content container widths. */
  container: { narrow: "48rem", default: "76rem", wide: "92rem" },
  /** Horizontal gutter, fluid from phone to ultrawide. */
  gutter: "clamp(1.25rem, 0.6rem + 2.6vw, 3.5rem)",
} as const;

export const SX_DENSITY = {
  comfortable: { rowHeight: "3.25rem", controlHeight: "2.75rem" },
  compact: { rowHeight: "2.5rem", controlHeight: "2.25rem" },
} as const;

/** Minimum interactive target size (WCAG 2.2 SC 2.5.8 is 24px; touch surfaces use 44px). */
export const SX_TARGET_SIZE = { pointer: "24px", touch: "44px" } as const;

/** Relative luminance per WCAG 2.x for a #rrggbb color. */
export function relativeLuminance(hex: string): number {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const [light, dark] = a > b ? [a, b] : [b, a];
  return (light + 0.05) / (dark + 0.05);
}

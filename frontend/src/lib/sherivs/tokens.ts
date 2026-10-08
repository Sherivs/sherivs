/**
 * Sherivs design tokens — the canonical, typed source.
 *
 * The CSS custom properties in `frontend/src/sherivs.css` are the runtime
 * projection of this module; `tests/unit/sherivs-tokens.test.ts` fails if the
 * two ever disagree, and verifies WCAG contrast for every text/surface pairing
 * declared in `CONTRAST_PAIRS`.
 *
 * Visual language ("Obsidian & Lumen"): deep ink foundations, one luminous
 * signal accent, precise 1px structure, translucency only on overlays. Colour
 * carries meaning (epistemic kind, status), never decoration.
 */

export type ThemeName = "dark" | "light";

/* ───────────── colour ───────────── */

export interface ColorRamp {
  /** Page background behind everything. */
  canvas: string;
  /** Default content ground. */
  ground: string;
  /** Raised panels and cards. */
  raised: string;
  /** Floating layers: menus, popovers, command palette. */
  overlay: string;
  line: string;
  lineStrong: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  /** Brand signal — the one luminous accent. */
  signal: string;
  signalStrong: string;
  onSignal: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
}

export const COLOR: Readonly<Record<ThemeName, ColorRamp>> = {
  dark: {
    canvas: "#07090c",
    ground: "#0b0e13",
    raised: "#10141b",
    overlay: "#161b24",
    line: "#232a36",
    lineStrong: "#323b4b",
    text: "#e8ecf2",
    textSecondary: "#a3adbd",
    textTertiary: "#8591a4",
    signal: "#4cc2ff",
    signalStrong: "#8bd7ff",
    onSignal: "#04131c",
    success: "#3dd68c",
    warning: "#f2b84b",
    danger: "#ff7a7a",
    info: "#7fb0ff",
  },
  light: {
    canvas: "#f5f4f0",
    ground: "#fbfaf8",
    raised: "#ffffff",
    overlay: "#ffffff",
    line: "#e2dfd8",
    lineStrong: "#cfcbc1",
    text: "#12151b",
    textSecondary: "#434c5c",
    textTertiary: "#5f6879",
    signal: "#0b6fa4",
    signalStrong: "#08577f",
    onSignal: "#ffffff",
    success: "#0e7a4b",
    warning: "#8a5a00",
    danger: "#b42318",
    info: "#1d5fc4",
  },
};

/**
 * Epistemic kinds — how Sherivs makes the *status of a statement* visible.
 * Distinguished by label + glyph + rule, never colour alone.
 */
export const EPISTEMIC_KINDS = [
  "observation",
  "inference",
  "recommendation",
  "action",
  "evidence",
  "verification",
] as const;
export type EpistemicKind = (typeof EPISTEMIC_KINDS)[number];

export const EPISTEMIC_COLOR: Readonly<Record<ThemeName, Record<EpistemicKind, string>>> = {
  dark: {
    observation: "#a9b6c9",
    inference: "#b9a2ff",
    recommendation: "#f2b84b",
    action: "#4cc2ff",
    evidence: "#4fd1c5",
    verification: "#3dd68c",
  },
  light: {
    observation: "#4d586a",
    inference: "#5b3fb0",
    recommendation: "#8a5a00",
    action: "#0b6fa4",
    evidence: "#0b6b63",
    verification: "#0e7a4b",
  },
};

/** The four planes the interface moves through: Reality → Intelligence → Action → Evidence. */
export const PLANES = ["reality", "intelligence", "action", "evidence"] as const;
export type Plane = (typeof PLANES)[number];

export const PLANE_TO_KIND: Readonly<Record<Plane, EpistemicKind>> = {
  reality: "observation",
  intelligence: "inference",
  action: "action",
  evidence: "evidence",
};

/** Foreground/background pairings the system promises are AA-legible. */
export const CONTRAST_PAIRS: readonly {
  readonly fg: keyof ColorRamp;
  readonly bg: keyof ColorRamp;
  readonly min: number;
}[] = [
  { fg: "text", bg: "canvas", min: 7 },
  { fg: "text", bg: "ground", min: 7 },
  { fg: "text", bg: "raised", min: 7 },
  { fg: "text", bg: "overlay", min: 7 },
  { fg: "textSecondary", bg: "ground", min: 4.5 },
  { fg: "textSecondary", bg: "raised", min: 4.5 },
  { fg: "textTertiary", bg: "ground", min: 4.5 },
  { fg: "textTertiary", bg: "raised", min: 4.5 },
  { fg: "signal", bg: "ground", min: 4.5 },
  { fg: "signal", bg: "raised", min: 4.5 },
  { fg: "onSignal", bg: "signal", min: 4.5 },
  { fg: "success", bg: "ground", min: 4.5 },
  { fg: "warning", bg: "ground", min: 4.5 },
  { fg: "danger", bg: "ground", min: 4.5 },
  { fg: "info", bg: "ground", min: 4.5 },
];

/* ───────────── typography ───────────── */

export const FONT_FAMILY = {
  sans: '"Geist Variable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  mono: '"Geist Mono Variable", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
} as const;

export interface TypeStyle {
  /** CSS clamp() or rem — fluid where it serves the surface. */
  size: string;
  line: string;
  tracking: string;
  weight: number;
  family: keyof typeof FONT_FAMILY;
  features?: string;
}

export const TYPE_SCALE = {
  display: { size: "clamp(2.75rem, 1.6rem + 5.2vw, 6rem)", line: "0.98", tracking: "-0.045em", weight: 600, family: "sans" },
  hero: { size: "clamp(2.25rem, 1.5rem + 3.4vw, 4.25rem)", line: "1.02", tracking: "-0.04em", weight: 600, family: "sans" },
  h1: { size: "clamp(1.75rem, 1.35rem + 1.7vw, 2.75rem)", line: "1.08", tracking: "-0.032em", weight: 600, family: "sans" },
  h2: { size: "clamp(1.375rem, 1.15rem + 1vw, 2rem)", line: "1.15", tracking: "-0.026em", weight: 600, family: "sans" },
  h3: { size: "1.25rem", line: "1.25", tracking: "-0.018em", weight: 600, family: "sans" },
  h4: { size: "1rem", line: "1.35", tracking: "-0.01em", weight: 600, family: "sans" },
  body: { size: "1rem", line: "1.6", tracking: "-0.003em", weight: 400, family: "sans" },
  small: { size: "0.875rem", line: "1.5", tracking: "0", weight: 400, family: "sans" },
  caption: { size: "0.75rem", line: "1.45", tracking: "0.005em", weight: 400, family: "sans" },
  label: { size: "0.6875rem", line: "1.2", tracking: "0.12em", weight: 500, family: "mono" },
  code: { size: "0.8125rem", line: "1.6", tracking: "0", weight: 400, family: "mono" },
  data: { size: "0.875rem", line: "1.4", tracking: "0", weight: 450, family: "mono", features: '"tnum" 1, "zero" 1' },
  metric: { size: "clamp(1.75rem, 1.4rem + 1.4vw, 2.5rem)", line: "1", tracking: "-0.03em", weight: 600, family: "sans", features: '"tnum" 1' },
} as const satisfies Record<string, TypeStyle>;
export type TypeToken = keyof typeof TYPE_SCALE;

/* ───────────── space, shape, depth ───────────── */

/** 4px grid. Keys are the multiplier; values are rem. */
export const SPACE = {
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

export const RADIUS = {
  xs: "2px",
  sm: "4px",
  md: "6px",
  lg: "10px",
  xl: "14px",
  pill: "9999px",
} as const;

export const SHADOW = {
  dark: {
    e1: "0 1px 0 rgb(255 255 255 / 0.03) inset, 0 1px 2px rgb(0 0 0 / 0.5)",
    e2: "0 8px 24px -8px rgb(0 0 0 / 0.6)",
    e3: "0 24px 64px -16px rgb(0 0 0 / 0.75)",
  },
  light: {
    e1: "0 1px 2px rgb(18 21 27 / 0.06)",
    e2: "0 8px 24px -8px rgb(18 21 27 / 0.14)",
    e3: "0 24px 64px -16px rgb(18 21 27 / 0.22)",
  },
} as const;

export const BLUR = { overlay: "16px", scrim: "6px" } as const;
export const OPACITY = { disabled: 0.45, scrim: 0.6, ghost: 0.08 } as const;

/** Stacking order. One-off z-index values are not allowed (see sherivs-tokens test). */
export const Z_INDEX = {
  base: 0,
  raised: 10,
  sticky: 100,
  header: 200,
  sidebar: 300,
  dropdown: 400,
  overlay: 500,
  modal: 600,
  toast: 700,
  command: 800,
  skipLink: 900,
} as const;

/* ───────────── motion ───────────── */

export const DURATION_MS = { instant: 0, fast: 120, base: 200, slow: 320, deliberate: 480 } as const;
export const EASING = {
  standard: "cubic-bezier(0.2, 0, 0, 1)",
  emphasized: "cubic-bezier(0.16, 1, 0.3, 1)",
  exit: "cubic-bezier(0.4, 0, 1, 1)",
} as const;

/* ───────────── layout, breakpoints, density, focus ───────────── */

/** Designed, not derived: each width gets its own layout decision (see responsive doc). */
export const BREAKPOINTS_PX = {
  s360: 360,
  s390: 390,
  s430: 430,
  tablet: 768,
  laptop: 1024,
  desktop: 1280,
  wide: 1440,
  xwide: 1600,
  hd: 1920,
  ultrawide: 2560,
} as const;

export const DENSITY_ROW_PX = { compact: 32, comfortable: 40, spacious: 48 } as const;

export const LAYOUT = {
  headerHeight: "3.5rem",
  sidebarWidth: "16.5rem",
  sidebarCollapsedWidth: "4rem",
  bottomNavHeight: "4rem",
  contentReadable: "68ch",
  pageMax: "75rem",
  pageMaxWide: "90rem",
  minTouchTarget: "2.75rem",
} as const;

export const FOCUS = { width: "2px", offset: "2px" } as const;

/** Minimum interactive target, in CSS px (WCAG 2.2 AA is 24; Sherivs promises 44 on touch). */
export const MIN_TOUCH_TARGET_PX = 44;

/* ───────────── CSS projection (used by tests; CSS file is authored to match) ───────────── */

/** Flat map of `--sv-*` custom property → value for a theme. Mirrors `sherivs.css`. */
export function cssVariables(theme: ThemeName): Record<string, string> {
  const c = COLOR[theme];
  const e = EPISTEMIC_COLOR[theme];
  const vars: Record<string, string> = {
    "--sv-canvas": c.canvas,
    "--sv-ground": c.ground,
    "--sv-raised": c.raised,
    "--sv-overlay": c.overlay,
    "--sv-line": c.line,
    "--sv-line-strong": c.lineStrong,
    "--sv-text": c.text,
    "--sv-text-2": c.textSecondary,
    "--sv-text-3": c.textTertiary,
    "--sv-signal": c.signal,
    "--sv-signal-strong": c.signalStrong,
    "--sv-on-signal": c.onSignal,
    "--sv-success": c.success,
    "--sv-warning": c.warning,
    "--sv-danger": c.danger,
    "--sv-info": c.info,
    "--sv-shadow-1": SHADOW[theme].e1,
    "--sv-shadow-2": SHADOW[theme].e2,
    "--sv-shadow-3": SHADOW[theme].e3,
  };
  for (const kind of EPISTEMIC_KINDS) vars[`--sv-kind-${kind}`] = e[kind];
  return vars;
}

/** Theme-independent variables (space, radius, motion, z-index, layout). */
export function cssStaticVariables(): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [k, v] of Object.entries(RADIUS)) vars[`--sv-radius-${k}`] = v;
  for (const [k, v] of Object.entries(Z_INDEX)) vars[`--sv-z-${k}`] = String(v);
  for (const [k, v] of Object.entries(DURATION_MS)) vars[`--sv-dur-${k}`] = `${v}ms`;
  for (const [k, v] of Object.entries(EASING)) vars[`--sv-ease-${k}`] = v;
  for (const [k, v] of Object.entries(SPACE)) vars[`--sv-space-${k}`] = v;
  vars["--sv-blur-overlay"] = BLUR.overlay;
  vars["--sv-font-sans"] = FONT_FAMILY.sans;
  vars["--sv-font-mono"] = FONT_FAMILY.mono;
  vars["--sv-header-h"] = LAYOUT.headerHeight;
  vars["--sv-sidebar-w"] = LAYOUT.sidebarWidth;
  vars["--sv-sidebar-w-collapsed"] = LAYOUT.sidebarCollapsedWidth;
  vars["--sv-bottom-nav-h"] = LAYOUT.bottomNavHeight;
  vars["--sv-page-max"] = LAYOUT.pageMax;
  vars["--sv-read-max"] = LAYOUT.contentReadable;
  vars["--sv-focus-w"] = FOCUS.width;
  vars["--sv-focus-offset"] = FOCUS.offset;
  return vars;
}

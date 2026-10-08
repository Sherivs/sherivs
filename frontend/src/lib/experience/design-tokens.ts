/**
 * Sherivs Experience System — design token CONTRACT.
 *
 * The CSS in `frontend/src/styles/sherivs-tokens.css` is the runtime source of
 * truth; this module is the typed declaration of what that file MUST define,
 * grouped by family, so tooling and tests (tests/unit/sherivs-design-tokens.test.ts)
 * can prove the token layer is complete and theme-forked where required.
 *
 * Rules (SHERIVS_DESIGN_SYSTEM.md §2):
 *   - every token is namespaced `--sh-`;
 *   - colour families are forked for `.light`; structural families never are;
 *   - no component may introduce a visual value that is not a token or a
 *     composition of tokens.
 */

export type TokenFamily =
  | "plane"
  | "text"
  | "border"
  | "signal"
  | "meaning"
  | "semantic"
  | "atmosphere"
  | "spacing"
  | "typography"
  | "radius"
  | "shadow"
  | "blur"
  | "opacity"
  | "z"
  | "motion"
  | "breakpoint"
  | "density"
  | "layout"
  | "focus"
  | "brand";

/** Families whose values are colour and therefore MUST be re-declared under `.light`. */
export const THEME_FORKED_FAMILIES: ReadonlySet<TokenFamily> = new Set<TokenFamily>([
  "plane",
  "text",
  "border",
  "signal",
  "meaning",
  "semantic",
  "atmosphere",
  "shadow",
]);

const t = (family: TokenFamily, names: readonly string[]) =>
  names.map((name) => ({ family, name: `--sh-${name}` }) as const);

/** The complete Sherivs token inventory. */
export const SHERIVS_TOKENS = [
  ...t("plane", ["plane-0", "plane-1", "plane-2", "plane-3", "plane-4", "plane-inverse"]),
  ...t("text", ["text-1", "text-2", "text-3", "text-4", "text-inverse"]),
  ...t("border", ["border-1", "border-2", "border-3", "border-inverse"]),
  ...t("signal", ["signal", "signal-strong", "signal-soft", "signal-on"]),
  ...t("meaning", [
    "reality",
    "reality-soft",
    "intel",
    "intel-soft",
    "action",
    "action-soft",
    "evidence",
    "evidence-soft",
  ]),
  ...t("semantic", [
    "success",
    "success-soft",
    "warning",
    "warning-soft",
    "danger",
    "danger-soft",
    "info",
    "info-soft",
    "neutral",
    "neutral-soft",
  ]),
  ...t("atmosphere", ["atmosphere-a", "atmosphere-b"]),
  ...t(
    "spacing",
    ["0", "1", "2", "3", "4", "5", "6", "8", "10", "12", "16", "20", "24", "32"].map(
      (n) => `space-${n}`,
    ),
  ),
  ...t("typography", [
    "font-sans",
    "font-display",
    "font-mono",
    ...[
      "display",
      "hero",
      "h1",
      "h2",
      "h3",
      "h4",
      "body-lg",
      "body",
      "small",
      "caption",
      "label",
      "code",
      "data",
      "metric",
    ].flatMap((role) => [`type-${role}-size`, `type-${role}-lh`]),
    "type-display-ls",
    "type-hero-ls",
    "type-h1-ls",
    "type-h2-ls",
    "type-h3-ls",
    "type-h4-ls",
    "type-label-ls",
    "type-metric-ls",
  ]),
  ...t("radius", ["xs", "sm", "md", "lg", "xl", "2xl", "full"].map((n) => `radius-${n}`)),
  ...t("shadow", ["shadow-1", "shadow-2", "shadow-3", "shadow-4", "shadow-signal"]),
  ...t("blur", ["blur-sm", "blur-md", "blur-lg"]),
  ...t("opacity", ["opacity-disabled", "opacity-muted", "opacity-overlay", "opacity-glass"]),
  ...t(
    "z",
    [
      "base",
      "raised",
      "sticky",
      "header",
      "sidebar",
      "overlay",
      "drawer",
      "modal",
      "popover",
      "toast",
      "command",
      "max",
    ].map((n) => `z-${n}`),
  ),
  ...t("motion", [
    "duration-instant",
    "duration-fast",
    "duration-base",
    "duration-slow",
    "duration-deliberate",
    "stagger-step",
    "ease-standard",
    "ease-emphasized",
    "ease-exit",
    "ease-soft-spring",
  ]),
  ...t(
    "breakpoint",
    ["xs", "sm", "md", "lg", "xl", "2xl", "3xl", "4xl", "5xl"].map((n) => `bp-${n}`),
  ),
  ...t("density", ["density", "control-h-sm", "control-h-md", "control-h-lg", "touch-target"]),
  ...t("layout", [
    "layout-prose",
    "layout-content",
    "layout-wide",
    "layout-max",
    "layout-gutter",
    "layout-header-h",
    "layout-sidebar-w",
    "layout-sidebar-w-collapsed",
    "layout-bottom-nav-h",
  ]),
  ...t("focus", ["focus-ring", "focus-outline", "focus-offset"]),
  ...t("brand", ["org-primary", "org-secondary", "org-primary-soft"]),
] as const;

export type SherivsTokenName = (typeof SHERIVS_TOKENS)[number]["name"];

/** Design breakpoints the responsive system designs for independently. */
export const SHERIVS_BREAKPOINTS = {
  xs: 360,
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  "2xl": 1440,
  "3xl": 1600,
  "4xl": 1920,
  "5xl": 2560,
} as const;

/** The four planes of meaning — the Sherivs semantic colour motif. */
export const PLANES_OF_MEANING = ["reality", "intel", "action", "evidence"] as const;
export type PlaneOfMeaning = (typeof PLANES_OF_MEANING)[number];

/** Semantic status tones available to every component. */
export const STATUS_TONES = [
  "success",
  "warning",
  "danger",
  "info",
  "neutral",
  ...PLANES_OF_MEANING,
] as const;
export type StatusTone = (typeof STATUS_TONES)[number];

/** Density presets (multiplier applied to control heights). */
export const DENSITY_PRESETS = {
  compact: 0.85,
  comfortable: 1,
  spacious: 1.15,
} as const;
export type DensityPreset = keyof typeof DENSITY_PRESETS;

export function tokensOfFamily(family: TokenFamily): readonly string[] {
  return SHERIVS_TOKENS.filter((token) => token.family === family).map((token) => token.name);
}

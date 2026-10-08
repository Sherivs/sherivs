/**
 * Sherivs design tokens — typed access to the canonical token manifest.
 *
 * `frontend/src/design/sherivs.tokens.json` is the single source of truth.
 * `sherivs-tokens.css` is generated from it (and verified in CI by
 * tests/unit/sherivs-design-tokens.test.ts), so a token can never exist in CSS
 * without existing here, and vice versa.
 *
 * Contrast math is delegated to the platform accessibility primitives
 * (`@/lib/experience/experience-platform`) rather than re-implemented.
 */
import tokens from "@/design/sherivs.tokens.json";

export type SherivsThemeName = "light" | "dark";
export type SherivsContrast = "standard" | "high";
export type SherivsDensity = "comfortable" | "compact";

export type SherivsThemeToken = keyof (typeof tokens)["themes"]["light"];
export type SherivsPlane = "reality" | "intelligence" | "action" | "evidence";

export const SHERIVS_TOKEN_VERSION: string = tokens.version;
export const SHERIVS_BREAKPOINTS: Readonly<Record<string, number>> = tokens.breakpoints;
export const SHERIVS_RESPONSIVE_TARGETS: readonly number[] = Object.values(tokens.breakpoints);

/** Reality → Intelligence → Action → Evidence: the canonical spatial order. */
export const SHERIVS_PLANES: readonly SherivsPlane[] = [
  "reality",
  "intelligence",
  "action",
  "evidence",
];

type ThemeMap = Record<string, string>;

/** Resolve a theme into concrete token values, applying the contrast overlay. */
export function resolveThemeTokens(
  theme: SherivsThemeName,
  contrast: SherivsContrast = "standard",
): Readonly<Record<string, string>> {
  const base: ThemeMap = { ...tokens.themes[theme] };
  if (contrast === "high") {
    const overlay: ThemeMap =
      theme === "light" ? tokens.themes["high-contrast-light"] : tokens.themes["high-contrast-dark"];
    return { ...base, ...overlay };
  }
  return base;
}

/** The CSS custom-property reference for a theme token, e.g. `var(--sv-accent)`. */
export function svVar(token: string): string {
  return `var(--sv-${token})`;
}

export const SHERIVS_CONTRAST_PAIRS: ReadonlyArray<readonly [string, string, number]> =
  tokens.contrastPairs as unknown as ReadonlyArray<readonly [string, string, number]>;

export const SHERIVS_MOTION = {
  duration: tokens.scalars.duration,
  ease: tokens.scalars.ease,
} as const;

export const SHERIVS_LAYOUT = tokens.scalars.layout;
export const SHERIVS_SOURCE_TOKENS = tokens;

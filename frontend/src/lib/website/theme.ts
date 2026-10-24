/** Per-organization theme → CSS variables. Colours are corrected to WCAG AA against white text/backgrounds. */
import type { SchoolPublic, Theme } from "./types";

const HEX = /^#[0-9a-fA-F]{6}$/;
const DEFAULT: Theme = { primary: "#0b6b3a", secondary: "#a35a00", font: "system", radius: "soft" }; // SDS v1 primary/accent

function lum(hex: string): number {
  const c = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export function contrast(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
/** Darken until white text on it reaches 4.5:1 (keeps the hue; brand colours like yellow become legible). */
export function ensureAA(hex: string, fallback: string): string {
  if (!HEX.test(hex)) return fallback;
  let [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  for (
    let i = 0;
    i < 40 &&
    contrast(`#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`, "#ffffff") < 4.5;
    i++
  ) {
    [r, g, b] = [r, g, b].map((v) => Math.floor(v * 0.9));
  }
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

export function themeFromBrand(
  s: Pick<SchoolPublic, "primary_color" | "secondary_color" | "logo_url">,
): Theme {
  return {
    primary: ensureAA(s.primary_color ?? "", DEFAULT.primary),
    secondary: ensureAA(s.secondary_color ?? "", DEFAULT.secondary),
    font: "system",
    radius: "soft",
    ...(s.logo_url ? { logo: s.logo_url } : {}),
  };
}

const FONTS: Record<Theme["font"], string> = {
  system: 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", "Noto Serif", serif',
  rounded: 'ui-rounded, "SF Pro Rounded", system-ui, "Segoe UI", Roboto, sans-serif',
};
const RADII: Record<Theme["radius"], string> = { square: "4px", soft: "12px", round: "20px" };

/** CSS custom properties consumed by components/website/website.css (no web fonts: zero font download). */
export function themeVars(t: Theme): Record<string, string> {
  const primary = ensureAA(t.primary, DEFAULT.primary);
  const secondary = ensureAA(t.secondary, DEFAULT.secondary);
  return {
    "--sw-primary": primary,
    "--sw-secondary": secondary,
    "--sw-font": FONTS[t.font] ?? FONTS.system,
    "--sw-radius": RADII[t.radius] ?? RADII.soft,
  };
}

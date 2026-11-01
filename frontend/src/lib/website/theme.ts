/**
 * Brand-driven theming (SPEC §8, v2). The whole palette is derived from the school's primary and secondary
 * colours: tints/shades, surfaces, borders, text, footer and a dark scheme. Every text/background pair is
 * checked and corrected to WCAG AA (4.5:1) so any brand colour (even yellow) stays readable.
 * Typography comes from curated, self-hosted font pairings (components/website/font-files.ts).
 */
import type { SchoolPublic, Theme } from "./types";

const HEX = /^#[0-9a-fA-F]{6}$/;
const DEFAULT = { primary: "#0b6b3a", secondary: "#a35a00" };
type RGB = [number, number, number];

const toRgb = (hex: string): RGB => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as RGB;
const toHex = (c: RGB) =>
  `#${c
    .map((v) =>
      Math.max(0, Math.min(255, Math.round(v)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
/** Linear sRGB mix: t = 0 → a, t = 1 → b. */
export function mix(a: string, b: string, t: number): string {
  const x = toRgb(a);
  const y = toRgb(b);
  return toHex([0, 1, 2].map((i) => x[i] + (y[i] - x[i]) * t) as RGB);
}
function lum(hex: string): number {
  const c = toRgb(hex)
    .map((v) => v / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export function contrast(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
/** Move `fg` toward black (or white) in small steps until it reaches `min` contrast on `bg`. Keeps the hue. */
export function fitContrast(fg: string, bg: string, min = 4.5): string {
  if (contrast(fg, bg) >= min) return fg;
  const target = lum(bg) > 0.18 ? "#000000" : "#ffffff";
  for (let t = 0.05; t <= 1.0001; t += 0.05) {
    const c = mix(fg, target, t);
    if (contrast(c, bg) >= min) return c;
  }
  return target;
}
/** fitContrast against several backgrounds at once (the colour is used on all of them). */
export function fitAll(fg: string, bgs: string[], min = 4.5): string {
  let c = fg;
  for (let i = 0; i < 3; i++) for (const bg of bgs) c = fitContrast(c, bg, min);
  return bgs.every((bg) => contrast(c, bg) >= min) ? c : fitContrast(c, bgs[0], min);
}
/** Back-compat (v1): darken until white text on it reaches 4.5:1. */
export function ensureAA(hex: string, fallback: string): string {
  return HEX.test(hex) ? fitContrast(hex, "#ffffff") : fallback;
}
/** Text colour for a filled brand surface: white or near-black, whichever passes; otherwise adjust the fill. */
export function onColor(fill: string): { fill: string; text: string } {
  const ink = "#111111";
  if (contrast(fill, "#ffffff") >= 4.5) return { fill, text: "#ffffff" };
  if (contrast(fill, ink) >= 4.5) return { fill, text: ink };
  return { fill: fitContrast(fill, "#ffffff"), text: "#ffffff" };
}

/* ---------- font pairings ---------- */
export const PAIRINGS = {
  classic: {
    label: "Classic",
    heading: "playfair-display",
    body: "source-sans-3",
    ratio: 1.25,
    weight: 700,
    tracking: "-0.01em",
  },
  scholarly: {
    label: "Scholarly",
    heading: "source-serif-4",
    body: "source-sans-3",
    ratio: 1.25,
    weight: 650,
    tracking: "-0.005em",
  },
  modern: {
    label: "Modern",
    heading: "montserrat",
    body: "inter",
    ratio: 1.2,
    weight: 750,
    tracking: "-0.02em",
  },
  friendly: {
    label: "Friendly",
    heading: "nunito",
    body: "nunito",
    ratio: 1.2,
    weight: 800,
    tracking: "-0.01em",
  },
  civic: {
    label: "Civic",
    heading: "roboto-slab",
    body: "inter",
    ratio: 1.22,
    weight: 650,
    tracking: "-0.01em",
  },
  heritage: {
    label: "Heritage",
    heading: "lora",
    body: "merriweather",
    ratio: 1.22,
    weight: 650,
    tracking: "0",
  },
} as const;
export type PairingKey = keyof typeof PAIRINGS;
export const PAIRING_KEYS = Object.keys(PAIRINGS) as PairingKey[];
export const FAMILY: Record<string, string> = {
  inter: "Inter Variable",
  montserrat: "Montserrat Variable",
  nunito: "Nunito Variable",
  "playfair-display": "Playfair Display Variable",
  "source-serif-4": "Source Serif 4 Variable",
  "source-sans-3": "Source Sans 3 Variable",
  merriweather: "Merriweather Variable",
  "roboto-slab": "Roboto Slab Variable",
  lora: "Lora Variable",
};
const SERIF = new Set([
  "playfair-display",
  "source-serif-4",
  "merriweather",
  "roboto-slab",
  "lora",
]);
const stack = (k: string) =>
  `"${FAMILY[k]}", ${SERIF.has(k) ? 'Georgia, "Noto Serif", serif' : 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif'}`;

/** Good default pairing by kind of organization (the school can pick another). */
export function defaultPairing(kind: string): PairingKey {
  if (kind === "nursery_primary") return "friendly";
  if (kind === "university" || kind === "polytechnic") return "scholarly";
  if (kind === "government") return "civic";
  if (kind === "group") return "modern";
  return "classic";
}
export function resolvePairing(t: Partial<Theme>, kind: string): PairingKey {
  if (t.pairing && t.pairing in PAIRINGS) return t.pairing as PairingKey;
  if (t.font === "serif") return "classic";
  if (t.font === "rounded") return "friendly";
  return defaultPairing(kind);
}

export function themeFromBrand(
  s: Pick<SchoolPublic, "primary_color" | "secondary_color" | "logo_url">,
  kind = "other",
): Theme {
  const primary = HEX.test(s.primary_color ?? "")
    ? (s.primary_color as string).toLowerCase()
    : DEFAULT.primary;
  const secondary = HEX.test(s.secondary_color ?? "")
    ? (s.secondary_color as string).toLowerCase()
    : DEFAULT.secondary;
  return {
    primary,
    secondary,
    font: "system",
    radius:
      kind === "nursery_primary"
        ? "round"
        : kind === "university" || kind === "government"
          ? "square"
          : "soft",
    pairing: defaultPairing(kind),
    dark: "auto",
    credit: true,
    ...(s.logo_url ? { logo: s.logo_url } : {}),
  };
}

export interface Palette {
  light: Record<string, string>;
  dark: Record<string, string>;
}
/** Full palette from two brand colours. Pure; every pair used for text is AA-checked. */
export function derivePalette(primaryIn: string, secondaryIn: string): Palette {
  const P = HEX.test(primaryIn) ? primaryIn.toLowerCase() : DEFAULT.primary;
  const S = HEX.test(secondaryIn) ? secondaryIn.toLowerCase() : DEFAULT.secondary;
  const white = "#ffffff";
  const p = onColor(P);
  const s = onColor(S);
  const bg = white;
  const muted = mix(P, white, 0.955);
  const text = fitContrast(mix(P, "#0b0c0e", 0.9), bg, 12);
  const text2 = fitAll(mix(P, "#4b5563", 0.85), [
    muted,
    white,
    mix(P, white, 0.86),
    mix(S, white, 0.9),
  ]);
  const footerBg = fitContrast(mix(P, "#06080a", 0.72), white, 10);
  const light = {
    "--sw-primary": p.fill,
    "--sw-on-primary": p.text,
    "--sw-secondary": s.fill,
    "--sw-on-secondary": s.text,
    "--sw-link": fitAll(P, [muted, white, mix(P, white, 0.94)]),
    "--sw-accent": fitAll(S, [muted, white, mix(S, white, 0.9)]),
    "--sw-p50": mix(P, white, 0.94),
    "--sw-p100": mix(P, white, 0.86),
    "--sw-p200": mix(P, white, 0.72),
    "--sw-p700": mix(P, "#000000", 0.25),
    "--sw-p900": mix(P, "#000000", 0.6),
    "--sw-s50": mix(S, white, 0.9),
    "--sw-bg": bg,
    "--sw-surface": white,
    "--sw-muted": muted,
    "--sw-border": mix(P, "#d5dbe3", 0.85),
    "--sw-text": text,
    "--sw-text-2": text2,
    "--sw-footer-bg": footerBg,
    "--sw-footer-text": fitContrast(mix(P, white, 0.9), footerBg, 7),
    "--sw-footer-muted": fitContrast(mix(P, white, 0.65), footerBg, 4.5),
    "--sw-chip-bg": mix(P, white, 0.88),
    "--sw-chip-text": fitContrast(P, mix(P, white, 0.88)),
  };
  const dbg = mix(P, "#0b0d10", 0.9);
  const dsurf = mix(P, "#13161a", 0.86);
  const dmuted = mix(P, "#0f1215", 0.84);
  const dtext = fitContrast("#eceef1", dbg, 12);
  const dark = {
    ...light,
    "--sw-link": fitAll(mix(P, white, 0.35), [dsurf, dmuted, dbg]),
    "--sw-accent": fitAll(mix(S, white, 0.3), [dsurf, dmuted, dbg]),
    "--sw-p50": mix(P, dbg, 0.85),
    "--sw-p100": mix(P, dbg, 0.75),
    "--sw-s50": mix(S, dbg, 0.85),
    "--sw-bg": dbg,
    "--sw-surface": dsurf,
    "--sw-muted": dmuted,
    "--sw-border": mix(P, "#2b3138", 0.85),
    "--sw-text": dtext,
    "--sw-text-2": fitAll("#b7bec7", [dmuted, dsurf, dbg, mix(P, dbg, 0.75), mix(S, dbg, 0.85)]),
    "--sw-footer-bg": mix(P, "#050607", 0.88),
    "--sw-footer-text": "#e6e8eb",
    "--sw-footer-muted": fitContrast("#9aa3ad", mix(P, "#050607", 0.88), 4.5),
    "--sw-chip-bg": mix(P, dsurf, 0.72),
    "--sw-chip-text": fitContrast(mix(P, white, 0.5), mix(P, dsurf, 0.72)),
  };
  return { light, dark };
}

const RADII: Record<Theme["radius"], string> = { square: "4px", soft: "12px", round: "22px" };

/** Typography variables: modular scale (fluid between 360 and 1200 px), line heights and families. */
export function typeVars(pairing: PairingKey): Record<string, string> {
  const pr = PAIRINGS[pairing];
  const r = pr.ratio;
  const step = (n: number, minR = 1.15) => {
    const min = (minR ** n).toFixed(3);
    const max = (r ** n).toFixed(3);
    return `clamp(${min}rem, calc(${min}rem + (${max} - ${min}) * ((100vw - 22.5rem) / 52.5)), ${max}rem)`;
  };
  return {
    "--sw-font": stack(pr.body),
    "--sw-font-head": stack(pr.heading),
    "--sw-head-weight": String(pr.weight),
    "--sw-head-tracking": pr.tracking,
    "--sw-step-0": "clamp(1rem, calc(1rem + 0.0625 * ((100vw - 22.5rem) / 52.5)), 1.0625rem)",
    "--sw-step-1": step(1),
    "--sw-step-2": step(2),
    "--sw-step-3": step(3),
    "--sw-step-4": step(4, 1.18),
    "--sw-step-5": step(5, 1.2),
    "--sw-lh": SERIF.has(pr.body) ? "1.7" : "1.6",
  };
}

const decl = (v: Record<string, string>) =>
  Object.entries(v)
    .map(([k, x]) => `${k}:${x}`)
    .join(";");

/**
 * Per-site stylesheet (inlined in a <style> tag). Only values computed here from validated hex colours and the
 * fixed pairing table are emitted, so it cannot carry injected CSS.
 */
export function themeCss(t: Theme, kind: string, scope = ".sw"): string {
  const pal = derivePalette(t.primary, t.secondary);
  const pairing = resolvePairing(t, kind);
  const base = { ...pal.light, ...typeVars(pairing), "--sw-radius": RADII[t.radius] ?? RADII.soft };
  const mode = t.dark ?? "auto";
  let css = `${scope}{${decl(base)}}`;
  if (mode === "dark") css += `${scope}{${decl(pal.dark)};color-scheme:dark}`;
  else if (mode === "auto")
    css += `@media (prefers-color-scheme: dark){${scope}{${decl(pal.dark)};color-scheme:dark}}`;
  return css;
}

/** v1 API kept for the builder thumbnail and older callers. */
export function themeVars(t: Theme, kind = "other"): Record<string, string> {
  return {
    ...derivePalette(t.primary, t.secondary).light,
    ...typeVars(resolvePairing(t, kind)),
    "--sw-radius": RADII[t.radius] ?? RADII.soft,
  };
}

/** The two font families a site needs (for @font-face and preload). */
export function pairingFonts(t: Partial<Theme>, kind: string): string[] {
  const pr = PAIRINGS[resolvePairing(t, kind)];
  return pr.heading === pr.body ? [pr.heading] : [pr.heading, pr.body];
}

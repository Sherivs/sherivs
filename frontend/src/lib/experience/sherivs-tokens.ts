/**
 * Sherivs visual tokens.
 *
 * The palette is an instrument, not a marketing gradient: warm paper in light,
 * warm ink in dark, one verdigris signal, brass only as a secondary mark.
 * Glass is a layering tool and is not the identity.
 *
 * Values mirror the CSS custom properties in styles.css. Components must use
 * those variables; this module is the typed contract tests and documentation
 * read.
 */

export interface ContrastPair {
  readonly name: string;
  readonly foreground: string;
  readonly background: string;
}

export const SHERIVS_LIGHT = {
  background: "#f3efe6",
  surface: "#fbf9f4",
  surfaceRaised: "#ffffff",
  ink: "#1a1814",
  inkMuted: "#5c564c",
  line: "#d9d2c5",
  signal: "#1a4f45",
  signalInk: "#f7f4ee",
  brass: "#8c6b3e",
  verify: "#1f6b45",
  warning: "#8a5a12",
  danger: "#8f2d2d",
} as const;

export const SHERIVS_DARK = {
  background: "#121410",
  surface: "#1a1d18",
  surfaceRaised: "#22261f",
  ink: "#f3efe6",
  inkMuted: "#b7b1a4",
  line: "#34382f",
  signal: "#8fd0c0",
  signalInk: "#10211c",
  brass: "#d7b98a",
  verify: "#8fd0a8",
  warning: "#e2b15a",
  danger: "#f0a0a0",
} as const;

export const SHERIVS_TYPE = {
  display: "clamp(3.25rem, 9vw, 7.25rem)",
  hero: "clamp(2.4rem, 5vw, 4.25rem)",
  h1: "clamp(1.75rem, 3vw, 2.5rem)",
  h2: "clamp(1.35rem, 2.2vw, 1.85rem)",
  h3: "1.2rem",
  h4: "1.05rem",
  body: "1.0625rem",
  small: "0.875rem",
  caption: "0.75rem",
  label: "0.6875rem",
  code: "0.8125rem",
  metric: "clamp(1.75rem, 3vw, 2.5rem)",
} as const;

export const SHERIVS_MOTION = {
  durationFast: "120ms",
  duration: "200ms",
  durationSlow: "360ms",
  ease: "cubic-bezier(0.2, 0, 0, 1)",
  reducedMotion: "0.01ms",
} as const;

export const SHERIVS_BREAKPOINTS = {
  xs: 360,
  sm: 390,
  mobile: 430,
  tablet: 768,
  laptop: 1024,
  desktop: 1280,
  wide: 1440,
  xl: 1600,
  ultrawide: 1920,
} as const;

function channel(hex: string, index: number): number {
  const raw = hex.replace("#", "");
  return parseInt(raw.slice(index, index + 2), 16) / 255;
}

function luminance(hex: string): number {
  const transform = (value: number) =>
    value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  const r = transform(channel(hex, 0));
  const g = transform(channel(hex, 2));
  const b = transform(channel(hex, 4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio for a pair of sRGB hex colors. */
export function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

export const SHERIVS_CONTRAST_PAIRS: readonly ContrastPair[] = [
  { name: "light-body", foreground: SHERIVS_LIGHT.ink, background: SHERIVS_LIGHT.background },
  { name: "light-signal", foreground: SHERIVS_LIGHT.signalInk, background: SHERIVS_LIGHT.signal },
  { name: "dark-body", foreground: SHERIVS_DARK.ink, background: SHERIVS_DARK.background },
  { name: "dark-signal", foreground: SHERIVS_DARK.signalInk, background: SHERIVS_DARK.signal },
];

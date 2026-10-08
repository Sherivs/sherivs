/**
 * Canonical Sherivs design tokens.
 *
 * CSS custom properties in styles.css mirror these values. Components must
 * consume the tokens (or the utilities built from them), not one-off palettes.
 */

export const SHERIVS_COLOR = {
  ink: "#161410",
  paper: "#f3efe6",
  paperRaised: "#e7e1d4",
  brass: "#8a6232",
  intelligence: "#1f4f5a",
  evidence: "#1e5c40",
  danger: "#8d2b2b",
  warning: "#8a5a12",
} as const;

export const SHERIVS_TYPE = {
  display: '"Newsreader", "Iowan Old Style", Palatino, "Palatino Linotype", serif',
  sans: '"Public Sans", "Segoe UI", sans-serif',
  mono: '"IBM Plex Mono", ui-monospace, monospace',
  roles: {
    display: { size: "clamp(3.5rem, 8vw, 7.5rem)", lineHeight: "0.92", weight: 560 },
    hero: { size: "clamp(2.4rem, 4vw, 4.25rem)", lineHeight: "1.02", weight: 560 },
    h1: { size: "clamp(2rem, 3vw, 3rem)", lineHeight: "1.08", weight: 560 },
    h2: { size: "clamp(1.5rem, 2vw, 2rem)", lineHeight: "1.15", weight: 560 },
    h3: { size: "1.25rem", lineHeight: "1.25", weight: 600 },
    h4: { size: "1.05rem", lineHeight: "1.3", weight: 600 },
    body: { size: "1.0625rem", lineHeight: "1.6", weight: 400 },
    small: { size: "0.875rem", lineHeight: "1.5", weight: 400 },
    caption: { size: "0.75rem", lineHeight: "1.4", weight: 500 },
    label: { size: "0.6875rem", lineHeight: "1.3", weight: 600, tracking: "0.16em" },
    code: { size: "0.8125rem", lineHeight: "1.5", weight: 400 },
    data: { size: "0.8125rem", lineHeight: "1.4", weight: 500 },
    metric: { size: "clamp(1.75rem, 3vw, 2.5rem)", lineHeight: "1", weight: 560 },
  },
} as const;

export const SHERIVS_SPACE = {
  1: "0.25rem",
  2: "0.5rem",
  3: "0.75rem",
  4: "1rem",
  6: "1.5rem",
  8: "2rem",
  12: "3rem",
  16: "4rem",
  24: "6rem",
} as const;

export const SHERIVS_RADIUS = {
  hairline: "0px",
  control: "2px",
  surface: "2px",
} as const;

export const SHERIVS_MOTION = {
  duration: {
    instant: "80ms",
    fast: "140ms",
    base: "220ms",
    slow: "360ms",
  },
  easing: {
    standard: "cubic-bezier(0.2, 0, 0, 1)",
    enter: "cubic-bezier(0.16, 1, 0.3, 1)",
  },
  reduced: "0.01ms",
} as const;

export const SHERIVS_BREAKPOINTS = {
  mobileSm: 360,
  mobile: 390,
  mobileLg: 430,
  tablet: 768,
  laptop: 1024,
  desktop: 1280,
  desktopLg: 1440,
  wide: 1600,
  ultra: 1920,
  ultraWide: 2560,
} as const;

export const SHERIVS_Z = {
  base: 0,
  sticky: 40,
  overlay: 60,
  modal: 70,
  toast: 80,
  skip: 100,
} as const;

export const SHERIVS_FOCUS = "2px solid #8a6232";

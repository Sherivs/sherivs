/**
 * A school picks its own brand colours, and the app paints buttons, tooltips and
 * selected days with them. The text on top used to be a fixed white, so a pale
 * school colour produced unreadable buttons. This module chooses the text colour
 * that reads best on whatever colour the school picked.
 */

export const LIGHT_ON_COLOR = "#ffffff";
export const DARK_ON_COLOR = "#0a0f1e";
/** Used only for the few mid-tone colours where white and navy both fall under 4.5:1. */
export const BLACK_ON_COLOR = "#000000";

type Rgb = readonly [number, number, number];

/** Accepts #rgb or #rrggbb. Anything else is not a usable colour. */
export function parseHexColor(value: string | null | undefined): Rgb | null {
  const v = (value ?? "").trim();
  const long = /^#([0-9a-f]{6})$/i.exec(v);
  if (long) {
    const n = Number.parseInt(long[1]!, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const short = /^#([0-9a-f]{3})$/i.exec(v);
  if (short) {
    const [r, g, b] = short[1]!.split("").map((c) => Number.parseInt(c + c, 16));
    return [r!, g!, b!];
  }
  return null;
}

function luminance([r, g, b]: Rgb): number {
  const lin = (c: number): number => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two colours, or null when either is not a usable colour. */
export function contrastBetween(a: string, b: string): number | null {
  const x = parseHexColor(a);
  const y = parseHexColor(b);
  if (!x || !y) return null;
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The text colour with the best contrast on `background`: white or the app's navy, and pure black
 * only for the few mid-tone colours where neither reaches 4.5:1 (the worst case for white and navy
 * is about 4.4:1; with black added it is about 4.6:1).
 * Returns null when the background is not a usable colour, so the caller keeps its default.
 */
export function readableOn(background: string | null | undefined): string | null {
  if (!parseHexColor(background)) return null;
  const onLight = contrastBetween(LIGHT_ON_COLOR, background!)!;
  const onDark = contrastBetween(DARK_ON_COLOR, background!)!;
  const best = onLight >= onDark ? LIGHT_ON_COLOR : DARK_ON_COLOR;
  if (Math.max(onLight, onDark) >= 4.5) return best;
  const onBlack = contrastBetween(BLACK_ON_COLOR, background!)!;
  return onBlack > Math.max(onLight, onDark) ? BLACK_ON_COLOR : best;
}

export interface TenantForegrounds {
  readonly primaryForeground: string | null;
  readonly secondaryForeground: string | null;
}

/** Text colours for the school's chosen primary and secondary colours; null means "keep the default". */
export function tenantForegrounds(
  primary: string | null | undefined,
  secondary: string | null | undefined,
): TenantForegrounds {
  return { primaryForeground: readableOn(primary), secondaryForeground: readableOn(secondary) };
}

/**
 * Organization brand layer — controlled theming.
 *
 * An organization may bring its own brand colour. It may NOT restyle Sherivs
 * structure, and it may not make the product illegible. This module is the only
 * path by which tenant colour reaches CSS: input is validated, then derived into
 * per-theme tokens whose text/fill pairings are guaranteed to meet WCAG AA.
 *
 *   brand input (untrusted)  →  validate  →  per-theme contrast-safe derivation
 *                            →  CSS custom properties on <html>
 *
 * The exact brand colour is preserved in `--tenant-brand` for logos and marks;
 * `--tenant-primary` is the contrast-safe derivative used for text, borders and
 * action fills.
 */
import { contrastRatio } from "@/lib/experience/experience-platform";
import { COLOR, type ThemeName } from "./tokens";

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const AA_TEXT = 4.5;
const INK = "#0a0d12";
const PAPER = "#ffffff";

export type Rgb = readonly [number, number, number];

export function normalizeHex(input: string): string | null {
  const v = input.trim();
  if (!HEX_RE.test(v)) return null;
  const hex = v.slice(1).toLowerCase();
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
  return `#${full}`;
}

function toRgb(hex: string): Rgb {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function toHex([r, g, b]: Rgb): string {
  const h = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

function mix(from: string, to: string, t: number): string {
  const a = toRgb(from);
  const b = toRgb(to);
  return toHex([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
}

export interface DerivedThemeBrand {
  /** Contrast-safe colour for text, borders and action fills on this theme's ground. */
  primary: string;
  /** Legible foreground to place ON `primary` (e.g. button label). */
  onPrimary: string;
  /** True when the supplied colour had to be shifted to remain legible. */
  adjusted: boolean;
}

export function deriveForTheme(brandHex: string, theme: ThemeName): DerivedThemeBrand {
  const ground = COLOR[theme].ground;
  const raised = COLOR[theme].raised;
  const toward = theme === "dark" ? PAPER : INK;
  let primary = brandHex;
  let adjusted = false;
  for (let step = 0; step < 20; step++) {
    if (contrastRatio(primary, ground) >= AA_TEXT && contrastRatio(primary, raised) >= AA_TEXT) break;
    primary = mix(primary, toward, 0.08);
    adjusted = true;
  }
  const onPrimary = contrastRatio(INK, primary) >= contrastRatio(PAPER, primary) ? INK : PAPER;
  return { primary, onPrimary, adjusted };
}

export interface OrgBrandInput {
  primaryColor?: string | null;
  secondaryColor?: string | null;
}

export interface OrgBrandResolution {
  /** True when at least one supplied colour was valid and applied. */
  applied: boolean;
  variables: Readonly<Record<string, string>>;
  issues: readonly string[];
  adjustedThemes: readonly ThemeName[];
}

/** Pure: resolve untrusted brand input into the CSS variables that may be applied. */
export function resolveOrganizationBrand(input: OrgBrandInput): OrgBrandResolution {
  const variables: Record<string, string> = {};
  const issues: string[] = [];
  const adjustedThemes = new Set<ThemeName>();

  const channels: Array<[string | null | undefined, "primary" | "secondary"]> = [
    [input.primaryColor, "primary"],
    [input.secondaryColor, "secondary"],
  ];
  for (const [raw, channel] of channels) {
    if (raw == null || raw === "") continue;
    const hex = normalizeHex(raw);
    if (!hex) {
      issues.push(`${channel} colour rejected: not a #rgb or #rrggbb value`);
      continue;
    }
    if (channel === "primary") variables["--tenant-brand"] = hex;
    for (const theme of ["dark", "light"] as const) {
      const derived = deriveForTheme(hex, theme);
      if (derived.adjusted) adjustedThemes.add(theme);
      variables[`--tenant-${channel}-${theme}`] = derived.primary;
      if (channel === "primary") variables[`--tenant-on-primary-${theme}`] = derived.onPrimary;
    }
  }
  return {
    applied: Object.keys(variables).length > 0,
    variables,
    issues,
    adjustedThemes: [...adjustedThemes],
  };
}

const MANAGED_VARIABLES = [
  "--tenant-brand",
  "--tenant-primary-dark",
  "--tenant-primary-light",
  "--tenant-secondary-dark",
  "--tenant-secondary-light",
  "--tenant-on-primary-dark",
  "--tenant-on-primary-light",
] as const;

/** Browser-side: apply (or clear) the resolved brand. Never accepts raw CSS. */
export function applyOrganizationBrand(root: HTMLElement, input: OrgBrandInput): OrgBrandResolution {
  for (const name of MANAGED_VARIABLES) root.style.removeProperty(name);
  const resolution = resolveOrganizationBrand(input);
  for (const [name, value] of Object.entries(resolution.variables)) root.style.setProperty(name, value);
  return resolution;
}

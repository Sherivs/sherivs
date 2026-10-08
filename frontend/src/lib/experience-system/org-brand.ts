/**
 * Organization brand layer — a CONTROLLED token layer.
 *
 * Organizations may bring an accent colour. They may not change canvas, text,
 * semantic status colours, focus rings or spacing. The accent is accepted only
 * as a validated hex and is then derived into a usability-safe trio:
 *
 *   --sv-org-accent       fill colour (buttons, markers)
 *   --sv-org-accent-fg    text on that fill, chosen to reach WCAG AA (4.5:1)
 *   --sv-org-accent-text  the accent used as TEXT/links on the active surface,
 *                         pulled toward the text colour until it reaches 4.5:1
 *
 * Anything that is not a valid hex is rejected, so arbitrary database values
 * never become CSS (no `url()`, no `var()`, no expressions).
 */
import { contrastRatio } from "@/lib/experience/experience-platform";

export interface OrgBrandInput {
  readonly accent: string | null | undefined;
  /** Active surface the accent text is rendered on. */
  readonly surface: string;
  /** Text colour of the active theme (the colour the accent is pulled toward). */
  readonly text: string;
}

export interface OrgBrandTokens {
  readonly accent: string;
  readonly accentFg: string;
  readonly accentText: string;
  /** True when the requested accent had to be adjusted to remain usable. */
  readonly adjustedForContrast: boolean;
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const INK = "#0b1118";
const WHITE = "#ffffff";
const AA = 4.5;

/** Normalise `#rgb` / `#rrggbb` to lower-case `#rrggbb`; null when invalid. */
export function normalizeHex(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!HEX.test(v)) return null;
  const body = v.slice(1).toLowerCase();
  return body.length === 3
    ? `#${body[0]}${body[0]}${body[1]}${body[1]}${body[2]}${body[2]}`
    : `#${body}`;
}

function channels(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function mix(from: string, to: string, amount: number): string {
  const a = channels(from);
  const b = channels(to);
  const out = a.map((c, i) => Math.round(c + (b[i] - c) * amount));
  return `#${out.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

export function deriveOrgBrandTokens(input: OrgBrandInput): OrgBrandTokens | null {
  const accent = normalizeHex(input.accent);
  const surface = normalizeHex(input.surface);
  const text = normalizeHex(input.text);
  if (!accent || !surface || !text) return null;

  const accentFg = contrastRatio(WHITE, accent) >= contrastRatio(INK, accent) ? WHITE : INK;

  let accentText = accent;
  let adjusted = false;
  for (let step = 1; step <= 20 && contrastRatio(accentText, surface) < AA; step += 1) {
    accentText = mix(accent, text, step * 0.05);
    adjusted = true;
  }
  if (contrastRatio(accentText, surface) < AA) accentText = text;

  return { accent, accentFg, accentText, adjustedForContrast: adjusted };
}

const LIGHT_SURFACE = { surface: "#ffffff", text: INK } as const;
const DARK_SURFACE = { surface: "#0f1721", text: "#e9eff4" } as const;

/**
 * Custom properties for the org layer; empty when the accent is invalid.
 * Text variants are emitted for BOTH themes so a theme switch never needs a
 * recompute; `sherivs.css` selects the right one per active theme.
 */
export function orgBrandVariables(accent: string | null | undefined): Record<string, string> {
  const light = deriveOrgBrandTokens({ accent, ...LIGHT_SURFACE });
  const dark = deriveOrgBrandTokens({ accent, ...DARK_SURFACE });
  if (!light || !dark) return {};
  return {
    "--sv-org-accent": light.accent,
    "--sv-org-accent-fg": light.accentFg,
    "--sv-org-accent-text-light": light.accentText,
    "--sv-org-accent-text-dark": dark.accentText,
  };
}

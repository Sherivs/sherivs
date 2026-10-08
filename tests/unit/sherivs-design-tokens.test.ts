/**
 * Sherivs Experience System — design token conformance.
 *
 * Proves that the CSS token layer (frontend/src/styles/sherivs-tokens.css)
 * satisfies the typed contract (frontend/src/lib/experience/design-tokens.ts):
 *   - every declared token is defined in `:root`;
 *   - every colour-family token is re-declared under `.light`;
 *   - the legacy compatibility layer (styles.css) aliases its structural
 *     variables onto `--sh-*` tokens instead of hardcoded colours;
 *   - the primitives layer declares the full type scale.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PLANES_OF_MEANING,
  SHERIVS_BREAKPOINTS,
  SHERIVS_TOKENS,
  THEME_FORKED_FAMILIES,
  tokensOfFamily,
} from "@/lib/experience/design-tokens";

const ROOT = join(import.meta.dirname, "..", "..");
const TOKENS_CSS = readFileSync(join(ROOT, "frontend/src/styles/sherivs-tokens.css"), "utf8");
const PRIMITIVES_CSS = readFileSync(
  join(ROOT, "frontend/src/styles/sherivs-primitives.css"),
  "utf8",
);
const ENTRY_CSS = readFileSync(join(ROOT, "frontend/src/styles.css"), "utf8");

/** Extract `{ ... }` body of the FIRST block whose selector matches exactly. */
function blockBody(css: string, selector: string): string {
  const re = new RegExp(`(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`, "m");
  const match = re.exec(css);
  if (!match) throw new Error(`selector not found: ${selector}`);
  const start = match.index + match[0].length;
  let depth = 1;
  let i = start;
  for (; i < css.length && depth > 0; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") depth--;
  }
  return css.slice(start, i - 1);
}

function declaredNames(body: string): Set<string> {
  return new Set([...body.matchAll(/(--sh-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
}

describe("Sherivs design tokens — contract vs CSS", () => {
  const root = declaredNames(blockBody(TOKENS_CSS, ":root"));
  const light = declaredNames(blockBody(TOKENS_CSS, ".light"));

  it("declares every contract token in :root", () => {
    const missing = SHERIVS_TOKENS.map((t) => t.name).filter((name) => !root.has(name));
    expect(missing).toEqual([]);
  });

  it("has no duplicate token names in the contract", () => {
    const names = SHERIVS_TOKENS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("forks every colour-family token under .light", () => {
    const missing = SHERIVS_TOKENS.filter(
      (t) => THEME_FORKED_FAMILIES.has(t.family) && !light.has(t.name),
    ).map((t) => t.name);
    expect(missing).toEqual([]);
  });

  it("never forks structural families under .light (spacing, type, radius, motion, layout, z)", () => {
    const structural = ["spacing", "typography", "radius", "motion", "layout", "z", "breakpoint"] as const;
    const leaked = structural.flatMap((family) =>
      tokensOfFamily(family).filter((name) => light.has(name)),
    );
    expect(leaked).toEqual([]);
  });

  it("defines the four planes of meaning with soft variants", () => {
    for (const plane of PLANES_OF_MEANING) {
      expect(root.has(`--sh-${plane}`)).toBe(true);
      expect(root.has(`--sh-${plane}-soft`)).toBe(true);
    }
  });

  it("keeps breakpoint tokens aligned with the responsive contract", () => {
    for (const [key, px] of Object.entries(SHERIVS_BREAKPOINTS)) {
      expect(TOKENS_CSS).toMatch(new RegExp(`--sh-bp-${key}:\\s*${px}px;`));
    }
  });

  it("tokens are the only root-declared custom properties in the token file (no stray values)", () => {
    const all = [...blockBody(TOKENS_CSS, ":root").matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]);
    const stray = all.filter((name) => !name.startsWith("--sh-"));
    expect(stray).toEqual([]);
  });
});

describe("Sherivs primitives — type scale and motion", () => {
  it("declares a class for every typographic role", () => {
    for (const role of [
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
    ]) {
      expect(PRIMITIVES_CSS).toContain(`.sh-${role} {`);
    }
  });

  it("honours prefers-reduced-motion for every animated primitive", () => {
    const reduced = blockBody(PRIMITIVES_CSS, "@media (prefers-reduced-motion: reduce)");
    for (const cls of [".sh-enter", ".sh-enter-scale", ".sh-stagger > *", ".sh-live", ".sh-skeleton"]) {
      expect(reduced).toContain(cls);
    }
  });

  it("uses only tokens for durations and easings (no literal ms/cubic-bezier in primitives)", () => {
    const withoutKeyframes = PRIMITIVES_CSS.replace(/@keyframes[\s\S]*?\n}\n/g, "");
    // `.sh-live` and `.sh-skeleton` carry an explicit tempo (2.4s / 1.6s) — the only sanctioned literals.
    const literals = [...withoutKeyframes.matchAll(/\b\d+(\.\d+)?m?s\b/g)].map((m) => m[0]);
    expect(literals.filter((v) => !["2.4s", "1.6s", "0s"].includes(v))).toEqual([]);
    expect(withoutKeyframes).not.toMatch(/cubic-bezier\(/);
  });
});

describe("Legacy compatibility layer — aliases onto Sherivs tokens", () => {
  const root = blockBody(ENTRY_CSS, ":root");

  it.each([
    "--surface-1",
    "--surface-2",
    "--surface-3",
    "--text-primary",
    "--text-secondary",
    "--text-muted",
    "--background",
    "--foreground",
    "--card",
    "--popover",
    "--border",
    "--ring",
    "--destructive",
    "--primary",
  ])("%s resolves to a --sh- token", (name) => {
    const re = new RegExp(`${name}:\\s*var\\(--sh-[a-z0-9-]+`);
    expect(root).toMatch(re);
  });

  it("maps Sherivs semantic colours into Tailwind utilities", () => {
    for (const util of [
      "--color-plane-0",
      "--color-signal",
      "--color-reality",
      "--color-intel",
      "--color-action",
      "--color-evidence",
      "--color-org",
    ]) {
      expect(ENTRY_CSS).toContain(`${util}: var(--sh-`);
    }
  });

  it("imports the token and primitive layers before any rule", () => {
    const tokensIdx = ENTRY_CSS.indexOf('@import "./styles/sherivs-tokens.css"');
    const primitivesIdx = ENTRY_CSS.indexOf('@import "./styles/sherivs-primitives.css"');
    const firstRule = ENTRY_CSS.indexOf("@theme inline");
    expect(tokensIdx).toBeGreaterThan(-1);
    expect(primitivesIdx).toBeGreaterThan(tokensIdx);
    expect(firstRule).toBeGreaterThan(primitivesIdx);
  });

  it("carries no raw hex colours outside keyframe fallbacks", () => {
    const hexes = [...ENTRY_CSS.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]);
    expect(hexes).toEqual([]);
  });
});

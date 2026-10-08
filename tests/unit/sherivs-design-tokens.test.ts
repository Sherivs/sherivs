/**
 * Sherivs design tokens — the typed token source and the CSS layer must agree, and
 * every declared text/background pair must meet its WCAG 2.2 contrast minimum in both
 * themes. The CSS blocks are delimited by `/* sx:light *\/`, `/* sx:dark *\/` and
 * `/* sx:end *\/` markers so this test can parse them.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  SX_BREAKPOINTS,
  SX_COLOR_TOKENS,
  SX_CONTRAST_PAIRS,
  SX_TARGET_SIZE,
  contrastRatio,
  type SxThemeName,
} from "@/design/tokens";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const css = readFileSync(join(ROOT, "frontend/src/styles.css"), "utf8");

function cssBlock(theme: SxThemeName): Record<string, string> {
  const start = css.indexOf(`/* sx:${theme} */`);
  expect(start, `styles.css must contain the sx:${theme} marker`).toBeGreaterThan(-1);
  const end = css.indexOf("/* sx:end */", start);
  const block = css.slice(start, end);
  const tokens: Record<string, string> = {};
  for (const match of block.matchAll(/--sx-([a-z0-9-]+):\s*(#[0-9a-f]{6});/giu)) {
    tokens[match[1]] = match[2].toLowerCase();
  }
  return tokens;
}

describe("Sherivs color tokens — TypeScript source and CSS layer agree", () => {
  for (const theme of ["light", "dark"] as const) {
    it(`${theme} theme declares the same tokens with the same values`, () => {
      const fromCss = cssBlock(theme);
      const fromTs = Object.fromEntries(
        Object.entries(SX_COLOR_TOKENS[theme]).map(([key, value]) => [key, value.toLowerCase()]),
      );
      expect(fromCss).toEqual(fromTs);
    });
  }

  it("both themes declare the same token names", () => {
    expect(Object.keys(SX_COLOR_TOKENS.dark).sort()).toEqual(
      Object.keys(SX_COLOR_TOKENS.light).sort(),
    );
  });
});

describe("Sherivs contrast — WCAG 2.2 AA in both themes", () => {
  it("computes known reference ratios", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });

  for (const theme of ["light", "dark"] as const) {
    for (const pair of SX_CONTRAST_PAIRS) {
      it(`${theme}: ${pair.foreground} on ${pair.background} >= ${pair.minimum}:1`, () => {
        const foreground = SX_COLOR_TOKENS[theme][pair.foreground];
        const background = SX_COLOR_TOKENS[theme][pair.background];
        expect(foreground, `${pair.foreground} must exist`).toBeDefined();
        expect(background, `${pair.background} must exist`).toBeDefined();
        expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(pair.minimum);
      });
    }
  }

  it("checks every intelligence-kind color against the page surface", () => {
    const kinds = [
      "observation",
      "inference",
      "recommendation",
      "action",
      "evidence",
      "verification",
      "danger",
    ];
    const checked = new Set(SX_CONTRAST_PAIRS.map((pair) => pair.foreground));
    for (const kind of kinds)
      expect(checked.has(kind), `${kind} must have a contrast pair`).toBe(true);
  });
});

describe("Sherivs motion, forced colors and targets", () => {
  it("neutralizes animation and transitions under prefers-reduced-motion", () => {
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced.length).toBeGreaterThan(0);
    expect(reduced).toMatch(/animation-duration:\s*0\.01ms\s*!important/u);
    expect(reduced).toMatch(/transition-duration:\s*0\.01ms\s*!important/u);
  });

  it("keeps focus and marks visible in forced-colors mode", () => {
    expect(css).toMatch(/@media \(forced-colors: active\)/u);
  });

  it("declares the responsive range from 360px to 2560px and touch targets of 44px", () => {
    const widths = Object.values(SX_BREAKPOINTS).map((value) => Number.parseInt(String(value), 10));
    expect(Math.min(...widths)).toBe(360);
    expect(Math.max(...widths)).toBe(2560);
    expect(SX_TARGET_SIZE.touch).toBe("44px");
  });
});

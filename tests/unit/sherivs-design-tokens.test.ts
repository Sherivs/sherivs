/**
 * Sherivs design tokens — source/generated sync, contrast, structure.
 * Experience Phase F (V1 target).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCss } from "../../scripts/experience/generate-design-tokens.mjs";
import { contrastRatio } from "@/lib/experience/experience-platform";
import {
  SHERIVS_BREAKPOINTS,
  SHERIVS_CONTRAST_PAIRS,
  SHERIVS_PLANES,
  SHERIVS_SOURCE_TOKENS,
  resolveThemeTokens,
} from "@/lib/experience-system/design-tokens";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = (ref: string) => readFileSync(join(ROOT, ref), "utf8");

describe("token pipeline", () => {
  it("keeps the generated CSS identical to what the source tokens produce", () => {
    const generated = read("frontend/src/design/sherivs-tokens.css");
    expect(generated).toBe(buildCss(SHERIVS_SOURCE_TOKENS));
  });

  it("imports tokens and component CSS from the global stylesheet", () => {
    const styles = read("frontend/src/styles.css");
    expect(styles).toContain("./design/sherivs-tokens.css");
    expect(styles).toContain("./design/sherivs.css");
  });

  it("loads brand fonts from bundled packages, not a third-party CDN", () => {
    expect(read("frontend/src/styles.css")).toContain("@fontsource-variable/geist");
    expect(read("frontend/src/routes/__root.tsx")).not.toContain("fonts.googleapis.com");
  });
});

describe("WCAG contrast of semantic token pairs", () => {
  const variants = [
    ["light", "standard"],
    ["dark", "standard"],
    ["light", "high"],
    ["dark", "high"],
  ] as const;

  for (const [theme, contrast] of variants) {
    it(`meets every declared minimum in ${theme}/${contrast}`, () => {
      const t = resolveThemeTokens(theme, contrast);
      const failures: string[] = [];
      for (const [fg, bg, min] of SHERIVS_CONTRAST_PAIRS) {
        const ratio = contrastRatio(t[fg], t[bg]);
        if (ratio < min) failures.push(`${fg} on ${bg}: ${ratio.toFixed(2)} < ${min}`);
      }
      expect(failures).toEqual([]);
    });
  }

  it("declares pairs at all (the check is not vacuous)", () => {
    expect(SHERIVS_CONTRAST_PAIRS.length).toBeGreaterThanOrEqual(10);
  });
});

describe("structure", () => {
  it("orders the four planes Reality, Intelligence, Action, Evidence", () => {
    expect(SHERIVS_PLANES).toEqual(["reality", "intelligence", "action", "evidence"]);
  });

  it("covers breakpoints from small phones to ultrawide", () => {
    const widths = Object.values(SHERIVS_BREAKPOINTS);
    expect(Math.min(...widths)).toBeLessThanOrEqual(360);
    expect(Math.max(...widths)).toBeGreaterThanOrEqual(2560);
  });

  it("honors reduced motion in component CSS", () => {
    const css = read("frontend/src/design/sherivs.css");
    expect(css).toContain("prefers-reduced-motion");
    expect(css).toContain('data-sv-motion="reduced"');
  });
});

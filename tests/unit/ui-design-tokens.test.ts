import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SRC = join(ROOT, "frontend/src");
const css = readFileSync(join(SRC, "styles.css"), "utf8");

function cssFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) cssFiles(p, out);
    else if (name.endsWith(".css")) out.push(p);
  }
  return out;
}

/** The declarations of the first rule whose selector line starts with `selector`. */
function block(selector: string, from = 0): Record<string, string> {
  const start = css.indexOf(`${selector} {`, from);
  if (start < 0) throw new Error(`no rule for ${selector}`);
  const end = css.indexOf("}", start);
  const out: Record<string, string> = {};
  for (const m of css.slice(start, end).matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g))
    out[m[1]!] = m[2]!.trim();
  return out;
}

/** The declarations of the rule that contains the character at `index`. */
function declarationsAround(index: number): Record<string, string> {
  const start = css.lastIndexOf("{", index);
  const end = css.indexOf("}", index);
  const out: Record<string, string> = {};
  for (const m of css.slice(start, end).matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g))
    out[m[1]!] = m[2]!.trim();
  return out;
}

type Rgb = [number, number, number];
const hex = (s: string): Rgb => [1, 3, 5].map((i) => Number.parseInt(s.slice(i, i + 2), 16)) as Rgb;
const lin = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = ([r, g, b]: Rgb) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};
const over = (fg: Rgb, alpha: number, bg: Rgb): Rgb =>
  fg.map((f, i) => Math.round(alpha * f + (1 - alpha) * bg[i]!)) as Rgb;
const alphaOf = (v: string) => Number(/rgba\([^)]*,\s*([0-9.]+)\)/.exec(v)![1]);

const dark = block(":root");
const light = block(".light", css.indexOf('Light ("off-white") mode'));
const WHITE: Rgb = [255, 255, 255];
const INK: Rgb = [17, 24, 39];

describe("text on the dark theme reads at 4.5:1 or better", () => {
  const surfaces = [dark["--surface-1"], dark["--surface-2"], dark["--surface-3"]].map((s) =>
    hex(s!),
  );
  const glass = over(WHITE, 0.12, surfaces[0]!);
  for (const token of ["--text-primary", "--text-secondary", "--text-muted"]) {
    it(token, () => {
      const a = alphaOf(dark[token]!);
      for (const bg of [...surfaces, glass])
        expect(ratio(over(WHITE, a, bg), bg)).toBeGreaterThanOrEqual(4.4);
    });
  }
});

describe("text on the light theme reads at 4.5:1 or better", () => {
  const surfaces = [light["--surface-1"], light["--surface-2"], light["--surface-3"]].map((s) =>
    hex(s!),
  );
  const hover = over(INK, 0.07, surfaces[0]!);
  for (const token of ["--text-primary", "--text-secondary", "--text-muted"]) {
    it(token, () => {
      const a = alphaOf(light[token]!);
      for (const bg of [...surfaces, hover])
        expect(ratio(over(INK, a, bg), bg)).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe("status colours read as text on their own tint", () => {
  const statusDark = declarationsAround(css.indexOf("--color-success:"));
  const statusLight = block(".light,\n.light ::backdrop");
  it("dark", () => {
    const bg = hex(dark["--surface-2"]!);
    for (const k of ["success", "warning", "danger", "info"]) {
      const fg = hex(statusDark[`--color-${k}`]!);
      expect(ratio(fg, over(fg, 0.1, bg)), k).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("light", () => {
    for (const k of ["success", "warning", "danger", "info"]) {
      const fg = hex(statusLight[`--color-${k}`]!);
      expect(ratio(fg, over(fg, 0.12, WHITE)), k).toBeGreaterThanOrEqual(4.5);
      expect(ratio(fg, WHITE), k).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("focus, motion, touch and type size", () => {
  it("shows a focus ring on both themes that is visible against the surface", () => {
    expect(css).toMatch(
      /:where\([^)]*\):focus-visible\s*{[^}]*outline:\s*2px solid var\(--focus-ring\)/,
    );
    expect(
      ratio(
        hex(block(":root", css.indexOf("Accessibility baseline"))["--focus-ring"]!),
        hex(dark["--surface-1"]!),
      ),
    ).toBeGreaterThanOrEqual(3);
    expect(
      ratio(
        hex(block(".light", css.indexOf("Accessibility baseline"))["--focus-ring"]!),
        hex(light["--surface-1"]!),
      ),
    ).toBeGreaterThanOrEqual(3);
  });

  it("gives every search wrapper a visible focus state when its inner input hides the outline", () => {
    for (const sel of [".app-shell-search", ".mobility-search", ".sherivs-console-search"]) {
      expect(css, sel).toContain(`${sel}:focus-within`);
    }
  });

  it("keeps the fixed bottom navigation from covering the focused element", () => {
    expect(css).toMatch(/html:has\(\.app-shell-bottom\)\s*{\s*scroll-padding-bottom:\s*6rem/);
  });

  it("respects the reduced-motion setting everywhere", () => {
    const m =
      /@media \(prefers-reduced-motion: reduce\)\s*{\s*\*,\s*\*::before,\s*\*::after\s*{([^}]*)}/.exec(
        css,
      );
    expect(m).not.toBeNull();
    const body = m![1]!;
    expect(body).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
    expect(body).toMatch(/animation-iteration-count:\s*1\s*!important/);
    expect(body).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
    expect(body).toMatch(/scroll-behavior:\s*auto\s*!important/);
  });

  it("enlarges touch targets to 44px on touch screens only", () => {
    const m = /@media \(pointer: coarse\)\s*{[^{]*{([^}]*)}/.exec(css);
    expect(m).not.toBeNull();
    expect(m![1]).toMatch(/min-height:\s*44px/);
    const button = readFileSync(join(SRC, "components/ui/button.tsx"), "utf8");
    expect(button).toContain("[@media(pointer:coarse)]:min-h-11");
    expect(button).toContain("[@media(pointer:coarse)]:min-w-11");
  });

  it("never animates every property at once", () => {
    for (const f of cssFiles(SRC)) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(
        /transition:\s*all\b|--transition-[a-z]+:\s*all\b/,
      );
    }
  });

  it("sets no text under 12px in any stylesheet", () => {
    for (const f of cssFiles(SRC)) {
      const text = readFileSync(f, "utf8");
      for (const m of text.matchAll(/font-size:\s*(\d*\.?\d+)(rem|px)/g)) {
        const px = m[2] === "rem" ? Number(m[1]) * 16 : Number(m[1]);
        expect(px, `${f}: ${m[0]}`).toBeGreaterThanOrEqual(12);
      }
    }
  });
});

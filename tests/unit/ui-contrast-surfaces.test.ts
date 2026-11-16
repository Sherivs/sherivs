import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DARK_THEME_SURFACE,
  LIGHT_THEME_SURFACE,
  contrastBetween,
  fitTextOn,
} from "@/lib/brand/tenant-contrast";

const SRC = join(fileURLToPath(new URL("../..", import.meta.url)), "frontend/src");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");
const publicCss = read("styles/sherivs-public.css");
const entryCss = read("components/app-entry/app-entry.css");
const consoleCss = read("components/internal-console/console.css");
const shellCss = read("components/app-shell/app-shell.css");
const passkeyCss = read("components/auth/passkey-enrollment.css");
const baseCss = read("styles.css");

/** Value of `--name: #hex;` in `css`. */
function token(css: string, name: string): string {
  const m = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
  if (!m) throw new Error(`no token ${name}`);
  return m[1]!;
}
const ratio = (a: string, b: string) => contrastBetween(a, b)!;

// Backgrounds measured in a real browser: the palest page, the blue hero wash behind the
// breadcrumb, the sign-in card, and the console sidebar glow.
const LIGHT_SURFACES = { paper: "#eef2f8", heroWash: "#c0e2f9", card: "#f4f7fb", white: "#ffffff" };

describe("UI-03 text tokens meet 4.5:1 on the surfaces they sit on", () => {
  it("public muted ink on every light surface", () => {
    const muted = token(publicCss, "--sherivs-ink-muted");
    for (const [name, bg] of Object.entries(LIGHT_SURFACES))
      expect(ratio(muted, bg), name).toBeGreaterThanOrEqual(4.5);
  });
  it("public link token on light surfaces", () => {
    const link = token(publicCss, "--sherivs-link");
    for (const [name, bg] of Object.entries(LIGHT_SURFACES))
      expect(ratio(link, bg), name).toBeGreaterThanOrEqual(4.5);
  });
  it("sign-in helper text, kicker and placeholder no longer use the pale greys", () => {
    for (const grey of ["#8b93a7", "#9aa3b8", "#6b7690"]) expect(entryCss).not.toContain(grey);
    expect(ratio("#566179", LIGHT_SURFACES.white)).toBeGreaterThanOrEqual(4.5);
  });
  it("console muted, amber and active-nav text", () => {
    expect(ratio(token(consoleCss, "--console-muted"), "#c8e8fc")).toBeGreaterThanOrEqual(4.5);
    expect(ratio(token(consoleCss, "--console-amber"), "#f5f0ec")).toBeGreaterThanOrEqual(4.5);
    expect(consoleCss).toMatch(/is-active \{[^}]*color:\s*#1238c9/);
    expect(ratio("#1238c9", "#bedafc")).toBeGreaterThanOrEqual(4.5);
  });
  it("amber text on the light page is the dark amber", () => {
    expect(publicCss).toMatch(/\.sherivs-public \.text-sherivs-warning[^{]*\{\s*color:\s*#8a5300/);
    expect(ratio("#8a5300", LIGHT_SURFACES.card)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("UI-03 surfaces", () => {
  it("glass cards inside dark bands are solid, not 78% white over navy", () => {
    expect(publicCss).toMatch(
      /\.sherivs-band-dusk \.sherivs-glass-card \{[^}]*background:\s*#f4f7fb/,
    );
  });
  it("cyan text is scoped to dark bands", () => {
    expect(publicCss).toMatch(
      /\.sherivs-public \.text-sherivs-cyan[^{]*\{\s*color:\s*var\(--sherivs-link\)/,
    );
    expect(publicCss).toMatch(
      /\.sherivs-band-dusk \.text-sherivs-cyan \{\s*color:\s*var\(--sherivs-cyan\)/,
    );
  });
  it("white text on a blue gradient starts no lighter than #3366ff", () => {
    for (const [name, css] of [
      ["public", publicCss],
      ["entry", entryCss],
      ["shell", shellCss],
      ["passkey", passkeyCss],
      ["console", consoleCss],
    ] as const) {
      expect(css, name).not.toMatch(/linear-gradient\([^)]*#4b86ff 0%, #1848fd/);
    }
    expect(ratio("#ffffff", "#3366ff")).toBeGreaterThanOrEqual(4.5);
  });
});

describe("UI-03 fitTextOn", () => {
  it("returns a colour that already reads unchanged", () => {
    expect(fitTextOn("#184efd", LIGHT_THEME_SURFACE)).toBe("#184efd");
  });
  it("lightens the Sherivs blue for the dark theme to at least 4.5:1", () => {
    const out = fitTextOn("#184efd", DARK_THEME_SURFACE)!;
    expect(out).not.toBe("#184efd");
    expect(ratio(out, DARK_THEME_SURFACE)).toBeGreaterThanOrEqual(4.5);
  });
  it("the shipped dark default equals what the function computes", () => {
    expect(token(baseCss, "--tenant-primary-text-dark")).toBe(
      fitTextOn("#184efd", DARK_THEME_SURFACE),
    );
    expect(token(baseCss, "--tenant-primary-text-light")).toBe(
      fitTextOn("#184efd", LIGHT_THEME_SURFACE),
    );
  });
  it("darkens a pale school colour for the light theme", () => {
    const out = fitTextOn("#ffd166", LIGHT_THEME_SURFACE)!;
    expect(ratio(out, LIGHT_THEME_SURFACE)).toBeGreaterThanOrEqual(4.5);
  });
  it("lightens a very dark school colour for the dark theme", () => {
    const out = fitTextOn("#0a1a3a", DARK_THEME_SURFACE)!;
    expect(ratio(out, DARK_THEME_SURFACE)).toBeGreaterThanOrEqual(4.5);
  });
  it("keeps the hue direction: a red stays red-dominant", () => {
    const out = fitTextOn("#b00020", DARK_THEME_SURFACE)!;
    const r = Number.parseInt(out.slice(1, 3), 16);
    const g = Number.parseInt(out.slice(3, 5), 16);
    expect(r).toBeGreaterThan(g);
  });
  it("returns null for anything that is not a colour", () => {
    expect(fitTextOn("red", DARK_THEME_SURFACE)).toBeNull();
    expect(fitTextOn(null, DARK_THEME_SURFACE)).toBeNull();
    expect(fitTextOn("#184efd", "navy")).toBeNull();
  });
  it("ends at white or black when nothing in between reaches the target", () => {
    expect(fitTextOn("#777777", "#808080")).toMatch(/^#(000000|ffffff)$/);
  });
});

describe("UI-03 brand text wiring", () => {
  it("text-primary is no longer used for text; text-primary-text is", () => {
    for (const f of [
      "components/ui/button.tsx",
      "components/ui/radio-group.tsx",
      "routes/forgot-password.tsx",
    ]) {
      const src = read(f);
      expect(src, f).toContain("text-primary-text");
      expect(src, f).not.toMatch(/(^|[^-a-z])text-primary([^-a-z]|$)/);
    }
  });
  it("the light theme switches the token", () => {
    expect(baseCss).toMatch(
      /\.light,\s*\.light ::backdrop \{\s*--primary-text:\s*var\(--tenant-primary-text-light\)/,
    );
    expect(baseCss).toContain("--color-primary-text: var(--primary-text)");
  });
  it("the school's colour is fitted at runtime and cleared when none is chosen", () => {
    const ctx = read("contexts/app-context.tsx");
    expect(ctx).toContain("fitTextOn(colors.primary, DARK_THEME_SURFACE)");
    expect(ctx).toContain("fitTextOn(colors.primary, LIGHT_THEME_SURFACE)");
    expect(ctx).toContain('removeProperty("--tenant-primary-text-dark")');
    expect(ctx).toContain('removeProperty("--tenant-primary-text-light")');
  });
});

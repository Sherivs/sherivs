/**
 * Organization brand layer — controlled, validated, contrast-guaranteed.
 * Raw tenant colors must never reach CSS unvalidated.
 */
import { describe, expect, it } from "vitest";
import { contrastRatio } from "@/lib/experience/experience-platform";
import {
  deriveOrgBrandTokens,
  normalizeHex,
  orgBrandVariables,
} from "@/lib/experience-system/org-brand";

describe("normalizeHex", () => {
  it("accepts #rgb and #rrggbb, lower-casing and expanding", () => {
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
    expect(normalizeHex(" #1D4ED8 ")).toBe("#1d4ed8");
  });

  it.each([
    "red",
    "#12",
    "#12345",
    "#gggggg",
    "rgb(0,0,0)",
    "#fff;}body{display:none",
    "url(javascript:alert(1))",
    "var(--x)",
    "",
    null,
    undefined,
  ])("rejects %s", (bad) => {
    expect(normalizeHex(bad as string | null | undefined)).toBeNull();
  });
});

describe("deriveOrgBrandTokens", () => {
  const light = { surface: "#ffffff", text: "#0b1118" };
  const dark = { surface: "#0f1721", text: "#e9eff4" };

  it("guarantees AA text contrast for any accent on both themes", () => {
    const accents = ["#ffff00", "#ff0000", "#00ff00", "#0000ff", "#777777", "#ffffff", "#000000", "#1d4ed8", "#f4c542"];
    for (const accent of accents) {
      for (const surface of [light, dark]) {
        const t = deriveOrgBrandTokens({ accent, ...surface });
        expect(t, accent).not.toBeNull();
        expect(contrastRatio(t!.accentText, surface.surface), `${accent} text`).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(t!.accentFg, t!.accent), `${accent} fg`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("flags when an accent had to be adjusted", () => {
    expect(deriveOrgBrandTokens({ accent: "#ffff00", ...light })?.adjustedForContrast).toBe(true);
    expect(deriveOrgBrandTokens({ accent: "#17766b", ...light })?.adjustedForContrast).toBe(false);
  });

  it("returns null for an invalid accent", () => {
    expect(deriveOrgBrandTokens({ accent: "nope", ...light })).toBeNull();
  });
});

describe("orgBrandVariables", () => {
  it("emits only the four org custom properties for a valid accent", () => {
    const vars = orgBrandVariables("#1d4ed8");
    expect(Object.keys(vars).sort()).toEqual([
      "--sv-org-accent",
      "--sv-org-accent-fg",
      "--sv-org-accent-text-dark",
      "--sv-org-accent-text-light",
    ]);
    for (const v of Object.values(vars)) expect(v).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("emits nothing for hostile or invalid input", () => {
    expect(orgBrandVariables("#fff;background:url(x)")).toEqual({});
    expect(orgBrandVariables(null)).toEqual({});
  });
});

import { describe, expect, it } from "vitest";
import {
  BLACK_ON_COLOR,
  DARK_ON_COLOR,
  LIGHT_ON_COLOR,
  contrastBetween,
  parseHexColor,
  readableOn,
  tenantForegrounds,
} from "../../frontend/src/lib/brand/tenant-contrast";
import { customTenantColors } from "../../frontend/src/lib/brand/tenant-colors";

describe("tenant colour text contrast", () => {
  it("parses six and three digit hex and refuses everything else", () => {
    expect(parseHexColor("#184efd")).toEqual([24, 78, 253]);
    expect(parseHexColor(" #FFF ")).toEqual([255, 255, 255]);
    for (const bad of [
      "",
      null,
      undefined,
      "red",
      "#12",
      "#12345",
      "#1234567",
      "rgb(1,2,3)",
      "#ggg",
    ]) {
      expect(parseHexColor(bad as string | null | undefined)).toBeNull();
    }
  });

  it("measures contrast the standard way", () => {
    expect(contrastBetween("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastBetween("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    expect(contrastBetween("nope", "#ffffff")).toBeNull();
  });

  it("picks white on dark colours and navy on light colours", () => {
    expect(readableOn("#184efd")).toBe(LIGHT_ON_COLOR);
    expect(readableOn("#08154a")).toBe(LIGHT_ON_COLOR);
    expect(readableOn("#facc15")).toBe(DARK_ON_COLOR);
    expect(readableOn("#a7f3d0")).toBe(DARK_ON_COLOR);
    expect(readableOn("#ffffff")).toBe(DARK_ON_COLOR);
    expect(readableOn("#000000")).toBe(LIGHT_ON_COLOR);
  });

  it("reaches 4.5:1 text contrast for every sampled sRGB colour a school might pick", () => {
    let worst = 21;
    let blackUsed = 0;
    for (let r = 0; r < 256; r += 15) {
      for (let g = 0; g < 256; g += 15) {
        for (let b = 0; b < 256; b += 15) {
          const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
          const text = readableOn(hex)!;
          if (text === BLACK_ON_COLOR) blackUsed += 1;
          worst = Math.min(worst, contrastBetween(text, hex)!);
        }
      }
    }
    expect(worst).toBeGreaterThanOrEqual(4.5);
    expect(blackUsed).toBeGreaterThan(0);
  });

  it("uses the brand navy rather than black whenever navy or white already pass", () => {
    expect(readableOn("#facc15")).toBe(DARK_ON_COLOR);
    expect(readableOn("#184efd")).toBe(LIGHT_ON_COLOR);
  });

  it("keeps the default when no usable colour was chosen", () => {
    expect(readableOn(null)).toBeNull();
    expect(readableOn("teal")).toBeNull();
    expect(tenantForegrounds(null, null)).toEqual({
      primaryForeground: null,
      secondaryForeground: null,
    });
    expect(tenantForegrounds("#facc15", "#184efd")).toEqual({
      primaryForeground: DARK_ON_COLOR,
      secondaryForeground: LIGHT_ON_COLOR,
    });
  });

  it("treats a value that is not a hex colour as no custom colour", () => {
    expect(customTenantColors("red", "javascript:alert(1)")).toEqual({
      primary: null,
      secondary: null,
    });
    expect(customTenantColors("#c2410c", "url(x)")).toEqual({
      primary: "#c2410c",
      secondary: null,
    });
    expect(customTenantColors("#c2410c", "#f59e0b")).toEqual({
      primary: "#c2410c",
      secondary: "#f59e0b",
    });
  });
});

/**
 * Sherivs Experience Architecture — contracts and brand classification.
 *
 * Version-target: ACTIVE-V1 (organizational envelope). Frozen V2/V3
 * capabilities are not claimed as implemented by these tests.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PLATFORM_CATEGORY,
  PLATFORM_DOMAIN,
  PLATFORM_NAME,
  PLATFORM_TAGLINE,
} from "@/lib/platform";
import {
  SHERIVS_BREAKPOINTS,
  SHERIVS_COLOR_TOKENS,
  SHERIVS_COMPONENT_STATES,
  SHERIVS_LAYOUT_MODES,
  SHERIVS_TYPE_ROLES,
} from "@/lib/experience/sherivs-tokens";
import {
  PUBLIC_FOOTER_NAV,
  PUBLIC_PRIMARY_NAV,
  publishedPublicPaths,
  SHERIVS_PUBLIC_ROUTES,
} from "@/lib/experience/sherivs-public-ia";
import {
  composeOrganizationPublicExperience,
  UNIVERSAL_PUBLIC_SECTION_CATALOG,
} from "@/lib/experience/organization-public";
import { SCHOLAR_PUBLIC_SECTION_CONTRIBUTION } from "@/lib/scholar/experience/organization-public-scholar";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = (ref: string) => readFileSync(join(ROOT, ref), "utf8");

describe("Customer-facing brand is Sherivs", () => {
  it("presents Sherivs as Institutional Intelligence Infrastructure", () => {
    expect(PLATFORM_NAME).toBe("Sherivs");
    expect(PLATFORM_TAGLINE).toBe("Institutional Intelligence Infrastructure");
    expect(PLATFORM_CATEGORY).toBe("Institutional Intelligence Infrastructure");
    expect(PLATFORM_DOMAIN).toBe("sherivs.com");
  });

  it("does not bind a domain runtime into the platform identity module", () => {
    const platform = read("frontend/src/lib/platform.ts");
    expect(platform).not.toMatch(/Scholar/);
    expect(platform).toContain('PLATFORM_NAME = "Sherivs"');
  });
});

describe("Design token contracts", () => {
  it("defines proprietary color, type, state and layout vocabularies", () => {
    expect(SHERIVS_COLOR_TOKENS.map((token) => token.id)).toEqual(
      expect.arrayContaining(["foundation", "signal", "evidence", "verification"]),
    );
    expect(SHERIVS_TYPE_ROLES).toContain("display");
    expect(SHERIVS_TYPE_ROLES).toContain("metric");
    expect(SHERIVS_COMPONENT_STATES).toContain("unauthorized");
    expect(SHERIVS_LAYOUT_MODES).toContain("command");
    expect(SHERIVS_BREAKPOINTS.ultrawide).toBe(2560);
  });

  it("keeps CSS variables aligned with the token catalog", () => {
    const css = read("frontend/src/styles.css");
    for (const token of SHERIVS_COLOR_TOKENS) {
      expect(css).toContain(token.cssVar);
    }
    expect(css).toContain("prefers-reduced-motion");
  });
});

describe("Public information architecture", () => {
  it("publishes only honest routes and defers careers until real roles exist", () => {
    expect(publishedPublicPaths()).toContain("/");
    expect(publishedPublicPaths()).toContain("/platform/missions");
    expect(SHERIVS_PUBLIC_ROUTES.find((route) => route.path === "/careers")?.status).toBe(
      "deferred",
    );
    expect(SHERIVS_PUBLIC_ROUTES.find((route) => route.path === "/coregrid")?.status).toBe(
      "alias",
    );
  });

  it("gives the public site a complete footer without fabricated social profiles", () => {
    expect(PUBLIC_PRIMARY_NAV.map((item) => item.href)).toEqual([
      "/platform",
      "/solutions",
      "/security",
      "/enterprise",
      "/resources",
    ]);
    expect(Object.keys(PUBLIC_FOOTER_NAV)).toEqual([
      "Platform",
      "Solutions",
      "Company",
      "Resources",
      "Legal",
    ]);
    const footer = read("frontend/src/components/sherivs-public/shell.tsx");
    expect(footer).not.toMatch(/twitter\.com|linkedin\.com|facebook\.com/);
  });
});

describe("Organization public experience engine", () => {
  it("keeps the universal catalog domain-neutral", () => {
    expect(UNIVERSAL_PUBLIC_SECTION_CATALOG.map((section) => section.id)).toContain("hero");
    expect(UNIVERSAL_PUBLIC_SECTION_CATALOG.map((section) => section.id)).not.toContain(
      "admissions",
    );
  });

  it("loads education sections only from the Scholar runtime contribution", () => {
    const withoutRuntime = composeOrganizationPublicExperience({
      identity: {
        name: "Example Org",
        tagline: null,
        logoUrl: null,
        primaryColor: null,
        secondaryColor: null,
      },
      runtimeId: null,
      enabledFlags: {},
      runtimeContributions: [SCHOLAR_PUBLIC_SECTION_CONTRIBUTION],
    });
    expect(withoutRuntime.sections.some((section) => section.id === "admissions")).toBe(false);

    const withScholar = composeOrganizationPublicExperience({
      identity: {
        name: "Example Org",
        tagline: null,
        logoUrl: null,
        primaryColor: null,
        secondaryColor: null,
      },
      runtimeId: "runtime:scholar",
      enabledFlags: {},
      runtimeContributions: [SCHOLAR_PUBLIC_SECTION_CONTRIBUTION],
    });
    expect(withScholar.sections.some((section) => section.id === "admissions" && section.enabled)).toBe(
      true,
    );
  });
});

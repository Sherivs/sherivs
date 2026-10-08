/**
 * Sherivs Experience Architecture — V1 contracts and brand boundaries.
 *
 * These tests lock what the experience program actually shipped: customer-facing
 * brand, public catalog honesty, experience configuration validation, and
 * Scholar-only public sections staying behind the education runtime.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  KERNEL_NAME,
  PLATFORM_NAME,
  PLATFORM_PUBLIC_DOMAIN,
  PLATFORM_TAGLINE,
  PRODUCT_JARVIS,
} from "@/lib/platform";
import { INSTALLED_RUNTIME_PRODUCT } from "@/lib/runtime/installed-runtimes";
import {
  isLegalSlug,
  isPlatformSlug,
  isResourceSlug,
  isSolutionSlug,
  SHERIVS_PUBLIC_ROUTES,
} from "@/lib/experience/public-catalog";
import { parseExperienceConfiguration } from "@/lib/experience/experience-contract";
import { resolveOrgPublicExperience } from "@/lib/experience/org-public-experience";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = (ref: string) => readFileSync(join(ROOT, ref), "utf8");

describe("Customer-facing brand", () => {
  it("names Sherivs as the platform and keeps CoreGrid as the kernel name", () => {
    expect(PLATFORM_NAME).toBe("Sherivs");
    expect(PLATFORM_TAGLINE).toBe("Institutional Intelligence Infrastructure");
    expect(PLATFORM_PUBLIC_DOMAIN).toBe("sherivs.com");
    expect(KERNEL_NAME).toBe("CoreGrid");
    expect(INSTALLED_RUNTIME_PRODUCT).toBe("Sherivs Scholar");
    expect(PRODUCT_JARVIS).toBe("Jarvis");
  });

  it("does not use CoreGrid as PLATFORM_NAME", () => {
    expect(read("frontend/src/lib/platform.ts")).toContain('export const PLATFORM_NAME = "Sherivs"');
    expect(read("frontend/src/lib/platform.ts")).not.toMatch(
      /export const PLATFORM_NAME = "CoreGrid"/,
    );
  });

  it("keeps domain-runtime product names out of the platform identity module", () => {
    const identity = read("frontend/src/lib/platform.ts");
    expect(identity).not.toMatch(/scholar/i);
    expect(identity).toMatch(/universalschoolos\.com/);
  });
});

describe("Public catalog honesty", () => {
  it("marks unpublished editorial catalogs empty instead of inventing posts", () => {
    const empty = SHERIVS_PUBLIC_ROUTES.filter((route) => route.capability === "empty_catalog");
    expect(empty.map((route) => route.path).sort()).toEqual([
      "/careers",
      "/resources/blog",
      "/resources/case-studies",
      "/resources/guides",
    ]);
  });

  it("keeps compatibility for /coregrid and lives routes for pricing and status", () => {
    expect(SHERIVS_PUBLIC_ROUTES.find((route) => route.path === "/coregrid")?.capability).toBe(
      "compatibility",
    );
    expect(SHERIVS_PUBLIC_ROUTES.find((route) => route.path === "/pricing")?.capability).toBe("live");
    expect(SHERIVS_PUBLIC_ROUTES.find((route) => route.path === "/status")?.capability).toBe("live");
  });

  it("validates public slugs and rejects unknown ones", () => {
    expect(isPlatformSlug("reality")).toBe(true);
    expect(isPlatformSlug("org")).toBe(false);
    expect(isSolutionSlug("education")).toBe(true);
    expect(isLegalSlug("privacy")).toBe(true);
    expect(isResourceSlug("blog")).toBe(true);
    expect(isResourceSlug("secret")).toBe(false);
  });

  it("does not fabricate social profile URLs", () => {
    const shell = read("frontend/src/components/experience/public-shell.tsx");
    expect(shell).not.toMatch(/twitter\.com|linkedin\.com|facebook\.com|instagram\.com/);
    expect(shell).toContain("No social profiles are published");
  });
});

describe("Experience configuration contract", () => {
  it("accepts a governed configuration and rejects arbitrary UI payloads", () => {
    const config = parseExperienceConfiguration({
      plane: "organization_workspace",
      tenantId: "tenant:alpha",
      runtimeIds: ["runtime:scholar"],
      roleTitle: "Organization administrator",
      theme: "system",
      density: "comfortable",
      contrast: "standard",
      locale: "en",
      navigation: [{ id: "overview", label: "Overview", href: "/admin/dashboard" }],
      capabilities: ["r001:org_admin.operations"],
    });
    expect(config.plane).toBe("organization_workspace");
    expect(() =>
      parseExperienceConfiguration({
        plane: "public_sherivs",
        tenantId: null,
        runtimeIds: [],
        roleTitle: "",
        theme: "neon",
        density: "comfortable",
        contrast: "standard",
        locale: "en",
        navigation: [],
        capabilities: [],
      }),
    ).toThrow();
  });
});

describe("Organization public experience engine", () => {
  it("loads Scholar admissions only when the Scholar runtime is active", () => {
    const scholar = resolveOrgPublicExperience({
      orgName: "North Campus",
      runtime: "scholar",
      flags: { section_admissions_enabled: true },
    });
    expect(scholar.sections.some((section) => section.id === "admissions")).toBe(true);

    const generic = resolveOrgPublicExperience({
      orgName: "North Campus",
      runtime: "none",
      flags: { section_admissions_enabled: true },
    });
    expect(generic.sections.some((section) => section.id === "admissions")).toBe(false);
    expect(generic.sections.some((section) => section.id === "about")).toBe(true);
  });
});

describe("Public homepage narrative", () => {
  it("renders the public narrative without waiting on session lookup on the platform host", () => {
    const index = read("frontend/src/routes/index.tsx");
    expect(index).toContain("loading && hostSlug");
    expect(read("frontend/src/contexts/app-context.tsx")).toContain("remainPublicVisitor");
  });

  it("introduces Sherivs as the brand and keeps mission/capability anchors", () => {
    const home = read("frontend/src/components/experience/public-home.tsx");
    expect(home).toContain("id=\"sherivs-hero\"");
    expect(home).toContain("PLATFORM_TAGLINE");
    expect(home).toContain("id=\"capabilities\"");
    expect(home).toContain("Mission → workforce → execution → evidence → verification → outcome");
    expect(home).not.toMatch(/<form\b/);
  });
});

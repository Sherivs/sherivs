/**
 * Sherivs experience system — brand boundary, narrative honesty, and
 * experience configuration. Structural and contract tests only.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PLATFORM_NAME, PLATFORM_ORIGIN, TECHNICAL_SUBSTRATE_NAME } from "@/lib/platform";
import { SHERIVS_BRAND, SHERIVS_SOCIAL_PROFILES } from "@/lib/sherivs/brand";
import { HOME_NARRATIVE } from "@/lib/sherivs/narrative";
import { DOCUMENTS, PUBLIC_PAGES, documentBySlug, publicSitemapPaths } from "@/lib/sherivs/pages";
import { parseExperienceConfiguration, visibleByCapability } from "@/lib/sherivs/experience-contract";
import { filterOrganizationPublicSections } from "@/lib/sherivs/organization-public";
import { ACCOUNT_SURFACES } from "@/lib/sherivs/account";
import { ORGANIZATION_WORKSPACE_NAV } from "@/lib/sherivs/navigation";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = (ref: string) => readFileSync(join(ROOT, ref), "utf8");

const FORBIDDEN_CLAIMS =
  /\btrusted by\b|\btestimonials?\b|customers include|99\.9%|as seen on|lorem ipsum|10,000\+|fake logo/i;

describe("Sherivs brand boundary", () => {
  it("presents Sherivs to customers and preserves the technical substrate name", () => {
    expect(PLATFORM_NAME).toBe("Sherivs");
    expect(SHERIVS_BRAND.name).toBe("Sherivs");
    expect(SHERIVS_BRAND.tagline).toBe("Institutional Intelligence Infrastructure");
    expect(PLATFORM_ORIGIN).toBe("https://sherivs.com");
    expect(TECHNICAL_SUBSTRATE_NAME).toBe("CoreGrid");
    expect(SHERIVS_BRAND.educationRuntime).toBe("Scholar");
    expect(SHERIVS_BRAND.executiveIntelligence).toBe("Jarvis");
  });

  it("publishes no invented social profiles", () => {
    expect(SHERIVS_SOCIAL_PROFILES).toEqual([]);
  });

  it("keeps the platform identity module free of a runtime's symbol", () => {
    const platform = read("frontend/src/lib/platform.ts");
    expect(platform).not.toContain("SCHOLAR_RUNTIME");
  });
});

describe("Homepage narrative", () => {
  it("tells twelve sections in order, starting with the brand", () => {
    expect(HOME_NARRATIVE).toHaveLength(12);
    expect(HOME_NARRATIVE.map((section) => section.index)).toEqual([
      "01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12",
    ]);
    expect(HOME_NARRATIVE[0]?.title).toBe("Sherivs");
    expect(HOME_NARRATIVE[5]?.sequence?.map((step) => step.label)).toEqual([
      "Mission", "Workforce", "Execution", "Evidence", "Verification", "Outcome",
    ]);
  });

  it("does not invent customers, metrics, or testimonials", () => {
    const prose = HOME_NARRATIVE.flatMap((section) => [
      section.title,
      ...section.paragraphs,
      ...(section.terms ?? []).flatMap((term) => [term.label, term.text]),
      ...(section.sequence ?? []).flatMap((step) => [step.label, step.text]),
    ]).join("\n");
    expect(prose).not.toMatch(FORBIDDEN_CLAIMS);
  });
});

describe("Public pages", () => {
  it("ships the requested surfaces that have real or explicitly empty content", () => {
    const paths = PUBLIC_PAGES.map((page) => page.path);
    for (const path of [
      "/platform/reality",
      "/platform/memory",
      "/platform/ai-workforce",
      "/platform/missions",
      "/platform/intelligence",
      "/platform/governance",
      "/platform/integrations",
      "/solutions",
      "/solutions/education",
      "/security",
      "/pricing",
      "/resources/blog",
      "/legal/privacy",
      "/status",
      "/request-demo",
    ]) {
      expect(paths, path).toContain(path);
    }
  });

  it("marks legal pages as notices, not instruments", () => {
    for (const page of PUBLIC_PAGES.filter((item) => item.path.startsWith("/legal/"))) {
      expect(page.lede.toLowerCase()).toContain("not a legal instrument");
    }
  });

  it("publishes three real documents and refuses unknown slugs", () => {
    expect(DOCUMENTS).toHaveLength(3);
    expect(documentBySlug("authorization")?.title).toBe("How a request is authorized");
    expect(documentBySlug("not-a-real-essay")).toBeUndefined();
  });

  it("keeps public copy free of fabricated claims", () => {
    const prose = [...PUBLIC_PAGES, ...DOCUMENTS]
      .flatMap((page) => [page.title, page.lede, ...page.sections.flatMap((section) => section.paragraphs)])
      .join("\n");
    expect(prose).not.toMatch(FORBIDDEN_CLAIMS);
  });

  it("lists public paths for the sitemap, including the homepage and proof page", () => {
    const paths = publicSitemapPaths();
    expect(paths).toContain("/");
    expect(paths).toContain("/coregrid");
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe("Experience configuration", () => {
  it("rejects an organization workspace without a tenant", () => {
    const result = parseExperienceConfiguration({
      plane: "organization-workspace",
      tenantId: null,
      runtimeId: "runtime:scholar",
      actorId: "user:1",
      capabilities: [],
      theme: "system",
      locale: "en",
      timeZone: "Africa/Lagos",
    });
    expect(result.success).toBe(false);
  });

  it("rejects the internal workspace when a customer tenant is attached", () => {
    const result = parseExperienceConfiguration({
      plane: "internal",
      tenantId: "tenant:customer",
      runtimeId: null,
      actorId: "user:1",
      capabilities: [],
      theme: "light",
      locale: "en",
      timeZone: "UTC",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a public configuration with no tenant", () => {
    const result = parseExperienceConfiguration({
      plane: "public",
      tenantId: null,
      runtimeId: null,
      actorId: null,
      capabilities: [],
      theme: "system",
      locale: "en",
      timeZone: "UTC",
    });
    expect(result.success).toBe(true);
  });

  it("hides workspace areas the actor is not capable of", () => {
    const visible = visibleByCapability(ORGANIZATION_WORKSPACE_NAV, ["org.calendar"]);
    expect(visible.map((item) => item.id)).toEqual(["calendar"]);
  });
});

describe("Organization public sections", () => {
  const sections = [
    { id: "about" },
    { id: "academics" },
    { id: "admissions-cta" },
    { id: "contact" },
  ];

  it("keeps education sections only while the education runtime is active", () => {
    expect(filterOrganizationPublicSections(sections, { educationRuntime: true }).map((s) => s.id)).toEqual([
      "about",
      "academics",
      "admissions-cta",
      "contact",
    ]);
    expect(filterOrganizationPublicSections(sections, { educationRuntime: false }).map((s) => s.id)).toEqual([
      "about",
      "contact",
    ]);
  });
});

describe("Account surface honesty", () => {
  it("offers profile, password, and privacy, and names the controls that are absent", () => {
    const byId = new Map(ACCOUNT_SURFACES.map((surface) => [surface.id, surface.status]));
    expect(byId.get("profile")).toBe("available");
    expect(byId.get("password")).toBe("available");
    expect(byId.get("privacy")).toBe("available");
    expect(byId.get("mfa")).toBe("unavailable");
    expect(byId.get("deletion")).toBe("unavailable");
  });
});

describe("Public homepage is not the operator console", () => {
  it("renders the narrative on / and moves provisioning behind the authenticated command centre", () => {
    const index = read("frontend/src/routes/index.tsx");
    expect(index).toContain("HomeNarrative");
    expect(index).not.toContain("CommandCentre");
    const provision = read("frontend/src/routes/_authenticated/command-centre/provision.tsx");
    expect(provision).toContain('createFileRoute("/_authenticated/command-centre/provision")');
    expect(provision).toContain("CommandCentre");
  });
});

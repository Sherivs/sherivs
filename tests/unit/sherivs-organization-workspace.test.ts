/**
 * Sherivs organization workspace — Plane C path contract, membership facade, hosts.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  bindNavUrl,
  bindOrganizationPath,
  isLegacyScholarPath,
  organizationWorkspacePath,
  parseOrganizationPath,
  scholarBoundHome,
  scholarRuntimePath,
  workspaceLeafPath,
} from "@/lib/experience/organization-routes";
import { resolveExperienceHost } from "@/lib/experience/experience-host";
import {
  membershipFromLegacyProfile,
  ORGANIZATION_MEMBERSHIP_SOURCE,
  organizationFromSchoolRow,
} from "@/lib/identity/organization-membership";
import { PLATFORM_OG_IMAGE_PATH, PLATFORM_PUBLIC_ORIGIN } from "@/lib/platform";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = (ref: string) => readFileSync(join(ROOT, ref), "utf8");

describe("organization path contract", () => {
  it("binds Scholar role leaves under /o/{org}/scholar", () => {
    expect(organizationWorkspacePath("northwind")).toBe("/o/northwind");
    expect(scholarRuntimePath("northwind")).toBe("/o/northwind/scholar");
    expect(bindOrganizationPath("northwind", "/teacher/dashboard")).toBe(
      "/o/northwind/scholar/teacher/dashboard",
    );
    expect(scholarBoundHome("northwind", "/admin/dashboard")).toBe(
      "/o/northwind/scholar/admin/dashboard",
    );
    expect(isLegacyScholarPath("/teacher/dashboard")).toBe(true);
    expect(isLegacyScholarPath("/o/northwind/scholar/teacher/dashboard")).toBe(false);
  });

  it("leaves universal shell paths unbound (those file routes stay top-level)", () => {
    expect(bindNavUrl("northwind", "/messages")).toBe("/messages");
    expect(bindNavUrl("northwind", "/teacher/grades")).toBe(
      "/o/northwind/scholar/teacher/grades",
    );
  });

  it("compares bound and LEGACY Scholar URLs as the same leaf", () => {
    expect(workspaceLeafPath("/o/northwind/scholar/admin/dashboard")).toBe("/admin/dashboard");
    expect(workspaceLeafPath("/admin/dashboard")).toBe("/admin/dashboard");
    expect(parseOrganizationPath("/o/acme/scholar/teacher/grades").scholarLeaf).toBe(
      "/teacher/grades",
    );
  });
});

describe("organization membership facade", () => {
  it("projects live public.schools rows without renaming the table", () => {
    const org = organizationFromSchoolRow(
      { id: "sch-1", slug: "northwind", name: "Northwind" },
      "runtime:scholar",
    );
    expect(org.source).toBe(ORGANIZATION_MEMBERSHIP_SOURCE);
    expect(org.slug).toBe("northwind");

    const membership = membershipFromLegacyProfile(
      { id: "user-1", school_id: "sch-1", role: "teacher" },
      { id: "sch-1", slug: "northwind", name: "Northwind" },
      "runtime:scholar",
    );
    expect(membership?.hasMembership).toBe(true);
    expect(membership?.organization.source).toBe("legacy_schools_table");
  });

  it("rejects mismatched profile/school ids", () => {
    expect(
      membershipFromLegacyProfile(
        { id: "user-1", school_id: "sch-a", role: "teacher" },
        { id: "sch-b", slug: "other", name: "Other" },
        "runtime:scholar",
      ),
    ).toBeNull();
  });
});

describe("experience hosts", () => {
  it("classifies intended Sherivs hosts before DNS cutover", () => {
    expect(resolveExperienceHost("sherivs.com")).toBe("public_platform");
    expect(resolveExperienceHost("app.sherivs.com")).toBe("app");
    expect(resolveExperienceHost("internal.sherivs.com")).toBe("internal");
    expect(resolveExperienceHost("northwind.sherivs.com")).toBe("tenant");
    expect(resolveExperienceHost("localhost")).toBe("local");
  });
});

describe("in-repo OG and onboarding surfaces", () => {
  it("ships a same-origin OG image", () => {
    expect(PLATFORM_OG_IMAGE_PATH).toBe("/og-image.png");
    expect(existsSync(join(ROOT, "public/og-image.png"))).toBe(true);
    expect(PLATFORM_PUBLIC_ORIGIN).toBe("https://sherivs.com");
  });

  it("registers /onboarding and /o/$organization in the route tree", () => {
    const tree = read("frontend/src/routeTree.gen.ts");
    expect(tree).toContain("'/onboarding'");
    expect(tree).toContain("'/_authenticated/o/$organization'");
    expect(tree).toContain("'/_authenticated/o/$organization/scholar/$'");
  });

  it("collects organization-first onboarding without education-as-default copy", () => {
    const page = read("frontend/src/routes/onboarding.tsx");
    expect(page).toContain("Create an organization");
    expect(page).toContain("createOrganizationOnboarding");
    expect(page).not.toMatch(/school name/i);
  });
});

/**
 * CoreGrid — R40 surface renderer tests.
 *
 * The served surfaces (generated site, served manifest, generated runtime) are
 * thin renderers over view-models, so the LAWS they must not break are tested
 * here rather than in a DOM:
 *
 *  - navigation and manifest shortcuts come from one source and cannot disagree;
 *  - approval-required sections are never presented as published content;
 *  - a tenant-less environment is labelled a preview, not published;
 *  - the runtime is composed from server-derived roles only, and states an empty
 *    result (with the reason) instead of inventing one;
 *  - no surface carries a per-organization or per-role branch.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DASHBOARD_CONTRIBUTIONS } from "@/lib/scholar/dashboards/contribution-catalog";
import { platformOrgRoles } from "@/lib/scholar/platform-org/platform-workspace-engine";
import { EDUCATION_REALITY_ROLES } from "@/lib/scholar/roles/role-registry";
import { workspacesForRoles } from "@/lib/scholar/roles/role-workspace-engine";
import {
  buildGeneratedSiteView,
  classAudienceIndex,
  isPreviewOnly,
  organizationClassLabel,
} from "@/lib/surfaces/generated-site-view";
import { buildRuntimeView } from "@/lib/surfaces/runtime-view";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

describe("R40 — generated site view (one source for site + manifest)", () => {
  const view = buildGeneratedSiteView({ orgType: "islamic_school" });

  it("derives display labels from the class key, never from a lookup table", () => {
    expect(organizationClassLabel("islamic_school")).toBe("Islamic School");
    expect(organizationClassLabel("multi-campus_network")).toBe("Multi Campus Network");
    expect(organizationClassLabel("school")).toBe("School");
  });

  it("serves exactly the sections it navigates, and anchors are stable ids", () => {
    expect(view.blocks.length).toBeGreaterThan(0);
    for (const block of view.blocks) {
      expect(block.anchor).toBe(`#${block.section}`);
      expect(view.navigation.some((item) => item.section === block.section)).toBe(true);
    }
    expect(view.navigation.every((item) => item.anchor === `#${item.section}`)).toBe(true);
  });

  it("keeps manifest shortcuts pointing at the anchors this page renders", () => {
    expect(view.manifestIssues).toEqual([]);
    expect(view.installable).toBe(true);
    expect(view.manifest.shortcuts.length).toBeGreaterThan(0);
    for (const shortcut of view.manifest.shortcuts) {
      const hash = `#${shortcut.url.split("#")[1]}`;
      expect(view.navigation.some((item) => item.anchor === hash)).toBe(true);
    }
    expect(view.manifest.theme_color).toBe(view.brand.primaryColor);
  });

  it("labels a tenant-less environment as a preview instead of publishing it", () => {
    const preview = buildGeneratedSiteView({ orgType: "school", tenantId: null });
    expect(isPreviewOnly(preview)).toBe(true);
    expect(preview.governance.ok).toBe(false);

    const bound = buildGeneratedSiteView({ orgType: "school", tenantId: "school:t-1" });
    expect(isPreviewOnly(bound)).toBe(false);
    expect(bound.governance.issues.join(" ")).not.toContain("no tenant context");
  });

  it("never presents an approval-required section as published content", () => {
    for (const block of view.blocks) {
      const requiresApproval = view.experience.requiresApproval.includes(block.section);
      expect(block.awaitingApproval).toBe(requiresApproval);
    }
    expect(view.blocks.filter((block) => block.awaitingApproval).length).toBeLessThanOrEqual(
      view.experience.requiresApproval.length,
    );
  });

  it("declares every native shell adapter with no validation issue", () => {
    expect(view.shells).toHaveLength(3);
    for (const shell of view.shells) {
      expect(shell.issues).toEqual([]);
    }
  });

  it("keeps non-education classes honest: only universal sections, no education codes", () => {
    const company = buildGeneratedSiteView({ orgType: "company" });
    for (const block of company.blocks) {
      expect(block.rationale).toEqual(["universal-section"]);
    }
    expect(company.experience.reality.featureKeys).toEqual([]);
    // Education sections NEVER render for a non-education class — the generated
    // site is organization reality, not Scholar's site wearing another label.
    const sections = company.blocks.map((block) => block.section);
    for (const educationSection of [
      "admissions",
      "programs",
      "curriculum",
      "departments",
      "student_life",
    ]) {
      expect(sections).not.toContain(educationSection);
    }
    // Genuinely universal sections still serve every organization.
    for (const universalSection of ["home", "about", "leadership", "news", "contact"]) {
      expect(sections).toContain(universalSection);
    }
  });

  it("education sections render from education reality, never from the class label", () => {
    const school = buildGeneratedSiteView({ orgType: "school" });
    const sections = school.blocks.map((block) => block.section);
    for (const educationSection of ["admissions", "programs", "curriculum", "student_life"]) {
      expect(sections).toContain(educationSection);
      expect(
        school.blocks.find((block) => block.section === educationSection)?.rationale,
      ).toContain("feature:curriculum.core");
    }

    // An unknown class key gets the NEUTRAL site — identical to a declared
    // non-education class, never the school site.
    const unknown = buildGeneratedSiteView({ orgType: "not-a-known-class" });
    expect(unknown.blocks.map((block) => block.section)).toEqual(
      buildGeneratedSiteView({ orgType: "company" }).blocks.map((block) => block.section),
    );
  });

  it("maps audiences back to the role categories that produce them", () => {
    const index = classAudienceIndex("boarding_school");
    // Public/relationship audiences are reached without a workforce category.
    expect(index.map((entry) => entry.audience)).toContain("public_visitor");
    const roleBacked = index.filter((entry) => entry.roleCategories.length > 0);
    expect(roleBacked.length).toBeGreaterThan(0);
    for (const entry of roleBacked) {
      expect(entry.audience).not.toBe("public_visitor");
    }
  });
});

describe("R40 — generated runtime view (server-derived, fail-closed)", () => {
  it("shows nothing and says why when no tenant scope resolved", () => {
    const view = buildRuntimeView({ tenantId: null, roleIds: [], enabledCodes: [] });
    expect(view.workspaces).toEqual([]);
    expect(view.landing).toBeNull();
    expect(view.platformDepartments).toEqual([]);
    expect(view.notices.join(" ")).toContain("No tenant scope");
  });

  it("composes workspaces from the role engine, and widgets only when enabled", () => {
    // A real (role, contribution) pair: the role's category participates in the
    // contribution AND the role staffs the workspace the widget lives in.
    const pair = EDUCATION_REALITY_ROLES.flatMap((role) =>
      DASHBOARD_CONTRIBUTIONS.filter(
        (contribution) =>
          contribution.roleCategories.includes(role.category) &&
          role.workspaceRequirements.includes(contribution.workspace),
      ).map((contribution) => ({ role, contribution })),
    )[0];
    expect(pair, "the catalog must offer a contribution a real role can reach").toBeDefined();
    if (!pair) return;
    const { role, contribution } = pair;

    const withoutCodes = buildRuntimeView({
      tenantId: "t-1",
      roleIds: [role.id],
      enabledCodes: [],
    });
    expect(withoutCodes.workspaces.map((workspace) => workspace.workspace)).toEqual(
      workspacesForRoles([role.id]).map((assignment) => assignment.workspace),
    );
    expect(withoutCodes.workspaces.every((workspace) => workspace.widgets.length === 0)).toBe(true);
    expect(withoutCodes.notices.join(" ")).toContain("no feature code is enabled");
    expect(withoutCodes.landing).not.toBeNull();

    const enabled = buildRuntimeView({
      tenantId: "t-1",
      roleIds: [role.id],
      enabledCodes: [contribution.featureCode],
    });
    const workspace = enabled.workspaces.find(
      (entry) => entry.workspace === contribution.workspace,
    );
    const widget = workspace?.widgets.find((entry) => entry.code === contribution.code);
    expect(widget, "an enabled feature must reach its role's workspace").toBeDefined();
    expect(widget?.reason).toContain(`feature:${contribution.featureCode}`);
  });

  it("ignores unknown role ids and surfaces them rather than trusting them", () => {
    const view = buildRuntimeView({
      tenantId: "t-1",
      roleIds: ["role:not-a-real-role"],
      enabledCodes: [],
    });
    expect(view.roleIds).toEqual([]);
    expect(view.unknownRoleIds).toEqual(["role:not-a-real-role"]);
    expect(view.notices.join(" ")).toContain("not in the reality catalog");
  });

  it("derives CoreGrid departments from platform roles only", () => {
    const platformRole = platformOrgRoles()[0];
    expect(platformRole).toBeDefined();
    if (!platformRole) return;

    const asPlatform = buildRuntimeView({
      tenantId: "t-1",
      roleIds: [platformRole],
      enabledCodes: [],
    });
    expect(asPlatform.platformDepartments.length).toBeGreaterThan(0);

    const tenantOnly = EDUCATION_REALITY_ROLES.find(
      (candidate) => !platformOrgRoles().includes(candidate.id),
    );
    expect(tenantOnly).toBeDefined();
    if (!tenantOnly) return;
    const asTenant = buildRuntimeView({
      tenantId: "t-1",
      roleIds: [tenantOnly.id],
      enabledCodes: [],
    });
    expect(asTenant.platformDepartments).toEqual([]);
  });
});

describe("R40 — surfaces carry no per-organization or per-role branch", () => {
  const SURFACE_SOURCES = [
    ...readdirSync(join(ROOT, "frontend/src/lib/surfaces")).map((name) =>
      join(ROOT, "frontend/src/lib/surfaces", name),
    ),
    join(ROOT, "frontend/src/components/generated/generated-site.tsx"),
    join(ROOT, "frontend/src/routes/reality.$class.tsx"),
    join(ROOT, "frontend/src/routes/_authenticated/runtime.tsx"),
    join(ROOT, "frontend/src/routes/marketplace.tsx"),
    join(ROOT, "frontend/src/routes/platform.org.tsx"),
    join(ROOT, "frontend/src/routes/manifest[.]webmanifest.ts"),
  ];

  it("scans real sources and finds no institution or role branch", () => {
    expect(SURFACE_SOURCES.length).toBeGreaterThanOrEqual(7);
    const offenders: string[] = [];
    for (const file of SURFACE_SOURCES) {
      const source = readFileSync(file, "utf8");
      const name = file.replace(/\\/g, "/").split("/").slice(-2).join("/");
      for (const pattern of [
        /if\s*\(\s*orgType\s*===/,
        /if\s*\(\s*role\s*===/,
        /if\s*\(\s*schoolType\s*===/,
        /if\s*\(\s*institutionType\s*===/,
        /"(?:School|Teacher|Parent|Student)Portal"/,
        /"SchoolDashboard"/,
      ]) {
        if (pattern.test(source)) offenders.push(`${name}: ${pattern}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("renders engine output instead of restating it", () => {
    const runtime = readFileSync(
      join(ROOT, "frontend/src/routes/_authenticated/runtime.tsx"),
      "utf8",
    );
    expect(runtime).toContain("buildRuntimeView");
    expect(runtime).toContain("getMyRealityRoles");
    expect(runtime).not.toMatch(/roleIds\s*:\s*\["/); // never a client-side role list

    const platformOrg = readFileSync(join(ROOT, "frontend/src/routes/platform.org.tsx"), "utf8");
    expect(platformOrg).toContain("platformOrgSnapshot");
    expect(platformOrg).toContain("auditPlatformOrg");

    const manifest = readFileSync(
      join(ROOT, "frontend/src/routes/manifest[.]webmanifest.ts"),
      "utf8",
    );
    expect(manifest).toContain("buildGeneratedSiteView");
    expect(manifest).toContain("application/manifest+json");

    const root = readFileSync(join(ROOT, "frontend/src/routes/__root.tsx"), "utf8");
    expect(root).toContain('{ rel: "manifest", href: "/manifest.webmanifest" }');
  });

  it("ships real generated icons for the manifest it validates", () => {
    const iconDir = join(ROOT, "public/icons");
    for (const [file, size] of [
      ["icon-192.png", 192],
      ["icon-512.png", 512],
      ["maskable-512.png", 512],
    ] as const) {
      const bytes = readFileSync(join(iconDir, file));
      expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      expect(bytes.readUInt32BE(16)).toBe(size);
      expect(bytes.readUInt32BE(20)).toBe(size);
    }
  });
});

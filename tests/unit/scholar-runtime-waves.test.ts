/**
 * Sherivs Scholar — runtime waves R32/R34/R35/R36 laws.
 *
 * R32: Sherivs is a living organization — its departments are generated from the
 *      SHERIVS_INTERNAL roles and its widgets are data.
 * R34: dashboards come from enabled feature codes + authorized role categories;
 *      no widget exists without the feature that owns it.
 * R35: the PWA manifest and the native shell adapters are generated from the
 *      brand, the reality's sections and per-shell data.
 * R36: the operator surface renders a generated experience for an organization
 *      class, and non-education classes stay education-feature-free.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PLATFORM_DEPARTMENTS,
  PLATFORM_WIDGET_KEYS,
} from "@/lib/scholar/platform-org/department-catalog";
import {
  auditPlatformOrg,
  platformInternalWorkspaces,
  platformOrgRoles,
  platformOrgSnapshot,
  platformWorkspaceForRoles,
} from "@/lib/scholar/platform-org/platform-workspace-engine";
import { DASHBOARD_CONTRIBUTIONS } from "@/lib/scholar/dashboards/contribution-catalog";
import {
  auditDashboardContributions,
  composeDashboardGrids,
  contributionIndexForCodes,
} from "@/lib/scholar/dashboards/grid-engine";
import { featureCodesForReality } from "@/lib/scholar/capability-codes";
import { buildWebAppManifest, validateWebAppManifest } from "@/lib/scholar/pwa/manifest-engine";
import {
  SHELL_TARGETS,
  nativeShellAdapter,
  shellAdapterMatrix,
  validateShellAdapter,
} from "@/lib/scholar/pwa/shell-adapters";
import { defaultBrand } from "@/lib/scholar/experience/experience-brand";
import { generateExperience } from "@/lib/scholar/experience/experience-engine";
import {
  EXPERIENCE_REALITY_PRESETS,
  NEUTRAL_REALITY,
  realityForOrgType,
} from "@/lib/scholar/experience/experience-presets";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

const BOARDING = {
  featureKeys: [
    "curriculum.core",
    "schedule.boarding",
    "curriculum.religious",
    "community.private",
  ],
  templateRefs: ["boarding_school", "islamic_madrassa"],
  curriculumFlavour: "islamic" as const,
};

describe("R32 — CoreGrid internal operating workspace", () => {
  it("audits clean and staffs every department from the role engine", () => {
    expect(auditPlatformOrg()).toEqual([]);
    expect(PLATFORM_DEPARTMENTS.length).toBeGreaterThanOrEqual(6);
    expect(platformOrgRoles().length).toBeGreaterThanOrEqual(40);
    expect(PLATFORM_WIDGET_KEYS.length).toBeGreaterThanOrEqual(20);
  });

  it("generates only the departments an actor's roles staff", () => {
    const engineering = platformWorkspaceForRoles(["role:backend-engineer"]);
    expect(engineering.map((entry) => entry.department)).toEqual(["engineering"]);
    expect(engineering[0].widgets).toContain("deployment_status");

    expect(platformWorkspaceForRoles(["role:ai-safety-engineer"])).toHaveLength(1);
    expect(platformWorkspaceForRoles(["role:ai-safety-engineer"])[0].department).toBe("ai");
    expect(platformWorkspaceForRoles(["role:chief-technology-officer"])[0].department).toBe(
      "executive",
    );
    expect(platformWorkspaceForRoles(["role:subject-teacher"])).toEqual([]);
  });

  it("composes the platform internal workspaces from platform roles only", () => {
    const workspaces = platformInternalWorkspaces([
      "role:backend-engineer",
      "role:subject-teacher",
    ]);
    expect(workspaces.map((entry) => entry.workspace)).toContain("platform");
  });

  it("publishes a deterministic snapshot", () => {
    const snapshot = platformOrgSnapshot();
    expect(snapshot.departments.length).toBe(PLATFORM_DEPARTMENTS.length);
    expect(snapshot.roleCount).toBe(platformOrgRoles().length);
    expect(snapshot.widgetCount).toBe(PLATFORM_WIDGET_KEYS.length);
  });
});

describe("R34 — data-driven dashboard grids", () => {
  it("audits clean and binds every widget to a feature code", () => {
    expect(auditDashboardContributions()).toEqual([]);
    expect(DASHBOARD_CONTRIBUTIONS.length).toBeGreaterThanOrEqual(20);
  });

  it("shows a widget only when its feature is enabled AND a role participates", () => {
    const teacherGrids = composeDashboardGrids({
      roleIds: ["role:subject-teacher"],
      enabledCodes: ["r001.attendance.record", "r001.academics.grade", "r001.finance.report"],
    });
    const teaching = teacherGrids.find((grid) => grid.workspace === "teaching");
    expect(teaching?.widgets.map((widget) => widget.code)).toEqual(
      expect.arrayContaining(["grid.academics.gradebook", "grid.attendance.today"]),
    );
    // The teacher holds the finance feature code but no finance role category.
    expect(teacherGrids.some((grid) => grid.workspace === "finance")).toBe(false);

    const withoutFeature = composeDashboardGrids({
      roleIds: ["role:subject-teacher"],
      enabledCodes: ["r001.attendance.record"],
    });
    expect(withoutFeature.flatMap((grid) => grid.widgets.map((w) => w.code))).not.toContain(
      "grid.academics.gradebook",
    );
  });

  it("orders widgets by size then declared order and labels the workspace", () => {
    const grids = composeDashboardGrids({
      roleIds: ["role:principal"],
      enabledCodes: [
        "r001.analytics.insight",
        "r001.messages.broadcast",
        "r001.attendance.monitor",
      ],
    });
    const leadership = grids.find((grid) => grid.workspace === "leadership");
    expect(leadership?.label).toBe("Leadership workspace");
    expect(leadership?.widgets[0].size).toBe(4);
  });

  it("previews the widgets a reality installs (role-independent)", () => {
    const codes = featureCodesForReality(BOARDING).map((entry) => entry.code);
    const grids = contributionIndexForCodes(codes);
    const workspaces = grids.map((grid) => grid.workspace);
    expect(workspaces).toContain("boarding");
    // Transport is core-curriculum reality, so it IS installed; vocational is not.
    expect(workspaces).toContain("transport");
    expect(workspaces).not.toContain("vocational");
    expect(workspaces).not.toContain("agricultural");
  });
});

describe("R35 — PWA manifest and native shell adapters", () => {
  const experience = generateExperience({ reality: { ...BOARDING } });

  it("generates a valid, installable manifest from brand + reality", () => {
    const manifest = buildWebAppManifest({
      brand: defaultBrand({ name: "Al-Hikmah Academy", primaryColor: "#0f766e" }),
      experience,
    });
    expect(validateWebAppManifest(manifest)).toEqual([]);
    expect(manifest.theme_color).toBe("#0f766e");
    // Shortcuts come from the sections the reality actually has.
    expect(manifest.shortcuts.length).toBeGreaterThan(0);
    expect(manifest.shortcuts.every((shortcut) => shortcut.url.includes("#"))).toBe(true);
  });

  it("rejects a manifest a browser would refuse to install", () => {
    const manifest = buildWebAppManifest({ brand: defaultBrand(), experience });
    const issues = validateWebAppManifest({
      ...manifest,
      short_name: "a very long application short name",
      start_url: "https://example.com",
      icons: [],
      theme_color: "teal",
    }).join(" ");
    expect(issues).toMatch(/at most 20 characters/);
    expect(issues).toMatch(/app-relative path/);
    expect(issues).toMatch(/at least one icon/);
    expect(issues).toMatch(/theme_color/);
  });

  it("declares every shell adapter and validates them", () => {
    expect(shellAdapterMatrix()).toHaveLength(SHELL_TARGETS.length);
    for (const shell of SHELL_TARGETS) {
      expect(validateShellAdapter(nativeShellAdapter(shell)), `${shell} adapter`).toEqual([]);
    }
    expect(nativeShellAdapter("ios").safeArea.bottom).toBeGreaterThan(0);
    expect(nativeShellAdapter("desktop").biometrics).toBe(false);
  });

  it("rejects an unsafe shell adapter", () => {
    const issues = validateShellAdapter({
      ...nativeShellAdapter("ios"),
      safeArea: { top: -1, bottom: 0, left: 0, right: 0 },
      minTouchTarget: 8,
    }).join(" ");
    expect(issues).toMatch(/safeArea.top/);
    expect(issues).toMatch(/home-indicator/);
    expect(issues).toMatch(/minTouchTarget/);
  });
});

describe("R36 — generated experiences rendered on the operator surface", () => {
  it("presets cover the organization classes and stay kernel-neutral", () => {
    expect(Object.keys(EXPERIENCE_REALITY_PRESETS).length).toBeGreaterThanOrEqual(12);
    // Non-education classes declare no education features (their runtime brings them).
    expect(realityForOrgType("company").featureKeys).toEqual([]);
    expect(realityForOrgType("government_agency").featureKeys).toEqual([]);
    // Unknown classes get the NEUTRAL reality — never Scholar's education vocabulary.
    expect(realityForOrgType("unknown-class")).toEqual(NEUTRAL_REALITY);
    expect(realityForOrgType("unknown-class")).not.toEqual(EXPERIENCE_REALITY_PRESETS.school);
  });

  it("an Islamic boarding class generates boarding + faith sections and workspaces", () => {
    const experience = generateExperience({ reality: realityForOrgType("boarding_school") });
    const sections = experience.sections.map((section) => section.section);
    expect(sections).toContain("boarding_life");
    expect(experience.internalApplication.workspaces.map((entry) => entry.workspace)).toContain(
      "boarding",
    );

    const islamic = generateExperience({ reality: realityForOrgType("islamic_school") });
    expect(islamic.sections.map((section) => section.section)).toContain("religious_life");
    expect(
      islamic.sections.find((section) => section.section === "religious_life")?.rationale,
    ).toEqual(expect.arrayContaining(["template:islamic_madrassa"]));
  });

});

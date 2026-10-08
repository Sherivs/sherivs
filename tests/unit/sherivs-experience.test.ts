/**
 * Sherivs experience architecture — brand boundary, navigation admission,
 * command admission, public-page evidence, and contrast.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SHERIVS_BRAND,
  classifyBrandReference,
  customerBrandLabel,
} from "@/lib/brand/sherivs-brand";
import { admitCommands, PLATFORM_COMMANDS } from "@/lib/experience/command-contract";
import { resolveExperienceConfiguration } from "@/lib/experience/experience-configuration";
import { PUBLIC_PAGES, publicSitemapPaths } from "@/lib/experience/public-pages";
import { EXECUTION_PATH_STAGES } from "@/lib/missions/mission-execution";
import { SHERIVS_CONTRAST_PAIRS, contrastRatio } from "@/lib/experience/sherivs-tokens";
import { PLATFORM_KERNEL_NAME, PLATFORM_NAME } from "@/lib/platform";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = (ref: string) => readFileSync(join(ROOT, ref), "utf8");

describe("Sherivs brand boundary", () => {
  it("presents Sherivs to customers and keeps the kernel name", () => {
    expect(PLATFORM_NAME).toBe(SHERIVS_BRAND.customerName);
    expect(PLATFORM_KERNEL_NAME).toBe("CoreGrid");
    expect(customerBrandLabel("ui-copy")).toBe("Sherivs");
    expect(customerBrandLabel("migration")).toBe("CoreGrid");
    expect(classifyBrandReference("table")).toBe("preserve-compatibility");
    expect(classifyBrandReference("metadata")).toBe("customer-facing");
  });
});

describe("Experience configuration", () => {
  it("hides education sections when that runtime is not installed", () => {
    const resolved = resolveExperienceConfiguration({
      plane: "organization-public",
      installedRuntimeIds: [],
      capabilities: new Set(),
      authenticated: false,
    });
    expect(resolved.visible.map((item) => item.id)).toEqual(["identity", "about", "contact"]);
    expect(resolved.withheld.map((item) => item.id)).toEqual(["programs", "admissions"]);
  });

  it("shows education sections only for the installed education runtime", () => {
    const resolved = resolveExperienceConfiguration({
      plane: "organization-public",
      installedRuntimeIds: ["runtime:scholar"],
      capabilities: new Set(),
      authenticated: false,
    });
    expect(resolved.visible.map((item) => item.id)).toContain("admissions");
    expect(resolved.withheld).toHaveLength(0);
  });

  it("withholds workspace items the caller cannot perform", () => {
    const resolved = resolveExperienceConfiguration({
      plane: "organization-workspace",
      installedRuntimeIds: ["runtime:scholar"],
      capabilities: new Set(["workspace.missions"]),
      authenticated: true,
    });
    expect(resolved.visible.map((item) => item.id)).toContain("missions");
    expect(resolved.visible.map((item) => item.id)).not.toContain("workforce");
    expect(resolved.withheld.map((item) => item.id)).toContain("workforce");
  });
});

describe("Command admission", () => {
  it("denies privileged commands without the capability", () => {
    const result = admitCommands(PLATFORM_COMMANDS, {
      authenticated: true,
      capabilities: new Set(),
    });
    expect(result.admitted.map((action) => action.id)).toEqual([
      "search",
      "open-settings",
      "open-notifications",
    ]);
    expect(result.denied.map((action) => action.id)).toContain("create-mission");
    expect(result.denied.map((action) => action.id)).toContain("open-internal");
  });

  it("denies every authenticated command to a signed-out visitor", () => {
    const result = admitCommands(PLATFORM_COMMANDS, {
      authenticated: false,
      capabilities: new Set(["mission.create", "internal.operations", "member.invite"]),
    });
    expect(result.admitted).toHaveLength(0);
    expect(result.denied).toHaveLength(PLATFORM_COMMANDS.length);
  });
});

describe("Public pages", () => {
  it("registers only pages with an evidence note and a unique path", () => {
    const paths = PUBLIC_PAGES.map((page) => page.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const page of PUBLIC_PAGES) {
      expect(page.evidence.length).toBeGreaterThan(8);
      expect(page.description.length).toBeGreaterThan(20);
      expect(page.blocks.length).toBeGreaterThan(0);
    }
  });

  it("describes the mission path with the execution stages that exist", () => {
    const home = read("frontend/src/components/sherivs/public-home.tsx");
    expect(home).toContain("EXECUTION_PATH_STAGES");
    expect(EXECUTION_PATH_STAGES).toContain("verified");
    expect(EXECUTION_PATH_STAGES).toContain("denied");
  });

  it("keeps the public homepage off the operator console", () => {
    const index = read("frontend/src/routes/index.tsx");
    expect(index).toContain("SherivsPublicHome");
    expect(index).not.toContain("CommandCentre");
    expect(read("frontend/src/routes/operate.tsx")).toContain("CommandCentre");
    expect(read("frontend/src/routes/operate.tsx")).toContain("noindex");
  });

  it("lists every public page in the sitemap helper", () => {
    const paths = publicSitemapPaths();
    expect(paths).toContain("/");
    expect(paths).toContain("/security");
    expect(paths).toContain("/legal/privacy");
    expect(paths).not.toContain("/operate");
  });
});

describe("Sherivs contrast pairs", () => {
  it("meets WCAG AA for body and signal text", () => {
    for (const pair of SHERIVS_CONTRAST_PAIRS) {
      expect(contrastRatio(pair.foreground, pair.background), pair.name).toBeGreaterThanOrEqual(4.5);
    }
  });
});

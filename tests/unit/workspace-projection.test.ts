/**
 * CoreGrid — Phase 06 workspace projection: engine (neutral) + Scholar adapter.
 *
 * The engine is tested with synthetic inputs only — it must work for any runtime,
 * which is what neutrality means in practice. The adapter is tested against the real
 * Scholar catalog: kinds are derived, the role registry is counted in full, and
 * gaps are reported rather than hidden.
 */
import { describe, expect, it } from "vitest";

import {
  composeWorkspace,
  composeWorkspaces,
  compositionMatrix,
  type WorkspaceCompositionInput,
} from "@/lib/workspace-projection";
import type { NavContribution } from "@/lib/workspace-engine/navigation";
import {
  SCHOLAR_WORKSPACE_KINDS,
  scholarCompositionInputs,
  scholarRoleWorkspaceCoverage,
  scholarRoleWorkspaceSample,
} from "@/lib/runtime/scholar-workspace-projection";
import { EDUCATION_REALITY_ROLES } from "@/lib/scholar/roles";

const CONTRIBUTIONS: readonly NavContribution[] = [
  {
    runtimeRef: "runtime:test",
    sectionKey: "operations",
    sectionLabel: "Operations",
    items: [
      { key: "dashboard", label: "Dashboard", iconKey: "home", url: "/d", orderHint: 0 },
      {
        key: "finance",
        label: "Finance",
        iconKey: "coins",
        url: "/f",
        capabilities: ["cap.finance"],
        orderHint: 1,
      },
    ],
  },
];

function input(overrides: Partial<WorkspaceCompositionInput> = {}): WorkspaceCompositionInput {
  return {
    key: "test:viewer",
    label: "Test viewer",
    capabilities: new Set<string>(),
    contributions: CONTRIBUTIONS,
    ...overrides,
  };
}

describe("Phase 06 engine — composition from inputs, for any runtime", () => {
  it("withholds items whose capabilities are absent", () => {
    const without = composeWorkspace(input());
    const withFinance = composeWorkspace(input({ capabilities: new Set(["cap.finance"]) }));

    expect(without.itemCount).toBe(1);
    expect(without.sections.flatMap((s) => s.items.map((i) => i.key))).toEqual(["dashboard"]);
    expect(withFinance.itemCount).toBe(2);
  });

  it("resolves home and quick navigation from what it grants", () => {
    const composition = composeWorkspace(input({ capabilities: new Set(["cap.finance"]) }));

    expect(composition.home).toBeTruthy();
    expect(composition.quickNavKeys.length).toBeGreaterThan(0);
    for (const key of composition.quickNavKeys) {
      expect(composition.sections.flatMap((s) => s.items.map((i) => i.key))).toContain(key);
    }
  });

  it("states an empty composition when nothing is authorized", () => {
    const composition = composeWorkspace(input({ contributions: [] }));

    expect(composition.empty).toBe(true);
    expect(composition.itemCount).toBe(0);
    expect(composition.home).toBeNull();
  });

  it("is deterministic and exposes the composition matrix", () => {
    const inputs = [
      input({ key: "a" }),
      input({ key: "b", capabilities: new Set(["cap.finance"]) }),
    ];
    const first = composeWorkspaces(inputs).map((composition) => composition.itemCount);

    expect(first).toEqual(composeWorkspaces(inputs).map((composition) => composition.itemCount));
    expect(composeWorkspaces(inputs).map((composition) => composition.key)).toEqual(["a", "b"]);
    expect(compositionMatrix(inputs)).toEqual({
      a: ["dashboard"],
      b: ["dashboard", "finance"],
    });
  });
});

describe("Scholar adapter — catalog-driven, never a hand-written list", () => {
  it("derives every workspace kind from the catalog", () => {
    const inputs = scholarCompositionInputs();

    expect(inputs.length).toBe(SCHOLAR_WORKSPACE_KINDS.length);
    expect(inputs.length).toBeGreaterThan(0);
    for (const entry of inputs) {
      expect(entry.key.startsWith("r001:")).toBe(true);
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.contributions.length).toBeGreaterThan(0);
    }
  });

  it("counts the FULL reality-role registry, not a sample", () => {
    const coverage = scholarRoleWorkspaceCoverage();

    expect(EDUCATION_REALITY_ROLES.length).toBeGreaterThan(0);
    expect(coverage.roleCount).toBe(EDUCATION_REALITY_ROLES.length);
    expect(coverage.workspaces.length).toBeGreaterThan(0);
    for (const workspace of coverage.workspaces) expect(workspace.label.length).toBeGreaterThan(0);
  });

  it("reports roles that declare no workspace instead of assuming they have one", () => {
    const coverage = scholarRoleWorkspaceCoverage();
    const rolesWithoutWorkspace = EDUCATION_REALITY_ROLES.filter(
      (role) => (role.workspaceRequirements ?? []).length === 0,
    ).map((role) => role.id);

    expect(coverage.unassignedRoleIds).toEqual(rolesWithoutWorkspace);
    expect(Array.isArray(coverage.auditFindings)).toBe(true);
  });

  it("keeps the role sample bounded and labelled as a sample", () => {
    const sample = scholarRoleWorkspaceSample(5);

    expect(sample.length).toBeLessThanOrEqual(5);
    for (const row of sample) {
      expect(row.roleId.startsWith("role:")).toBe(true);
      expect(row.name.length).toBeGreaterThan(0);
      expect(Array.isArray(row.workspaces)).toBe(true);
    }
  });
});

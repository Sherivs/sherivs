/**
 * CoreGrid — V1 AI Workforce Scope Lock tests (DECISIONS.md #206).
 *
 * The catalog is a governance artifact: these tests enforce the scope-lock
 * laws mechanically (directive §§4/5/16/19/20/45/61) — fail closed on any
 * role that claims authority without substrate, escapes the V5.3 version
 * boundary, or collapses the authority model.
 */
import { describe, expect, it } from "vitest";
import {
  executorRolesForCapability,
  roleById,
  rolesByDivision,
  rolesForCapability,
  staffingIsIndependenceSafe,
  validateWorkforceRoleCatalog,
  verifierRolesForCapability,
  workforceScopeHistogram,
  WORKFORCE_AUTHORITY_LEVELS,
  WORKFORCE_DIVISIONS,
  WORKFORCE_INSTANTIATION_POLICIES,
  WORKFORCE_ROLE_CATALOG,
  WORKFORCE_ROLE_CATALOG_VALIDATED,
  WORKFORCE_SCOPE_TARGETS,
  workforceRoleSchema,
  type WorkforceRole,
} from "../../../frontend/src/lib/workforce/role-catalog";

describe("V1 workforce scope lock (DECISIONS.md #206)", () => {
  it("validates the shipped catalog fail-closed", () => {
    const result = validateWorkforceRoleCatalog(WORKFORCE_ROLE_CATALOG);
    expect(result.ok).toBe(true);
    expect(WORKFORCE_ROLE_CATALOG_VALIDATED).toHaveLength(WORKFORCE_ROLE_CATALOG.length);
  });

  it("covers every directive division with at least one role", () => {
    for (const division of WORKFORCE_DIVISIONS) {
      expect(rolesByDivision(division).length, `division ${division}`).toBeGreaterThan(0);
    }
  });

  it("carries a scope histogram inside the V5.3 version boundary", () => {
    const histogram = workforceScopeHistogram();
    const total = Object.values(histogram).reduce((sum, count) => sum + count, 0);
    expect(total).toBe(WORKFORCE_ROLE_CATALOG.length);
    expect(histogram.V1).toBeGreaterThan(0);
    // Frozen scope targets may exist but never dominate: the V1 envelope is the point.
    expect(histogram.V1).toBeGreaterThan(histogram.V2 + histogram.DEFERRED_BEYOND_V2);
  });

  it("keeps the executive control plane singular and proposal-only (directive §3)", () => {
    const persistent = WORKFORCE_ROLE_CATALOG_VALIDATED.filter(
      (role) => role.instantiationPolicy === "persistent_control_plane",
    );
    expect(persistent).toHaveLength(1);
    expect(persistent[0].roleId).toBe("jarvis");
    expect(persistent[0].authorityLevels).not.toContain("execute");
    expect(persistent[0].authorityLevels).not.toContain("approve");
    expect(persistent[0].authorityLevels).not.toContain("deploy");
  });

  it("requires every V1 role to map to existing substrate (reuse law)", () => {
    for (const role of WORKFORCE_ROLE_CATALOG_VALIDATED) {
      if (role.classification === "V1") {
        expect(role.substrateRefs.length, role.roleId).toBeGreaterThan(0);
      }
    }
  });

  it("freezes every non-V1 role until a human authorization record exists", () => {
    for (const role of WORKFORCE_ROLE_CATALOG_VALIDATED) {
      if (role.classification !== "V1") {
        expect(role.instantiationPolicy, role.roleId).toBe("frozen");
        expect(role.authorityLevels, role.roleId).toEqual(["observe"]);
      }
    }
  });

  it("never grants a single role both execute and verify authority (four-eyes law)", () => {
    for (const role of WORKFORCE_ROLE_CATALOG_VALIDATED) {
      const both = role.authorityLevels.includes("execute") && role.authorityLevels.includes("verify");
      expect(both, role.roleId).toBe(false);
    }
  });

  it("always forbids state fabrication (anti-hallucination law)", () => {
    for (const role of WORKFORCE_ROLE_CATALOG_VALIDATED) {
      expect(role.forbiddenOperations).toContain("state_fabrication");
    }
  });
});

describe("workforce role catalog fail-closed construction", () => {
  const base: WorkforceRole = {
    roleId: "test-role",
    division: "engineering",
    title: "Test Role",
    classification: "V1",
    authorityLevels: ["analyze", "propose", "execute"],
    maxRiskClass: "medium",
    missionCapabilities: ["code_implementation"],
    substrateRefs: ["frontend/src/lib/security-role-gate.ts"],
    forbiddenOperations: ["state_fabrication"],
    instantiationPolicy: "dynamic_on_mission",
    note: "Synthetic role for negative-path testing only.",
  };

  it("accepts a well-formed role", () => {
    expect(workforceRoleSchema.safeParse(base).success).toBe(true);
  });

  it("rejects unknown division / scope target / instantiation policy", () => {
    expect(workforceRoleSchema.safeParse({ ...base, division: "marketing" }).success).toBe(false);
    expect(workforceRoleSchema.safeParse({ ...base, classification: "V3" }).success).toBe(false);
    expect(
      workforceRoleSchema.safeParse({ ...base, instantiationPolicy: "always_on" }).success,
    ).toBe(false);
  });

  it("rejects V1 roles without substrate", () => {
    const result = validateWorkforceRoleCatalog([{ ...base, substrateRefs: [] }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("substrate");
  });

  it("rejects frozen non-V1 roles that still claim dynamic activation", () => {
    const result = validateWorkforceRoleCatalog([
      { ...base, classification: "V2", substrateRefs: [], instantiationPolicy: "dynamic_on_mission" },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("frozen");
  });

  it("rejects roles holding both execute and verify authority", () => {
    const result = validateWorkforceRoleCatalog([
      { ...base, authorityLevels: ["analyze", "execute", "verify"] },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("four-eyes");
  });

  it("rejects approve authority at a critical risk ceiling", () => {
    const result = validateWorkforceRoleCatalog([
      { ...base, authorityLevels: ["analyze", "approve"], maxRiskClass: "critical" },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("approve authority");
  });

  it("rejects roles missing the state-fabrication prohibition", () => {
    const result = validateWorkforceRoleCatalog([{ ...base, forbiddenOperations: [] }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("state_fabrication");
  });

  it("rejects duplicate role ids and duplicate capability slugs", () => {
    expect(validateWorkforceRoleCatalog([base, base]).ok).toBe(false);
    expect(
      validateWorkforceRoleCatalog([{ ...base, missionCapabilities: ["code_implementation", "code_implementation"] }])
        .ok,
    ).toBe(false);
  });

  it("rejects secret-shaped material in human-readable fields", () => {
    expect(
      validateWorkforceRoleCatalog([{ ...base, note: "token sk_live abcdef123456 stored here." }]).ok,
    ).toBe(false);
  });
});

describe("workforce staffing seam", () => {
  it("staffs engineering capabilities only from V1 roles", () => {
    const matches = rolesForCapability(WORKFORCE_ROLE_CATALOG_VALIDATED, "code_implementation");
    expect(matches.length).toBeGreaterThan(0);
    for (const role of matches) expect(role.classification).toBe("V1");
  });

  it("returns no candidates for frozen capabilities", () => {
    expect(rolesForCapability(WORKFORCE_ROLE_CATALOG_VALIDATED, "ml_training")).toHaveLength(0);
    expect(executorRolesForCapability(WORKFORCE_ROLE_CATALOG_VALIDATED, "ml_training")).toHaveLength(0);
  });

  it("separates executor and verifier candidate sets per capability", () => {
    const executors = executorRolesForCapability(WORKFORCE_ROLE_CATALOG_VALIDATED, "verification_independent");
    const verifiers = verifierRolesForCapability(WORKFORCE_ROLE_CATALOG_VALIDATED, "verification_independent");
    expect(verifiers.length).toBeGreaterThan(0);
    for (const verifier of verifiers) {
      expect(verifier.authorityLevels).toContain("verify");
      expect(verifier.authorityLevels).not.toContain("execute");
    }
    expect(executors.every((role) => !verifiers.some((v) => v.roleId === role.roleId))).toBe(true);
  });

  it("flags staffing plans where executor and verifier roles intersect", () => {
    expect(staffingIsIndependenceSafe(["qa-engineer"], ["qa-engineer"])).toBe(false);
    expect(staffingIsIndependenceSafe(["backend-engineer"], ["qa-engineer"])).toBe(true);
  });

  it("resolves roles by id and enumerates the full vocabularies", () => {
    expect(roleById("jarvis")?.division).toBe("executive_command");
    expect(roleById("does-not-exist")).toBeUndefined();
    expect(WORKFORCE_AUTHORITY_LEVELS).toContain("emergency");
    expect(WORKFORCE_SCOPE_TARGETS).toContain("REQUIRES_ARCHITECTURAL_DECISION");
    expect(WORKFORCE_INSTANTIATION_POLICIES).toContain("dynamic_on_mission");
  });
});
/**
 * CoreGrid — capability-gate tests (fail-closed, per-feature r001 codes).
 */
import { describe, expect, it } from "vitest";
import {
  evaluateRuntimeCapability,
  parseCapabilityCode,
  MEMBERSHIP_FOR_NAV_KIND,
  type CapabilityGateDecision,
} from "../../frontend/src/lib/capability-gate";
import type { AppRole } from "../../frontend/src/lib/roles";
import { isDeclaredRuntimeFeatureCode, SCHOLAR_FEATURE_CODES } from "@/lib/runtime/nav-registry";

const teacherCode = [...SCHOLAR_FEATURE_CODES].find((c) => c.startsWith("r001:teacher."));
const adminCode = [...SCHOLAR_FEATURE_CODES].find((c) => c.startsWith("r001:org_admin."));
const parentCode = [...SCHOLAR_FEATURE_CODES].find((c) => c.startsWith("r001:parent."));

/** Deny code of a decision (null when allowed) — keeps deny assertions typed. */
type DenyCode = "malformed" | "unknown_feature" | "unknown_kind" | "role_required";
function denyCodeOf(outcome: CapabilityGateDecision): DenyCode | null {
  return outcome.decision === "deny" ? outcome.code : null;
}

describe("parseCapabilityCode (strict, fail-closed)", () => {
  it("parses valid codes into runtime/kind/feature", () => {
    expect(parseCapabilityCode("r001:org_admin.settings")).toEqual({
      runtime: "r001",
      kind: "org_admin",
      feature: "settings",
    });
    expect(parseCapabilityCode("r001:teacher.grades.enter")).toEqual({
      runtime: "r001",
      kind: "teacher",
      feature: "grades.enter",
    });
  });

  it("rejects malformed codes", () => {
    expect(parseCapabilityCode("")).toBeNull();
    expect(parseCapabilityCode("org_admin.settings")).toBeNull();
    expect(parseCapabilityCode("r001:org_admin")).toBeNull();
    expect(parseCapabilityCode("r001:.settings")).toBeNull();
    expect(parseCapabilityCode("R001:org_admin.settings")).toBeNull();
  });
});

describe("evaluateRuntimeCapability (fail-closed on every non-allow path)", () => {
  it("declares a real feature index", () => {
    expect(SCHOLAR_FEATURE_CODES.size).toBeGreaterThan(40);
    expect(isDeclaredRuntimeFeatureCode("r001:teacher.dashboard")).toBe(true);
  });

  it("grants the matching membership kind", () => {
    if (teacherCode && adminCode) {
      expect(evaluateRuntimeCapability({ code: teacherCode, role: "teacher" }).decision).toBe(
        "allow",
      );
      expect(evaluateRuntimeCapability({ code: adminCode, role: "admin" }).decision).toBe("allow");
      expect(evaluateRuntimeCapability({ code: adminCode, role: "principal" }).decision).toBe(
        "allow",
      );
      if (parentCode) {
        expect(evaluateRuntimeCapability({ code: parentCode, role: "parent" }).decision).toBe(
          "allow",
        );
      }
    } else {
      throw new Error("Feature index unexpectedly empty");
    }
  });

  it("denies cross-kind access", () => {
    if (teacherCode && adminCode) {
      expect(evaluateRuntimeCapability({ code: adminCode, role: "teacher" }).decision).toBe("deny");
      expect(evaluateRuntimeCapability({ code: teacherCode, role: "bursar" }).decision).toBe(
        "deny",
      );
      expect(
        evaluateRuntimeCapability({ code: parentCode ?? "r001:parent.dashboard", role: "teacher" })
          .decision,
      ).toBe("deny");
    }
  });

  it("denies malformed, undeclared and unknown-kind codes", () => {
    expect(denyCodeOf(evaluateRuntimeCapability({ code: "not-a-code", role: "admin" }))).toBe(
      "malformed",
    );
    expect(
      denyCodeOf(evaluateRuntimeCapability({ code: "r001:org_admin.not_shipped", role: "admin" })),
    ).toBe("unknown_feature");
    expect(
      denyCodeOf(evaluateRuntimeCapability({ code: "r001:lab_tech.dashboard", role: "admin" })),
    ).toBe("unknown_kind");
  });

  it("allows platform super-admin only on declared codes", () => {
    if (adminCode) {
      expect(
        evaluateRuntimeCapability({ code: adminCode, role: "teacher", isPlatformSuper: true })
          .decision,
      ).toBe("allow");
    }
    expect(
      denyCodeOf(
        evaluateRuntimeCapability({
          code: "r001:org_admin.not_shipped",
          role: "admin",
          isPlatformSuper: true,
        }),
      ),
    ).toBe("unknown_feature");
  });

  it("keeps the kind→membership map complete for every Scholar chrome kind", () => {
    for (const [kind, roles] of Object.entries(MEMBERSHIP_FOR_NAV_KIND)) {
      expect(kind.length).toBeGreaterThan(0);
      expect(roles.length).toBeGreaterThan(0);
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * V1CAP-014 / J-006 additions: the gate resolves roles through the
 * neutral universal vocabulary (CTO RULING-4, domain -> neutral only).
 * Closes I-010 (role vocabulary), I-030 (restaurant fixture mapping)
 * and I-031 (contract-level neutral role validation) for this gate.
 * ────────────────────────────────────────────────────────────*/
import { SCHOLAR_NEUTRAL_ROLE_MAPPINGS } from "../../frontend/src/lib/runtime/scholar-role-mappings";
import { RESTAURANT_NEUTRAL_ROLE_MAPPINGS } from "../../frontend/src/lib/domain-config/restaurant";
import {
  INSTALLED_DOMAIN_ROLE_MAPPINGS,
  NEUTRAL_ROLES_FOR_NAV_KIND,
  neutralRolesForIdentityRole,
} from "../../frontend/src/lib/capability-gate";
import { resolveDomainRoleToNeutral } from "../../frontend/src/lib/universal-roles";

const bursarCode = [...SCHOLAR_FEATURE_CODES].find((c) => c.startsWith("r001:bursar."));
const superAdminCode = [...SCHOLAR_FEATURE_CODES].find((c) => c.startsWith("r001:super_admin."));

describe("neutral role resolution (V1CAP-014 / J-006 / I-010)", () => {
  it("resolves every legacy identity-store role FORWARD into the neutral vocabulary", () => {
    const expected: Record<string, readonly string[]> = {
      super_admin: ["ADMINISTRATOR", "SYSTEM"],
      hq: ["SUPERVISOR"],
      admin: ["ADMINISTRATOR"],
      principal: ["ADMINISTRATOR"],
      teacher: ["CONTRIBUTOR"],
      bursar: ["OPERATOR"],
      parent: ["MEMBER"],
      student: ["MEMBER"],
      driver: ["WORKER"],
    };
    for (const [role, neutralRoles] of Object.entries(expected)) {
      expect(neutralRolesForIdentityRole(role), `role "${role}"`).toEqual(neutralRoles);
    }
  });

  it("passes already-neutral roles through unchanged", () => {
    expect(neutralRolesForIdentityRole("WORKER")).toEqual(["WORKER"]);
    expect(neutralRolesForIdentityRole("SYSTEM")).toEqual(["SYSTEM"]);
    expect(neutralRolesForIdentityRole("AUDITOR")).toEqual(["AUDITOR"]);
  });

  it("resolves nothing for unknown roles and for roles the gate has no mapping for", () => {
    expect(neutralRolesForIdentityRole("chef")).toBeNull();
    expect(neutralRolesForIdentityRole("service_staff")).toBeNull();
    expect(neutralRolesForIdentityRole("")).toBeNull();
  });

  it("resolves every legacy role into its own chrome kind's neutral membership", () => {
    for (const [kind, roles] of Object.entries(MEMBERSHIP_FOR_NAV_KIND)) {
      const neutralMembership =
        NEUTRAL_ROLES_FOR_NAV_KIND[kind as keyof typeof NEUTRAL_ROLES_FOR_NAV_KIND];
      expect(neutralMembership.length, `kind "${kind}"`).toBeGreaterThan(0);
      for (const role of roles) {
        const resolved = neutralRolesForIdentityRole(role);
        expect(resolved, `role "${role}" of kind "${kind}"`).not.toBeNull();
        if (resolved) {
          expect(resolved.some((neutral) => neutralMembership.includes(neutral))).toBe(true);
        }
      }
    }
  });

  it("the gate's legacy bridge stays coherent with the runtime's DECLARED domain mapping, both ways", () => {
    const bridge = INSTALLED_DOMAIN_ROLE_MAPPINGS[0]?.mappings;
    expect(bridge).toBeDefined();
    if (!bridge) return;
    for (const [domainRole, neutralRoles] of Object.entries(SCHOLAR_NEUTRAL_ROLE_MAPPINGS)) {
      expect(bridge[domainRole], `bridge entry "${domainRole}"`).toEqual(neutralRoles);
    }
    for (const [domainRole, neutralRoles] of Object.entries(bridge)) {
      expect(
        resolveDomainRoleToNeutral(SCHOLAR_NEUTRAL_ROLE_MAPPINGS, domainRole),
        `declared entry "${domainRole}"`,
      ).toEqual(neutralRoles);
    }
  });
});

describe("gate decisions resolve through the neutral vocabulary (not the role name)", () => {
  it("grants a declared code to an already-neutral role matching the kind's semantics", () => {
    if (teacherCode && adminCode && bursarCode) {
      expect(evaluateRuntimeCapability({ code: teacherCode, role: "CONTRIBUTOR" }).decision).toBe(
        "allow",
      );
      expect(evaluateRuntimeCapability({ code: adminCode, role: "ADMINISTRATOR" }).decision).toBe(
        "allow",
      );
      expect(evaluateRuntimeCapability({ code: bursarCode, role: "OPERATOR" }).decision).toBe(
        "allow",
      );
    } else {
      throw new Error("Feature index unexpectedly empty");
    }
  });

  it("denies neutral roles whose semantics do not match the chrome kind", () => {
    if (teacherCode && adminCode) {
      const denied = evaluateRuntimeCapability({ code: teacherCode, role: "WORKER" });
      expect(denied.decision).toBe("deny");
      if (denied.decision === "deny") {
        expect(denied.code).toBe("role_required");
        expect(denied.reason).toContain("WORKER");
      }
      expect(evaluateRuntimeCapability({ code: adminCode, role: "MEMBER" }).decision).toBe("deny");
    }
  });

  it("maps super_admin as ADMINISTRATOR|SYSTEM per I-010 (documented platform-administration delta)", () => {
    if (superAdminCode && adminCode && bursarCode) {
      expect(
        evaluateRuntimeCapability({ code: superAdminCode, role: "super_admin" }).decision,
      ).toBe("allow");
      expect(evaluateRuntimeCapability({ code: adminCode, role: "super_admin" }).decision).toBe(
        "allow",
      );
      expect(evaluateRuntimeCapability({ code: bursarCode, role: "super_admin" }).decision).toBe(
        "deny",
      );
    }
  });

  it("preserves legacy AppRole behavior: every identity-store role grants its own kind, denies others", () => {
    for (const [kind, roles] of Object.entries(MEMBERSHIP_FOR_NAV_KIND)) {
      const code = [...SCHOLAR_FEATURE_CODES].find((c) => c.startsWith(`r001:${kind}.`));
      expect(code, `kind "${kind}" has declared codes`).toBeDefined();
      if (!code) continue;
      for (const role of roles) {
        expect(evaluateRuntimeCapability({ code, role }).decision, `${role} on ${code}`).toBe(
          "allow",
        );
      }
    }
    expect(
      evaluateRuntimeCapability({ code: "r001:bursar.dashboard", role: "teacher" }).decision,
    ).toBe("deny");
    expect(
      evaluateRuntimeCapability({ code: "r001:teacher.dashboard", role: "driver" }).decision,
    ).toBe("deny");
  });
});

describe("I-030 / I-031 closure at the gate (restaurant resolves without the Scholar vocabulary)", () => {
  it("restaurant service_staff resolves to floor-workforce semantics through the same engine", () => {
    const resolved = resolveDomainRoleToNeutral(RESTAURANT_NEUTRAL_ROLE_MAPPINGS, "service_staff");
    expect(resolved).toEqual(["WORKER", "OPERATOR"]);
    expect(resolved).not.toContain("CONTRIBUTOR");
  });

  it("the gate knows no restaurant role and no restaurant chrome kind (fixture stays quarantined)", () => {
    expect(neutralRolesForIdentityRole("service_staff")).toBeNull();
    // Untrusted input on purpose: the fixture role is outside the typed role
    // unions, which is exactly the surface this denial proves stays closed.
    const outcome = evaluateRuntimeCapability({
      code: "r001:restaurant_service.pos",
      role: "service_staff" as AppRole,
    });
    expect(outcome.decision).toBe("deny");
    if (outcome.decision === "deny") {
      expect(outcome.code).toBe("unknown_kind");
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * MISSION-R-120 / V1CAP-092 — I-012 CLOSURE (additive recertification).
 * The nav-kind membership coupling is re-keyed to neutral roles and the
 * tables are RUNTIME-DECLARED: Scholar nav kinds consume via the Scholar
 * mapping table (in the runtime layer); the gate hand-writes no role list.
 * Every export name, shape and decision is preserved.
 * ────────────────────────────────────────────────────────────*/
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  RUNTIME_NAV_KIND_NEUTRAL_MEMBERSHIP,
  RUNTIME_NAV_KIND_ROLE_ASSIGNMENTS,
} from "../../frontend/src/lib/runtime/nav-registry";

const GATE_PATH = join(
  fileURLToPath(new URL("../..", import.meta.url)),
  "frontend/src/lib/capability-gate.ts",
);

describe("I-012 closure: nav-kind membership is runtime-declared and neutral-keyed", () => {
  it("MEMBERSHIP_FOR_NAV_KIND IS the runtime-declared assignment table (the gate owns no role list)", () => {
    expect(MEMBERSHIP_FOR_NAV_KIND).toEqual(RUNTIME_NAV_KIND_ROLE_ASSIGNMENTS);
  });

  it("NEUTRAL_ROLES_FOR_NAV_KIND IS the runtime-declared neutral membership", () => {
    expect(NEUTRAL_ROLES_FOR_NAV_KIND).toEqual(RUNTIME_NAV_KIND_NEUTRAL_MEMBERSHIP);
  });

  it("every chrome kind's neutral membership is DERIVED through the Scholar mapping table (forward resolution only)", () => {
    for (const [kind, roles] of Object.entries(RUNTIME_NAV_KIND_ROLE_ASSIGNMENTS)) {
      const derived: string[] = [];
      for (const role of roles) {
        const resolved = resolveDomainRoleToNeutral(SCHOLAR_NEUTRAL_ROLE_MAPPINGS, role);
        expect(resolved, `role "${role}" of kind "${kind}"`).not.toBeNull();
        for (const neutral of resolved ?? []) {
          if (!derived.includes(neutral)) derived.push(neutral);
        }
      }
      expect(derived, `kind "${kind}" derived through the declared mapping table`).toEqual([
        ...NEUTRAL_ROLES_FOR_NAV_KIND[kind as keyof typeof NEUTRAL_ROLES_FOR_NAV_KIND],
      ]);
    }
  });

  it("the gate source hand-writes no legacy role list (I-012 correction: runtime-declared, not re-listed)", () => {
    const source = readFileSync(GATE_PATH, "utf8");
    expect(source).not.toMatch(/"(admin|principal|teacher|bursar|parent|student|driver|hq|super_admin)"/);
  });

  it("decision behavior is UNCHANGED: every decision equals the neutral-membership semantics", () => {
    for (const [kind, roles] of Object.entries(MEMBERSHIP_FOR_NAV_KIND)) {
      const code = [...SCHOLAR_FEATURE_CODES].find((c) => c.startsWith(`r001:${kind}.`));
      expect(code, `kind "${kind}" has declared codes`).toBeDefined();
      if (!code) continue;
      for (const role of roles) {
        const resolved = neutralRolesForIdentityRole(role);
        expect(resolved, `role "${role}" resolves neutrally`).not.toBeNull();
        for (const otherKind of Object.keys(MEMBERSHIP_FOR_NAV_KIND)) {
          const otherCode = [...SCHOLAR_FEATURE_CODES].find((c) =>
            c.startsWith(`r001:${otherKind}.`),
          );
          if (!otherCode) continue;
          const expected = (resolved ?? []).some((neutral) =>
            NEUTRAL_ROLES_FOR_NAV_KIND[otherKind as keyof typeof NEUTRAL_ROLES_FOR_NAV_KIND].includes(
              neutral,
            ),
          )
            ? "allow"
            : "deny";
          expect(
            evaluateRuntimeCapability({ code: otherCode, role }).decision,
            `${role} on ${otherCode}`,
          ).toBe(expected);
        }
      }
    }
  });
});

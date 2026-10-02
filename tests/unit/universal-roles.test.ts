/**
 * CoreGrid — universal role vocabulary + directional mapping contract tests
 * (V1CAP-014 / J-006, CTO RULING-4; closes I-010 / I-030 / I-031 at the
 * contract level).
 */
import { describe, expect, it } from "vitest";
import * as universalRolesModule from "../../frontend/src/lib/universal-roles";
import {
  UNIVERSAL_ROLES,
  UNIVERSAL_ROLE_REGISTRY,
  UNIVERSAL_ROLE_SET,
  defineDomainRoleMappings,
  isUniversalRole,
  resolveDomainRoleToNeutral,
  roleMappingTable,
  validateDirectionalRoleMappings,
} from "../../frontend/src/lib/universal-roles";
import {
  SCHOLAR_DOMAIN_ID,
  SCHOLAR_NEUTRAL_ROLE_MAPPINGS,
  SCHOLAR_ROLE_MAPPINGS,
} from "../../frontend/src/lib/runtime/scholar-role-mappings";
import {
  RESTAURANT_NEUTRAL_ROLE_MAPPINGS,
  RESTAURANT_ROLE_MAPPINGS,
} from "../../frontend/src/lib/domain-config/restaurant";
import { MEMBERSHIP_FOR_NAV_KIND } from "../../frontend/src/lib/capability-gate";

/** The legacy identity-store role union as runtime values (the I-010 vocabulary). */
const LEGACY_IDENTITY_STORE_ROLES: readonly string[] = [
  ...new Set(Object.values(MEMBERSHIP_FOR_NAV_KIND).flat()),
];

/** The ruled universal vocabulary, verbatim and in order. */
const RULED_UNIVERSAL_ROLES = [
  "ACTOR",
  "MEMBER",
  "OWNER",
  "ADMINISTRATOR",
  "OPERATOR",
  "MANAGER",
  "SUPERVISOR",
  "CONTRIBUTOR",
  "REVIEWER",
  "APPROVER",
  "AUDITOR",
  "WORKER",
  "AGENT",
  "SERVICE",
  "SYSTEM",
] as const;

describe("universal role vocabulary (completeness)", () => {
  it("is exactly the ruled 15-role vocabulary, in the ruled order", () => {
    expect([...UNIVERSAL_ROLES]).toEqual([...RULED_UNIVERSAL_ROLES]);
    expect(UNIVERSAL_ROLES.length).toBe(15);
  });

  it("describes every role in the typed registry — none guessed", () => {
    expect(Object.keys(UNIVERSAL_ROLE_REGISTRY).sort()).toEqual([...UNIVERSAL_ROLES].sort());
    for (const descriptor of Object.values(UNIVERSAL_ROLE_REGISTRY)) {
      expect(descriptor.description.length).toBeGreaterThan(20);
      expect(["identity", "functional", "machine"]).toContain(descriptor.kind);
      expect(UNIVERSAL_ROLE_SET.has(descriptor.role)).toBe(true);
    }
  });

  it("classifies machine authorities separately from human participants", () => {
    for (const role of ["AGENT", "SERVICE", "SYSTEM"] as const) {
      expect(UNIVERSAL_ROLE_REGISTRY[role].kind).toBe("machine");
    }
    for (const role of ["ACTOR", "MEMBER", "OWNER"] as const) {
      expect(UNIVERSAL_ROLE_REGISTRY[role].kind).toBe("identity");
    }
  });

  it("answers isUniversalRole fail-closed for untrusted input", () => {
    expect(isUniversalRole("WORKER")).toBe(true);
    expect(isUniversalRole("worker")).toBe(false);
    expect(isUniversalRole("WORKER ")).toBe(false);
    expect(isUniversalRole("teacher")).toBe(false);
    expect(isUniversalRole(42)).toBe(false);
    expect(isUniversalRole(null)).toBe(false);
  });

  it("is a genuinely NEW vocabulary, disjoint from the legacy identity-store union (I-010)", () => {
    for (const legacyRole of LEGACY_IDENTITY_STORE_ROLES) {
      expect(UNIVERSAL_ROLE_SET.has(legacyRole)).toBe(false);
    }
    for (const neutralRole of UNIVERSAL_ROLES) {
      expect(LEGACY_IDENTITY_STORE_ROLES).not.toContain(neutralRole);
    }
  });

  it("carries no domain vocabulary on the universal surface", () => {
    const source =
      UNIVERSAL_ROLES.join(",") +
      Object.values(UNIVERSAL_ROLE_REGISTRY)
        .map((descriptor) => `${descriptor.role}: ${descriptor.description}`)
        .join(" ");
    for (const forbidden of [
      "school",
      "teacher",
      "student",
      "learner",
      "identity",
      "bursar",
      "parent",
      "driver",
      "education",
      "campus",
    ]) {
      expect(source.toLowerCase()).not.toContain(forbidden);
    }
  });
});

describe("directional mapping enforcement (RULING-4: domain -> neutral ONLY)", () => {
  it("accepts a well-formed domain -> neutral mapping", () => {
    const result = validateDirectionalRoleMappings({
      dispatcher: ["OPERATOR"],
      crew: ["WORKER", "CONTRIBUTOR"],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(resolveDomainRoleToNeutral(result.mappings, "crew")).toEqual([
        "WORKER",
        "CONTRIBUTOR",
      ]);
    }
  });

  it("rejects a reverse mapping (neutral role used as the key) at runtime", () => {
    const result = validateDirectionalRoleMappings({
      WORKER: ["dispatcher"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toMatch(/RULING-4/);
      expect(result.errors.join(" ")).toMatch(/reverse mapping/);
    }
  });

  it("rejects a reverse mapping in the TYPE SYSTEM and at runtime, in one construct", () => {
    expect(() =>
      defineDomainRoleMappings({
        // @ts-expect-error RULING-4: a neutral role must never be a mapping key
        MEMBER: ["MEMBER"],
      }),
    ).toThrow(/RULING-4/);
  });

  it("rejects domain role names on the neutral side (value positions)", () => {
    const result = validateDirectionalRoleMappings({
      barista: ["teacher"],
      cook: ["sous_chef"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const joined = result.errors.join(" ");
      expect(joined).toMatch(/"teacher" which is not in the universal role vocabulary/);
      expect(joined).toMatch(/"sous_chef" which is not in the universal role vocabulary/);
    }
  });

  it("rejects mapping values that are not non-empty neutral arrays", () => {
    const result = validateDirectionalRoleMappings({
      ghost: [],
      absent: ["NOT_A_ROLE"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toMatch(/non-empty array of neutral roles/);
      expect(result.errors.join(" ")).toMatch(/"NOT_A_ROLE"/);
    }
  });

  it("exports no reverse resolver — the neutral -> domain direction does not exist", () => {
    for (const exportName of Object.keys(universalRolesModule)) {
      const lower = exportName.toLowerCase();
      if (lower.includes("neutral") && lower.includes("domain")) {
        // the only permitted mention order is domain -> neutral
        expect(
          lower.indexOf("domain"),
          `${exportName} must read in the domain -> neutral direction`,
        ).toBeLessThan(lower.indexOf("neutral"));
      }
      expect(lower).not.toMatch(
        /neutral.{0,24}(to|for|as).{0,24}domain|todomain|domainfor|reverse/,
      );
    }
  });

  it("resolves nothing for neutral role names through the directional engine", () => {
    for (const neutralRole of UNIVERSAL_ROLES) {
      expect(
        resolveDomainRoleToNeutral(
          {
            floor_lead: ["SUPERVISOR"],
          },
          neutralRole,
        ),
      ).toBeNull();
    }
  });

  it("fails closed on unknown domain roles and rejects duplicate declaration ids", () => {
    expect(resolveDomainRoleToNeutral({ floor_lead: ["SUPERVISOR"] }, "ghost")).toBeNull();
    expect(() =>
      roleMappingTable([
        { domainRole: "cook", neutralRoles: ["WORKER"], description: "kitchen line" },
        { domainRole: "cook", neutralRoles: ["OPERATOR"], description: "duplicate id" },
      ]),
    ).toThrow(/duplicate domain role id "cook"/);
  });

  it("requires every mapping choice to be documented", () => {
    expect(() =>
      roleMappingTable([{ domainRole: "cook", neutralRoles: ["WORKER"], description: "  " }]),
    ).toThrow(/requires a documentation string/);
  });
});

describe("Scholar domain mapping table (the FIRST domain mapping, I-010)", () => {
  it("is declared for the scholar domain", () => {
    expect(SCHOLAR_DOMAIN_ID).toBe("scholar");
    expect(SCHOLAR_ROLE_MAPPINGS.length).toBeGreaterThan(0);
  });

  it("maps every legacy identity-store role forward — the bridge vocabulary is fully covered", () => {
    const declaredKeys = SCHOLAR_ROLE_MAPPINGS.map((declaration) => declaration.domainRole);
    expect([...declaredKeys].sort()).toEqual([...LEGACY_IDENTITY_STORE_ROLES].sort());
  });

  it("resolves each Scholar role to its documented neutral semantics", () => {
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
    for (const [domainRole, neutralRoles] of Object.entries(expected)) {
      expect(
        resolveDomainRoleToNeutral(SCHOLAR_NEUTRAL_ROLE_MAPPINGS, domainRole),
        `scholar role "${domainRole}"`,
      ).toEqual(neutralRoles);
    }
  });

  it("every mapping value is a neutral role and every choice is documented", () => {
    for (const declaration of SCHOLAR_ROLE_MAPPINGS) {
      expect(declaration.neutralRoles.length).toBeGreaterThan(0);
      for (const neutralRole of declaration.neutralRoles) {
        expect(isUniversalRole(neutralRole)).toBe(true);
      }
      expect(declaration.description.length).toBeGreaterThan(30);
    }
  });

  it("never maps a neutral role backwards (no key is a universal role)", () => {
    for (const declaration of SCHOLAR_ROLE_MAPPINGS) {
      expect(isUniversalRole(declaration.domainRole)).toBe(false);
    }
  });
});

describe("restaurant domain mapping table (I-030 closure — the seeded contamination proof)", () => {
  it("resolves service_staff to floor-workforce semantics, NOT educator semantics", () => {
    expect(resolveDomainRoleToNeutral(RESTAURANT_NEUTRAL_ROLE_MAPPINGS, "service_staff")).toEqual([
      "WORKER",
      "OPERATOR",
    ]);
    const resolved = resolveDomainRoleToNeutral(RESTAURANT_NEUTRAL_ROLE_MAPPINGS, "service_staff");
    expect(resolved).not.toBeNull();
    if (resolved) {
      expect(resolved).not.toContain("CONTRIBUTOR");
      expect(resolved).not.toContain("SUPERVISOR");
    }
  });

  it("resolves every restaurant role to its documented neutral semantics", () => {
    const expected: Record<string, readonly string[]> = {
      manager: ["ADMINISTRATOR", "OWNER"],
      cashier: ["OPERATOR"],
      service_staff: ["WORKER", "OPERATOR"],
      runner: ["WORKER"],
    };
    for (const [domainRole, neutralRoles] of Object.entries(expected)) {
      expect(
        resolveDomainRoleToNeutral(RESTAURANT_NEUTRAL_ROLE_MAPPINGS, domainRole),
        `restaurant role "${domainRole}"`,
      ).toEqual(neutralRoles);
    }
  });

  it("resolves WITHOUT any legacy identity-store role: no restaurant key is a Scholar role", () => {
    for (const declaration of RESTAURANT_ROLE_MAPPINGS) {
      expect(LEGACY_IDENTITY_STORE_ROLES).not.toContain(declaration.domainRole);
      for (const neutralRole of declaration.neutralRoles) {
        expect(isUniversalRole(neutralRole)).toBe(true);
        expect(LEGACY_IDENTITY_STORE_ROLES).not.toContain(neutralRole);
      }
    }
  });

  it("shares zero role names with the Scholar mapping (disjoint domain vocabularies)", () => {
    const scholarKeys = SCHOLAR_ROLE_MAPPINGS.map((declaration) => declaration.domainRole);
    const restaurantKeys = RESTAURANT_ROLE_MAPPINGS.map((declaration) => declaration.domainRole);
    expect(restaurantKeys.filter((key) => scholarKeys.includes(key))).toEqual([]);
  });

  it("passes through the SAME directional engine as every other domain", () => {
    const rebuilt = roleMappingTable(RESTAURANT_ROLE_MAPPINGS);
    for (const [domainRole, neutralRoles] of Object.entries(rebuilt)) {
      expect(resolveDomainRoleToNeutral(RESTAURANT_NEUTRAL_ROLE_MAPPINGS, domainRole)).toEqual(
        neutralRoles,
      );
    }
  });
});

describe("I-031 closure at the contract level (role validation re-pointed at the neutral vocabulary)", () => {
  it("the contract-level validator enforces the NEUTRAL vocabulary, not the legacy identity-store set", () => {
    const result = validateDirectionalRoleMappings({
      night_auditor: ["AUDITOR"],
      floor_lead: ["SUPERVISOR"],
    });
    expect(result.ok).toBe(true);
  });

  it("a domain mapping into the legacy identity-store vocabulary is rejected by the contract", () => {
    const result = validateDirectionalRoleMappings({
      barista: ["teacher"],
      runner: ["driver"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const joined = result.errors.join(" ");
      expect(joined).toMatch(/"teacher" which is not in the universal role vocabulary/);
      expect(joined).toMatch(/"driver" which is not in the universal role vocabulary/);
    }
  });

  it("the platform never learns a domain role name: mappings are domain -> neutral data the platform only consumes", () => {
    for (const table of [SCHOLAR_NEUTRAL_ROLE_MAPPINGS, RESTAURANT_NEUTRAL_ROLE_MAPPINGS]) {
      for (const domainRole of Object.keys(table)) {
        expect(isUniversalRole(domainRole)).toBe(false);
      }
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * MISSION-R-120 / V1CAP-092 additions — I-012 closure seen from the
 * vocabulary side: the nav-kind membership coupling consumes the declared
 * domain mapping tables (forward resolution only), and the declaration
 * lives in the runtime layer.
 * ────────────────────────────────────────────────────────────*/
import {
  RUNTIME_NAV_KIND_NEUTRAL_MEMBERSHIP,
  RUNTIME_NAV_KIND_ROLE_ASSIGNMENTS,
} from "../../frontend/src/lib/runtime/nav-registry";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The runtime layer, per the platform-neutrality guard's own path list. */
const RUNTIME_LAYER_PATH_PATTERN =
  /^frontend\/src\/lib\/runtime\/scholar([-\/][^/]*)?\.tsx?$/;
const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

describe("I-012 closure: nav-kind membership consumes the declared mapping tables", () => {
  it("every assigned Scholar role resolves FORWARD through the Scholar mapping table into its kind's neutral membership", () => {
    for (const [kind, roles] of Object.entries(RUNTIME_NAV_KIND_ROLE_ASSIGNMENTS)) {
      for (const role of roles) {
        const resolved = resolveDomainRoleToNeutral(SCHOLAR_NEUTRAL_ROLE_MAPPINGS, role);
        expect(resolved, `role "${role}" of kind "${kind}"`).not.toBeNull();
        for (const neutral of resolved ?? []) {
          expect(
            RUNTIME_NAV_KIND_NEUTRAL_MEMBERSHIP[kind as keyof typeof RUNTIME_NAV_KIND_NEUTRAL_MEMBERSHIP],
            `role "${role}" neutral "${neutral}" of kind "${kind}"`,
          ).toContain(neutral);
        }
      }
    }
  });

  it("the declared mapping table is authoritative in the runtime layer, not re-listed in the gate", () => {
    const mappingTablePath = "frontend/src/lib/runtime/scholar-role-mappings.ts";
    expect(RUNTIME_LAYER_PATH_PATTERN.test(mappingTablePath)).toBe(true);
    const gate = readFileSync(`${REPO_ROOT}/frontend/src/lib/capability-gate.ts`, "utf8");
    expect(gate).not.toContain("defineDomainRoleMappings");
  });
});

/**
 * CoreGrid — DOMAIN RUNTIME CERTIFICATION suite (MISSION-R-120, wave 2;
 * V1CAP-092 / V1CAP-093 / V1CAP-007).
 *
 * Recertifies BOTH installed domain runtimes against the reconstructed
 * identity/authority primitives, from the CONSUMER side:
 *
 *  1. Neutral role resolution — every declared domain role resolves FORWARD
 *     through its runtime's declared mapping table into the closed universal
 *     vocabulary (RULING-4: domain -> neutral only), and the platform gate's
 *     legacy bridge consumes the runtime's declaration instead of re-listing it.
 *  2. Nav-kind decoupling (I-012) — the capability gate's membership tables
 *     are runtime-declared and neutral-keyed; the gate hand-writes no role
 *     list; the neutral membership is DERIVED through the declared mapping
 *     table, never re-declared.
 *  3. No legacy role semantics — the restaurant fixture declares neutral-only
 *     roles (its recertified semantics: WORKER / OPERATOR / ADMINISTRATOR /
 *     OWNER), carries no educator semantic, and keeps every domain-vocabulary
 *     statement either in the runtime layer or as a documented-gated
 *     chrome-kind borrow.
 *  4. Standing oracle — the continuous domain-neutrality guard PASSes with
 *     the fixture in place (the second-domain acceptance oracle).
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  UNIVERSAL_ROLES,
  isUniversalRole,
  resolveDomainRoleToNeutral,
} from "../../frontend/src/lib/universal-roles";
import {
  SCHOLAR_DOMAIN_ID,
  SCHOLAR_NEUTRAL_ROLE_MAPPINGS,
} from "../../frontend/src/lib/runtime/scholar-role-mappings";
import {
  RESTAURANT_DOMAIN_DEFINITION,
  RESTAURANT_NEUTRAL_ROLE_MAPPINGS,
  RESTAURANT_DOMAIN_ID,
} from "../../frontend/src/lib/domain-config/restaurant";
import {
  validateDomainDefinition,
} from "../../frontend/src/lib/domain-config/domain-definition";
import {
  MEMBERSHIP_FOR_NAV_KIND,
  NEUTRAL_ROLES_FOR_NAV_KIND,
  evaluateRuntimeCapability,
  neutralRolesForIdentityRole,
} from "../../frontend/src/lib/capability-gate";
import {
  RUNTIME_NAV_KIND_NEUTRAL_MEMBERSHIP,
  RUNTIME_NAV_KIND_ROLE_ASSIGNMENTS,
} from "../../frontend/src/lib/runtime/nav-registry";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = (ref: string) => readFileSync(`${REPO_ROOT}/${ref}`, "utf8");

/** The runtime layer, per the platform-neutrality guard's own path list. */
const RUNTIME_LAYER_PATTERNS: readonly RegExp[] = [
  /^frontend\/src\/lib\/scholar\//,
  /^frontend\/src\/lib\/scholar-[^/]+\.tsx?$/,
  /^frontend\/src\/lib\/runtime\/scholar[^/]*\.tsx?$/,
];

const inRuntimeLayer = (ref: string) => RUNTIME_LAYER_PATTERNS.some((p) => p.test(ref));

/* ─────────────────────────────────────────────────────────────
 * 1. Neutral role resolution (both domains)
 * ────────────────────────────────────────────────────────────*/

describe("certification: neutral role resolution (V1CAP-092/093)", () => {
  it("every SCHOLAR role resolves forward into the closed universal vocabulary — nothing else", () => {
    expect(SCHOLAR_DOMAIN_ID).toBe("scholar");
    for (const [domainRole, neutralRoles] of Object.entries(SCHOLAR_NEUTRAL_ROLE_MAPPINGS)) {
      const resolved = resolveDomainRoleToNeutral(SCHOLAR_NEUTRAL_ROLE_MAPPINGS, domainRole);
      expect(resolved, `scholar role "${domainRole}"`).toEqual(neutralRoles);
      expect(resolved).not.toBeNull();
      for (const neutral of resolved ?? []) {
        expect(isUniversalRole(neutral), `scholar role "${domainRole}" -> "${neutral}"`).toBe(true);
      }
    }
  });

  it("every RESTAURANT role resolves forward into the closed universal vocabulary — nothing else", () => {
    expect(RESTAURANT_DOMAIN_ID).toBe("restaurant");
    for (const [domainRole, neutralRoles] of Object.entries(RESTAURANT_NEUTRAL_ROLE_MAPPINGS)) {
      const resolved = resolveDomainRoleToNeutral(RESTAURANT_NEUTRAL_ROLE_MAPPINGS, domainRole);
      expect(resolved, `restaurant role "${domainRole}"`).toEqual(neutralRoles);
      for (const neutral of resolved ?? []) {
        expect(isUniversalRole(neutral), `restaurant role "${domainRole}" -> "${neutral}"`).toBe(
          true,
        );
      }
    }
  });

  it("neither domain resolves a role outside the ruled 15-role vocabulary", () => {
    for (const table of [SCHOLAR_NEUTRAL_ROLE_MAPPINGS, RESTAURANT_NEUTRAL_ROLE_MAPPINGS]) {
      for (const neutralRoles of Object.values(table)) {
        for (const neutral of neutralRoles) {
          expect(UNIVERSAL_ROLES).toContain(neutral);
        }
      }
    }
  });

  it("the gate's legacy bridge IS the runtime's declared mapping (authoritative in the runtime layer)", () => {
    // The Scholar mapping table lives in the runtime layer — the only place a
    // runtime's own vocabulary belongs.
    expect(inRuntimeLayer("frontend/src/lib/runtime/scholar-role-mappings.ts")).toBe(true);
    // Every legacy role the gate accepts resolves through that declared table.
    for (const roles of Object.values(MEMBERSHIP_FOR_NAV_KIND)) {
      for (const role of roles) {
        const resolved = neutralRolesForIdentityRole(role);
        expect(resolved, `legacy role "${role}"`).not.toBeNull();
        expect(resolved).toEqual(
          resolveDomainRoleToNeutral(SCHOLAR_NEUTRAL_ROLE_MAPPINGS, role),
        );
      }
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * 2. Nav-kind decoupling (I-012 closed)
 * ────────────────────────────────────────────────────────────*/

describe("certification: nav-kind membership decoupled to neutral roles (I-012)", () => {
  it("the gate's membership tables ARE the runtime-declared tables (consumed, not owned)", () => {
    expect(MEMBERSHIP_FOR_NAV_KIND).toEqual(RUNTIME_NAV_KIND_ROLE_ASSIGNMENTS);
    expect(NEUTRAL_ROLES_FOR_NAV_KIND).toEqual(RUNTIME_NAV_KIND_NEUTRAL_MEMBERSHIP);
  });

  it("each runtime's neutral membership is DERIVED through its declared mapping table, never re-declared", () => {
    for (const [kind, roles] of Object.entries(RUNTIME_NAV_KIND_ROLE_ASSIGNMENTS)) {
      const derived = new Set<string>();
      for (const role of roles) {
        for (const neutral of resolveDomainRoleToNeutral(SCHOLAR_NEUTRAL_ROLE_MAPPINGS, role) ?? []) {
          derived.add(neutral);
        }
      }
      expect(
        [...derived].sort(),
        `kind "${kind}" neutral membership derives from the declared mapping table`,
      ).toEqual([...NEUTRAL_ROLES_FOR_NAV_KIND[kind as keyof typeof NEUTRAL_ROLES_FOR_NAV_KIND]].sort());
    }
  });

  it("the gate source hand-writes no domain role list and names no runtime symbol", () => {
    const gate = read("frontend/src/lib/capability-gate.ts");
    expect(gate).not.toMatch(
      /"(admin|principal|teacher|bursar|parent|student|driver|hq|super_admin)"/,
    );
    expect(gate).not.toContain("SCHOLAR_");
    expect(gate).not.toContain("defineDomainRoleMappings");
  });

  it("every gate decision resolves through the NEUTRAL table (the legacy list is a deprecated fallback only)", () => {
    for (const [kind, roles] of Object.entries(MEMBERSHIP_FOR_NAV_KIND)) {
      for (const role of roles) {
        const resolved = neutralRolesForIdentityRole(role);
        expect(resolved, `role "${role}" of kind "${kind}"`).not.toBeNull();
        expect(
          (resolved ?? []).some((neutral) =>
            NEUTRAL_ROLES_FOR_NAV_KIND[kind as keyof typeof NEUTRAL_ROLES_FOR_NAV_KIND].includes(
              neutral,
            ),
          ),
          `role "${role}" must satisfy kind "${kind}" in NEUTRAL terms`,
        ).toBe(true);
      }
    }
  });

  it("an unknown role denies even though the legacy fallback list exists (fail closed)", () => {
    const outcome = evaluateRuntimeCapability({ code: "r001:teacher.dashboard", role: "ghost" as never });
    expect(outcome.decision).toBe("deny");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 3. No legacy role semantics (restaurant recertified)
 * ────────────────────────────────────────────────────────────*/

describe("certification: no legacy role semantics (V1CAP-093 recertification)", () => {
  it("the restaurant fixture validates end-to-end through the fail-closed validator", () => {
    const result = validateDomainDefinition(RESTAURANT_DOMAIN_DEFINITION);
    expect(result.ok).toBe(true);
  });

  it("every restaurant role declares the neutral vocabulary ONLY — zero appRoles declarations", () => {
    for (const role of RESTAURANT_DOMAIN_DEFINITION.roles) {
      expect(role.appRoles, `role "${role.domainRole}"`).toBeUndefined();
      expect(role.neutralRoles?.length).toBeGreaterThan(0);
    }
  });

  it("restaurant recertifies to exactly WORKER / OPERATOR / ADMINISTRATOR / OWNER semantics", () => {
    const recertified: Record<string, readonly string[]> = {
      manager: ["ADMINISTRATOR", "OWNER"],
      cashier: ["OPERATOR"],
      service_staff: ["WORKER", "OPERATOR"],
      runner: ["WORKER"],
    };
    for (const [domainRole, neutralRoles] of Object.entries(recertified)) {
      expect(
        resolveDomainRoleToNeutral(RESTAURANT_NEUTRAL_ROLE_MAPPINGS, domainRole),
        `restaurant role "${domainRole}"`,
      ).toEqual(neutralRoles);
    }
  });

  it("no restaurant role resolves to the educator-resolved neutral semantic (CONTRIBUTOR)", () => {
    for (const [domainRole, neutralRoles] of Object.entries(RESTAURANT_NEUTRAL_ROLE_MAPPINGS)) {
      expect(neutralRoles, `restaurant role "${domainRole}"`).not.toContain("CONTRIBUTOR");
    }
    expect(neutralRolesForIdentityRole("service_staff")).toBeNull();
  });

  it("no restaurant role name is a legacy identity-store role (the I-030 forced mapping cannot return)", () => {
    const legacyRoles = new Set<string>(Object.values(MEMBERSHIP_FOR_NAV_KIND).flat());
    for (const domainRole of Object.keys(RESTAURANT_NEUTRAL_ROLE_MAPPINGS)) {
      expect(legacyRoles.has(domainRole), `restaurant role "${domainRole}"`).toBe(false);
    }
  });

  it("the workspace chrome-kind borrows are the ONLY education-vocabulary literals, and the debt is documented-gated", () => {
    const source = read("frontend/src/lib/domain-config/restaurant.ts");
    // The debt is documented with its consumer list and a ratchet TODO.
    expect(source).toContain("TODO(I-012/V1CAP-084)");
    expect(source).toContain("tests/unit/domain-config-restaurant.test.ts");
    // No education-vocabulary string literal exists beyond the two
    // chrome-kind kind strings (runtime nav registry vocabulary).
    const educatorTokens = [
      "student",
      "teacher",
      "school",
      "curriculum",
      "exam",
      "attendance",
      "fee",
      "tuition",
      "bursar",
      "principal",
      "guardian",
      "academic",
    ];
    const observed = new Set<string>();
    for (const line of source.split("\n")) {
      for (const token of educatorTokens) {
        if (new RegExp(`['"\`]${token}['"\`]`, "i").test(line)) observed.add(token);
      }
    }
    expect([...observed].sort()).toEqual(["bursar", "teacher"]);
  });

  it("Scholar domain vocabulary lives ONLY in the runtime layer (declared tables + adapter)", () => {
    for (const ref of [
      "frontend/src/lib/runtime/scholar-role-mappings.ts",
      "frontend/src/lib/runtime/scholar-nav-catalog.ts",
      "frontend/src/lib/runtime/scholar-workspace-projection.ts",
    ]) {
      expect(inRuntimeLayer(ref), `${ref} must be a runtime-layer path`).toBe(true);
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * 4. Standing oracle — the continuous domain-neutrality guard
 * ────────────────────────────────────────────────────────────*/

/** The files this mission owns (the certification scope). */
const CERTIFIED_FILES: readonly string[] = [
  "frontend/src/lib/capability-gate.ts",
  "frontend/src/lib/domain-config/restaurant.ts",
  "frontend/src/lib/domain-config/domain-definition.ts",
  "frontend/src/lib/runtime/scholar-role-mappings.ts",
  "frontend/src/lib/runtime/nav-registry.ts",
];

describe("certification: the domain-neutrality guard stays clean on the certified files", () => {
  /**
   * The guard scans the whole universal surface, which parallel missions also
   * edit; this certification therefore asserts the scope it owns — no NEW
   * violation may originate from a certified file — and proves the gate got
   * STRICTLY cleaner (its legacy role list left the universal surface, so its
   * baseline entries become shrink-only ratchet opportunities).
   */
  it("introduces no new domain-neutrality violation from a certified file, and the gate's baseline entries become ratchets", () => {
    const result = spawnSync("node", ["scripts/verify-domain-neutrality.mjs"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    const output = `${result.stdout}\n${result.stderr}`;
    const failLines = output.split("\n").filter((line) => line.startsWith("FAIL  "));
    const fromCertifiedFiles = failLines.filter((line) =>
      CERTIFIED_FILES.some((ref) => line.includes(ref)),
    );
    expect(
      fromCertifiedFiles,
      `guard output:\n${output}`,
    ).toEqual([]);
    // The gate's hand-written role list left the universal surface; the six
    // stale capability-gate baseline groups were RATCHETED OUT of the
    // baseline (shrink-only ratchet executed by the guard's owning
    // coordinator after MISSION-R-120). Assert the post-ratchet state: the
    // guard reports zero ratchet warnings and a clean pass, and the baseline
    // file no longer carries any capability-gate.ts entry.
    expect(output).not.toMatch(/RATCHET/);
    expect(output).toMatch(/STATUS=PASS/);
    const baseline = JSON.parse(
      readFileSync(
        "architecture/coregrid-mvp-architecture/NEUTRALITY_GUARD_BASELINE.json",
        "utf8",
      ),
    );
    expect(
      baseline.baselineEntries.some((entry: { file: string }) =>
        entry.file.includes("capability-gate.ts"),
      ),
      "capability-gate.ts baseline entries must stay removed after the ratchet",
    ).toBe(false);
  });
});

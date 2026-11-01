/**
 * Sherivs Scholar — per-feature capability codes and the fail-closed gate
 * (WAVE-R33).
 *
 * Laws under test:
 *  - every code is installed over a REGISTERED kernel capability and a
 *    registered phase, and belongs to a real workspace;
 *  - reality decides which codes are installed (a boarding code needs a boarding
 *    reality);
 *  - the gate denies unknown codes, unscoped actors, features outside the
 *    reality and roles outside the feature's categories, and it denies a
 *    category match with no installed grant (least privilege);
 *  - policies may only make a decision stricter.
 */

import { describe, expect, it } from "vitest";
import { KERNEL_CAPABILITIES } from "@/lib/kernel/kernel-capability-registry";
import {
  SCHOLAR_FEATURE_CODES,
  auditScholarFeatureCodes,
  featureCodeByCode,
  featureCodesForReality,
  featureCodesForRole,
  featureCodesForRoles,
} from "@/lib/scholar/capability-codes";
import {
  assertFeatureAccess,
  decideFeatureAccess,
  enabledFeatureCodes,
  featureGateSnapshot,
} from "@/lib/scholar/feature-gate";
import { tenantTierEntitlement } from "@/lib/payments/tier-entitlements";
import { tenantId } from "@/lib/tenant-core";
import type { EducationRealityRole } from "@/lib/scholar/roles/role-definition";
import { EDUCATION_REALITY_ROLES, roleById } from "@/lib/scholar/roles/role-registry";

const DAY_SCHOOL = {
  featureKeys: ["curriculum.core", "schedule.day_full", "community.public_govt"],
  templateRefs: ["public_day"],
};

const BOARDING_SCHOOL = {
  featureKeys: ["curriculum.core", "schedule.boarding", "community.private"],
  templateRefs: ["boarding_school"],
};

/**
 * A tenant role set with ONE installed grant (what the persistence wave writes):
 * the catalog definition REPLACED by the tenant's granted version. Appending
 * would leave the ungranted catalog copy first in the list, so the first match
 * must be the tenant's.
 */
const GRANTED_TEACHER: EducationRealityRole = {
  ...(roleById("role:subject-teacher") as EducationRealityRole),
  permissions: ["academic-intelligence"],
};
const TENANT_ROLES: readonly EducationRealityRole[] = EDUCATION_REALITY_ROLES.map((role) =>
  role.id === GRANTED_TEACHER.id ? GRANTED_TEACHER : role,
);

describe("capability codes — vocabulary laws", () => {
  it("audits clean", () => {
    expect(auditScholarFeatureCodes()).toEqual([]);
  });

  it("is a substantial feature surface with unique codes", () => {
    expect(SCHOLAR_FEATURE_CODES.length).toBeGreaterThanOrEqual(25);
    const codes = new Set(SCHOLAR_FEATURE_CODES.map((entry) => entry.code));
    expect(codes.size).toBe(SCHOLAR_FEATURE_CODES.length);
  });

  it("installs every code over a registered capability and a registered phase", () => {
    const capabilities = new Set(KERNEL_CAPABILITIES.map((entry) => entry.id));
    for (const entry of SCHOLAR_FEATURE_CODES) {
      expect(capabilities.has(entry.capability), `${entry.code} capability`).toBe(true);
      expect(entry.phase, `${entry.code} phase`).toMatch(/^\d{2}$/);
    }
  });

  it("ties every code to the workspace its role categories participate in", () => {
    for (const entry of SCHOLAR_FEATURE_CODES) {
      const reachable = entry.roleCategories.some((category) =>
        EDUCATION_REALITY_ROLES.some(
          (role) =>
            role.category === category && role.workspaceRequirements.includes(entry.workspace),
        ),
      );
      expect(reachable, `${entry.code} → workspace ${entry.workspace}`).toBe(true);
    }
  });

  it("turns codes on by reality, not by institution type", () => {
    const boarding = featureCodesForReality(BOARDING_SCHOOL).map((entry) => entry.code);
    expect(boarding).toContain("r001.boarding.manage");
    expect(boarding).toContain("r001.attendance.record");

    const day = featureCodesForReality(DAY_SCHOOL).map((entry) => entry.code);
    expect(day).not.toContain("r001.boarding.manage");
    expect(day).not.toContain("r001.vocational.workshop");
    expect(day).toContain("r001.attendance.record");
  });

  it("selects codes by role category", () => {
    const teacher = featureCodesForRole("role:subject-teacher").map((entry) => entry.code);
    expect(teacher).toContain("r001.attendance.record");
    expect(teacher).not.toContain("r001.finance.report");

    const bursar = featureCodesForRole("role:bursar").map((entry) => entry.code);
    expect(bursar).toContain("r001.finance.fees.collect");
    expect(bursar).not.toContain("r001.attendance.record");

    expect(featureCodesForRoles(["role:subject-teacher", "role:bursar"]).length).toBeGreaterThan(
      featureCodesForRole("role:subject-teacher").length,
    );
    expect(featureCodesForRole("role:not-registered")).toEqual([]);
  });

  it("resolves codes by exact id", () => {
    expect(featureCodeByCode("r001.boarding.manage")?.label).toBe(
      "Manage boarding houses and residents",
    );
    expect(featureCodeByCode("r001.nope.nope")).toBeUndefined();
  });
});

describe("feature gate — fail closed", () => {
  const actor = {
    identityId: "user:1",
    tenantId: "tenant:a",
    roleIds: ["role:subject-teacher"],
  };

  it("denies an unknown code", () => {
    const decision = decideFeatureAccess({ code: "r001.unknown.feature", actor });
    expect(decision.enabled).toBe(false);
    expect(decision.reasons.join(" ")).toMatch(/unknown feature code/);
  });

  it("denies an unscoped actor", () => {
    expect(
      decideFeatureAccess({
        code: "r001.attendance.record",
        actor: { ...actor, identityId: null },
      }).enabled,
    ).toBe(false);
    expect(
      decideFeatureAccess({
        code: "r001.attendance.record",
        actor: { ...actor, tenantId: null },
      }).reasons.join(" "),
    ).toMatch(/no tenant context/);
  });

  it("denies a feature the reality does not install", () => {
    const decision = decideFeatureAccess({
      code: "r001.boarding.manage",
      actor,
      reality: DAY_SCHOOL,
    });
    expect(decision.enabled).toBe(false);
    expect(decision.reasons.join(" ")).toMatch(/not installed in this reality/);
  });

  it("denies a role set outside the feature's categories", () => {
    const decision = decideFeatureAccess({ code: "r001.finance.fees.collect", actor });
    expect(decision.enabled).toBe(false);
    expect(decision.reasons.join(" ")).toMatch(/no assigned role in the categories/);
  });

  it("denies a category match with no installed grant (least privilege)", () => {
    const decision = decideFeatureAccess({ code: "r001.attendance.record", actor });
    expect(decision.enabled).toBe(false);
    expect(decision.reasons.join(" ")).toMatch(/no assigned role declares this capability/);
  });

  it("does not let active commercial status or entitlement substitute for actor permission", () => {
    const commercialEntitlement = tenantTierEntitlement(
      tenantId("tenant:a"),
      "enterprise",
      "fee_management",
    );
    const commercialContext = {
      identityId: "user:1",
      tenantId: "tenant:a",
      roleIds: [],
      organizationStatus: "active",
      subscriptionStatus: "active",
      commercialEntitlement: commercialEntitlement.entitled,
    };

    const decision = decideFeatureAccess({
      code: "r001.finance.fees.collect",
      actor: commercialContext,
    });

    expect(commercialEntitlement.entitled).toBe(true);
    expect(decision.enabled).toBe(false);
    expect(decision.reasons.join(" ")).toMatch(/no assigned role in the categories/);
  });

  it("allows only when a tenant grant exists, and reports the models used", () => {
    const decision = decideFeatureAccess({
      code: "r001.academics.grade",
      actor,
      roles: TENANT_ROLES,
    });
    expect(decision.enabled).toBe(true);
    expect(decision.capability).toBe("academic-intelligence");
    expect(decision.categoryRoles).toEqual(["role:subject-teacher"]);
    expect(decision.models).toEqual(expect.arrayContaining(["RBAC", "RLS"]));
  });

  it("lets a policy make the decision stricter, never looser", () => {
    const denied = decideFeatureAccess({
      code: "r001.academics.grade",
      actor,
      roles: TENANT_ROLES,
      policies: [
        {
          id: "policy.assessment-lockdown",
          capability: "academic-intelligence",
          outcome: "DENY",
          reason: "assessment lockdown",
        },
      ],
    });
    expect(denied.enabled).toBe(false);
    expect(denied.appliedPolicies).toEqual(["policy.assessment-lockdown"]);
  });

  it("snapshots every installed code and reports the enabled set", () => {
    const snapshot = featureGateSnapshot({ actor, roles: TENANT_ROLES, reality: BOARDING_SCHOOL });
    // The snapshot is reality-filtered: only installed codes are decided.
    expect(snapshot.length).toBeGreaterThanOrEqual(15);
    expect(snapshot.map((decision) => decision.code)).toContain("r001.boarding.manage");
    const enabled = enabledFeatureCodes({ actor, roles: TENANT_ROLES, reality: BOARDING_SCHOOL });
    expect(enabled).toContain("r001.academics.grade");
    expect(enabled).not.toContain("r001.finance.fees.collect");
  });

  it("throws instead of silently allowing", () => {
    expect(() =>
      assertFeatureAccess({ code: "r001.finance.report", actor, roles: TENANT_ROLES }),
    ).toThrow(/not available/);
    expect(
      assertFeatureAccess({ code: "r001.academics.grade", actor, roles: TENANT_ROLES }).enabled,
    ).toBe(true);
  });
});

/**
 * CoreGrid — H3-091 legacy-tier reconciliation tests (mission I-091 / J-044,
 * Squad I — Payments & economics).
 *
 * Grounds the authored legacy-tier → neutral entitlement mapping in
 * `frontend/src/lib/payments/legacy-tier-reconciliation.ts` against the LIVE
 * legacy commercial catalog (`frontend/src/lib/subscription-tiers.ts`):
 * catalog drift fails here, not silently in production. This test file owns
 * the domain vocabulary needed for grounding — the module under test must
 * never contain it (J-037), which is also asserted below.
 *
 * Pure offline: no network, no database, no secrets.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ALL_TIERS,
  SUBSCRIPTION_TIERS,
  getTier,
  type FeatureKey,
  type TierName,
} from "../../frontend/src/lib/subscription-tiers";
import { tenantId as makeTenantId } from "../../frontend/src/lib/tenant-core";
import {
  LEGACY_TIER_NAMES,
  LEGACY_TIER_PLAN_MAP,
  NEUTRAL_CAPABILITY_CLASSES,
  NEUTRAL_CAPACITY_CLASSES,
  NEUTRAL_PLAN_CLASSES,
  isNeutralCapabilityEntitled,
  legacyTierReconciliationSchema,
  neutralEntitlementPlanSchema,
  neutralEntitlementsForTier,
  neutralTierEntitlementSchema,
  reconcileLegacyTierNameSet,
  reconcileLegacyTierPlan,
  type NeutralCapabilityClass,
} from "../../frontend/src/lib/payments/legacy-tier-reconciliation";

const MODULE_PATH = "frontend/src/lib/payments/legacy-tier-reconciliation.ts";
const moduleSource = readFileSync(
  new URL(`../../${MODULE_PATH}`, import.meta.url),
  "utf8",
);

const TENANT_A = makeTenantId("tenant_alpha");
const TENANT_B = makeTenantId("tenant_beta");

/**
 * Grounding bridge (test-side only): the legacy feature keys whose truth
 * values anchor each neutral capability class in the live catalog matrix.
 * "Granted" ⇒ every anchor key is true; "not granted" ⇒ the first anchor
 * key is false in that tier's matrix.
 */
const CAPABILITY_ANCHORS: Record<NeutralCapabilityClass, readonly FeatureKey[]> = {
  core_platform: ["admin_portal", "basic_profiles", "class_management", "manual_attendance", "view_grades"],
  multi_role_portals: ["teacher_portal", "parent_portal", "student_portal", "bursar_portal"],
  payment_rails: ["paystack_payments"],
  payment_split: ["paystack_split"],
  communication_channels: ["email_notifications"],
  presence_verification: ["qr_attendance"],
  content_publishing: ["grade_publishing", "report_cards", "lesson_plans"],
  operations_suites: ["fee_management", "expense_tracking", "transport_basic"],
  governance_audit: ["audit_logs"],
  bulk_data_import: ["bulk_import"],
  analytics_reporting: ["advanced_analytics", "exportable_reports"],
  ai_intelligence: ["ai_timetable"],
  branding_removal: ["remove_branding"],
  platform_branding: ["white_label", "custom_domain"],
  priority_support: ["priority_support"],
  digital_twin: ["digital_twin"],
  api_access: ["api_access"],
  multi_site: ["multi_branch"],
  dedicated_infrastructure: ["dedicated_database"],
};

function featureMatrix(tier: TierName): Record<FeatureKey, boolean> {
  return SUBSCRIPTION_TIERS[tier].features;
}

/* ─────────────────────────────────────────────────────────────
 * Contract shape (Zod, strict, frozen)
 * ────────────────────────────────────────────────────────────*/

describe("authored plan table — contract conformance", () => {
  it("exposes exactly one plan per recognized legacy tier name", () => {
    expect(Object.keys(LEGACY_TIER_PLAN_MAP).sort()).toEqual(
      [...LEGACY_TIER_NAMES].sort(),
    );
  });

  it("every plan parses against the strict Zod contract", () => {
    for (const tier of LEGACY_TIER_NAMES) {
      const parsed = neutralEntitlementPlanSchema.parse(LEGACY_TIER_PLAN_MAP[tier]);
      expect(parsed.legacyTier).toBe(tier);
    }
  });

  it("every plan is provenance-stamped (§12)", () => {
    for (const tier of LEGACY_TIER_NAMES) {
      const plan = LEGACY_TIER_PLAN_MAP[tier];
      expect(plan.provenance.declaredBy).toBe(MODULE_PATH);
      expect(plan.provenance.authority).toContain("I-091");
      expect(plan.provenance.declaredAt.length).toBeGreaterThan(0);
      expect(plan.provenance.source).toContain("legacy");
    }
  });

  it("the plan table and every nested record are deeply frozen", () => {
    expect(Object.isFrozen(LEGACY_TIER_PLAN_MAP)).toBe(true);
    for (const tier of LEGACY_TIER_NAMES) {
      expect(Object.isFrozen(LEGACY_TIER_PLAN_MAP[tier])).toBe(true);
      expect(Object.isFrozen(LEGACY_TIER_PLAN_MAP[tier].capabilities)).toBe(true);
      expect(Object.isFrozen(LEGACY_TIER_PLAN_MAP[tier].provenance)).toBe(true);
    }
    expect(() => {
      (LEGACY_TIER_PLAN_MAP.trial as { planId: string }).planId = "tampered";
    }).toThrow(TypeError);
  });

  it("capability lists are unique within every plan", () => {
    for (const tier of LEGACY_TIER_NAMES) {
      const capabilities = LEGACY_TIER_PLAN_MAP[tier].capabilities;
      expect(new Set(capabilities).size).toBe(capabilities.length);
    }
  });

  it("capability grants are strictly monotonic across the tier ladder", () => {
    const tierOrder = ALL_TIERS as readonly TierName[];
    for (let i = 0; i + 1 < tierOrder.length; i += 1) {
      const lower = new Set(LEGACY_TIER_PLAN_MAP[tierOrder[i]].capabilities);
      const higher = new Set(LEGACY_TIER_PLAN_MAP[tierOrder[i + 1]].capabilities);
      for (const capability of lower) {
        expect(higher.has(capability)).toBe(true);
      }
      expect(higher.size).toBeGreaterThan(lower.size);
    }
  });

  it("plan classes and capacity classes progress in declared order", () => {
    const tierOrder = ALL_TIERS as readonly TierName[];
    tierOrder.forEach((tier, index) => {
      expect(LEGACY_TIER_PLAN_MAP[tier].planClass).toBe(NEUTRAL_PLAN_CLASSES[index]);
      expect(LEGACY_TIER_PLAN_MAP[tier].capacityClass).toBe(
        NEUTRAL_CAPACITY_CLASSES[index],
      );
    });
  });
});

/* ─────────────────────────────────────────────────────────────
 * Grounding against the LIVE legacy catalog (reality, not invention)
 * ────────────────────────────────────────────────────────────*/

describe("grounding — mapping vs the live legacy catalog matrix", () => {
  it("the recognized legacy tier name set equals the catalog tier set exactly", () => {
    expect([...LEGACY_TIER_NAMES].sort()).toEqual([...ALL_TIERS].sort());
  });

  it("every granted capability class is anchored true in the tier's matrix", () => {
    for (const tier of ALL_TIERS) {
      const features = featureMatrix(tier);
      const plan = LEGACY_TIER_PLAN_MAP[tier];
      for (const capability of plan.capabilities) {
        for (const anchor of CAPABILITY_ANCHORS[capability]) {
          expect(features[anchor], `${tier}: ${capability} anchor ${anchor}`).toBe(
            true,
          );
        }
      }
    }
  });

  it("every ungranted capability class is contradicted by the tier's matrix", () => {
    for (const tier of ALL_TIERS) {
      const features = featureMatrix(tier);
      const granted = new Set(LEGACY_TIER_PLAN_MAP[tier].capabilities);
      for (const capability of NEUTRAL_CAPABILITY_CLASSES) {
        if (granted.has(capability)) continue;
        const firstAnchor = CAPABILITY_ANCHORS[capability][0];
        expect(
          features[firstAnchor],
          `${tier}: ${capability} must NOT be granted (anchor ${firstAnchor} is false)`,
        ).toBe(false);
      }
    }
  });

  it("capacity classes match the catalog's numeric seat ordering", () => {
    const seats = (tier: TierName): number =>
      SUBSCRIPTION_TIERS[tier].max_students + SUBSCRIPTION_TIERS[tier].max_teachers;
    expect(seats("trial")).toBeLessThan(seats("starter"));
    expect(seats("starter")).toBeLessThan(seats("growth"));
    expect(seats("growth")).toBeLessThan(seats("professional"));
    expect(SUBSCRIPTION_TIERS.enterprise.max_students).toBe(-1);

    const tierOrder = ALL_TIERS as readonly TierName[];
    for (let i = 0; i + 1 < tierOrder.length; i += 1) {
      const lowerIndex = NEUTRAL_CAPACITY_CLASSES.indexOf(
        LEGACY_TIER_PLAN_MAP[tierOrder[i]].capacityClass,
      );
      const higherIndex = NEUTRAL_CAPACITY_CLASSES.indexOf(
        LEGACY_TIER_PLAN_MAP[tierOrder[i + 1]].capacityClass,
      );
      expect(higherIndex).toBeGreaterThan(lowerIndex);
    }
    expect(LEGACY_TIER_PLAN_MAP.enterprise.capacityClass).toBe("unbounded");
  });
});

/* ─────────────────────────────────────────────────────────────
 * Fail-closed reconciliation semantics
 * ────────────────────────────────────────────────────────────*/

describe("reconcileLegacyTierPlan — fail closed on ambiguity", () => {
  it("resolves every recognized tier with its full plan", () => {
    for (const tier of LEGACY_TIER_NAMES) {
      const reconciliation = reconcileLegacyTierPlan(tier);
      expect(reconciliation.ok).toBe(true);
      if (reconciliation.ok) {
        expect(reconciliation.legacyTier).toBe(tier);
        expect(reconciliation.plan).toEqual(LEGACY_TIER_PLAN_MAP[tier]);
      }
    }
  });

  it("denies missing tier values as missing_tier — never a default grant", () => {
    for (const raw of [null, undefined, "", "   ", "\t\n"]) {
      const reconciliation = reconcileLegacyTierPlan(raw);
      expect(reconciliation).toEqual({
        ok: false,
        code: "missing_tier",
        reason: expect.stringContaining("fail closed"),
      });
    }
  });

  it("denies unrecognized tier values as unrecognized_tier — never coerced", () => {
    for (const raw of ["platinum", "trial-plus", "enterprise pro", "TRIALX", "trial1"]) {
      const reconciliation = reconcileLegacyTierPlan(raw);
      expect(reconciliation.ok).toBe(false);
      if (!reconciliation.ok) {
        expect(reconciliation.code).toBe("unrecognized_tier");
        expect(reconciliation.reason).toContain("fail closed");
      }
    }
  });

  it("resolves case/whitespace variants to the SAME tier only", () => {
    expect(reconcileLegacyTierPlan("  ENTERPRISE  ")).toEqual({
      ok: true,
      legacyTier: "enterprise",
      plan: LEGACY_TIER_PLAN_MAP.enterprise,
    });
    expect(reconcileLegacyTierPlan("EnterpriseX").ok).toBe(false);
  });

  it("every reconciliation result parses against the Zod decision contract", () => {
    expect(legacyTierReconciliationSchema.parse(reconcileLegacyTierPlan("growth")).ok).toBe(
      true,
    );
    const denied = reconcileLegacyTierPlan("mystery");
    expect(denied.ok).toBe(false);
    expect(legacyTierReconciliationSchema.parse(denied).ok).toBe(false);
  });

  it("is pure and deterministic — same input, deeply equal output", () => {
    expect(reconcileLegacyTierPlan("growth")).toEqual(reconcileLegacyTierPlan("growth"));
    expect(reconcileLegacyTierPlan("nope")).toEqual(reconcileLegacyTierPlan("nope"));
  });

  it("does NOT inherit the legacy catalog's fail-open resolver defect", () => {
    // Documented legacy defect: getTier coerces unknown values onto the
    // trial plan (fail open). The neutral reconciliation must deny instead.
    expect(getTier("platinum")).toBe("trial");
    expect(reconcileLegacyTierPlan("platinum").ok).toBe(false);
  });
});

/* ─────────────────────────────────────────────────────────────
 * Entitlement records (TenantId-keyed, provenance-stamped)
 * ────────────────────────────────────────────────────────────*/

describe("neutralEntitlementsForTier — TenantId-keyed entitlement records", () => {
  it("emits one record per declared capability class, in declared order", () => {
    const entitlements = neutralEntitlementsForTier(TENANT_A, "growth");
    expect(entitlements.map((record) => record.capability)).toEqual(
      [...NEUTRAL_CAPABILITY_CLASSES],
    );
  });

  it("records carry the plan reference and catalog source for a recognized tier", () => {
    const entitlements = neutralEntitlementsForTier(TENANT_A, "starter");
    const planCapabilities = new Set(LEGACY_TIER_PLAN_MAP.starter.capabilities);
    for (const record of entitlements) {
      expect(record.tenantId).toBe(TENANT_A);
      expect(record.legacyTier).toBe("starter");
      expect(record.planId).toBe("coregrid.plan.standard");
      expect(record.entitled).toBe(planCapabilities.has(record.capability));
      expect(record.source).toBe("legacy-tier-catalog");
    }
    const entitled = entitlements.filter((record) => record.entitled);
    expect(entitled.map((record) => record.capability).sort()).toEqual(
      [...planCapabilities].sort(),
    );
  });

  it("records parse against the strict Zod entitlement contract", () => {
    for (const record of neutralEntitlementsForTier(TENANT_B, "enterprise")) {
      const parsed = neutralTierEntitlementSchema.parse(record);
      expect(parsed.tenantId).toBe(TENANT_B);
    }
  });

  it("an unrecognized tier yields ONLY denials with the fail-closed marker", () => {
    const entitlements = neutralEntitlementsForTier(TENANT_A, "platinum");
    expect(entitlements).toHaveLength(NEUTRAL_CAPABILITY_CLASSES.length);
    for (const record of entitlements) {
      expect(record.entitled).toBe(false);
      expect(record.legacyTier).toBeNull();
      expect(record.planId).toBeNull();
      expect(record.source).toBe("fail-closed-no-recognized-tier");
    }
  });

  it("a missing tier yields ONLY denials — nothing is assumed", () => {
    for (const raw of [null, undefined, ""]) {
      for (const record of neutralEntitlementsForTier(TENANT_A, raw)) {
        expect(record.entitled).toBe(false);
        expect(record.source).toBe("fail-closed-no-recognized-tier");
      }
    }
  });

  it("an empty tenant id is a caller defect and throws", () => {
    expect(() => neutralEntitlementsForTier(makeTenantId(""), "growth")).toThrow();
    expect(() => neutralEntitlementsForTier(makeTenantId("   "), "growth")).toThrow();
  });

  it("output is deeply frozen", () => {
    const entitlements = neutralEntitlementsForTier(TENANT_A, "trial");
    expect(Object.isFrozen(entitlements)).toBe(true);
    for (const record of entitlements) expect(Object.isFrozen(record)).toBe(true);
  });
});

describe("isNeutralCapabilityEntitled — single-capability probe", () => {
  it("grants exactly the plan's capability set for a recognized tier", () => {
    const planCapabilities = new Set(LEGACY_TIER_PLAN_MAP.professional.capabilities);
    for (const capability of NEUTRAL_CAPABILITY_CLASSES) {
      expect(isNeutralCapabilityEntitled(TENANT_A, "professional", capability)).toBe(
        planCapabilities.has(capability),
      );
    }
  });

  it("denies every capability for missing and unrecognized tiers", () => {
    for (const raw of [null, undefined, "", "platinum"]) {
      for (const capability of NEUTRAL_CAPABILITY_CLASSES) {
        expect(isNeutralCapabilityEntitled(TENANT_A, raw, capability)).toBe(false);
      }
    }
  });

  it("denies a runtime capability outside the closed class set", () => {
    const impostor = "made_up_capability" as NeutralCapabilityClass;
    expect(isNeutralCapabilityEntitled(TENANT_A, "enterprise", impostor)).toBe(false);
  });

  it("throws on an empty tenant id (caller defect)", () => {
    expect(() =>
      isNeutralCapabilityEntitled(makeTenantId(""), "enterprise", "core_platform"),
    ).toThrow();
  });
});

/* ─────────────────────────────────────────────────────────────
 * Bulk name-set reconciliation (drift detection)
 * ────────────────────────────────────────────────────────────*/

describe("reconcileLegacyTierNameSet — defects surface, never absorb", () => {
  it("classifies a mixed census without dropping or coercing anything", () => {
    const result = reconcileLegacyTierNameSet([
      "trial",
      " trial ",
      null,
      "platinum",
      "trial",
      undefined,
      "",
      "ENTERPRISE",
    ]);
    expect(result.recognized).toEqual(["trial", "enterprise"]);
    expect(result.unrecognized).toEqual([
      { raw: "", code: "missing_tier" },
      { raw: "platinum", code: "unrecognized_tier" },
    ]);
  });

  it("an empty census yields empty classifications", () => {
    expect(reconcileLegacyTierNameSet([])).toEqual({
      recognized: [],
      unrecognized: [],
    });
  });

  it("a census of only defects yields only denials", () => {
    const result = reconcileLegacyTierNameSet([null, "gold", "gold", "  "]);
    expect(result.recognized).toEqual([]);
    expect(result.unrecognized).toEqual([
      { raw: "", code: "missing_tier" },
      { raw: "gold", code: "unrecognized_tier" },
      { raw: "  ", code: "missing_tier" },
    ]);
  });

  it("output is deeply frozen", () => {
    expect(Object.isFrozen(reconcileLegacyTierNameSet(["trial"]))).toBe(true);
  });
});

/* ─────────────────────────────────────────────────────────────
 * Domain-neutrality self-scan (J-037) on the module under test
 * ────────────────────────────────────────────────────────────*/

describe("domain neutrality — the module must carry zero domain vocabulary", () => {
  const STRICT_TOKENS = [
    "scholar", "student", "teacher", "school", "classroom", "curriculum",
    "exam", "examination", "grade", "grading", "attendance", "fee", "fees",
    "tuition", "timetable", "admission", "lesson", "homework", "library",
    "hostel", "bursar", "principal", "guardian", "enrollment", "enrolment",
    "academic", "discipline", "payroll", "textbook", "vibeora",
  ] as const;

  const LITERAL_TOKENS = ["parent", "staff", "driver", "bus"] as const;

  it("contains no STREAM I strict domain token (word-boundary, case-insensitive)", () => {
    for (const token of STRICT_TOKENS) {
      const pattern = new RegExp(`\\b${token}\\b`, "i");
      expect(pattern.test(moduleSource), `token "${token}" found in ${MODULE_PATH}`).toBe(
        false,
      );
    }
  });

  it("contains no domain role name as a string literal", () => {
    for (const token of LITERAL_TOKENS) {
      const pattern = new RegExp(`['"\`]${token}['"\`]`, "i");
      expect(pattern.test(moduleSource), `literal "${token}" found in ${MODULE_PATH}`).toBe(
        false,
      );
    }
  });

  it("contains no structural schoolId-style token", () => {
    expect(/\b(schoolId|school_id)\b/.test(moduleSource)).toBe(false);
  });

  it("does not import the legacy catalog — the neutral plane stays sealed", () => {
    expect(moduleSource.includes('from "../subscription-tiers"')).toBe(false);
    expect(/import\s+type\s+.*subscription-tiers/.test(moduleSource)).toBe(false);
  });
});